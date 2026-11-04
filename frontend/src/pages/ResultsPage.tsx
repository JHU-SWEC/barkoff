import { Link } from 'react-router'
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

export default function ResultsPage() {
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
