import type { Calibration } from './calibration'

// Sends a take to the local scoring server (backend/server.py), which runs score.py's score():
// loudness against the player's calibration, YAMNet likeness, and the weighted total.
// The browser decodes the take at its own rate (not 16 kHz: loudness weights the range above
// 8 kHz), so the server needs no FFmpeg.

export interface ScoreResult {
  score: number
  loudness: number
  likeness: number
  loudness_lufs: number
  over_speech_lu: number
  duration_s: number
  calibrated: boolean
  weights: { loudness: number; likeness: number }
  top: { name: string; score: number }[]
}

const UNREACHABLE = 'The scoring server isn’t reachable. Start it with python backend/server.py.'

export async function decodeMono(blob: Blob): Promise<{ samples: Float32Array<ArrayBuffer>; rate: number }> {
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
  } finally {
    void ctx.close()
  }
  // Takes are recorded mono; average the channels in case a browser wrote two.
  const samples = new Float32Array(new ArrayBuffer(decoded.length * 4))
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const channel = decoded.getChannelData(c)
    for (let i = 0; i < samples.length; i++) samples[i] += channel[i] / decoded.numberOfChannels
  }
  return { samples, rate: decoded.sampleRate }
}

export async function scoreTake(blob: Blob, calibration: Calibration | null): Promise<ScoreResult> {
  let audio: { samples: Float32Array<ArrayBuffer>; rate: number }
  try {
    audio = await decodeMono(blob)
  } catch {
    throw new Error('This browser couldn’t decode the take, so it can’t be scored here.')
  }

  const params = new URLSearchParams({ sr: String(audio.rate) })
  if (calibration) {
    params.set('noise_lufs', calibration.noiseLufs.toFixed(2))
    params.set('speech_lufs', calibration.speechLufs.toFixed(2))
  }

  let res: Response
  try {
    res = await fetch(`/api/score?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Blob([audio.samples]),
    })
  } catch {
    throw new Error(UNREACHABLE)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? UNREACHABLE)
  return body as ScoreResult
}
