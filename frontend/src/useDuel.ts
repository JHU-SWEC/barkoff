import { useCallback, useEffect, useRef, useState } from 'react'
import type { Calibration } from './calibration'
import { encodeTake, type BotLevel, type DuelRound, type DuelView, type Foul } from './duelApi'
import { DuelSocket, UNREACHABLE, type ServerMessage } from './duelSocket'
import { playerId, playerSecret } from './player'

// The duel client: lobby -> queue -> duel, over one socket to the game server (duelSocket.ts).
// The server pushes queue progress and a fresh view whenever the duel changes; the page works out
// countdowns and the BARK! cue itself from the round times and the socket's synced clock.

const COUNTDOWN_S = 3
const LOST = 'Lost the duel server. Reconnecting…'
const GONE = 'That duel is gone: the duel server restarted while you were away.'

export type DuelStage =
  | { kind: 'lobby' }
  | { kind: 'joining' }
  | { kind: 'queue'; waitedS: number; window: number; inQueue: number }
  | { kind: 'duel'; view: DuelView }

/** What the arena shows right now, worked out from the server's round times and the synced clock. */
export type Moment =
  | { kind: 'intro' }
  | { kind: 'countdown'; n: number }
  | { kind: 'wait' }
  | { kind: 'bark'; leftS: number }
  | { kind: 'scoring' }
  | { kind: 'result'; round: DuelRound; nextInS: number }
  | { kind: 'over' }

export function momentOf(view: DuelView, now: number): Moment {
  const r = view.round
  if (view.result || !r) return { kind: 'over' }
  const last = view.rounds.at(-1)
  if (now < r.starts_at) return last ? { kind: 'result', round: last, nextInS: r.starts_at - now } : { kind: 'intro' }
  if (now < r.starts_at + COUNTDOWN_S) return { kind: 'countdown', n: Math.ceil(r.starts_at + COUNTDOWN_S - now) }
  if (now < r.cue_at) return { kind: 'wait' }
  if (now < r.window_ends) return { kind: 'bark', leftS: r.window_ends - now }
  return { kind: 'scoring' }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export function useDuel() {
  const [id] = useState(playerId)
  const [secret] = useState(playerSecret)
  const [stage, setStage] = useState<DuelStage>({ kind: 'lobby' })
  const [error, setError] = useState<string | null>(null)
  const socket = useRef<DuelSocket | null>(null)
  // Socket events arrive between renders, so they read the stage from here, kept in step by go().
  const stageRef = useRef<DuelStage>(stage)
  const go = useCallback((next: DuelStage) => {
    stageRef.current = next
    setStage(next)
  }, [])
  // What the last Find match asked for, to get back in line after a reconnect.
  const lastQueue = useRef<{ name: string; dog: string } | null>(null)

  useEffect(() => {
    const unfinished = () => {
      const st = stageRef.current
      return st.kind === 'duel' && st.view.result == null ? st.view.id : null
    }
    const onMessage = (msg: ServerMessage) => {
      const st = stageRef.current
      if (msg.type === 'queue') {
        if (msg.status === 'waiting' && (st.kind === 'joining' || st.kind === 'queue')) {
          go({ kind: 'queue', waitedS: msg.waited_s, window: msg.window, inQueue: msg.in_queue })
        }
      } else if (msg.type === 'duel') {
        if (st.kind === 'lobby') {
          // Matched just as we left the queue: hand it straight back so the opponent isn't left waiting.
          if (msg.view.result == null) s.send({ type: 'forfeit' })
        } else if (st.kind !== 'duel' || st.view.id === msg.view.id) {
          go({ kind: 'duel', view: msg.view })
        }
      } else if (msg.type === 'duel_gone') {
        if (st.kind === 'duel' && st.view.id === msg.duel_id) {
          setError(GONE)
          go({ kind: 'lobby' })
        }
      } else {
        setError(msg.message)
        if (st.kind === 'joining') go({ kind: 'lobby' })
      }
    }
    const onStatus = (ready: boolean) => {
      const st = stageRef.current
      if (!ready) {
        if (st.kind === 'joining') go({ kind: 'lobby' })
        if (st.kind !== 'lobby' && !(st.kind === 'duel' && st.view.result)) setError(LOST)
        return
      }
      setError((e) => (e === LOST ? null : e))
      // The server took us out of the queue when the connection dropped; get back in line.
      // (An unfinished duel comes back by itself: hello carries it as resume.)
      if (st.kind === 'queue' && lastQueue.current) s.send({ type: 'queue', ...lastQueue.current })
    }
    const s = new DuelSocket({ hello: () => ({ id, secret, resume: unfinished() }), message: onMessage, status: onStatus })
    socket.current = s
    return () => {
      // Leaving the page mid-duel gives it up now, rather than after the server's reconnect grace.
      // Queued, closing is enough: the server takes us out.
      if (unfinished()) s.send({ type: 'forfeit' })
      s.close()
      socket.current = null
    }
  }, [id, secret, go])

  const connected = useCallback(async () => {
    const s = socket.current
    if (!s) throw new Error(UNREACHABLE)
    await s.whenReady()
    return s
  }, [])

  const serverNow = useCallback(() => socket.current?.serverNow() ?? Date.now() / 1000, [])

  const findMatch = useCallback(
    async (name: string, dog: string) => {
      setError(null)
      go({ kind: 'joining' })
      try {
        const s = await connected()
        if (stageRef.current.kind !== 'joining') return // cancelled while connecting
        lastQueue.current = { name, dog }
        s.send({ type: 'queue', name, dog })
      } catch (err) {
        setError(message(err))
        go({ kind: 'lobby' })
      }
    },
    [connected, go],
  )

  const cancel = useCallback(async () => {
    go({ kind: 'lobby' })
    socket.current?.send({ type: 'leave_queue' })
  }, [go])

  const playBot = useCallback(
    async (name: string, dog: string, level: BotLevel) => {
      setError(null)
      go({ kind: 'joining' })
      try {
        const s = await connected()
        if (stageRef.current.kind !== 'joining') return
        s.send({ type: 'bot', name, dog, level }) // also takes us out of the ranked queue
      } catch (err) {
        setError(message(err))
        go({ kind: 'lobby' })
      }
    },
    [connected, go],
  )

  const backToLobby = useCallback(() => go({ kind: 'lobby' }), [go])

  /** Sends a round's take. The server scores it and pushes the duel; a refusal arrives as an error. */
  const submit = useCallback(
    async (duelId: string, round: number, blob: Blob, calibration: Calibration | null, position: 'ok' | Foul) => {
      try {
        const frame = await encodeTake(duelId, round, blob, calibration, position)
        const s = await connected()
        s.send(frame)
      } catch (err) {
        setError(message(err))
      }
    },
    [connected],
  )

  return { playerId: id, stage, error, serverNow, findMatch, playBot, cancel, submit, backToLobby }
}
