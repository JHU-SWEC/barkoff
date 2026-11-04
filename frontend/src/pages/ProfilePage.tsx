import { Link } from 'react-router'
import { BarkMark } from '../components/BarkMark'
import { CalibrationSummary } from '../components/CalibrationSummary'
import { Figure } from '../components/Figure'
import { PageHeader } from '../components/PageHeader'
import { StubNote } from '../components/StubNote'
import { loadSoloRecord } from '../soloResults'
import { SAMPLE_HISTORY, SAMPLE_ME } from '../sampleData'
import './ProfilePage.css'

export default function ProfilePage() {
  const played = SAMPLE_ME.wins + SAMPLE_ME.losses
  const { best } = loadSoloRecord()

  return (
    <>
      <PageHeader kicker="Your corner" title="Profile">
        <StubNote>Mic check and best solo bark are real (kept in this browser). Elo and match history are samples until accounts exist.</StubNote>
      </PageHeader>

      <div className="profile-layout">
        <div className="profile-main">
          <section className="card" aria-label="Player">
            <div className="profile-id">
              <div className="profile-avatar">
                <BarkMark className="profile-mark" />
              </div>
              <div>
                <h2>{SAMPLE_ME.name}</h2>
                <Link className="text-button" to="/login">
                  Sign in to save your barks
                </Link>
              </div>
            </div>
            <dl className="figures figures-profile">
              <Figure lead label="Elo" value={String(SAMPLE_ME.elo)} />
              <Figure label="Record" value={`${SAMPLE_ME.wins}–${SAMPLE_ME.losses}`} />
              <Figure label="Win rate" value={`${Math.round((SAMPLE_ME.wins / played) * 100)}%`} />
              <Figure label="Best solo bark" value={best ? best.score.toFixed(2) : '—'} />
            </dl>
          </section>

          <section className="card" aria-labelledby="history-heading">
            <h2 id="history-heading">Recent duels</h2>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Opponent</th>
                  <th scope="col">Result</th>
                  <th scope="col">Rounds</th>
                  <th scope="col">Elo</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_HISTORY.map((match) => (
                  <tr key={`${match.opponent}-${match.when}`}>
                    <th scope="row">{match.opponent}</th>
                    <td>
                      <span className={match.won ? 'pill pill-info' : 'pill pill-negative'}>
                        {match.won ? 'Win' : 'Loss'}
                      </span>
                    </td>
                    <td className="num">{match.rounds}</td>
                    <td className="num">
                      {match.eloChange > 0 ? '+' : '−'}
                      {Math.abs(match.eloChange)}
                    </td>
                    <td className="quiet">{match.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <CalibrationSummary />
      </div>
    </>
  )
}
