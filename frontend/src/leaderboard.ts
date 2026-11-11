export interface LeaderboardPlayer {
  userId: string
  displayName: string
  elo: number
  wins: number
  losses: number
  bestBark: number | null
}

const UNREACHABLE = 'The server isn’t reachable. Start it with python backend/server.py.'

export async function fetchLeaderboard(limit = 50): Promise<LeaderboardPlayer[]> {
  let res: Response
  try {
    res = await fetch(`/api/leaderboard?limit=${limit}`)
  } catch {
    throw new Error(UNREACHABLE)
  }
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(payload?.error ?? UNREACHABLE)
  return (payload?.players as LeaderboardPlayer[] | undefined) ?? []
}
