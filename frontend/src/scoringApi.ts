// Hand scores for the human-bark clips (backend/bark_scores.py). Each scorer's scores are saved
// to scripts/data/human_barks/labels/<scorer>.csv on the server, one request per change.

export const TYPES = ['playful', 'aggressive', 'whimper', 'growl', 'alarm', 'none'] as const
export type BarkType = (typeof TYPES)[number]

export interface ClipScore {
  id: string
  likeness: string // "" or "0" "0.25" "0.5" "0.75" "1"
  type: BarkType | ''
  not_human: string // "1" or ""
  bad_audio: string
  notes: string
  scored_at?: string
}

export interface Team {
  clips: number
  scorers: Record<string, number>
  clips_by_scorers: Record<string, number>
}

const UNREACHABLE = 'The server isn’t reachable. Start it with python backend/server.py.'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new Error(UNREACHABLE)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? UNREACHABLE)
  return body as T
}

const who = (scorer: string) => `scorer=${encodeURIComponent(scorer)}`

export const fetchClips = () => call<{ clips: string[]; missing_audio: number }>('/api/scoring/clips')
export const fetchScores = (scorer: string) =>
  call<{ scores: Record<string, ClipScore> }>(`/api/scoring/scores?${who(scorer)}`).then((r) => r.scores)
export const fetchTeam = () => call<Team>('/api/scoring/team')
export const clipUrl = (id: string) => `/api/scoring/audio/${id}.wav`

export function saveScore(scorer: string, s: ClipScore | { id: string; clear: true }) {
  const body =
    'clear' in s
      ? s
      : {
          id: s.id,
          likeness: s.likeness === '' ? null : Number(s.likeness),
          type: s.type,
          not_human: s.not_human === '1',
          bad_audio: s.bad_audio === '1',
          notes: s.notes,
        }
  return call<{ saved: string; scored: number }>(`/api/scoring/scores?${who(scorer)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Scored = a likeness and a type, or flagged as not usable. */
export function isComplete(s: ClipScore | undefined): boolean {
  return !!s && (s.bad_audio === '1' || s.not_human === '1' || (s.likeness !== '' && !!s.type))
}

export function isFlagged(s: ClipScore | undefined): boolean {
  return !!s && (s.bad_audio === '1' || s.not_human === '1')
}
