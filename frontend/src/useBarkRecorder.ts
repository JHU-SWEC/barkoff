import { useCallback, useEffect, useRef, useState } from 'react'
import { analyse, amplitudeToDb, FLOOR_DB, type Analysis, type LevelPoint } from './audio'

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

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'analysing' | 'error'

export interface Take extends Analysis {
  id: number
  recordedAt: Date
  url: string
  blob: Blob
  mimeType: string
  extension: string
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

export function useBarkRecorder(lengthS: number) {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [takes, setTakes] = useState<Take[]>([])
  const [live, setLive] = useState<LiveLevels>(EMPTY_LIVE)
  const [mic, setMic] = useState<MicInfo | null>(null)

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

  const start = useCallback(async () => {
    setError(null)
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
    let peak = 0
    let rafId = 0
    let stopTimer = 0
    const startedAt = performance.now()

    const tick = () => {
      analyser.getFloatTimeDomainData(frame)
      let sumSquares = 0
      for (const s of frame) {
        sumSquares += s * s
        if (Math.abs(s) > peak) peak = Math.abs(s)
      }
      const levelDb = Math.max(FLOOR_DB, amplitudeToDb(Math.sqrt(sumSquares / frame.length)))
      const elapsedS = Math.min(lengthS, (performance.now() - startedAt) / 1000)
      trace.push({ t: elapsedS, db: levelDb })
      setLive({ trace: trace.slice(), levelDb, peakDb: amplitudeToDb(peak), elapsedS })
      rafId = requestAnimationFrame(tick)
    }

    const cleanup = () => {
      cancelAnimationFrame(rafId)
      clearTimeout(stopTimer)
      stream.getTracks().forEach((t) => t.stop())
      if (audioCtx.state !== 'closed') void audioCtx.close()
      cleanupRef.current = () => {}
      stopRef.current = () => {}
    }
    cleanupRef.current = cleanup
    stopRef.current = () => recorder.state !== 'inactive' && recorder.stop()

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = async () => {
      cancelAnimationFrame(rafId)
      clearTimeout(stopTimer)
      stream.getTracks().forEach((t) => t.stop())
      setStatus('analysing')

      const type = recorder.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunks, { type })
      let analysis: Analysis
      try {
        analysis = analyse(await audioCtx.decodeAudioData(await blob.arrayBuffer()))
      } catch {
        // Keep the take playable even if this browser can't decode its own recording.
        const durationS = (performance.now() - startedAt) / 1000
        analysis = { durationS, trace, loudest: null, peakDb: amplitudeToDb(peak), peakAtS: 0, clipAtS: null }
      }
      cleanup()

      const take: Take = {
        ...analysis,
        id: nextId.current++,
        recordedAt: new Date(),
        url: URL.createObjectURL(blob),
        blob,
        mimeType: type,
        extension: type.includes('mp4') ? 'm4a' : 'webm',
      }
      setTakes((prev) => [take, ...prev].slice(0, MAX_TAKES))
      setLive(EMPTY_LIVE)
      setStatus('idle')
    }

    setLive(EMPTY_LIVE)
    recorder.start()
    setStatus('recording')
    rafId = requestAnimationFrame(tick)
    stopTimer = window.setTimeout(() => stopRef.current(), lengthS * 1000)
  }, [lengthS])

  return { status, error, takes, live, mic, start, stop }
}
