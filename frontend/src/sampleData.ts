// Placeholder content for the stub pages. Delete each export as the API replaces it.
// Scores use the scorer's 0-1 scale and its weights, so the layouts are tested with realistic numbers.

export interface SamplePlayer {
  name: string
  elo: number
  wins: number
  losses: number
  bestBark: number
}

export interface SampleBark {
  score: number
  loudness: number
  likeness: number
}

export const SAMPLE_ME: SamplePlayer = { name: 'Guest', elo: 1248, wins: 7, losses: 4, bestBark: 0.83 }

export const SAMPLE_OPPONENT: SamplePlayer = { name: 'Porch Alarm', elo: 1262, wins: 12, losses: 9, bestBark: 0.8 }

export const SAMPLE_LEADERBOARD: SamplePlayer[] = [
  { name: 'Good Boy 9000', elo: 1712, wins: 88, losses: 21, bestBark: 0.97 },
  { name: 'Squirrel Patrol', elo: 1664, wins: 73, losses: 30, bestBark: 0.94 },
  { name: 'Couch Wolf', elo: 1621, wins: 61, losses: 28, bestBark: 0.95 },
  { name: 'Mail Carrier’s Nightmare', elo: 1540, wins: 49, losses: 33, bestBark: 0.91 },
  { name: 'Zoomies', elo: 1498, wins: 40, losses: 31, bestBark: 0.88 },
  { name: 'Tennis Ball Thief', elo: 1431, wins: 35, losses: 34, bestBark: 0.86 },
  { name: 'Loud Neighbor', elo: 1377, wins: 28, losses: 26, bestBark: 0.9 },
  SAMPLE_OPPONENT,
  SAMPLE_ME,
  { name: 'Biscuit', elo: 1183, wins: 5, losses: 9, bestBark: 0.71 },
]

export const SAMPLE_ROUNDS: { you: SampleBark; them: SampleBark }[] = [
  { you: { score: 0.75, loudness: 0.9, likeness: 0.71 }, them: { score: 0.68, loudness: 0.82, likeness: 0.64 } },
  { you: { score: 0.56, loudness: 0.74, likeness: 0.52 }, them: { score: 0.73, loudness: 0.88, likeness: 0.69 } },
  { you: { score: 0.83, loudness: 0.93, likeness: 0.8 }, them: { score: 0.7, loudness: 0.85, likeness: 0.66 } },
]

export const SAMPLE_ELO_CHANGE = 18

export const SAMPLE_HISTORY = [
  { opponent: 'Porch Alarm', won: true, rounds: '2–1', eloChange: 18, when: 'Today' },
  { opponent: 'Biscuit', won: true, rounds: '2–0', eloChange: 9, when: 'Yesterday' },
  { opponent: 'Loud Neighbor', won: false, rounds: '1–2', eloChange: -14, when: 'Yesterday' },
  { opponent: 'Zoomies', won: false, rounds: '0–2', eloChange: -11, when: 'Oct 30' },
]
