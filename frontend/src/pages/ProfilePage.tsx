import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { logoutAccount, saveDisplayName, useAccount } from '../account'
import { BarkMark } from '../components/BarkMark'
import { CalibrationSummary } from '../components/CalibrationSummary'
import { Figure } from '../components/Figure'
import { PageHeader } from '../components/PageHeader'
import { StubNote } from '../components/StubNote'
import { loadSoloRecord } from '../soloResults'
import { SAMPLE_HISTORY, SAMPLE_ME } from '../sampleData'
import './ProfilePage.css'

export default function ProfilePage() {
  const { account, setAccount } = useAccount()
  const { best } = loadSoloRecord()

  if (!account) return <GuestProfile bestScore={best ? best.score.toFixed(2) : '—'} />

  return (
    <SignedInProfile
      account={account}
      bestScore={best ? best.score.toFixed(2) : '—'}
      onAccount={setAccount}
      onSignedOut={() => setAccount(null)}
    />
  )
}

function GuestProfile({ bestScore }: { bestScore: string }) {
  const played = SAMPLE_ME.wins + SAMPLE_ME.losses
  return (
    <>
      <PageHeader kicker="Your corner" title="Profile">
        <StubNote>Mic check and best solo bark are real (kept in this browser). Elo and match history are samples until you sign in.</StubNote>
      </PageHeader>
      <div className="profile-layout">
        <div className="profile-main">
          <section className="card" aria-label="Player">
            <PlayerId name={SAMPLE_ME.name} />
            <Link className="text-button" to="/login">
              Sign in to save your name
            </Link>
            <RecordFigures
              elo={String(SAMPLE_ME.elo)}
              record={`${SAMPLE_ME.wins}–${SAMPLE_ME.losses}`}
              winRate={`${Math.round((SAMPLE_ME.wins / played) * 100)}%`}
              bestScore={bestScore}
            />
          </section>
          <History />
        </div>
        <CalibrationSummary />
      </div>
    </>
  )
}

function SignedInProfile({
  account,
  bestScore,
  onAccount,
  onSignedOut,
}: {
  account: NonNullable<ReturnType<typeof useAccount>['account']>
  bestScore: string
  onAccount: (account: NonNullable<ReturnType<typeof useAccount>['account']>) => void
  onSignedOut: () => void
}) {
  const [name, setName] = useState(account.displayName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const played = account.wins + account.losses

  useEffect(() => {
    setName(account.displayName)
  }, [account.displayName])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onAccount(await saveDisplayName(name))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    try {
      await logoutAccount()
    } catch {
      // Drop the local session even if the server is down.
    }
    onSignedOut()
  }

  return (
    <>
      <PageHeader kicker="Your corner" title="Profile">
        <p className="subline">Your name, Elo and record are saved to your account. Solo barks still stay in this browser.</p>
      </PageHeader>
      <div className="profile-layout">
        <div className="profile-main">
          <section className="card" aria-label="Player">
            <PlayerId name={account.displayName} />
            <p className="quiet profile-email">{account.email}</p>
            <RecordFigures
              elo={String(account.elo)}
              record={`${account.wins}–${account.losses}`}
              winRate={played ? `${Math.round((account.wins / played) * 100)}%` : '—'}
              bestScore={bestScore}
            />
            <form className="profile-edit" onSubmit={onSubmit}>
              <label className="field">
                <span>Display name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} required />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="card-actions">
                <button className="button button-primary" type="submit" disabled={busy || name.trim() === account.displayName}>
                  Save name
                </button>
                <button className="button button-secondary" type="button" onClick={signOut}>
                  Sign out
                </button>
              </div>
            </form>
          </section>
          <section className="card" aria-labelledby="history-heading">
            <h2 id="history-heading">Recent duels</h2>
            <p className="quiet">No duels yet. Ranked matches aren’t recorded until the duel server exists.</p>
          </section>
        </div>
        <CalibrationSummary />
      </div>
    </>
  )
}

function PlayerId({ name }: { name: string }) {
  return (
    <div className="profile-id">
      <div className="profile-avatar">
        <BarkMark className="profile-mark" />
      </div>
      <h2>{name}</h2>
    </div>
  )
}

function RecordFigures({
  elo,
  record,
  winRate,
  bestScore,
}: {
  elo: string
  record: string
  winRate: string
  bestScore: string
}) {
  return (
    <dl className="figures figures-profile">
      <Figure lead label="Elo" value={elo} />
      <Figure label="Record" value={record} />
      <Figure label="Win rate" value={winRate} />
      <Figure label="Best solo bark" value={bestScore} />
    </dl>
  )
}

function History() {
  return (
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
                <span className={match.won ? 'pill pill-info' : 'pill pill-negative'}>{match.won ? 'Win' : 'Loss'}</span>
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
  )
}
