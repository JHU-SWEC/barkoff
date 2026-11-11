import type { Calibration } from './calibration'
import { decodeMono } from './score'

// The ranked duel API on the local server (backend/server.py, rules in backend/duels.py).
// Field names match the server's JSON. Times are server epoch seconds.

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

export type QueueStatus =
  | { status: 'idle' }
  | { status: 'waiting'; waited_s: number; window: number; in_queue: number }
  | { status: 'matched'; duel_id: string }

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

const q = (playerId: string) => `player_id=${encodeURIComponent(playerId)}`

export function registerPlayer(player: { id: string; name: string; dog: string }): Promise<DuelPlayer> {
  return call('POST', '/api/players', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(player),
  })
}

export const joinQueue = (playerId: string) => call<QueueStatus>('POST', `/api/queue?${q(playerId)}`)
export const pollQueue = (playerId: string) => call<QueueStatus>('GET', `/api/queue?${q(playerId)}`)

/** keepalive so leaving still reaches the server when the tab is closing. */
export const leaveQueue = (playerId: string) =>
  call<QueueStatus>('DELETE', `/api/queue?${q(playerId)}`, { keepalive: true })

/** Leave an unfinished duel; keepalive so it still lands when the tab is closing. */
export const forfeitDuel = (playerId: string) =>
  call<QueueStatus>('POST', `/api/duels/forfeit?${q(playerId)}`, { keepalive: true })

export type BotLevel = 'easy' | 'normal' | 'hard'

export const startBotDuel = (playerId: string, level: BotLevel) =>
  call<QueueStatus>('POST', `/api/duels/bot?${q(playerId)}&level=${level}`)

export const getDuel = (duelId: string, playerId: string) =>
  call<DuelView>('GET', `/api/duels/${encodeURIComponent(duelId)}?${q(playerId)}`)

/** Uploads a round's take; the server scores it, applies the camera verdict and returns the duel. */
export async function submitRound(
  duelId: string,
  playerId: string,
  round: number,
  blob: Blob,
  calibration: Calibration | null,
  position: 'ok' | Foul,
): Promise<DuelView> {
  const audio = await decodeMono(blob)
  const params = new URLSearchParams({ player_id: playerId, sr: String(audio.rate), position })
  if (calibration) {
    params.set('noise_lufs', calibration.noiseLufs.toFixed(2))
    params.set('speech_lufs', calibration.speechLufs.toFixed(2))
  }
  return call('POST', `/api/duels/${encodeURIComponent(duelId)}/rounds/${round}?${params}`, {
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([audio.samples]),
  })
}

export const fetchLeaderboard = () => call<DuelPlayer[]>('GET', '/api/leaderboard')
