import type { ScoreResult } from './score'

// Signed-in bark clips. Bytes live in object storage on the server; this module
// only talks to /api/clips. Guests skip upload and keep scores in localStorage.

export interface Clip {
  id: string
  userId: string
  kind: 'solo' | 'duel'
  contentType: string
  byteSize: number
  durationS: number | null
  score: number
  loudness: number
  likeness: number
  loudnessLufs: number | null
  overSpeechLu: number | null
  calibrated: boolean
  clientTakeId: number | null
  createdAt: string
  expiresAt: string
  audioUrl: string
}

const UNREACHABLE = 'The server isn’t reachable. Start it with python backend/server.py.'

export async function uploadClip(blob: Blob, result: ScoreResult, clientTakeId: number): Promise<Clip> {
  const contentType = blob.type || 'audio/webm'
  const meta = {
    kind: 'solo',
    contentType,
    clientTakeId,
    score: result.score,
    loudness: result.loudness,
    likeness: result.likeness,
    loudnessLufs: result.loudness_lufs,
    overSpeechLu: result.over_speech_lu,
    durationS: result.duration_s,
    calibrated: result.calibrated,
  }

  let res: Response
  try {
    res = await fetch('/api/clips', {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-Barkoff-Meta': JSON.stringify(meta),
      },
      body: blob,
    })
  } catch {
    throw new Error(UNREACHABLE)
  }
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.clip) throw new Error(payload?.error ?? UNREACHABLE)
  return payload.clip as Clip
}

export async function listClips(kind: 'solo' | 'duel' = 'solo', limit = 10): Promise<Clip[]> {
  let res: Response
  try {
    res = await fetch(`/api/clips?kind=${kind}&limit=${limit}`)
  } catch {
    throw new Error(UNREACHABLE)
  }
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(payload?.error ?? UNREACHABLE)
  return (payload?.clips as Clip[] | undefined) ?? []
}
