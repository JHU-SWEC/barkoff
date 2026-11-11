import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router'
import { useDog } from '../dogs'
import { playClickBark, setMuted, useMuted } from '../sfx'
import { BarkMark } from './BarkMark'
import { DogSprite } from './DogSprite'
import './AppShell.css'

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/solo', label: 'Single player' },
  { to: '/duel', label: 'Duel' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/profile', label: 'Profile' },
]

export function SoundToggle({ className = 'sound-toggle' }: { className?: string }) {
  const muted = useMuted()
  return (
    <button
      className={className}
      aria-pressed={!muted}
      aria-label={muted ? 'Turn bark sounds on' : 'Turn bark sounds off'}
      title={muted ? 'Bark sounds off' : 'Bark sounds on'}
      // Quiet when muting; one bark to confirm when sound comes back on.
      data-sfx="off"
      onClick={() => {
        setMuted(!muted)
        if (muted) playClickBark()
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" />
        {muted ? (
          <path className="sound-stroke" d="m16 9 5 6m0-6-5 6" />
        ) : (
          <path className="sound-stroke" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
        )}
      </svg>
    </button>
  )
}

export function AppShell() {
  const dog = useDog()

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
          <div className="topbar-tools">
            <SoundToggle />
            <Link className="topbar-dog" to="/#your-dog" title={`${dog.name} the ${dog.breed}`}>
              <DogSprite dog={dog} scale={1} label={`Your dog, ${dog.name}`} />
            </Link>
            <Link className="button button-secondary topbar-signin" to="/login">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="column canvas">
        <Outlet />
      </main>
      <ScrollRestoration />
    </>
  )
}
