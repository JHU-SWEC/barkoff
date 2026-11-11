import { Link, useLocation, useSearchParams } from 'react-router'
import { DogSprite } from '../components/DogSprite'
import { PageHeader } from '../components/PageHeader'
import { StubNote } from '../components/StubNote'
import { dogById, dogFor, useDog, type Dog } from '../dogs'
import type { DuelBark, DuelView } from '../duelApi'
import { loadLastDuel } from '../lastDuel'
import { MAPS, mapIndex } from '../maps'
import {
  SAMPLE_ELO_CHANGE,
  SAMPLE_ME,
  SAMPLE_OPPONENT,
  SAMPLE_ROUNDS,
  type SampleBark,
  type SamplePlayer,
} from '../sampleData'
import { loadSoloRecord } from '../soloResults'
import './ResultsPage.css'

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span className="num">{value.toFixed(2)}</span>
      </div>
      <div className="meter-track" aria-hidden="true">
        <div className="meter-fill" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  )
}

function SoloResults() {
  const location = useLocation()
  const myDog = useDog()
  const { last, best, runs } = loadSoloRecord()
  if (!last) {
    return (
      <>
        <PageHeader kicker="Solo" title="Results">
          <p className="subline">No scored bark yet. Record one in Single player and press Score take.</p>
        </PageHeader>
        <div className="card-actions">
          <Link className="button button-primary" to="/solo">
            Start barking
          </Link>
        </div>
      </>
    )
  }

  const isBest = best != null && best.scoredAt === last.scoredAt
  // Router state says whether this run beat an earlier best; without it (a refresh), fall back to the record.
  const newBest = (location.state as { newBest?: boolean } | null)?.newBest ?? (isBest && runs > 1)

  return (
    <>
      <PageHeader kicker="Solo" title="Results">
        <p className="subline">
          Take {last.takeId}, scored {new Date(last.scoredAt).toLocaleTimeString()}.{' '}
          {last.calibrated ? 'Loudness against your calibration.' : 'Not calibrated: loudness against a typical voice.'}
        </p>
      </PageHeader>

      <div className="verdict on-ink">
        <p className="verdict-call">{newBest ? 'New best' : isBest ? 'Your best' : 'Nice bark'}</p>
        <p className="verdict-rounds num">{last.score.toFixed(2)}</p>
        {best && <p className="verdict-elo num">Best {best.score.toFixed(2)}</p>}
      </div>

      <div className="fighters">
        <section className={isBest ? 'card fighter fighter-winner' : 'card fighter'} aria-label="This bark">
          <DogSprite dog={myDog} scale={2} barking={isBest} className="fighter-dog" />
          <p className="kicker">This bark</p>
          <p className="fighter-score num">{last.score.toFixed(2)}</p>
          <p className="quiet">
            {last.weights.loudness} × loudness + {last.weights.likeness} × likeness
          </p>
          <Meter label="Loudness" value={last.loudness} />
          <Meter label="Likeness" value={last.likeness} />
        </section>
        <section className="card" aria-labelledby="heard-heading">
          <h2 id="heard-heading">What the model heard</h2>
          <dl className="rows">
            {last.top.map((c) => (
              <div className="row" key={c.name}>
                <dt>{c.name}</dt>
                <dd className="num">{c.score.toFixed(3)}</dd>
              </div>
            ))}
          </dl>
          <p className="quiet">
            Loudest 400 ms: <span className="num">{last.loudnessLufs.toFixed(1)} LUFS</span>,{' '}
            <span className="num">
              {last.overSpeechLu >= 0 ? '+' : '−'}
              {Math.abs(last.overSpeechLu).toFixed(1)} LU
            </span>{' '}
            over speech. {runs} scored {runs === 1 ? 'bark' : 'barks'} in this browser.
          </p>
        </section>
      </div>

      <div className="card-actions">
        <Link className="button button-primary" to="/solo">
          Play again
        </Link>
        <Link className="button button-secondary" to="/leaderboard">
          Leaderboard
        </Link>
        <Link className="button button-secondary" to="/">
          Home
        </Link>
      </div>
    </>
  )
}

