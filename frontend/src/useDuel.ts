import { useCallback, useEffect, useRef, useState } from 'react'
import type { Calibration } from './calibration'
import {
  forfeitDuel,
  getDuel,
  startBotDuel,
  type BotLevel,
  joinQueue,
  leaveQueue,
  pollQueue,
  registerPlayer,
  submitRound,
  type DuelRound,
  type DuelView,
  type Foul,
} from './duelApi'
import { playerId } from './player'

// The duel client: lobby -> queue -> duel. Polls the server (1 s in the queue, 0.5 s in a duel) and
// keeps a clock offset from the lowest-latency reply, so both players' countdowns and the BARK! cue
// land at the same moment. A realtime socket can replace the polling without changing the page.

const QUEUE_POLL_MS = 1000
const DUEL_POLL_MS = 500
const COUNTDOWN_S = 3

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
  const [stage, setStage] = useState<DuelStage>({ kind: 'lobby' })
  const [error, setError] = useState<string | null>(null)
  const clock = useRef({ offset: 0, rttMs: Infinity })

  // Keep the offset from the fastest round trip: its midpoint is the best guess of when the server spoke.
  const synced = useCallback(async (request: () => Promise<DuelView>) => {
    const t0 = Date.now()
    const view = await request()
    const t1 = Date.now()
    if (t1 - t0 <= clock.current.rttMs) clock.current = { offset: view.server_now - (t0 + t1) / 2000, rttMs: t1 - t0 }
    return view
  }, [])

  const serverNow = useCallback(() => Date.now() / 1000 + clock.current.offset, [])

  const findMatch = useCallback(
    async (name: string, dog: string) => {
      setError(null)
      setStage({ kind: 'joining' })
      try {
        await registerPlayer({ id, name, dog })
        const status = await joinQueue(id)
        if (status.status === 'matched') setStage({ kind: 'duel', view: await synced(() => getDuel(status.duel_id, id)) })
        else if (status.status === 'waiting') {
          setStage({ kind: 'queue', waitedS: status.waited_s, window: status.window, inQueue: status.in_queue })
        } else setStage({ kind: 'lobby' })
      } catch (err) {
        setError(message(err))
        setStage({ kind: 'lobby' })
      }
    },
    [id, synced],
  )

  const cancel = useCallback(async () => {
    setStage({ kind: 'lobby' })
    await leaveQueue(id).catch(() => {})
  }, [id])

  const playBot = useCallback(
    async (name: string, dog: string, level: BotLevel) => {
      setError(null)
      setStage({ kind: 'joining' })
      try {
        await registerPlayer({ id, name, dog })
        await leaveQueue(id).catch(() => {})
        const status = await startBotDuel(id, level)
        if (status.status !== 'matched') throw new Error('The bot didn’t show up.')
        setStage({ kind: 'duel', view: await synced(() => getDuel(status.duel_id, id)) })
      } catch (err) {
        setError(message(err))
        setStage({ kind: 'lobby' })
      }
    },
    [id, synced],
  )

  const backToLobby = useCallback(() => setStage({ kind: 'lobby' }), [])

  const submit = useCallback(
    async (duelId: string, round: number, blob: Blob, calibration: Calibration | null, position: 'ok' | Foul) => {
      try {
        const view = await synced(() => submitRound(duelId, id, round, blob, calibration, position))
        setStage({ kind: 'duel', view })
      } catch (err) {
        setError(message(err))
      }
    },
    [id, synced],
  )

  // Queue: poll until matched.
  const queued = stage.kind === 'queue'
  useEffect(() => {
    if (!queued) return
    let stopped = false
    const tick = async () => {
      try {
        const status = await pollQueue(id)
        if (stopped) return
        if (status.status === 'matched') {
          const view = await synced(() => getDuel(status.duel_id, id))
          if (!stopped) setStage({ kind: 'duel', view })
        } else if (status.status === 'waiting') {
          setStage({ kind: 'queue', waitedS: status.waited_s, window: status.window, inQueue: status.in_queue })
        } else setStage({ kind: 'lobby' })
      } catch (err) {
        if (stopped) return
        setError(message(err))
        setStage({ kind: 'lobby' })
      }
    }
    const timer = setInterval(() => void tick(), QUEUE_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [queued, id, synced])

  // Leaving the page while queued takes you out of the queue.
  useEffect(() => {
    if (!queued) return
    const leave = () => void leaveQueue(id).catch(() => {})
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
    }
  }, [queued, id])
  const stageRef = useRef(stage)
  useEffect(() => {
    stageRef.current = stage
  }, [stage])
  useEffect(() => () => void (stageRef.current.kind === 'queue' && leaveQueue(id).catch(() => {})), [id])

  // Leaving mid-duel (Leave, another page, closing the tab) gives the duel up, so the opponent
  // isn't left waiting and the server doesn't hold you in it.
  const unfinished = stage.kind === 'duel' && stage.view.result == null
  useEffect(() => {
    if (!unfinished) return
    const leave = () => void forfeitDuel(id).catch(() => {})
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      if (stageRef.current.kind === 'duel' && stageRef.current.view.result == null) leave()
    }
  }, [unfinished, id])

  // Duel: poll for the opponent's progress and round results until it's over.
  const duelId = stage.kind === 'duel' ? stage.view.id : null
  const over = stage.kind === 'duel' && stage.view.result != null
  useEffect(() => {
    if (!duelId || over) return
    let stopped = false
    let inFlight = false
    const timer = setInterval(async () => {
      if (inFlight) return
      inFlight = true
      try {
        const view = await synced(() => getDuel(duelId, id))
        if (!stopped) setStage({ kind: 'duel', view })
      } catch (err) {
        if (!stopped) setError(message(err))
      } finally {
        inFlight = false
      }
    }, DUEL_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [duelId, over, id, synced])

  return { playerId: id, stage, error, serverNow, findMatch, playBot, cancel, submit, backToLobby }
}
