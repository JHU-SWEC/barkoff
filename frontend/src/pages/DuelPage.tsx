import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { SoundToggle } from '../components/AppShell'
import { Backdrop, Skyline } from '../components/Backdrop'
import { DogSprite, WalkingDog } from '../components/DogSprite'
import { FaceCutout } from '../components/FaceCutout'
import { dogById, spriteUrl, useDog, type Dog } from '../dogs'
import type { BotLevel, DuelBark, DuelView } from '../duelApi'
import { saveLastDuel } from '../lastDuel'
import { MAPS, mapIndex } from '../maps'
import { MAX_NAME, loadName, saveName } from '../player'
import { playBark, playBeep, playHit, playJingle, playTick } from '../sfx'
import { useBarkRecorder } from '../useBarkRecorder'
import { momentOf, useDuel, type Moment } from '../useDuel'
import { judgeTake, useHeadGuide, type Fit } from '../useHeadGuide'
import './DuelPage.css'

// The duel as a full-screen fighting game: Street Fighter health bars on top, Smash-style player
// cards at the bottom, a stage picked by roulette in between. The server runs the rounds (useDuel);
// this page records at the cue, sends the take, and stages the fight around the real results.

type Mode = { kind: 'ranked' } | { kind: 'bot'; level: BotLevel }
type Side = 'you' | 'them'

const BOT_LEVELS: { level: BotLevel; label: string; blurb: string }[] = [
  { level: 'easy', label: 'Easy', blurb: 'A sleepy pup' },
  { level: 'normal', label: 'Normal', blurb: 'A yappy rival' },
  { level: 'hard', label: 'Hard', blurb: 'Hound of the arena' },
]

const FOUL_TEXT: Record<NonNullable<DuelBark['foul']>, string> = {
  close: 'Too close',
  gone: 'Off camera',
  unchecked: 'No camera',
  missed: 'No bark',
}

const FIT_PROMPT: Record<Fit, string> = {
  none: 'Get back in frame!',
  close: 'Too close! Back up',
  far: 'Move closer',
  'off-centre': 'Move to the middle',
  ok: 'Hold still…',
}

// How long you must stay inside the outline before the menu opens.
const GATE_HOLD_MS = 900

// Rising mic level that counts as one bark "attack" on screen, and the gap between attacks.
const ATTACK_DB = -26
const ATTACK_GAP_MS = 240
// Fireball flight, the super's freeze-and-cut-in before its beam, the beam, and the hit-stop.
const BALL_MS = 380
const FREEZE_MS = 650
const BEAM_MS = 320
const HITSTOP_MS = 90

// Stage roulette: hops that slow down by HOP_GROWTH each time, landing on the server's pick.
const HOP_MS = 45
const HOP_GROWTH = 1.1
const ROULETTE_HOLD_MS = 800

interface Fx {
  id: number
  kind: 'ball' | 'beam' | 'hit' | 'bighit' | 'clash'
  from: Side
}

/** Where the roulette is `elapsedMs` into the intro. Pure, so both screens agree. */
function roulette(elapsedMs: number, target: number): { index: number; landed: boolean; done: boolean } {
  const hops = 3 * MAPS.length + 1 + target
  let t = 0
  for (let i = 0; i < hops; i++) {
    const d = HOP_MS * HOP_GROWTH ** i
    if (elapsedMs < t + d) return { index: i % MAPS.length, landed: false, done: false }
    t += d
  }
  return { index: target, landed: true, done: elapsedMs >= t + ROULETTE_HOLD_MS }
}

function useNow(serverNow: () => number, active: boolean): number {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      if (t - last < 50) return
      last = t
      setNow(serverNow())
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [serverNow, active])
  return now
}

function levelToBar(db: number): number {
  return Math.max(0, Math.min(1, (db + 60) / 60))
}

// Two decimals, or three when two would make different scores look tied.
function barkText(b: DuelBark | undefined, other?: DuelBark): string {
  if (!b) return '—'
  if (b.foul) return FOUL_TEXT[b.foul]
  const close = other && !other.foul && other.score !== b.score && other.score.toFixed(2) === b.score.toFixed(2)
  return b.score.toFixed(close ? 3 : 2)
}

