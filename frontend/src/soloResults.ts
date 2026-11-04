import type { ScoreResult } from './score'

// Solo results kept in this browser until accounts exist: the latest scored take (so Results
// survives a refresh) and the personal best. Numbers only, no audio.

export interface SoloResult {
  score: number
  loudness: number
  likeness: number
  loudnessLufs: number
  overSpeechLu: number
  calibrated: boolean
  weights: { loudness: number; likeness: number }
  top: { name: string; score: number }[]
  takeId: number
  scoredAt: number
}

export interface SoloRecord {
  last: SoloResult | null
  best: SoloResult | null
  runs: number
}

const STORAGE_KEY = 'barkoff.solo'
const EMPTY: SoloRecord = { last: null, best: null, runs: 0 }

export function loadSoloRecord(): SoloRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<SoloRecord>
    return { last: parsed.last ?? null, best: parsed.best ?? null, runs: parsed.runs ?? 0 }
  } catch {
    return EMPTY
  }
}

/** Saves a scored take and returns the record plus whether it beat the previous best. */
export function saveSoloResult(result: ScoreResult, takeId: number): { record: SoloRecord; newBest: boolean } {
  const solo: SoloResult = {
    score: result.score,
    loudness: result.loudness,
    likeness: result.likeness,
    loudnessLufs: result.loudness_lufs,
    overSpeechLu: result.over_speech_lu,
    calibrated: result.calibrated,
    weights: result.weights,
    top: result.top,
    takeId,
    scoredAt: Date.now(),
  }
  const prev = loadSoloRecord()
  const newBest = !prev.best || solo.score > prev.best.score
  const record: SoloRecord = { last: solo, best: newBest ? solo : prev.best, runs: prev.runs + 1 }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // Storage blocked (private mode): the result still shows, it just won't persist.
  }
  return { record, newBest }
}
