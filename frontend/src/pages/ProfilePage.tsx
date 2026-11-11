import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { logoutAccount, saveDisplayName, useAccount } from '../account'
import { listClips, type Clip } from '../clips'
import { BarkMark } from '../components/BarkMark'
import { CalibrationSummary } from '../components/CalibrationSummary'
import { Figure } from '../components/Figure'
import { PageHeader } from '../components/PageHeader'
import { StubNote } from '../components/StubNote'
import { loadSoloRecord } from '../soloResults'
import './ProfilePage.css'

export default function ProfilePage() {
  const { account, setAccount } = useAccount()
  const { best } = loadSoloRecord()
  const localBest = best ? best.score.toFixed(2) : '—'
  const accountBest =
    account?.bestSoloScore != null ? account.bestSoloScore.toFixed(2) : localBest

  if (!account) return <GuestProfile bestScore={localBest} />

  return (
    <SignedInProfile
      account={account}
      bestScore={accountBest}
      onAccount={setAccount}
      onSignedOut={() => setAccount(null)}
    />
  )
}

function GuestProfile({ bestScore }: { bestScore: string }) {
  return (
    <>
      <PageHeader kicker="Your corner" title="Profile">
        <StubNote>Mic check and best solo bark in this browser are real. Sign in for Elo, saved recordings, and a leaderboard row.</StubNote>
      </PageHeader>
      <div className="profile-layout">
        <div className="profile-main">
          <section className="card" aria-label="Player">
            <PlayerId name="Guest" />
            <Link className="text-button" to="/login">
              Sign in to save your name
            </Link>
            <RecordFigures elo="—" record="—" winRate="—" bestScore={bestScore} />
          </section>
          <section className="card" aria-labelledby="history-heading">
            <h2 id="history-heading">Recent duels</h2>
            <p className="quiet">Sign in once ranked duels exist to see match history here.</p>
          </section>
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
  const [clips, setClips] = useState<Clip[] | null>(null)
  const [clipsError, setClipsError] = useState<string | null>(null)
  const played = account.wins + account.losses
  const bestClip = clips?.[0] ?? null
  const serverBest = bestClip ? bestClip.score.toFixed(2) : bestScore

  useEffect(() => {
    setName(account.displayName)
  }, [account.displayName])

  useEffect(() => {
    let cancelled = false
    listClips('solo', 5)
      .then((next) => {
        if (!cancelled) {
          setClips(next)
          setClipsError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setClips([])
          setClipsError(err instanceof Error ? err.message : 'Could not load recordings.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [account.id])

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
        <p className="subline">Your name and scored recordings are saved to your account. Elo updates when duels exist.</p>
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
              bestScore={serverBest}
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
          <section className="card" aria-labelledby="barks-heading">
            <h2 id="barks-heading">Saved barks</h2>
            {clipsError ? (
              <p className="quiet">{clipsError}</p>
            ) : clips == null ? (
              <p className="quiet">Loading recordings…</p>
            ) : clips.length === 0 ? (
              <p className="quiet">No saved recordings yet. Score a take while signed in on Single player.</p>
            ) : (
              <ul className="profile-clips">
                {clips.map((clip) => (
                  <li key={clip.id}>
                    <div className="profile-clip-meta">
                      <span className="num">{clip.score.toFixed(2)}</span>
                      <span className="quiet">
                        {new Date(clip.createdAt).toLocaleString()}
                        {bestClip?.id === clip.id ? ' · Best' : ''}
                      </span>
                    </div>
                    <audio controls preload="metadata" src={clip.audioUrl}>
                      Your browser can’t play this recording.
                    </audio>
                  </li>
                ))}
              </ul>
            )}
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
