import { useCallback, useEffect, useRef, useState } from 'react'
import { analyse, amplitudeToDb, FLOOR_DB, type Analysis, type LevelPoint } from './audio'
import { CALIBRATION_S, loadCalibration, measureCalibration, saveCalibration, type Calibration } from './calibration'

// Raw mic input: the scorer measures loudness itself, so the browser must not
// normalize, gate, or filter the signal before we record it.
const RAW_AUDIO: MediaTrackConstraints = {
  autoGainControl: false,
  noiseSuppression: false,
  echoCancellation: false,
  channelCount: 1,
}

// Chrome/Firefox record WebM/Opus; Safari only supports MP4/AAC.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

export const MAX_TAKES = 6

// Round flow from the plan: 3-2-1, a random pause so nobody can time the bark, then BARK!
// Recording starts on the cue, so the take is exactly the bark window.
const COUNTDOWN_FROM = 3
const CUE_DELAY_S = [0.5, 2]
const BARK_CUE_S = 0.8

export type RecorderStatus = 'idle' | 'requesting' | 'countdown' | 'recording' | 'analysing' | 'error'

// 3, 2, 1, then 'wait' for the random pause, then 'bark' as recording starts.
export type Cue = number | 'wait' | 'bark' | null

export interface CapturePlan {
  kind: 'take' | 'calibration'
  lengthS: number
  countdown: boolean
}

export interface Take extends Analysis {
  id: number
  recordedAt: Date
  url: string
  blob: Blob
  mimeType: string
  extension: string
  round: boolean
}

export interface LiveLevels {
  trace: LevelPoint[]
  levelDb: number
  peakDb: number
  elapsedS: number
}

export interface MicInfo {
  label: string
  settings: MediaTrackSettings
}

const EMPTY_LIVE: LiveLevels = { trace: [], levelDb: FLOOR_DB, peakDb: -Infinity, elapsedS: 0 }

function pickMimeType(): string {
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

function describeMicError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return 'Microphone access is blocked. Allow it in the browser’s site settings, then try again.'
  }
  if (err instanceof DOMException && err.name === 'NotFoundError') {
    return 'No microphone was found. Plug one in, then try again.'
  }
  return err instanceof Error ? err.message : 'The microphone could not be opened.'
}

