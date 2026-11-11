import type { DuelView } from './duelApi'

// The last finished duel, kept for this tab so Results still shows it after a refresh.
const KEY = 'barkoff.lastDuel'

export function saveLastDuel(view: DuelView) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(view))
  } catch {
    // Private mode or full storage: Results falls back to router state.
  }
}

export function loadLastDuel(): DuelView | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as DuelView) : null
  } catch {
    return null
  }
}
