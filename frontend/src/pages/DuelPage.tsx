import { Link } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { StubNote } from '../components/StubNote'
import { SAMPLE_ME, SAMPLE_OPPONENT, type SamplePlayer } from '../sampleData'
import './DuelPage.css'

const TAPE: { label: string; value: (p: SamplePlayer) => string }[] = [
  { label: 'Elo', value: (p) => String(p.elo) },
  { label: 'Record', value: (p) => `${p.wins}–${p.losses}` },
  { label: 'Best bark', value: (p) => p.bestBark.toFixed(2) },
]

const ROUND_STEPS = [
  'You’re matched with someone near your Elo.',
  'Both of you get the same 3-2-1 countdown.',
  'BARK! appears at a random moment. You both bark at once.',
  'Scores land side by side, then the next round starts.',
  'Best of three takes it, and Elo updates.',
]

export default function DuelPage() {
  return (
    <>
      <PageHeader kicker="Ranked 1v1" title="Duel">
        <StubNote>Matchmaking needs the realtime server. This is the planned layout with a sample opponent.</StubNote>
      </PageHeader>

      <div className="duel-layout">
        <section className="card tape on-ink" aria-labelledby="tape-heading">
          <h2 id="tape-heading" className="visually-hidden">
            Tale of the tape
          </h2>
          <div className="tape-names">
            <p className="tape-name">{SAMPLE_ME.name}</p>
            <p className="tape-vs" aria-hidden="true">
              VS
            </p>
            <p className="tape-name tape-name-them">{SAMPLE_OPPONENT.name}</p>
          </div>
          <dl className="tape-rows">
            {TAPE.map(({ label, value }) => (
              <div className="tape-row" key={label}>
                <dd className="num">{value(SAMPLE_ME)}</dd>
                <dt>{label}</dt>
                <dd className="num">{value(SAMPLE_OPPONENT)}</dd>
              </div>
            ))}
          </dl>
          <div className="tape-actions">
            <button className="button button-primary" disabled>
              Find a match
            </button>
            <Link className="text-button" to="/results">
              Preview the results screen
            </Link>
          </div>
        </section>

        <section className="card" aria-labelledby="steps-heading">
          <h2 id="steps-heading">How a duel runs</h2>
          <ol className="duel-steps">
            {ROUND_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      </div>
    </>
  )
}