export function useBarkRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  // The current capture, or the last one so an error knows what to retry.
  const [plan, setPlan] = useState<CapturePlan | null>(null)
  const [cue, setCue] = useState<Cue>(null)
  const [error, setError] = useState<string | null>(null)
  const [takes, setTakes] = useState<Take[]>([])
  const [live, setLive] = useState<LiveLevels>(EMPTY_LIVE)
  const [mic, setMic] = useState<MicInfo | null>(null)
  const [calibration, setCalibration] = useState<Calibration | null>(loadCalibration)

  const nextId = useRef(1)
  const stopRef = useRef<() => void>(() => {})
  const cleanupRef = useRef<() => void>(() => {})
  const urlsRef = useRef<Set<string>>(new Set())

  // Revoke object URLs for takes that dropped off the list, and all of them on unmount.
  useEffect(() => {
    const kept = new Set(takes.map((t) => t.url))
    for (const url of urlsRef.current) if (!kept.has(url)) URL.revokeObjectURL(url)
    urlsRef.current = kept
  }, [takes])

  useEffect(
    () => () => {
      cleanupRef.current()
      for (const url of urlsRef.current) URL.revokeObjectURL(url)
    },
    [],
  )

  const stop = useCallback(() => stopRef.current(), [])

  const capture = useCallback(async (next: CapturePlan) => {
    setError(null)
    setPlan(next)
    setStatus('requesting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO })
    } catch (err) {
      setError(describeMicError(err))
      setStatus('error')
      return
    }

    const track = stream.getAudioTracks()[0]
    setMic({ label: track.label, settings: track.getSettings() })

    const audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    const frame = new Float32Array(analyser.fftSize)

    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    const trace: LevelPoint[] = []
    const timers: number[] = []
    let peak = 0
    let rafId = 0
    let startedAt = 0

    const after = (s: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, s * 1000))
    }

    const tick = () => {
      analyser.getFloatTimeDomainData(frame)
      let sumSquares = 0
      for (const s of frame) {
        sumSquares += s * s
        if (Math.abs(s) > peak) peak = Math.abs(s)
      }
      const levelDb = Math.max(FLOOR_DB, amplitudeToDb(Math.sqrt(sumSquares / frame.length)))
      const elapsedS = Math.min(next.lengthS, (performance.now() - startedAt) / 1000)
      trace.push({ t: elapsedS, db: levelDb })
      setLive({ trace: trace.slice(), levelDb, peakDb: amplitudeToDb(peak), elapsedS })
      rafId = requestAnimationFrame(tick)
    }

    const cleanup = () => {
      cancelAnimationFrame(rafId)
      timers.forEach(clearTimeout)
      stream.getTracks().forEach((t) => t.stop())
      if (audioCtx.state !== 'closed') void audioCtx.close()
      cleanupRef.current = () => {}
      stopRef.current = () => {}
    }
    cleanupRef.current = cleanup

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = async () => {
      const durationS = (performance.now() - startedAt) / 1000
      cancelAnimationFrame(rafId)
      timers.forEach(clearTimeout)
      stream.getTracks().forEach((t) => t.stop())
      setCue(null)
      setStatus('analysing')

      const type = recorder.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunks, { type })
      let buffer: AudioBuffer | null = null
      try {
        buffer = await audioCtx.decodeAudioData(await blob.arrayBuffer())
      } catch {
        // Some browsers can't decode their own recording; handled per kind below.
      }
      cleanup()
      setLive(EMPTY_LIVE)

      if (next.kind === 'calibration') {
        const result = buffer
          ? measureCalibration(buffer, track.label)
          : 'This browser couldn’t read back its own recording, so calibration can’t be measured here.'
        if (typeof result === 'string') {
          setError(result)
          setStatus('error')
          return
        }
        saveCalibration(result)
        setCalibration(result)
        setStatus('idle')
        return
      }

      // Keep the take playable even if it couldn't be decoded.
      const analysis: Analysis = buffer
        ? analyse(buffer)
        : { durationS, trace, loudest: null, peakDb: amplitudeToDb(peak), peakAtS: 0, clipAtS: null }
      const take: Take = {
        ...analysis,
        id: nextId.current++,
        recordedAt: new Date(),
        url: URL.createObjectURL(blob),
        blob,
        mimeType: type,
        extension: type.includes('mp4') ? 'm4a' : 'webm',
        round: next.countdown,
      }
      setTakes((prev) => [take, ...prev].slice(0, MAX_TAKES))
      setStatus('idle')
    }

    const begin = () => {
      setLive(EMPTY_LIVE)
      recorder.start()
      startedAt = performance.now()
      stopRef.current = () => recorder.state !== 'inactive' && recorder.stop()
      setStatus('recording')
      rafId = requestAnimationFrame(tick)
      after(next.lengthS, () => stopRef.current())
      if (next.countdown) {
        setCue('bark')
        after(BARK_CUE_S, () => setCue(null))
      }
    }

    if (!next.countdown) {
      begin()
      return
    }

    // Stopping during the countdown cancels: there is nothing to keep yet.
    stopRef.current = () => {
      cleanup()
      setCue(null)
      setStatus('idle')
    }
    setStatus('countdown')
    setCue(COUNTDOWN_FROM)
    for (let n = COUNTDOWN_FROM - 1; n >= 1; n--) after(COUNTDOWN_FROM - n, () => setCue(n))
    after(COUNTDOWN_FROM, () => setCue('wait'))
    const [minDelay, maxDelay] = CUE_DELAY_S
    after(COUNTDOWN_FROM + minDelay + Math.random() * (maxDelay - minDelay), begin)
  }, [])

  const record = useCallback(
    (lengthS: number, countdown: boolean) => capture({ kind: 'take', lengthS, countdown }),
    [capture],
  )
  const calibrate = useCallback(
    () => capture({ kind: 'calibration', lengthS: CALIBRATION_S, countdown: false }),
    [capture],
  )

  return { status, plan, cue, error, takes, live, mic, calibration, record, calibrate, stop }
}
