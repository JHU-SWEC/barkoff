import { kWeight, powerToLufs } from './loudness'

// Level analysis for a recorded take. The trace and peak are in dBFS (0 = full scale);
// the loudest window is K-weighted LUFS, the scorer's loudness measure.

export const FLOOR_DB = -60
// The scorer measures short-term loudness over 400 ms, so we find the same window here.
export const LOUDEST_WINDOW_S = 0.4
const HOP_S = 0.02
const CLIP_THRESHOLD = 0.99

export interface LevelPoint {
  t: number
  db: number
}

export interface LoudestWindow {
  start: number
  end: number
  lufs: number
}

export interface Analysis {
  durationS: number
  trace: LevelPoint[]
  loudest: LoudestWindow | null
  peakDb: number
  peakAtS: number
  clipAtS: number | null
}

export function amplitudeToDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity
}

function powerToDb(power: number): number {
  return power > 0 ? 10 * Math.log10(power) : -Infinity
}

export function analyse(buffer: AudioBuffer): Analysis {
  const samples = buffer.getChannelData(0)
  const rate = buffer.sampleRate
  const weighted = kWeight(samples, rate)
  const hop = Math.max(1, Math.round(HOP_S * rate))
  const hops = Math.ceil(samples.length / hop)
  const meanSquares = new Float64Array(hops)
  const weightedMeanSquares = new Float64Array(hops)

  let peak = 0
  let peakIndex = 0
  let clipIndex = -1

  for (let h = 0; h < hops; h++) {
    const from = h * hop
    const to = Math.min(samples.length, from + hop)
    let sum = 0
    let weightedSum = 0
    for (let i = from; i < to; i++) {
      const s = samples[i]
      const abs = Math.abs(s)
      sum += s * s
      weightedSum += weighted[i] * weighted[i]
      if (abs > peak) {
        peak = abs
        peakIndex = i
      }
      if (clipIndex < 0 && abs >= CLIP_THRESHOLD) clipIndex = i
    }
    meanSquares[h] = sum / (to - from)
    weightedMeanSquares[h] = weightedSum / (to - from)
  }

  const trace = Array.from(meanSquares, (ms, h) => ({
    t: (h * hop) / rate,
    db: Math.max(FLOOR_DB, powerToDb(ms)),
  }))

  // Sliding mean of K-weighted power over the window; a take shorter than the window is one window.
  const span = Math.min(hops, Math.round(LOUDEST_WINDOW_S / HOP_S))
  let loudest: LoudestWindow | null = null
  if (span > 0) {
    let sum = 0
    for (let h = 0; h < span; h++) sum += weightedMeanSquares[h]
    let best = sum
    let bestStart = 0
    for (let h = span; h < hops; h++) {
      sum += weightedMeanSquares[h] - weightedMeanSquares[h - span]
      if (sum > best) {
        best = sum
        bestStart = h - span + 1
      }
    }
    loudest = {
      start: (bestStart * hop) / rate,
      end: Math.min(buffer.duration, ((bestStart + span) * hop) / rate),
      lufs: powerToLufs(best / span),
    }
  }

  return {
    durationS: buffer.duration,
    trace,
    loudest,
    peakDb: amplitudeToDb(peak),
    peakAtS: peakIndex / rate,
    clipAtS: clipIndex >= 0 ? clipIndex / rate : null,
  }
}
