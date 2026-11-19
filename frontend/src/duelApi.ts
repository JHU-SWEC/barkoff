import type { Calibration } from './calibration'
import { decodeMono } from './score'

// What the duel server sends and takes (backend/realtime.py over the socket in duelSocket.ts,
// rules in backend/duels.py). Field names match the server's JSON. Times are server epoch seconds.

export interface DuelPlayer {
  id: string
  name: string
  dog: string
  elo: number
  wins: number
  losses: number
  draws: number
}

export type Foul = 'close' | 'gone' | 'unchecked' | 'missed'

export interface DuelBark {
  score: number
  loudness: number
  likeness: number
  foul: Foul | null
  /** Loudest 400 ms, in LUFS, and how far that was over the player's speaking voice. */
  lufs?: number | null
  over_speech_lu?: number | null
  /** Whether over_speech_lu used the player's own calibration or a typical voice. */
  calibrated?: boolean
  /** The top sound class the model heard, and its probability. */
  heard?: string | null
  heard_score?: number | null
}

export interface DuelRound {
  index: number
  you: DuelBark
  opponent: DuelBark
  winner: 'you' | 'opponent' | 'tie'
}

export interface DuelView {
  id: string
  server_now: number
  phase: 'intro' | 'countdown' | 'bark' | 'scoring' | 'result' | 'over'
  you: DuelPlayer
  opponent: DuelPlayer
  /** False for practice duels against a bot: no Elo change. */
  ranked: boolean
  /** The map, picked by the server (maps.ts). */
  stage: string
  /** When the intro (stage roulette, then VS) began. */
  intro_at: number
  wins: { you: number; opponent: number }
  wins_needed: number
  window_s: number
  rounds: DuelRound[]
  round: {
    index: number
    starts_at: number
    cue_at: number
    window_ends: number
    deadline: number
    submitted: { you: boolean; opponent: boolean }
  } | null
  next_at?: number
  result: {
    winner: 'you' | 'opponent' | 'draw'
    elo_before: number
    elo_after: number
    elo_change: number
    /** Who walked out, if the duel ended that way. */
    forfeit: 'you' | 'opponent' | null
  } | null
}

/** Queue news over the socket. Being matched arrives as the duel itself. */
export type QueueStatus =
  | { status: 'idle' }
  | { status: 'waiting'; waited_s: number; window: number; in_queue: number }

export type BotLevel = 'easy' | 'normal' | 'hard'

/** A round's take as one binary socket frame: uint32 header length, the JSON header, then the
 *  float32 samples. The server scores it, applies the camera verdict and pushes the duel. */
export async function encodeTake(
  duelId: string,
  round: number,
  blob: Blob,
  calibration: Calibration | null,
  position: 'ok' | Foul,
): Promise<ArrayBuffer> {
  const audio = await decodeMono(blob)
  const header = new TextEncoder().encode(
    JSON.stringify({
      duel_id: duelId,
      round,
      sr: audio.rate,
      position,
      ...(calibration && { noise_lufs: calibration.noiseLufs, speech_lufs: calibration.speechLufs }),
    }),
  )
  const samples = new Uint8Array(audio.samples.buffer, audio.samples.byteOffset, audio.samples.byteLength)
  const frame = new Uint8Array(4 + header.length + samples.length)
  new DataView(frame.buffer).setUint32(0, header.length, true)
  frame.set(header, 4)
  frame.set(samples, 4 + header.length)
  return frame.buffer
}

const UNREACHABLE = 'The duel server isn’t reachable. Start it with python backend/server.py.'

async function call<T>(method: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { method, ...init })
  } catch {
    throw new Error(UNREACHABLE)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? UNREACHABLE)
  return body as T
}

export const fetchLeaderboard = () => call<DuelPlayer[]>('GET', '/api/leaderboard')
