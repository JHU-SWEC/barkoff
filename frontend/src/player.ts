// Guest identity for duels until accounts exist. The id lives in sessionStorage, so each tab is
// its own player: open two tabs to duel yourself. The name is shared across tabs.

const ID_KEY = 'barkoff.player'
const SECRET_KEY = 'barkoff.secret'
const NAME_KEY = 'barkoff.name'

export const MAX_NAME = 24

function newId(): string {
  return `guest-${crypto.randomUUID()}`
}

function stored(key: string, fallback: Map<string, string>): string {
  try {
    let value = sessionStorage.getItem(key)
    if (!value) {
      value = newId()
      sessionStorage.setItem(key, value)
    }
    return value
  } catch {
    if (!fallback.has(key)) fallback.set(key, newId())
    return fallback.get(key)!
  }
}

const fallbacks = new Map<string, string>()

/** Public: opponents and the leaderboard see it. */
export const playerId = (): string => stored(ID_KEY, fallbacks)

/** Never shown to anyone: proves to the duel server that this tab is playerId(). */
export const playerSecret = (): string => stored(SECRET_KEY, fallbacks)

export function loadName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY)
    if (saved) return saved
  } catch {
    // fall through to a fresh guest name
  }
  return `Guest ${Math.floor(1000 + Math.random() * 9000)}`
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Private mode: the name lasts for this page only.
  }
}
