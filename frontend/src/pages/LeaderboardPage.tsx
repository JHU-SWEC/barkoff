import { useEffect, useState } from 'react'
import { useAccount } from '../account'
import { PageHeader } from '../components/PageHeader'
import { fetchLeaderboard, type LeaderboardPlayer } from '../leaderboard'
import './LeaderboardPage.css'

export default function LeaderboardPage() {
  const { account } = useAccount()
  const [players, setPlayers] = useState<LeaderboardPlayer[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchLeaderboard(50)
      .then((next) => {
        if (!cancelled) {
          setPlayers(next)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPlayers([])
          setError(err instanceof Error ? err.message : 'Could not load leaderboard.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [account?.id, account?.displayName, account?.bestSoloScore])

  const podium = players?.slice(0, 3) ?? []

  return (
    <>
      <PageHeader kicker="Global" title="Leaderboard">
        <p className="subline">Every account, ranked by Elo. Best solo bark updates when you upload a scored take.</p>
      </PageHeader>

      {error ? (
        <p className="quiet">{error}</p>
      ) : players == null ? (
        <p className="quiet">Loading rankings…</p>
      ) : players.length === 0 ? (
        <p className="quiet">No players yet. Create an account to appear here.</p>
      ) : (
        <>
          <ol className="podium" aria-label="Top three">
            {podium.map((player, i) => (
              <li className={`podium-step podium-${i + 1}`} key={player.userId}>
                <span className="podium-rank num">{i + 1}</span>
                <span className="podium-name">{player.displayName}</span>
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
                {players.map((player, i) => {
                  const you = account?.id === player.userId
                  return (
                    <tr key={player.userId} className={you ? 'row-you' : undefined}>
                      <td className="rank num">{i + 1}</td>
                      <th scope="row">{you ? `${player.displayName} (you)` : player.displayName}</th>
                      <td className="num">{player.elo}</td>
                      <td className="num">
                        {player.wins}–{player.losses}
                      </td>
                      <td className="num">{player.bestBark != null ? player.bestBark.toFixed(2) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  )
}
