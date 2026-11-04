import { PageHeader } from '../components/PageHeader'
import { StubNote } from '../components/StubNote'
import { SAMPLE_LEADERBOARD, SAMPLE_ME } from '../sampleData'
import './LeaderboardPage.css'

export default function LeaderboardPage() {
  const podium = SAMPLE_LEADERBOARD.slice(0, 3)

  return (
    <>
      <PageHeader kicker="Global" title="Leaderboard">
        <StubNote>Sample players. The real table comes from ranked duels, ordered by Elo.</StubNote>
      </PageHeader>

      <ol className="podium" aria-label="Top three">
        {podium.map((player, i) => (
          <li className={`podium-step podium-${i + 1}`} key={player.name}>
            <span className="podium-rank num">{i + 1}</span>
            <span className="podium-name">{player.name}</span>
            <span className="podium-elo num">{player.elo} Elo</span>
          </li>
        ))}
      </ol>

      <section className="card" aria-labelledby="table-heading">
        <h2 id="table-heading">Rankings</h2>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">Elo</th>
              <th scope="col">Record</th>
              <th scope="col">Best bark</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_LEADERBOARD.map((player, i) => (
              <tr key={player.name} className={player === SAMPLE_ME ? 'row-you' : undefined}>
                <td className="rank num">{i + 1}</td>
                <th scope="row">{player === SAMPLE_ME ? `${player.name} (you)` : player.name}</th>
                <td className="num">{player.elo}</td>
                <td className="num">
                  {player.wins}–{player.losses}
                </td>
                <td className="num">{player.bestBark.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
