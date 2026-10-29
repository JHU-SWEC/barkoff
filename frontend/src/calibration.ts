import { integratedLoudness, kWeight } from './loudness'

// Five seconds per the plan: room noise first, then a normal speaking line.
// Takes are compared against the speaking level; the scorer will use both numbers.
export const CALIBRATION_S = 5
export const QUIET_S = 2
export const CALIBRATION_LINE = 'Testing, one, two, three. I’m ready to bark.'

// Skip the click some mics make as they open.
const SETTLE_S = 0.25
// Gated loudness can't go below the BS.1770 absolute gate, so a silent room reads as this.
const NOISE_FLOOR_LUFS = -70
// Speech this close to the room noise is not a usable baseline.
const MIN_VOICE_OVER_ROOM_DB = 6
const STORAGE_KEY = 'barkoff.calibration'

export interface Calibration {
  noiseLufs: number
  speechLufs: number
  device: string
  sampleRate: number
  measuredAt: string
}

export function measureCalibration(buffer: AudioBuffer, device: string): Calibration | string {
  const rate = buffer.sampleRate
  if (buffer.duration < CALIBRATION_S - 0.5) return 'Calibration was cut short. Run it again and let it finish.'

  const weighted = kWeight(buffer.getChannelData(0), rate)
  const quietEnd = Math.round(QUIET_S * rate)
  const noiseLufs = Math.max(
    NOISE_FLOOR_LUFS,
    integratedLoudness(weighted.subarray(Math.round(SETTLE_S * rate), quietEnd), rate),
  )
  const speechLufs = integratedLoudness(weighted.subarray(quietEnd), rate)

  if (!(speechLufs - noiseLufs >= MIN_VOICE_OVER_ROOM_DB)) {
    return 'Your voice was barely louder than the room. Read the line out loud at a normal volume, or move somewhere quieter.'
  }
  return { noiseLufs, speechLufs, device, sampleRate: rate, measuredAt: new Date().toISOString() }
}

// Snake case for the Python scorer.
export function calibrationJson(c: Calibration): string {
  const round = (n: number) => Math.round(n * 100) / 100
  return JSON.stringify(
    {
      noise_lufs: round(c.noiseLufs),
      speech_lufs: round(c.speechLufs),
      device: c.device,
      sample_rate: c.sampleRate,
      measured_at: c.measuredAt,
      method: `pyloudnorm integrated loudness of the quiet (${SETTLE_S}-${QUIET_S} s) and speaking (${QUIET_S}-${CALIBRATION_S} s) segments`,
    },
    null,
    2,
  )
}

// Per-browser convenience: the calibration belongs to this device's mic.
export function loadCalibration(): Calibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const c = raw ? (JSON.parse(raw) as Calibration) : null
    return c && Number.isFinite(c.noiseLufs) && Number.isFinite(c.speechLufs) ? c : null
  } catch {
    return null
  }
}

export function saveCalibration(c: Calibration) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  } catch {
    // Storage blocked (private window); the calibration still holds for this visit.
  }
}