export default function ResultsPage() {
  const [params] = useSearchParams()
  return params.get('mode') === 'solo' ? <SoloResults /> : <DuelResults />
}

// ---------- duel results ----------

// The scorer's weights (backend/score.py), for showing how a bark's score adds up.
const LOUDNESS_WEIGHT = 0.2
const LIKENESS_WEIGHT = 0.8

const FOUL_TEXT: Record<NonNullable<DuelBark['foul']>, string> = {
  close: 'Too close to the mic',
  gone: 'Left the camera',
  unchecked: 'Camera off',
  missed: 'No bark arrived',
}

/** A bark with whatever detail we have; sample barks get the same detail worked out from their scores. */
type Bark = SampleBark & Partial<DuelBark>

interface Side {
  name: string
  dog: Dog
}

// One duel's numbers, from a real match or the sample.
interface DuelSummary {
  you: Side
  them: Side
  rounds: { you: Bark; them: Bark; winner: 'you' | 'them' | 'tie' }[]
  youWon: number
  theyWon: number
  outcome: 'win' | 'loss' | 'draw'
  eloChange: number
  ranked: boolean
  stage: string | null
  forfeit: 'you' | 'them' | null
}

function fromDuel(view: DuelView): DuelSummary {
  const result = view.result
  return {
    you: { name: view.you.name, dog: dogById(view.you.dog) },
    them: { name: view.opponent.name, dog: dogById(view.opponent.dog) },
    rounds: view.rounds.map((r) => ({
      you: r.you,
      them: r.opponent,
      winner: r.winner === 'opponent' ? 'them' : r.winner,
    })),
    youWon: view.wins.you,
    theyWon: view.wins.opponent,
    outcome: result?.winner === 'you' ? 'win' : result?.winner === 'opponent' ? 'loss' : 'draw',
    eloChange: result?.elo_change ?? 0,
    ranked: view.ranked,
    stage: MAPS[mapIndex(view.stage)]?.name ?? null,
    forfeit: result?.forfeit === 'opponent' ? 'them' : (result?.forfeit ?? null),
  }
}

// Sample barks only have the three scores; fill in the rest from loudness.py's mapping.
function withDetail(b: SampleBark): Bark {
  const over = -10 + 25 * b.loudness
  return {
    ...b,
    lufs: -30 + over,
    over_speech_lu: over,
    calibrated: false,
    heard: b.likeness > 0.6 ? 'Bark' : 'Dog',
    heard_score: b.likeness * 0.9,
  }
}

function fromSample(myDog: Dog, me: SamplePlayer, them: SamplePlayer): DuelSummary {
  const youWon = SAMPLE_ROUNDS.filter((r) => r.you.score > r.them.score).length
  const theyWon = SAMPLE_ROUNDS.length - youWon
  return {
    you: { name: me.name, dog: myDog },
    them: { name: them.name, dog: dogFor(them.name) },
    rounds: SAMPLE_ROUNDS.map((r) => ({
      you: withDetail(r.you),
      them: withDetail(r.them),
      winner: r.you.score > r.them.score ? 'you' : 'them',
    })),
    youWon,
    theyWon,
    outcome: youWon > theyWon ? 'win' : 'loss',
    eloChange: SAMPLE_ELO_CHANGE,
    ranked: true,
    stage: null,
    forfeit: null,
  }
}

const CALLS = { win: 'You win', loss: 'You lose', draw: 'Draw' }

function signed(n: number, digits = 1): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

