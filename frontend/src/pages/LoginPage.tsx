import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { loginAccount, registerAccount, useAccount } from '../account'
import './LoginPage.css'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAccount } = useAccount()
  const [creating, setCreating] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const account = creating
        ? await registerAccount(email, password, displayName)
        : await loginAccount(email, password)
      setAccount(account)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <title>{creating ? 'Create account' : 'Sign in'} · Bark Off</title>
      <div className="login-poster on-ink">
        <p className="login-wordmark">
          Bark
          <br />
          Off
        </p>
        <p className="login-tagline">Loudest, doggiest bark wins.</p>
      </div>

      <div className="login-panel">
        <form className="login-form" onSubmit={onSubmit}>
          <h1>{creating ? 'Create account' : 'Sign in'}</h1>
          <p className="subline">
            Email and a display name are saved in Postgres. Google and Apple sign-in aren’t set up.
          </p>

          <div className="login-fields">
            {creating && (
              <label className="field">
                <span>Display name</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="nickname"
                  maxLength={24}
                  required
                />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={creating ? 'new-password' : 'current-password'}
                minLength={8}
                required
              />
            </label>
            <button className="button button-primary" type="submit" disabled={busy}>
              {creating ? 'Create account' : 'Sign in'}
            </button>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <p className="login-or">or</p>
            <button className="button button-secondary" type="button" disabled>
              Continue with Google
            </button>
            <button className="button button-secondary" type="button" disabled>
              Continue with Apple
            </button>
          </div>

          <button
            className="text-button login-switch"
            type="button"
            onClick={() => {
              setCreating((value) => !value)
              setError(null)
            }}
          >
            {creating ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </button>

          <Link className="button button-secondary login-guest" to="/">
            Continue as guest
          </Link>
        </form>
      </div>
    </main>
  )
}