/** A head-and-shoulders crop of a sprite, centred on the dog's face. */
function Portrait({ dog, size, flip }: { dog: Dog; size: number; flip?: boolean }) {
  const zoom = size / 26 // about 26 grid pixels of face in view
  const [fx, fy] = dog.face
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: `url(${spriteUrl(dog)})`,
    backgroundSize: `${64 * zoom}px`,
    backgroundPosition: `${size / 2 - fx * zoom}px ${size / 2 - fy * zoom}px`,
    transform: flip ? 'scaleX(-1)' : undefined,
  }
  return <span className="portrait" style={style} aria-hidden="true" />
}

function HealthBar({
  side,
  name,
  sub,
  dog,
  hp,
  won,
  needed,
}: {
  side: Side
  name: string
  sub: string
  dog: Dog | null
  hp: number
  won: number
  needed: number
}) {
  return (
    <div className={`hp hp-${side}`}>
      <div className="hp-portrait">
        {dog ? <Portrait dog={dog} size={64} flip={side === 'them'} /> : <span className="portrait portrait-empty">?</span>}
      </div>
      <div className="hp-body">
        <div className="hp-name">
          <span className="hp-name-text">{name}</span>
          <span className="hp-sub num">{sub}</span>
        </div>
        <div className="hp-track" aria-label={`${name}: ${Math.round(hp * 100)}% left`}>
          <span className="hp-trail" style={{ width: `${hp * 100}%` }} />
          <span className="hp-fill" style={{ width: `${hp * 100}%` }} />
        </div>
        <span className="pips" aria-label={`${won} of ${needed} rounds won`}>
          {Array.from({ length: needed }, (_, i) => (
            <img key={i} className={i < won ? 'pip pip-won' : 'pip'} src="/sprites/paw.png" width={20} height={20} alt="" />
          ))}
        </span>
      </div>
    </div>
  )
}

