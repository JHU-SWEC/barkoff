import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router'
import { logoutAccount, useAccount } from '../account'
import { BarkMark } from './BarkMark'
import './AppShell.css'

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/solo', label: 'Single player' },
  { to: '/duel', label: 'Duel' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/profile', label: 'Profile' },
]

export function AppShell() {
  const { account, setAccount } = useAccount()

  async function signOut() {
    try {
      await logoutAccount()
    } catch {
      // Drop the local session even if the server is down.
    }
    setAccount(null)
  }

  return (
    <>
      <header className="topbar on-ink">
        <div className="column topbar-inner">
          <Link className="brand" to="/" aria-label="Bark Off home">
            <BarkMark />
            Bark Off
          </Link>
          <nav className="nav" aria-label="Main">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink key={to} to={to} end={to === '/'}>
                {label}
              </NavLink>
            ))}
          </nav>
          {account ? (
            <div className="topbar-account">
              <Link className="topbar-name" to="/profile">
                {account.displayName}
              </Link>
              <button className="button button-secondary topbar-signin" type="button" onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : (
            <Link className="button button-secondary topbar-signin" to="/login">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="column canvas">
        <Outlet />
      </main>
      <ScrollRestoration />
    </>
  )
}
