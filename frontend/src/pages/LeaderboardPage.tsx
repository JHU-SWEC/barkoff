import { useEffect, useState } from 'react'
import { DogSprite } from '../components/DogSprite'
import { PageHeader } from '../components/PageHeader'
import { StubNote } from '../components/StubNote'
import { dogById, dogFor, useDog, type Dog } from '../dogs'
import { fetchLeaderboard } from '../duelApi'
import { playerId } from '../player'
import { SAMPLE_LEADERBOARD, SAMPLE_ME } from '../sampleData'
import './LeaderboardPage.css'

interface Row {
  key: string
  name: string
  dog: Dog
  elo: number
  record: string
  bestBark: string
  you: boolean
}

export default function LeaderboardPage() {
  const myDog = useDog()
  // Players from the duel server when it's running and has anyone on it; the sample otherwise.
  const [live, setLive] = useState<Row[] | null>(null)
  useEffect(() => {
    let cancelled = false
    const me = playerId()
    fetchLeaderboard()
      .then((players) => {
        if (cancelled || !players.length) return
        setLive(
          players.map((p) => ({
            key: p.id,
            name: p.name,
            dog: dogById(p.dog),
            elo: p.elo,
            record: p.draws ? `${p.wins}–${p.losses}–${p.draws}` : `${p.wins}–${p.losses}`,
            bestBark: '—',
            you: p.id === me,
          })),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const rows: Row[] =
    live ??
    SAMPLE_LEADERBOARD.map((p) => ({
      key: p.name,
      name: p.name,
      dog: p === SAMPLE_ME ? myDog : dogFor(p.name),
      elo: p.elo,
      record: `${p.wins}–${p.losses}`,
      bestBark: p.bestBark.toFixed(2),
      you: p === SAMPLE_ME,
    }))
  const podium = rows.slice(0, 3)

  return (
    <>
      <PageHeader kicker="Global" title="Leaderboard">
        {live ? (
          <p className="subline">Live from the duel server. Guest ratings reset when it restarts, until accounts land.</p>
        ) : (
          <StubNote>Sample players. Start the duel server and play a duel to see real ratings.</StubNote>
        )}
      </PageHeader>

      <ol className="podium" aria-label="Top three">
        {podium.map((player, i) => (
          <li className={`podium-step podium-${i + 1}`} key={player.key}>
            <span className="podium-rank num">{i + 1}</span>
            <DogSprite dog={player.dog} scale={i === 0 ? 3 : 2} barking={i === 0} className="podium-dog" />
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
            {rows.map((player, i) => (
              <tr key={player.key} className={player.you ? 'row-you' : undefined}>
                <td className="rank num">{i + 1}</td>
                <th scope="row">
                  <span className="player-cell">
                    <DogSprite dog={player.dog} scale={1} className="player-dog" label={player.dog.breed} />
                    {player.you ? `${player.name} (you)` : player.name}
                  </span>
                </th>
                <td className="num">{player.elo}</td>
                <td className="num">{player.record}</td>
                <td className="num">{player.bestBark}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
