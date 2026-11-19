import type { BotLevel, DuelView, QueueStatus } from './duelApi'

// The Duel page's realtime connection to the game server (backend/realtime.py; the protocol is at
// the top of that file). Says hello on every connect, reconnects with backoff when the connection
// drops, and keeps a server clock offset from the fastest ping/pong so both players' countdowns
// and the BARK! cue land at the same moment.

export type ServerMessage =
  | ({ type: 'queue' } & QueueStatus)
  | { type: 'duel'; view: DuelView }
  /** The duel this page asked to resume isn't on the server any more (it restarted). */
  | { type: 'duel_gone'; duel_id: string }
  | { type: 'error'; message: string }

type Incoming = ServerMessage | { type: 'welcome'; server_now: number } | { type: 'pong'; t: number | null; server_now: number }

export type ClientMessage =
  | { type: 'queue'; name: string; dog: string }
  | { type: 'leave_queue' }
  | { type: 'bot'; name: string; dog: string; level: BotLevel }
  | { type: 'forfeit' }

export interface DuelSocketEvents {
  /** Who this socket is (secret proves it), and the unfinished duel the page shows (to resume after a drop). */
  hello: () => { id: string; secret: string; resume: string | null }
  message: (msg: ServerMessage) => void
  /** Connected and greeted (true), or lost an established connection (false). */
  status: (ready: boolean) => void
}

export const UNREACHABLE = 'The duel server isn’t reachable. Start it with python backend/server.py.'

const RETRY_MS = [250, 500, 1000, 2000, 4000]
const READY_TIMEOUT_MS = 4000
const PINGS_ON_CONNECT = 5
const PING_BURST_MS = 150
const PING_EVERY_MS = 5000
/** The server closes an older socket with this when the same player connects again. */
const REPLACED = 4000

function socketUrl(): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
}

export class DuelSocket {
  private ws: WebSocket | null = null
  private ready = false
  private stopped = false
  private stopReason: string | null = null
  private attempt = 0
  private retryTimer = 0
  private pingTimers: number[] = []
  private waiters: (() => void)[] = []
  private clock = { offset: 0, rttMs: Infinity }
  private readonly on: DuelSocketEvents

  constructor(on: DuelSocketEvents) {
    this.on = on
    this.connect()
  }

  readonly serverNow = (): number => Date.now() / 1000 + this.clock.offset

  /** Resolves once connected and greeted; rejects with UNREACHABLE if that takes too long. */
  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (this.stopped) return Promise.reject(new Error(this.stopReason ?? UNREACHABLE))
    // Waiting out a backoff: try again now, someone's asking.
    if (!this.ws) {
      clearTimeout(this.retryTimer)
      this.connect()
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(UNREACHABLE)), READY_TIMEOUT_MS)
      this.waiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** False when not connected. Nothing is queued: after a reconnect the server's state is the truth. */
  send(msg: ClientMessage | ArrayBuffer): boolean {
    if (!this.ready || !this.ws) return false
    this.ws.send(msg instanceof ArrayBuffer ? msg : JSON.stringify(msg))
    return true
  }

  close(): void {
    this.stopped = true
    this.stopPinging()
    clearTimeout(this.retryTimer)
    const ws = this.ws
    this.ws = null
    this.ready = false
    ws?.close(1000)
  }

  private connect(): void {
    const ws = new WebSocket(socketUrl())
    this.ws = ws
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', ...this.on.hello() }))
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const msg = JSON.parse(event.data) as Incoming
      if (msg.type === 'pong') this.sample(msg.t, msg.server_now)
      else if (msg.type === 'welcome') this.welcomed()
      else this.on.message(msg)
    }
    ws.onclose = (event) => {
      if (this.ws !== ws) return // close() was called, or a newer socket replaced this one
      this.ws = null
      const wasReady = this.ready
      this.ready = false
      this.stopPinging()
      if (event.code === REPLACED) {
        // Another tab is this player now. Reconnecting would only knock that one off in turn.
        this.stopped = true
        this.stopReason = event.reason || 'This player connected again somewhere else.'
        this.on.message({ type: 'error', message: this.stopReason })
      }
      if (wasReady) this.on.status(false)
      if (this.stopped) return
      const delay = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)]
      this.retryTimer = window.setTimeout(() => this.connect(), delay)
    }
  }

  private welcomed(): void {
    this.ready = true
    this.attempt = 0
    // A quick burst so the first countdown is already in sync, then a slow refresh.
    for (let i = 0; i < PINGS_ON_CONNECT; i++) this.pingTimers.push(window.setTimeout(() => this.ping(), i * PING_BURST_MS))
    this.pingTimers.push(window.setInterval(() => this.ping(), PING_EVERY_MS))
    const waiters = this.waiters
    this.waiters = []
    waiters.forEach((resolve) => resolve())
    this.on.status(true)
  }

  private ping(): void {
    if (this.ready) this.ws?.send(JSON.stringify({ type: 'ping', t: Date.now() }))
  }

  /** Keep the offset from the fastest round trip: its midpoint is the best guess of when the server spoke. */
  private sample(sentMs: number | null, serverNow: number): void {
    if (sentMs == null) return
    const now = Date.now()
    const rttMs = now - sentMs
    if (rttMs <= this.clock.rttMs) this.clock = { offset: serverNow - (sentMs + now) / 2000, rttMs }
  }

  private stopPinging(): void {
    // clearTimeout and clearInterval share one pool of ids, so either clears both kinds.
    this.pingTimers.forEach((timer) => clearTimeout(timer))
    this.pingTimers = []
  }
}
