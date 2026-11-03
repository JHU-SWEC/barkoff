import { useCallback, useEffect, useRef, useState } from 'react'
import { FaceDetector } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'

// Webcam distance check: barking with your mouth on the mic would win on loudness, so the player
// has to stay at arm's length, head and shoulders inside the outline, while a take records.
// Distance comes from the face's height as a share of the frame; no camera calibration needed.

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

// The panel shows the camera at 4:3, cropped from the sides. Measure against that visible frame.
export const FRAME_ASPECT = 4 / 3

// Face box height over frame height. The outline's head fits a face of about 0.36; on a typical
// laptop camera NEAR is about 35-40 cm from the screen and FAR about 80-90 cm.
const NEAR = 0.52
const FAR = 0.24
// Face centre further than this from the middle of the frame (share of frame width).
const OFF_CENTRE = 0.22
const SMOOTHING = 0.4
const DETECT_EVERY_MS = 66
// A dropped frame or a blink of motion blur shouldn't read as leaving the frame.
const LOST_AFTER_MS = 300

// What happened during a take: seconds spent too close and out of view.
// More than this and the take can't be scored.
const MAX_CLOSE_S = 0.5
const MAX_GONE_S = 1

const STORAGE_KEY = 'barkoff.camera'

export type Fit = 'none' | 'close' | 'far' | 'off-centre' | 'ok'
export type CameraStatus = 'off' | 'starting' | 'on' | 'error'

export interface PositionCheck {
  closeS: number
  goneS: number
  totalS: number
}

export type Verdict = { ok: true } | { ok: false; reason: 'unchecked' | 'close' | 'gone'; message: string }

export function judgeTake(check: PositionCheck | undefined): Verdict {
  if (!check) {
    return { ok: false, reason: 'unchecked', message: 'Turn on the camera and record again to score a take.' }
  }
  if (check.closeS > MAX_CLOSE_S) {
    return {
      ok: false,
      reason: 'close',
      message: `You were too close to the mic for ${check.closeS.toFixed(1)} s. Stay inside the outline and record again.`,
    }
  }
  if (check.goneS > MAX_GONE_S) {
    return {
      ok: false,
      reason: 'gone',
      message: `Your face left the camera for ${check.goneS.toFixed(1)} s. Stay inside the outline and record again.`,
    }
  }
  return { ok: true }
}

function classify(size: number, centreX: number): Fit {
  if (size > NEAR) return 'close'
  if (size < FAR) return 'far'
  if (Math.abs(centreX - 0.5) > OFF_CENTRE) return 'off-centre'
  return 'ok'
}

function readRemembered(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

function remember(on: boolean) {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, 'on')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode: the camera just won't turn itself on next time.
  }
}

let detectorPromise: Promise<FaceDetector> | null = null

function loadDetector(): Promise<FaceDetector> {
  detectorPromise ??= FaceDetector.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    { baseOptions: { modelAssetPath: MODEL_URL }, runningMode: 'VIDEO', minDetectionConfidence: 0.6 },
  ).catch((err: unknown) => {
    detectorPromise = null
    throw err
  })
  return detectorPromise
}

export function useHeadGuide() {
  // Turn back on if the player left it on last visit (the browser remembers the permission).
  const [status, setStatus] = useState<CameraStatus>(() => (readRemembered() ? 'starting' : 'off'))
  const [error, setError] = useState<string | null>(null)
  const [fit, setFit] = useState<Fit>('none')
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fitRef = useRef<Fit>('none')
  const watchRef = useRef<PositionCheck | null>(null)

  const open = useCallback(async () => {
    try {
      const [stream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        }),
        loadDetector(),
      ])
      streamRef.current = stream
      setStatus('on')
      remember(true)
    } catch (err) {
      setStatus('error')
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in the address bar, then try again.'
          : 'The camera or the face detector couldn’t start.',
      )
    }
  }, [])

  const start = useCallback(async () => {
    if (streamRef.current) return
    setStatus('starting')
    setError(null)
    await open()
  }, [open])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    fitRef.current = 'none'
    setFit('none')
    setStatus('off')
    remember(false)
  }, [])

  useEffect(() => {
    if (readRemembered()) void open()
    return () => streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [open])

  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    if (el && streamRef.current) {
      el.srcObject = streamRef.current
      void el.play().catch(() => {})
    }
    setVideo(el)
  }, [])

  // Run the detector while the video element is mounted.
  useEffect(() => {
    if (status !== 'on' || !video) return

    let rafId = 0
    let cancelled = false
    let lastDetect = 0
    let lastTick = performance.now()
    let lastSeen = 0
    let size = 0
    let centreX = 0.5

    void loadDetector().then((detector) => {
      const tick = (now: number) => {
        if (cancelled) return
        rafId = requestAnimationFrame(tick)
        if (now - lastDetect < DETECT_EVERY_MS || video.readyState < 2) return
        lastDetect = now

        const { videoWidth: vw, videoHeight: vh } = video
        const visibleW = Math.min(vw, vh * FRAME_ASPECT)
        const x0 = (vw - visibleW) / 2
        const faces = detector.detectForVideo(video, now).detections
        const box = faces
          .map((d) => d.boundingBox)
          .filter((b) => b != null)
          .sort((a, b) => b.height - a.height)[0]

        if (box) {
          const seenSize = box.height / vh
          size = lastSeen ? size + SMOOTHING * (seenSize - size) : seenSize
          centreX = (box.originX + box.width / 2 - x0) / visibleW
          lastSeen = now
        }
        const lost = now - lastSeen > LOST_AFTER_MS
        const next: Fit = lost ? 'none' : classify(size, centreX)
        if (lost) lastSeen = 0

        const watch = watchRef.current
        if (watch) {
          const dt = (now - lastTick) / 1000
          watch.totalS += dt
          if (next === 'close') watch.closeS += dt
          if (next === 'none') watch.goneS += dt
        }
        lastTick = now

        if (next !== fitRef.current) {
          fitRef.current = next
          setFit(next)
        }
      }
      rafId = requestAnimationFrame(tick)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  }, [status, video])

  // Bracket a take: begin when recording starts, end when it stops.
  const beginWatch = useCallback(() => {
    watchRef.current = streamRef.current ? { closeS: 0, goneS: 0, totalS: 0 } : null
  }, [])

  const endWatch = useCallback((): PositionCheck | undefined => {
    const watch = watchRef.current
    watchRef.current = null
    // Camera turned off mid-take: no evidence either way.
    return watch && streamRef.current ? watch : undefined
  }, [])

  return { status, error, fit, attachVideo, start, stop, beginWatch, endWatch }
}
