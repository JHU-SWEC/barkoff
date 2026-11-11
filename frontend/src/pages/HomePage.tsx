import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAccount } from '../account'
import { CalibrationSummary } from '../components/CalibrationSummary'
import { fetchLeaderboard, type LeaderboardPlayer } from '../leaderboard'
import { loadSoloRecord } from '../soloResults'
import './HomePage.css'

export default function HomePage() {
  const { account } = useAccount()
  const { best } = loadSoloRecord()
  const [top, setTop] = useState<LeaderboardPlayer[] | null>(null)
  const [topError, setTopError] = useState<string | null>(null)

  const elo = account ? account.elo : null
  const wins = account ? account.wins : null
  const losses = account ? account.losses : null
  const bestScore =
    account?.bestSoloScore != null
      ? account.bestSoloScore.toFixed(2)
      : best
        ? best.score.toFixed(2)
        : '—'

  useEffect(() => {
    let cancelled = false
    fetchLeaderboard(3)
      .then((players) => {
        if (!cancelled) {
          setTop(players)
          setTopError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTop([])
          setTopError(err instanceof Error ? err.message : 'Could not load leaderboard.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [account?.id, account?.displayName, account?.bestSoloScore])

  return (
    <>
      <title>Bark Off</title>
      <div className="page-header">
        <h1>Pick your fight</h1>
        <p className="subline">Bark into your mic. You’re scored on how loud you are and how much you sound like a dog.</p>
      </div>

      <div className="fight-card">
        <Link className="fight-side fight-solo" to="/solo">
          <span className="kicker">Single player</span>
          <span className="fight-title">Solo</span>
          <span className="fight-copy">One bark, one score. Keep going until you beat your best.</span>
          <span className="fight-cta">Start barking →</span>
        </Link>
        <Link className="fight-side fight-duel" to="/duel">
          <span className="kicker">Ranked 1v1</span>
          <span className="fight-title">Duel</span>
          <span className="fight-copy">Best of three, same cue, same second. Elo on the line.</span>
          <span className="fight-cta">See the card →</span>
        </Link>
        <span className="fight-vs" aria-hidden="true">
          VS
        </span>
      </div>

      <div className="home-strip">
        <CalibrationSummary />

        <section className="card" aria-labelledby="record-heading">
          <div className="card-head">
            <h2 id="record-heading">Your record</h2>
            {account ? (
              <span className="pill pill-info">Signed in</span>
            ) : (
              <span className="pill pill-warning">Guest</span>
            )}
          </div>
          <dl className="rows">
            <div className="row">
              <dt>Elo</dt>
              <dd className="num">{elo ?? '—'}</dd>
            </div>
            <div className="row">
              <dt>Wins – losses</dt>
              <dd className="num">{wins != null && losses != null ? `${wins} – ${losses}` : '—'}</dd>
            </div>
            <div className="row">
              <dt>Best solo bark</dt>
              <dd className="num">{bestScore}</dd>
            </div>
          </dl>
          <div className="card-actions">
            <Link className="button button-secondary" to={account ? '/profile' : '/login'}>
              {account ? 'View profile' : 'Sign in'}
            </Link>
          </div>
        </section>

        <section className="card" aria-labelledby="top-heading">
          <div className="card-head">
            <h2 id="top-heading">Top dogs</h2>
          </div>
          {topError ? (
            <p className="quiet">{topError}</p>
          ) : top == null ? (
            <p className="quiet">Loading…</p>
          ) : top.length === 0 ? (
            <p className="quiet">No accounts yet. Be the first on the board.</p>
          ) : (
            <ol className="rows top-dogs">
              {top.map((player, i) => (
                <li className="row" key={player.userId}>
                  <span>
                    <span className="top-rank num">{i + 1}</span> {player.displayName}
                  </span>
                  <span className="num">{player.elo}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="card-actions">
            <Link className="button button-secondary" to="/leaderboard">
              Full leaderboard
            </Link>
          </div>
        </section>
      </div>
    </>
  )
}