/** What the loudness score is made of, in words. */
function loudnessDetail(b: Bark): string | null {
  if (b.lufs == null || b.over_speech_lu == null) return null
  const voice = b.calibrated ? 'your speaking voice' : 'a typical speaking voice'
  return `Loudest 400 ms ${b.lufs.toFixed(1)} LUFS, ${signed(b.over_speech_lu)} LU over ${voice}`
}

function likenessDetail(b: Bark): string | null {
  if (!b.heard) return null
  return `Model heard “${b.heard}”${b.heard_score != null ? ` (${Math.round(b.heard_score * 100)}%)` : ''}`
}

function Bar({ label, value, detail, tone }: { label: string; value: number; detail?: string | null; tone?: 'loud' | 'like' }) {
  return (
    <div className={`bar bar-${tone ?? 'plain'}`}>
      <div className="bar-head">
        <span>{label}</span>
        <span className="num">{value.toFixed(2)}</span>
      </div>
      <div className="bar-track" aria-hidden="true">
        <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </div>
      {detail && <p className="bar-detail">{detail}</p>}
    </div>
  )
}

/** How a bark's score adds up: 0.2 × loudness + 0.8 × likeness. */
function Formula({ bark }: { bark: Bark }) {
  if (bark.foul) {
    return (
      <p className="formula formula-foul">
        <span className="pill pill-negative">Foul</span> {FOUL_TEXT[bark.foul]}: scored 0
      </p>
    )
  }
  return (
    <p className="formula num">
      {LOUDNESS_WEIGHT} × {bark.loudness.toFixed(2)} + {LIKENESS_WEIGHT} × {bark.likeness.toFixed(2)} ={' '}
      <strong>{bark.score.toFixed(2)}</strong>
    </p>
  )
}

function FighterCard({
  side,
  barks,
  winner,
  flip,
}: {
  side: Side
  barks: Bark[]
  winner: boolean
  flip?: boolean
}) {
  const fair = barks.filter((b) => !b.foul)
  const top = barks.reduce((a, b) => (b.score > a.score ? b : a), barks[0])
  return (
    <section className={winner ? 'card fighter fighter-winner' : 'card fighter'} aria-label={side.name}>
      <DogSprite dog={side.dog} scale={2} flip={flip} barking={winner} className="fighter-dog" />
      <p className="kicker">{winner ? 'Winner' : 'Runner-up'}</p>
      <h2>{side.name}</h2>
      <p className="fighter-score num">{top ? top.score.toFixed(2) : '—'}</p>
      <p className="quiet">Best bark</p>
      {top && (
        <>
          <Bar label="Loudness" tone="loud" value={top.loudness} detail={loudnessDetail(top)} />
          <Bar label="Likeness" tone="like" value={top.likeness} detail={likenessDetail(top)} />
          <Formula bark={top} />
        </>
      )}
      <dl className="fighter-averages">
        <div>
          <dt>Avg loudness</dt>
          <dd className="num">{fair.length ? mean(fair.map((b) => b.loudness)).toFixed(2) : '—'}</dd>
        </div>
        <div>
          <dt>Avg likeness</dt>
          <dd className="num">{fair.length ? mean(fair.map((b) => b.likeness)).toFixed(2) : '—'}</dd>
        </div>
        <div>
          <dt>Fouls</dt>
          <dd className="num">{barks.length - fair.length}</dd>
        </div>
      </dl>
    </section>
  )
}

function BarkCell({ name, bark, won }: { name: string; bark: Bark; won: boolean }) {
  return (
    <div className={won ? 'bark-cell bark-cell-won' : 'bark-cell'}>
      <div className="bark-cell-head">
        <span className="bark-cell-name">{name}</span>
        <span className="bark-cell-score num">{bark.score.toFixed(2)}</span>
      </div>
      {bark.foul && <p className="bark-cell-foul">{FOUL_TEXT[bark.foul]}: scored 0</p>}
      <Bar label="Loudness" tone="loud" value={bark.loudness} detail={loudnessDetail(bark)} />
      <Bar label="Likeness" tone="like" value={bark.likeness} detail={likenessDetail(bark)} />
    </div>
  )
}

