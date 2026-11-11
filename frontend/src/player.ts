// Guest identity for duels until accounts exist. The id lives in sessionStorage, so each tab is
// its own player: open two tabs to duel yourself. The name is shared across tabs.

const ID_KEY = 'barkoff.player'
const NAME_KEY = 'barkoff.name'

export const MAX_NAME = 24

function newId(): string {
  return `guest-${crypto.randomUUID()}`
}

export function playerId(): string {
  try {
    let id = sessionStorage.getItem(ID_KEY)
    if (!id) {
      id = newId()
      sessionStorage.setItem(ID_KEY, id)
    }
    return id
  } catch {
    return (fallbackId ??= newId())
  }
}

let fallbackId: string | null = null

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
