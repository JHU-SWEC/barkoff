import { Navigate, createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AppShell } from './components/AppShell'
import { Root } from './components/Root'
import HomePage from './pages/HomePage'
import LeaderboardPage from './pages/LeaderboardPage'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'
import ResultsPage from './pages/ResultsPage'

// Routes only. Page content lives in pages/, shared pieces in components/.
// Login and Duel take the whole screen; everything else sits in the shell with the nav bar.
const router = createBrowserRouter([
  {
    element: <Root />,
    // Shown while a direct visit to a lazy route loads.
    hydrateFallbackElement: <p className="column canvas quiet">Loading…</p>,
    children: [
      { path: '/login', element: <LoginPage /> },
      // Lazy so the face detector only downloads for the pages that use it.
      { path: '/duel', lazy: async () => ({ Component: (await import('./pages/DuelPage')).default }) },
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'solo', lazy: async () => ({ Component: (await import('./pages/SinglePlayerPage')).default }) },
          { path: 'results', element: <ResultsPage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: 'leaderboard', element: <LeaderboardPage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
