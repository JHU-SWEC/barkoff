import { Link, useLocation, useSearchParams } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { StubNote } from '../components/StubNote'
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

function best(barks: SampleBark[]): SampleBark {
  return barks.reduce((top, bark) => (bark.score > top.score ? bark : top))
}

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

function Fighter({ player, bark, winner }: { player: SamplePlayer; bark: SampleBark; winner: boolean }) {
  return (
    <section className={winner ? 'card fighter fighter-winner' : 'card fighter'} aria-label={player.name}>
      <p className="kicker">{winner ? 'Winner' : 'Runner-up'}</p>
      <h2>{player.name}</h2>
      <p className="fighter-score num">{bark.score.toFixed(2)}</p>
      <p className="quiet">Best bark</p>
      <Meter label="Loudness" value={bark.loudness} />
      <Meter label="Likeness" value={bark.likeness} />
    </section>
  )
}

function SoloResults() {
  const location = useLocation()
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
          <p className="kicker">This bark</p>
          <p className="fighter-score num">{last.score.toFixed(2)}</p>
          <p className="quiet">
            {last.weights.loudness} × loudness + {last.weights.likeness} × likeness
          </p>
          <Meter label="Loudness" value={last.loudness} />
          <Meter label="Likeness" value={last.likeness} />
          {last.clipId && (
            <div className="clip-replay">
              <p className="quiet">Replay</p>
              <audio controls preload="metadata" src={`/api/clips/${last.clipId}/audio`}>
                Your browser can’t play this recording.
              </audio>
            </div>
          )}
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
            {last.clipId ? ' Recording is saved on your account.' : ''}
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

function DuelResults() {
  const youWon = SAMPLE_ROUNDS.filter((r) => r.you.score > r.them.score).length
  const theyWon = SAMPLE_ROUNDS.length - youWon

  return (
    <>
      <PageHeader kicker="Final" title="Results">
        <StubNote>A sample duel. Real rounds arrive from the scoring service once duels exist.</StubNote>
      </PageHeader>

      <div className="verdict on-ink">
        <p className="verdict-call">{youWon > theyWon ? 'You win' : 'You lose'}</p>
        <p className="verdict-rounds num">
          {youWon}–{theyWon}
        </p>
        <p className="verdict-elo num">+{SAMPLE_ELO_CHANGE} Elo</p>
      </div>

      <div className="fighters">
        <Fighter player={SAMPLE_ME} bark={best(SAMPLE_ROUNDS.map((r) => r.you))} winner={youWon > theyWon} />
        <Fighter player={SAMPLE_OPPONENT} bark={best(SAMPLE_ROUNDS.map((r) => r.them))} winner={theyWon > youWon} />
      </div>

      <section className="card" aria-labelledby="rounds-heading">
        <h2 id="rounds-heading">Round by round</h2>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">{SAMPLE_ME.name}</th>
              <th scope="col">{SAMPLE_OPPONENT.name}</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_ROUNDS.map(({ you, them }, i) => (
              <tr key={i}>
                <th scope="row">Round {i + 1}</th>
                <td className={you.score > them.score ? 'num round-won' : 'num'}>{you.score.toFixed(2)}</td>
                <td className={them.score > you.score ? 'num round-won' : 'num'}>{them.score.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="card-actions">
        <Link className="button button-primary" to="/duel">
          Rematch
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