function DuelResults() {
  const location = useLocation()
  const myDog = useDog()
  const duel = (location.state as { duel?: DuelView } | null)?.duel ?? loadLastDuel()
  const d = duel ? fromDuel(duel) : fromSample(myDog, SAMPLE_ME, SAMPLE_OPPONENT)
  const youBarks = d.rounds.map((r) => r.you)
  const themBarks = d.rounds.map((r) => r.them)

  return (
    <>
      <PageHeader kicker="Final" title="Results">
        {duel ? (
          <p className="subline">
            {d.you.name} vs {d.them.name}
            {d.stage && ` at ${d.stage}`} · {d.ranked ? 'Ranked' : 'Practice vs bot'} · {d.rounds.length}{' '}
            {d.rounds.length === 1 ? 'round' : 'rounds'}
          </p>
        ) : (
          <StubNote>A sample duel. Finish a duel to see your real rounds here.</StubNote>
        )}
      </PageHeader>

      <div className="verdict on-ink">
        <p className="verdict-call">{CALLS[d.outcome]}</p>
        <p className="verdict-rounds num">
          {d.youWon}–{d.theyWon}
        </p>
        <p className="verdict-elo num">{d.ranked ? `${signed(d.eloChange, 0)} Elo` : 'Practice · no Elo'}</p>
        {d.forfeit && (
          <p className="verdict-note">{d.forfeit === 'them' ? `${d.them.name} left the duel.` : 'You left the duel.'}</p>
        )}
      </div>

      <div className="fighters">
        <FighterCard side={d.you} barks={youBarks} winner={d.outcome === 'win'} />
        <FighterCard side={d.them} barks={themBarks} winner={d.outcome === 'loss'} flip />
      </div>

      <section className="card rounds-card" aria-labelledby="rounds-heading">
        <h2 id="rounds-heading">Round by round</h2>
        <ol className="round-list">
          {d.rounds.map(({ you, them, winner }, i) => {
            const margin = Math.abs(you.score - them.score)
            return (
              <li className="round" key={i}>
                <div className="round-head">
                  <span className="round-index">Round {i + 1}</span>
                  {winner === 'tie' ? (
                    <span className="pill pill-warning">Tie, replayed</span>
                  ) : (
                    <span className="pill pill-info num">
                      {`${winner === 'you' ? d.you.name : d.them.name} by ${margin.toFixed(margin < 0.01 ? 3 : 2)}`}
                    </span>
                  )}
                </div>
                <div className="round-barks">
                  <BarkCell name={d.you.name} bark={you} won={winner === 'you'} />
                  <BarkCell name={d.them.name} bark={them} won={winner === 'them'} />
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <section className="card scoring-explainer" aria-labelledby="how-heading">
        <h2 id="how-heading">How a bark is scored</h2>
        <dl className="rows">
          <div className="row">
            <dt>Loudness</dt>
            <dd>
              The loudest 400 ms of the take, against your calibrated speaking voice: 0 at 10 LU under it, 1 at
              15 LU over it.
            </dd>
          </div>
          <div className="row">
            <dt>Likeness</dt>
            <dd>How sure the sound model is that it heard a dog: bark, howl, yip, growl.</dd>
          </div>
          <div className="row">
            <dt>Score</dt>
            <dd className="num">
              {LOUDNESS_WEIGHT} × loudness + {LIKENESS_WEIGHT} × likeness. A camera foul scores 0.
            </dd>
          </div>
        </dl>
      </section>

      <div className="card-actions">
        <Link className="button button-primary" to="/duel">
          {duel ? 'Duel again' : 'Rematch'}
        </Link>
        <Link className="button button-secondary" to="/leaderboard">
          Leaderboard
        </Link>
        <Link className="button button-secondary" to="/">
          Home
        </Link>
      </div>
    </>
  )
}
