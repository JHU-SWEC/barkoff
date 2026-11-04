import { Navigate, createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AppShell } from './components/AppShell'
import DuelPage from './pages/DuelPage'
import HomePage from './pages/HomePage'
import LeaderboardPage from './pages/LeaderboardPage'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'
import ResultsPage from './pages/ResultsPage'

// Routes only. Page content lives in pages/, shared pieces in components/.
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppShell />,
    // Shown while a direct visit to a lazy route loads.
    hydrateFallbackElement: <p className="column canvas quiet">Loading…</p>,
    children: [
      { index: true, element: <HomePage /> },
      // Lazy so the face detector only downloads for the page that uses it.
      { path: 'solo', lazy: async () => ({ Component: (await import('./pages/SinglePlayerPage')).default }) },
      { path: 'duel', element: <DuelPage /> },
      { path: 'results', element: <ResultsPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'leaderboard', element: <LeaderboardPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
