import { useSyncExternalStore } from 'react'

// The eight pixel dogs (public/sprites/, drawn by scripts/sprites.mjs). The player's pick is kept in
// this browser until accounts can store it. Each dog has its own synthesized voice (sfx.ts).

/** How a dog's bark is synthesized: one or more barks of a pitch contour through two formants. */
export interface Voice {
  wave: OscillatorType
  /** Base pitch in Hz. */
  pitch: number
  /** Pitch at the start, peak (a quarter in) and end, as multiples of `pitch`. */
  contour: [number, number, number]
  /** Seconds per bark. */
  length: number
  /** Barks in a row, `gap` seconds apart. */
  repeats: number
  gap: number
  /** Two vowel resonances in Hz: low "oo/woo", high "ee/yip". */
  formants: [number, number]
  /** Breathiness, 0 to 1. */
  breath: number
  /** Howl wobble: rate in Hz and depth as a share of pitch. */
  vibrato?: [number, number]
  /** Throaty flutter depth, 0 to 1. */
  growl?: number
  /** Distortion amount; 0 for clean. */
  drive?: number
}

export interface Dog {
  id: string
  name: string
  breed: string
  voice: Voice
  /** Middle of the face on the 64px sprite grid, for head-and-shoulders portraits. */
  face: [number, number]
  /** The head circle on the 64px grid (centre x, centre y, radius): where the player's face goes. */
  head: [number, number, number]
}

export const DOGS: Dog[] = [
  {
    // The Shiba scream: one long, wobbling "AAAH".
    id: 'shiba', name: 'Mochi', breed: 'Shiba Inu', face: [44, 28], head: [40, 28, 13],
    voice: { wave: 'sawtooth', pitch: 520, contour: [0.85, 1.25, 1.05], length: 0.55, repeats: 1, gap: 0, formants: [950, 2300], breath: 0.3, vibrato: [8, 0.07], drive: 4 },
  },
  {
    // A quick "arf-arf".
    id: 'corgi', name: 'Biscuit', breed: 'Corgi', face: [47, 34], head: [43, 34, 12],
    voice: { wave: 'square', pitch: 430, contour: [0.85, 1.35, 0.8], length: 0.09, repeats: 2, gap: 0.07, formants: [820, 1700], breath: 0.35 },
  },
  {
    // Husky talk: a rising-falling "awoo-woo".
    id: 'husky', name: 'Blizzard', breed: 'Husky', face: [44, 27], head: [40, 27, 13.5],
    voice: { wave: 'sawtooth', pitch: 300, contour: [0.7, 1.35, 0.8], length: 0.42, repeats: 2, gap: 0.04, formants: [620, 1100], breath: 0.2, vibrato: [5, 0.06] },
  },
  {
    // Snorty grunts: "hrmf hrmf".
    id: 'pug', name: 'Nugget', breed: 'Pug', face: [43, 31], head: [39, 31, 14.5],
    voice: { wave: 'sawtooth', pitch: 170, contour: [1, 1.12, 0.7], length: 0.13, repeats: 2, gap: 0.05, formants: [480, 1250], breath: 0.95, growl: 0.55, drive: 10 },
  },
  {
    // The textbook "woof".
    id: 'dalmatian', name: 'Domino', breed: 'Dalmatian', face: [45, 20], head: [41, 19, 11.5],
    voice: { wave: 'sawtooth', pitch: 230, contour: [0.85, 1.25, 0.7], length: 0.17, repeats: 1, gap: 0, formants: [620, 1150], breath: 0.3 },
  },
  {
    // A soft, happy "boof".
    id: 'golden', name: 'Sunny', breed: 'Golden Retriever', face: [44, 28], head: [41, 28, 12.5],
    voice: { wave: 'triangle', pitch: 165, contour: [0.9, 1.15, 0.8], length: 0.22, repeats: 1, gap: 0, formants: [430, 880], breath: 0.15 },
  },
  {
    // Yappy: "yap-yap-yap".
    id: 'dachshund', name: 'Frank', breed: 'Dachshund', face: [51, 38], head: [48, 38, 10.5],
    voice: { wave: 'square', pitch: 540, contour: [0.9, 1.4, 0.95], length: 0.07, repeats: 3, gap: 0.055, formants: [1050, 2500], breath: 0.3 },
  },
  {
    // The hound's bay: a long "aroooo".
    id: 'beagle', name: 'Scout', breed: 'Beagle', face: [44, 28], head: [42, 28, 12.5],
    voice: { wave: 'sawtooth', pitch: 320, contour: [0.7, 1.2, 0.95], length: 0.85, repeats: 1, gap: 0, formants: [700, 1300], breath: 0.2, vibrato: [6, 0.05] },
  },
]

const DEFAULT_DOG = DOGS[0]
const STORAGE_KEY = 'barkoff.dog'
const CHANGE_EVENT = 'barkoff:dog'

export function dogById(id: string | null | undefined): Dog {
  return DOGS.find((d) => d.id === id) ?? DEFAULT_DOG
}

export function spriteUrl(dog: Dog, barking = false): string {
  return `/sprites/${dog.id}${barking ? '-bark' : ''}.png`
}

/** The ears, nose, mouth, tongue and whiskers alone, to lay over the player's face. */
export function faceUrl(dog: Dog, barking = false): string {
  return `/sprites/${dog.id}-face${barking ? '-bark' : ''}.png`
}

export function walkUrls(dog: Dog): [string, string] {
  return [`/sprites/${dog.id}-walk1.png`, `/sprites/${dog.id}-walk2.png`]
}

// A stable dog for a player we only know by name (sample players, opponents without a pick).
export function dogFor(name: string): Dog {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return DOGS[h % DOGS.length]
}

export function loadDog(): Dog {
  try {
    return dogById(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_DOG
  }
}

export function saveDog(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Private mode: the pick lasts for this page only.
  }
  current = dogById(id)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

let current: Dog | null = null

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    current = loadDog()
    onChange()
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

function snapshot(): Dog {
  current ??= loadDog()
  return current
}

/** The player's dog, shared across the page and other tabs. */
export function useDog(): Dog {
  return useSyncExternalStore(subscribe, snapshot)
}

// Fetch the barking frames up front so the first bark doesn't flash an empty image.
export function preloadSprites() {
  for (const dog of DOGS) {
    for (const url of [spriteUrl(dog), spriteUrl(dog, true), ...walkUrls(dog), faceUrl(dog), faceUrl(dog, true)]) {
      new Image().src = url
    }
  }
}