function Confetti() {
  const colours = ['#d8f23c', '#d53a15', '#f7f0e2', '#5c97ea', '#f4a3a3']
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => (
        <span
          key={i}
          style={
            {
              '--x': `${(i * 37) % 100}%`,
              '--delay': `${1 + (i % 9) * 0.11}s`,
              '--spin': `${(i % 2 ? 1 : -1) * (200 + ((i * 53) % 400))}deg`,
              '--drift': `${((i * 29) % 60) - 30}px`,
              background: colours[i % colours.length],
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** The big words: VS, 3-2-1, BARK!, round calls, K.O. and the final verdict. */
function Roulette({ index, landed }: { index: number; landed: boolean }) {
  return (
    <div className="announce roulette" key="roulette">
      <p className="roulette-title">Stage select</p>
      <div className="roulette-strip">
        {MAPS.map((m, i) => (
          <div key={m.id} className={['roulette-card', i === index && 'roulette-on', landed && i === index && 'roulette-pick'].filter(Boolean).join(' ')}>
            <div className="roulette-thumb">
              <Backdrop map={m.id} />
            </div>
            <span className="roulette-name">{m.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Announcer({ moment, view, wheel }: { moment: Moment; view: DuelView; wheel: ReturnType<typeof roulette> }) {
  switch (moment.kind) {
    case 'intro':
      if (!wheel.done) return <Roulette index={wheel.index} landed={wheel.landed} />
      return (
        <div className="announce announce-intro" key="intro">
          <div className="intro-plate intro-plate-you">
            <span className="intro-name">{view.you.name}</span>
            <span className="intro-dog">{dogById(view.you.dog).breed}</span>
          </div>
          <span className="intro-vs">VS</span>
          <div className="intro-plate intro-plate-them">
            <span className="intro-name">{view.opponent.name}</span>
            <span className="intro-dog">{dogById(view.opponent.dog).breed}</span>
          </div>
          <p className="intro-round">
            {MAPS[mapIndex(view.stage)].name} · {view.ranked ? 'ranked' : 'practice'} · best of three
          </p>
        </div>
      )
    case 'countdown':
      return (
        <p className="announce slam slam-number num" key={`n${moment.n}`}>
          {moment.n}
        </p>
      )
    case 'wait':
      return (
        <p className="announce ready" key="wait">
          Ready…
        </p>
      )
    case 'bark':
      return (
        <p className="announce slam slam-bark" key="bark">
          BARK!
        </p>
      )
    case 'scoring':
      return (
        <p className="announce judging" key="judging">
          Judging<span className="dots" />
        </p>
      )
    case 'result': {
      const { round } = moment
      const winner = round.winner === 'you' ? view.you.name : view.opponent.name
      return (
        <div className="announce announce-result" key={`r${round.index}`}>
          <p className="result-call">{round.winner === 'tie' ? 'Clash! Replay' : `${winner} takes it`}</p>
          <p className="result-scores num">
            <span className={round.winner === 'you' ? 'won' : undefined}>{barkText(round.you, round.opponent)}</span>
            <span className="vs">vs</span>
            <span className={round.winner === 'opponent' ? 'won' : undefined}>{barkText(round.opponent, round.you)}</span>
          </p>
          <p className="result-next num">Next round in {Math.ceil(moment.nextInS)}</p>
        </div>
      )
    }
    case 'over': {
      const result = view.result
      if (!result) return null
      const call = result.winner === 'draw' ? 'Draw' : result.winner === 'you' ? 'You win!' : 'You lose'
      return (
        <div className={`announce announce-over announce-${result.winner}`} key="over">
          <p className="ko">{result.forfeit ? 'Forfeit' : result.winner === 'draw' ? 'Time!' : 'K.O.'}</p>
          <p className="final-call">{call}</p>
          {result.forfeit === 'opponent' && <p className="final-note">{view.opponent.name} left the duel</p>}
          <p className="final-detail num">
            {view.wins.you}–{view.wins.opponent}
            {view.ranked && (
              <span className={result.elo_change >= 0 ? 'elo-chip elo-up' : 'elo-chip'}>
                {result.elo_change >= 0 ? '+' : '−'}
                {Math.abs(result.elo_change)} Elo
              </span>
            )}
          </p>
        </div>
      )
    }
  }
}

export default function DuelPage() {
  const navigate = useNavigate()
  const myDog = useDog()
  const [name, setName] = useState(loadName)
  const [mode, setMode] = useState<Mode>({ kind: 'ranked' })
  const duel = useDuel()
  const { stage, serverNow, submit } = duel
  const recorder = useBarkRecorder()
  const { status, live, takes, calibration, record } = recorder
  const guide = useHeadGuide()
  const { beginWatch, endWatch, attachVideo, video: camVideo, faceRef } = guide

  const view = stage.kind === 'duel' ? stage.view : null
  const now = useNow(serverNow, view != null && view.result == null)
  const moment: Moment | null = view ? momentOf(view, now) : null
  const round = view?.round ?? null
  const scene = moment?.kind ?? stage.kind

  // ---------- recording at the cue ----------

  const taking = useRef<{ duelId: string; round: number } | null>(null)
  const cueRound = round && !round.submitted.you && view?.result == null ? round.index : null
  const cueAt = round?.cue_at
  const windowS = view?.window_s ?? 3
  const duelId = view?.id
  useEffect(() => {
    if (cueRound == null || cueAt == null || !duelId) return
    const delayMs = (cueAt - serverNow()) * 1000
    if (delayMs < -500) return // Arrived after the cue (a reload mid-round): this round scores 0.
    const timer = setTimeout(() => {
      taking.current = { duelId, round: cueRound }
      beginWatch()
      void record(windowS, false)
    }, Math.max(0, delayMs))
    return () => clearTimeout(timer)
  }, [cueRound, cueAt, duelId, windowS, serverNow, beginWatch, record])

  const newest = takes[0]
  const lastSent = useRef<number | null>(null)
  useEffect(() => {
    const t = taking.current
    if (!t || !newest || newest.id === lastSent.current) return
    lastSent.current = newest.id
    taking.current = null
    const verdict = judgeTake(endWatch())
    void submit(t.duelId, t.round, newest.blob, calibration, verdict.ok ? 'ok' : verdict.reason)
  }, [newest, endWatch, submit, calibration])

  // The mic failed: nothing to send, so the round scores 0 at its deadline.
  useEffect(() => {
    if (status !== 'error' || !taking.current) return
    taking.current = null
    endWatch()
  }, [status, endWatch])

  // ---------- fight effects ----------

  const [fx, setFx] = useState<Fx[]>([])
  const [attacks, setAttacks] = useState({ you: 0, them: 0 })
  const [hurts, setHurts] = useState({ you: 0, them: 0 })
  const [combos, setCombos] = useState({ you: 0, them: 0 })
  const [shake, setShake] = useState(0)
  const [hitstop, setHitstop] = useState(false)
  const [superBy, setSuperBy] = useState<Side | null>(null)
  const fxId = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }, [])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const addFx = useCallback(
    (item: Omit<Fx, 'id'>, lifeMs: number) => {
      const id = ++fxId.current
      setFx((prev) => [...prev, { ...item, id }])
      later(lifeMs, () => setFx((prev) => prev.filter((f) => f.id !== id)))
    },
    [later],
  )

  const land = useCallback(
    (from: Side, big: boolean) => {
      const to: Side = from === 'you' ? 'them' : 'you'
      setHurts((h) => ({ ...h, [to]: h[to] + 1 }))
      setCombos((c) => ({ ...c, [from]: c[from] + 1 }))
      setShake((s) => s + 1)
      setHitstop(true)
      later(big ? HITSTOP_MS * 3 : HITSTOP_MS, () => setHitstop(false))
      addFx({ kind: big ? 'bighit' : 'hit', from }, big ? 700 : 420)
      playHit(big)
    },
    [addFx, later],
  )

  // A fireball: the attacker lunges, the ball flies, the hit lands.
  const attack = useCallback(
    (from: Side) => {
      setAttacks((a) => ({ ...a, [from]: a[from] + 1 }))
      addFx({ kind: 'ball', from }, BALL_MS + 40)
      later(BALL_MS, () => land(from, false))
    },
    [addFx, later, land],
  )

  // A super: the screen freezes and darkens with the attacker's cut-in, then a beam crosses the stage.
  const superAttack = useCallback(
    (from: Side) => {
      setSuperBy(from)
      later(FREEZE_MS, () => {
        setSuperBy(null)
        setAttacks((a) => ({ ...a, [from]: a[from] + 1 }))
        addFx({ kind: 'beam', from }, BEAM_MS + 200)
        later(BEAM_MS * 0.6, () => land(from, true))
      })
    },
    [addFx, later, land],
  )

  // Your barks become attacks the moment the mic hears them.
  const barking = moment?.kind === 'bark'
  const loud = barking && live.levelDb > ATTACK_DB
  const lastAttack = useRef(0)
  useEffect(() => {
    if (!loud) return
    const t = performance.now()
    if (t - lastAttack.current < ATTACK_GAP_MS) return
    lastAttack.current = t
    attack('you')
  }, [loud, live.levelDb, attack])

  // The rival's barks: we only learn their score afterwards, so their volley is staged.
  const barkRound = barking ? round?.index : null
  useEffect(() => {
    if (barkRound == null) return
    later(0, () => setCombos({ you: 0, them: 0 }))
    const shots = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < shots; i++) later(250 + Math.random() * (windowS * 1000 - 700), () => attack('them'))
  }, [barkRound, windowS, attack, later])

  // Stage roulette during the intro, on the shared clock.
  const wheel = view ? roulette((now - view.intro_at) * 1000, mapIndex(view.stage)) : { index: 0, landed: true, done: true }
  const inRoulette = moment?.kind === 'intro' && !wheel.done
  const wheelIndex = inRoulette ? wheel.index : null
  const wheelLanded = inRoulette && wheel.landed
  useEffect(() => {
    if (wheelIndex != null && !wheelLanded) playTick()
  }, [wheelIndex, wheelLanded])
  useEffect(() => {
    if (wheelLanded) playBeep(true)
  }, [wheelLanded])

  // Countdown beeps (the mic opens at the cue, so the cue itself stays silent).
  const countN = moment?.kind === 'countdown' ? moment.n : null
  useEffect(() => {
    if (countN != null) playBeep()
  }, [countN])

  // Each resolved round: the winner's super bark lands. A tie is a clash in the middle.
  const resolved = view?.rounds.length ?? 0
  const lastRound = view?.rounds.at(-1)
  const youDog = view ? dogById(view.you.dog) : myDog
  const themDog = view ? dogById(view.opponent.dog) : null
  const announced = useRef(0)
  const outcome = view?.result?.winner
  useEffect(() => {
    const fresh = resolved > announced.current
    announced.current = resolved
    if (!fresh || !lastRound || !themDog) return
    if (lastRound.winner === 'tie') {
      // Two fireballs meet in the middle and cancel out.
      later(150, () => {
        addFx({ kind: 'ball', from: 'you' }, BALL_MS / 2)
        addFx({ kind: 'ball', from: 'them' }, BALL_MS / 2)
      })
      later(150 + BALL_MS / 2, () => {
        addFx({ kind: 'clash', from: 'you' }, 600)
        setShake((s) => s + 1)
        playHit(false)
      })
      return
    }
    const from: Side = lastRound.winner === 'you' ? 'you' : 'them'
    playBark(from === 'you' ? youDog : themDog)
    later(100, () => superAttack(from))
  }, [resolved, lastRound, youDog, themDog, superAttack, addFx, later])

  useEffect(() => {
    if (!outcome) return
    later(1200, () => (outcome === 'draw' ? playBeep(true) : playJingle(outcome === 'you')))
  }, [outcome, later])

  // Keep the finished duel for Results, which may be opened later or refreshed.
  const finished = view?.result ? view : null
  useEffect(() => {
    if (finished) saveLastDuel(finished)
  }, [finished])

  // ---------- lobby ----------

  const searching = stage.kind === 'queue' || stage.kind === 'joining'

  // Position gate: the menu stays shut until you've held still inside the outline.
  const [positioned, setPositioned] = useState(false)
  const fitOk = guide.status === 'on' && guide.fit === 'ok'
  useEffect(() => {
    if (positioned || !fitOk) return
    const timer = setTimeout(() => setPositioned(true), GATE_HOLD_MS)
    return () => clearTimeout(timer)
  }, [fitOk, positioned])
  const gateOpen = !view && !searching && !positioned

  const start = async (next: Mode) => {
    const trimmed = name.trim()
    if (!trimmed) return
    saveName(trimmed)
    setMode(next)
    // Ask for the mic now so the first cue doesn't wait on a permission prompt.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      // The recorder reports a blocked mic when the round starts.
    }
    if (next.kind === 'bot') void duel.playBot(trimmed, myDog.id, next.level)
    else void duel.findMatch(trimmed, myDog.id)
  }

  const leave = () => {
    if (stage.kind === 'queue') void duel.cancel()
    if (document.fullscreenElement) void document.exitFullscreen()
    navigate('/')
  }

  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement != null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }

  // ---------- what's on screen ----------

  const cameraOn = guide.status === 'on'
  const wins = view?.wins ?? { you: 0, opponent: 0 }
  const needed = view?.wins_needed ?? 2
  const hp = { you: 1 - wins.opponent / needed, them: 1 - wins.you / needed }
  const over = view?.result ?? null
  const fighterState = (side: Side): string => {
    if (!over) return ''
    if (over.winner === 'draw') return 'fighter-draw'
    const won = (over.winner === 'you') === (side === 'you')
    return won ? 'fighter-win' : 'fighter-lose'
  }
  const recentAttack = (side: Side) => fx.some((f) => f.from === side && (f.kind === 'ball' || f.kind === 'beam'))
  // Lobby: the menu's arena. Roulette: whichever stage is lit. Then the stage the server picked.
  const backdrop = !view ? 'arena' : inRoulette ? MAPS[wheel.index].id : MAPS[mapIndex(view.stage)].id
  const superDog = superBy === 'you' ? youDog : superBy === 'them' ? themDog : null

  let youScore: ReactNode = barkText(lastRound?.you, lastRound?.opponent)
  if (barking) youScore = `${Math.round(levelToBar(live.levelDb) * 100)}%`
  const themScore: ReactNode = barking ? '???' : barkText(lastRound?.opponent, lastRound?.you)

  return (
    <div className="game" data-scene={scene}>
      <title>Duel · Bark Off</title>

      {/* Two identical shake animations, swapped per hit, so each hit restarts it without remounting the fighters. */}
      <div className={shake ? `game-world shake-${shake % 2 ? 'a' : 'b'}` : 'game-world'}>
        <Backdrop map={backdrop} />

        {/* Fighters spawn once the roulette has picked the stage. */}
        <div className={hitstop ? 'stage hitstop' : 'stage'} hidden={inRoulette}>
          <div className={`fighter fighter-you ${fighterState('you')}`} key={`you-${view?.id ?? 'lobby'}-${youDog.id}`}>
            <div className="spawn-beam" aria-hidden="true" />
            <div className="fighter-shadow" aria-hidden="true" />
            <div className="fighter-hurt" key={`h${hurts.you}`} data-hurt={hurts.you > 0}>
              <div className="fighter-lunge" key={`a${attacks.you}`} data-attack={attacks.you > 0}>
                <DogSprite
                  dog={youDog}
                  scale={5}
                  barking={loud || recentAttack('you') || fighterState('you') === 'fighter-win'}
                  className="fighter-sprite"
                  label={`Your ${youDog.breed}`}
                />
                <FaceCutout
                  dog={youDog}
                  barking={loud || recentAttack('you') || fighterState('you') === 'fighter-win'}
                  video={camVideo}
                  faceRef={faceRef}
                />
              </div>
            </div>
            {fighterState('you') === 'fighter-lose' && (
              <span className="dizzy" aria-hidden="true">
                ★ ★ ★
              </span>
            )}
          </div>

          {themDog ? (
            <div className={`fighter fighter-them ${fighterState('them')}`} key={`them-${view?.id}`}>
              <div className="spawn-beam" aria-hidden="true" />
              <div className="fighter-shadow" aria-hidden="true" />
              <div className="fighter-hurt" key={`h${hurts.them}`} data-hurt={hurts.them > 0}>
                <div className="fighter-lunge" key={`a${attacks.them}`} data-attack={attacks.them > 0}>
                  <DogSprite
                    dog={themDog}
                    scale={5}
                    flip
                    barking={recentAttack('them') || fighterState('them') === 'fighter-win'}
                    className="fighter-sprite"
                    label={`${view?.opponent.name}’s ${themDog.breed}`}
                  />
                </div>
              </div>
              {fighterState('them') === 'fighter-lose' && (
                <span className="dizzy" aria-hidden="true">
                  ★ ★ ★
                </span>
              )}
            </div>
          ) : (
            <div className="fighter fighter-them fighter-ghost" aria-hidden="true">
              <div className="fighter-shadow" />
              <DogSprite dog={dogById('husky')} scale={5} flip className="fighter-sprite" />
              <span className="ghost-mark">?</span>
            </div>
          )}

          {fx.map((f) => {
            const to = f.from === 'you' ? 'them' : 'you'
            switch (f.kind) {
              case 'ball':
                return <span key={f.id} className={`ball ball-from-${f.from}`} aria-hidden="true" />
              case 'beam':
                return <span key={f.id} className={`beam beam-from-${f.from}`} aria-hidden="true" />
              case 'clash':
                return (
                  <span key={f.id} className="hitspark hitspark-clash" aria-hidden="true">
                    {Array.from({ length: 8 }, (_, i) => (
                      <i key={i} style={{ rotate: `${i * 45 + 10}deg` }} />
                    ))}
                  </span>
                )
              default:
                // Hit spark: white-hot shards from the point of impact.
                return (
                  <span key={f.id} className={`hitspark hitspark-on-${to} ${f.kind === 'bighit' ? 'hitspark-big' : ''}`} aria-hidden="true">
                    {Array.from({ length: f.kind === 'bighit' ? 10 : 6 }, (_, i) => (
                      <i key={i} style={{ rotate: `${(i * 360) / (f.kind === 'bighit' ? 10 : 6) + (f.id % 5) * 9}deg` }} />
                    ))}
                  </span>
                )
            }
          })}

          {(['you', 'them'] as const).map(
            (side) =>
              combos[side] >= 2 && (
                <p key={`${side}${combos[side]}`} className={`combo combo-${side}`} aria-hidden="true">
                  <span className="num">{combos[side]}</span> hits
                </p>
              ),
          )}
        </div>
      </div>

      {/* Super: everything freezes and darkens while the attacker's portrait cuts across. */}
      {superBy && superDog && (
        <div className={`super super-${superBy}`} aria-hidden="true">
          <div className="super-band">
            <Portrait dog={superDog} size={180} flip={superBy === 'them'} />
          </div>
        </div>
      )}

      {moment?.kind === 'bark' && <div className="flash" aria-hidden="true" />}
      {over?.winner === 'you' && <Confetti />}

      {/* Street Fighter bars */}
      <header className="hud">
        <HealthBar
          side="you"
          name={view?.you.name ?? (name.trim() || 'You')}
          sub={view?.ranked ? `Elo ${view.you.elo}` : youDog.breed}
          dog={youDog}
          hp={hp.you}
          won={wins.you}
          needed={needed}
        />
        <div className="hud-centre">
          {view && round && !over ? (
            <>
              <span className="hud-round">Round {round.index}</span>
              <span className="hud-timer num">
                {moment?.kind === 'bark' ? moment.leftS.toFixed(1) : moment?.kind === 'countdown' ? moment.n : '∞'}
              </span>
            </>
          ) : (
            <span className="hud-vs">VS</span>
          )}
        </div>
        <HealthBar
          side="them"
          name={view?.opponent.name ?? (searching ? 'Searching…' : 'Challenger')}
          sub={view ? (view.ranked ? `Elo ${view.opponent.elo}` : `${themDog?.breed} · CPU`) : '???'}
          dog={themDog}
          hp={hp.them}
          won={wins.opponent}
          needed={needed}
        />
      </header>

      <div className="game-tools">
        <button className="tool" onClick={leave}>
          ← Leave
        </button>
        <span className="tool-gap" />
        <SoundToggle className="tool tool-icon" />
        <button
          className="tool tool-icon"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          title="Full screen"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={fullscreen ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
          </svg>
        </button>
      </div>

      {view && moment && (
        <div className="announcer" aria-live="assertive">
          <Announcer moment={moment} view={view} wheel={wheel} />
        </div>
      )}

      {/* The camera: centred with the outline until you're in position, then out of sight. The video
          stays mounted either way, because the face detector and the face on your dog both read it. */}
      <section className={gateOpen ? 'gate' : 'gate gate-closed'} data-fit={cameraOn ? guide.fit : 'off'} aria-label="Camera check">
        <p className="gate-title">Get in position</p>
        <div className="gate-frame">
          {cameraOn && <video ref={attachVideo} muted playsInline />}
          <svg className="gate-outline" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
            <ellipse cx="200" cy="118" rx="58" ry="74" />
            <path d="M174 186c0 14-4 26-22 33-60 18-104 34-128 81M226 186c0 14 4 26 22 33 60 18 104 34 128 81" />
          </svg>
          {!cameraOn && (
            <button className="gate-start" onClick={() => void guide.start()} disabled={guide.status === 'starting'}>
              {guide.status === 'starting' ? 'Starting…' : 'Turn on camera'}
            </button>
          )}
          {fitOk && <span className="gate-hold" key="hold" />}
        </div>
        <p className="gate-prompt" aria-live="polite">
          {cameraOn ? FIT_PROMPT[guide.fit] : 'Your camera checks you’re not barking into the mic.'}
        </p>
        <p className="gate-note">Fit your head and shoulders inside the outline to continue.</p>
      </section>

      {/* Out of position mid-game: the call goes up over your dog. */}
      {!gateOpen && !searching && cameraOn && guide.fit !== 'ok' && (
        <p className="pos-warn" key={guide.fit}>
          {FIT_PROMPT[guide.fit]}
        </p>
      )}
      {!gateOpen && !searching && !cameraOn && positioned && (
        <button className="pos-warn pos-warn-button" onClick={() => void guide.start()}>
          Camera off. Turn it back on
        </button>
      )}

      <div className="meter" aria-label="Bark meter">
        <span className="meter-fill" style={{ height: `${levelToBar(live.levelDb) * 100}%` }} data-hot={loud} />
        <span className="meter-label">Bark</span>
      </div>

      {/* Smash player cards */}
      <footer className="cards">
        <div className="pcard pcard-you">
          <Portrait dog={youDog} size={72} />
          <div className="pcard-text">
            <span className="pcard-tag">P1</span>
            <span className="pcard-score num">{youScore}</span>
            <span className="pcard-name">{youDog.name}</span>
          </div>
        </div>
        <div className="pcard pcard-them">
          {themDog ? (
            <Portrait dog={themDog} size={72} flip />
          ) : (
            <span className="portrait portrait-empty" style={{ width: 72, height: 72 }}>
              ?
            </span>
          )}
          <div className="pcard-text">
            <span className="pcard-tag">{view && !view.ranked ? 'CPU' : 'P2'}</span>
            <span className="pcard-score num">{themDog ? themScore : '—'}</span>
            <span className="pcard-name">{themDog?.name ?? '???'}</span>
          </div>
        </div>
      </footer>

      {(duel.error || recorder.error || guide.error) && (
        <p className="game-error" role="alert">
          {duel.error ?? recorder.error ?? guide.error}
        </p>
      )}

      {/* Mode select */}
      {!view && !searching && positioned && (
        <div className="menu">
          <form
            className="menu-panel"
            onSubmit={(e) => {
              e.preventDefault()
              void start({ kind: 'ranked' })
            }}
          >
            <p className="menu-title">Choose your fight</p>
            <label className="menu-field">
              <span>Fighter name</span>
              <input
                value={name}
                maxLength={MAX_NAME}
                onChange={(e) => setName(e.target.value)}
                autoComplete="nickname"
                required
              />
            </label>
            <button className="menu-big" disabled={!cameraOn || !name.trim()}>
              <span className="menu-big-title">Ranked 1v1</span>
              <span className="menu-big-sub">Matched by Elo. Rating on the line.</span>
            </button>
            <p className="menu-label">Practice vs bot</p>
            <div className="menu-bots">
              {BOT_LEVELS.map(({ level, label, blurb }) => (
                <button
                  type="button"
                  key={level}
                  className={`menu-bot menu-bot-${level}`}
                  disabled={!cameraOn || !name.trim()}
                  onClick={() => void start({ kind: 'bot', level })}
                >
                  <span className="menu-bot-title">{label}</span>
                  <span className="menu-bot-sub">{blurb}</span>
                </button>
              ))}
            </div>
            <p className="menu-note">
              {`Fighting as ${myDog.name}. `}
              <Link to="/#your-dog">Change dog</Link>
            </p>
          </form>
        </div>
      )}

      {searching && (
        <div className="search">
          {/* A walk down the block while the queue looks for someone near your Elo. */}
          <div className="search-sky" />
          <div className="search-far">
            <div className="search-strip">
              <Skyline repeat={2} />
            </div>
          </div>
          <div className="search-lamps" />
          <div className="search-curb" />
          <div className="search-walk" />
          <div className="search-dog">
            <WalkingDog dog={myDog} scale={4} />
            <FaceCutout dog={myDog} video={camVideo} faceRef={faceRef} />
          </div>
          <div className="search-panel">
            <p className="search-title">
              Searching for an opponent<span className="dots" />
            </p>
            {stage.kind === 'queue' ? (
              <dl className="queue-stats">
                <div>
                  <dt>Waiting</dt>
                  <dd className="num">
                    {Math.floor(stage.waitedS / 60)}:{String(Math.floor(stage.waitedS % 60)).padStart(2, '0')}
                  </dd>
                </div>
                <div>
                  <dt>Elo range</dt>
                  <dd className="num">±{stage.window}</dd>
                </div>
                <div>
                  <dt>In queue</dt>
                  <dd className="num">{stage.inQueue}</dd>
                </div>
              </dl>
            ) : (
              <p className="search-note">Getting ready…</p>
            )}
            <div className="menu-row">
              <button className="menu-small" onClick={() => void duel.cancel()}>
                Cancel
              </button>
              <button
                className="menu-small"
                onClick={() => void duel.cancel().then(() => start({ kind: 'bot', level: 'normal' }))}
              >
                Fight a bot instead
              </button>
            </div>
          </div>
        </div>
      )}

      {over && view && (
        <div className="after">
          <button className="menu-small menu-primary" onClick={() => void start(mode)}>
            {mode.kind === 'bot' ? 'Rematch' : 'Find another match'}
          </button>
          <button className="menu-small" onClick={() => duel.backToLobby()}>
            Change mode
          </button>
          <button className="menu-small" onClick={() => navigate('/results', { state: { duel: view } })}>
            Full results
          </button>
        </div>
      )}
    </div>
  )
}
