import { useSyncExternalStore } from 'react'
import { loadDog, type Dog } from './dogs'

// Sound effects. Useful clicks play a real recorded bark (public/sounds/bark.mp3, credited in
// public/sounds/CREDITS.md); each dog's own voice for the picker and duels is synthesized from
// dogs.ts, as are duel hits, beeps and jingles.
// Never while the mic is open: a bark from the speakers would land in the take and score itself.

const STORAGE_KEY = 'barkoff.sfx'
const CHANGE_EVENT = 'barkoff:sfx'
const VOLUME = 0.22

// What counts as useful: links, buttons and choices. Mark anything else with data-sfx="off" to stay quiet.
const CLICKABLE = 'a[href], button, input[type="radio"], input[type="checkbox"], [role="radio"], [role="tab"]'

let ctx: AudioContext | null = null
let micOpen = false

export function setMicOpen(open: boolean) {
  micOpen = open
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'off'
  } catch {
    return false
  }
}

let muted = readMuted()

export function setMuted(next: boolean) {
  muted = next
  try {
    if (next) localStorage.setItem(STORAGE_KEY, 'off')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode: muting lasts for this page only.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(CHANGE_EVENT, onChange)
      return () => window.removeEventListener(CHANGE_EVENT, onChange)
    },
    () => muted,
  )
}

/**
 * The dog's own bark (see Voice in dogs.ts): each bark is a pitch contour through two vowel
 * formants, with a breathy noise burst on the attack, plus optional howl wobble, throaty flutter
 * and grit. Short barks punch; long ones (screams, howls) swell in and hold.
 */
export function playBark(dog: Dog = loadDog()) {
  const ctx = ready()
  if (!ctx) return
  const v = dog.voice
  const p = v.pitch * (0.96 + Math.random() * 0.08)
  const long = v.length > 0.3
  for (let i = 0; i < v.repeats; i++) {
    const t = ctx.currentTime + 0.005 + i * (v.length + v.gap)
    // Later barks in a burst come out a touch lower and quieter.
    const pitch = p * (1 - i * 0.04)
    const level = VOLUME * (1 - i * 0.12)

    const out = ctx.createGain()
    out.gain.setValueAtTime(0.0001, t)
    out.gain.exponentialRampToValueAtTime(level, t + (long ? 0.05 : 0.01))
    out.gain.setValueAtTime(level * (long ? 0.85 : 0.6), t + v.length * (long ? 0.7 : 0.5))
    out.gain.exponentialRampToValueAtTime(0.0001, t + v.length)
    out.connect(ctx.destination)

    let into: AudioNode = out
    if (v.drive) {
      const shaper = distortion(ctx, v.drive)
      shaper.connect(out)
      into = shaper
    }
    if (v.growl) {
      const flutter = ctx.createGain()
      flutter.gain.value = 1 - v.growl / 2
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 34
      const depth = ctx.createGain()
      depth.gain.value = v.growl / 2
      lfo.connect(depth).connect(flutter.gain)
      flutter.connect(into)
      into = flutter
      lfo.start(t)
      lfo.stop(t + v.length + 0.02)
    }

    const voice = ctx.createOscillator()
    voice.type = v.wave
    const [c0, c1, c2] = v.contour
    voice.frequency.setValueAtTime(pitch * c0, t)
    voice.frequency.exponentialRampToValueAtTime(pitch * c1, t + v.length * 0.25)
    voice.frequency.exponentialRampToValueAtTime(pitch * c2, t + v.length)
    if (v.vibrato) {
      const [rate, depth] = v.vibrato
      const lfo = ctx.createOscillator()
      lfo.frequency.value = rate
      const amount = ctx.createGain()
      amount.gain.value = pitch * depth
      lfo.connect(amount).connect(voice.frequency)
      lfo.start(t)
      lfo.stop(t + v.length + 0.02)
    }
    v.formants.forEach((freq, k) => {
      const band = ctx.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = freq
      band.Q.value = k === 0 ? 4 : 6
      const g = ctx.createGain()
      g.gain.value = k === 0 ? 1 : 0.55
      voice.connect(band).connect(g).connect(into)
    })

    const noise = ctx.createBufferSource()
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * Math.min(0.08, v.length)), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1) * (1 - j / data.length)
    noise.buffer = buf
    const hiss = ctx.createBiquadFilter()
    hiss.type = 'bandpass'
    hiss.frequency.value = v.formants[1]
    hiss.Q.value = 1
    const hissGain = ctx.createGain()
    hissGain.gain.value = v.breath * 0.6
    noise.connect(hiss).connect(hissGain).connect(into)

    voice.start(t)
    voice.stop(t + v.length + 0.02)
    noise.start(t)
  }
}

function distortion(ctx: AudioContext, amount: number): WaveShaperNode {
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x))
  }
  const shaper = ctx.createWaveShaper()
  shaper.curve = curve
  shaper.oversample = '2x'
  return shaper
}

const CLICK_BARK_URL = '/sounds/bark.mp3'
let clickBark: Promise<AudioBuffer | null> | null = null

function loadClickBark(c: AudioContext): Promise<AudioBuffer | null> {
  clickBark ??= fetch(CLICK_BARK_URL)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
    .then((data) => c.decodeAudioData(data))
    .catch(() => null)
  return clickBark
}

/** A real bark on each useful click, its pitch nudged a little each time; the synth if it won't load. */
export function playClickBark() {
  const c = ready()
  if (!c) return
  void loadClickBark(c).then((buffer) => {
    // The mic may have opened while the file loaded.
    if (micOpen || muted) return
    if (!buffer) {
      synthClickBark(c)
      return
    }
    const source = c.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 0.92 + Math.random() * 0.16
    const gain = c.createGain()
    gain.gain.value = 0.55
    source.connect(gain).connect(c.destination)
    source.start()
  })
}

/**
 * Fallback click bark: one low, gruff "RUFF". A distorted sawtooth with a square an octave below,
 * a fast tremolo for the growl, and a hard, short envelope.
 */
function synthClickBark(ctx: AudioContext) {
  const t = ctx.currentTime + 0.005
  const length = 0.17
  const p = 125 * (0.93 + Math.random() * 0.14)

  const out = ctx.createGain()
  out.gain.setValueAtTime(0.0001, t)
  out.gain.exponentialRampToValueAtTime(VOLUME * 1.1, t + 0.006)
  out.gain.setValueAtTime(VOLUME * 1.1, t + length * 0.45)
  out.gain.exponentialRampToValueAtTime(0.0001, t + length)
  out.connect(ctx.destination)

  // Growl: the level flutters ~40 times a second.
  const growl = ctx.createGain()
  growl.gain.value = 0.65
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 38
  const depth = ctx.createGain()
  depth.gain.value = 0.35
  lfo.connect(depth).connect(growl.gain)

  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.setValueAtTime(2600, t)
  tone.frequency.exponentialRampToValueAtTime(900, t + length)
  const shaper = distortion(ctx, 18)
  growl.connect(shaper).connect(tone)
  for (const [freq, q, gain] of [
    [480, 3, 1],
    [1050, 5, 0.6],
  ]) {
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = freq
    band.Q.value = q
    const g = ctx.createGain()
    g.gain.value = gain
    tone.connect(band).connect(g).connect(out)
  }
  // Some unfiltered body underneath the formants.
  const body = ctx.createGain()
  body.gain.value = 0.25
  tone.connect(body).connect(out)

  const voices = [
    { type: 'sawtooth' as OscillatorType, mult: 1, gain: 0.8 },
    { type: 'square' as OscillatorType, mult: 0.5, gain: 0.45 },
  ]
  for (const v of voices) {
    const osc = ctx.createOscillator()
    osc.type = v.type
    osc.frequency.setValueAtTime(p * v.mult * 0.85, t)
    osc.frequency.exponentialRampToValueAtTime(p * v.mult * 1.35, t + 0.035)
    osc.frequency.exponentialRampToValueAtTime(p * v.mult * 0.7, t + length)
    const g = ctx.createGain()
    g.gain.value = v.gain
    osc.connect(g).connect(growl)
    osc.start(t)
    osc.stop(t + length + 0.02)
  }

  // A rough, breathy attack.
  const noise = ctx.createBufferSource()
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2
  noise.buffer = buf
  const hiss = ctx.createBiquadFilter()
  hiss.type = 'bandpass'
  hiss.frequency.value = 1400
  hiss.Q.value = 0.8
  const hissGain = ctx.createGain()
  hissGain.gain.value = 0.5
  noise.connect(hiss).connect(hissGain).connect(out)
  noise.start(t)

  lfo.start(t)
  lfo.stop(t + length + 0.02)
}

function ready(): AudioContext | null {
  if (muted || micOpen) return null
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** A fighting-game impact: a low sine drop with a burst of noise. `big` for a finishing hit. */
export function playHit(big = false) {
  const c = ready()
  if (!c) return
  const t = c.currentTime + 0.005
  const length = big ? 0.45 : 0.22
  const out = c.createGain()
  out.gain.setValueAtTime(VOLUME * (big ? 1.6 : 1.1), t)
  out.gain.exponentialRampToValueAtTime(0.0001, t + length)
  out.connect(c.destination)

  const thump = c.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(big ? 150 : 190, t)
  thump.frequency.exponentialRampToValueAtTime(40, t + length)
  thump.connect(out)
  thump.start(t)
  thump.stop(t + length)

  const noise = c.createBufferSource()
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * length), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3
  noise.buffer = buf
  const crack = c.createBiquadFilter()
  crack.type = 'lowpass'
  crack.frequency.value = big ? 2400 : 3500
  noise.connect(crack).connect(out)
  noise.start(t)
}

/** Countdown blip: `go` is the higher, longer one. */
export function playBeep(go = false) {
  const c = ready()
  if (!c) return
  const t = c.currentTime + 0.005
  const length = go ? 0.4 : 0.14
  const out = c.createGain()
  out.gain.setValueAtTime(VOLUME * 0.6, t)
  out.gain.exponentialRampToValueAtTime(0.0001, t + length)
  out.connect(c.destination)
  const osc = c.createOscillator()
  osc.type = 'square'
  osc.frequency.value = go ? 880 : 440
  const soften = c.createBiquadFilter()
  soften.type = 'lowpass'
  soften.frequency.value = 2000
  osc.connect(soften).connect(out)
  osc.start(t)
  osc.stop(t + length)
}

/** A short click for each hop of the stage roulette. */
export function playTick() {
  const c = ready()
  if (!c) return
  const t = c.currentTime + 0.002
  const out = c.createGain()
  out.gain.setValueAtTime(VOLUME * 0.35, t)
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
  out.connect(c.destination)
  const osc = c.createOscillator()
  osc.type = 'square'
  osc.frequency.value = 1320
  osc.connect(out)
  osc.start(t)
  osc.stop(t + 0.035)
}

/** Three rising notes for a win, three falling for a loss. */
export function playJingle(win: boolean) {
  const c = ready()
  if (!c) return
  const notes = win ? [523, 659, 784, 1047] : [392, 349, 311, 262]
  notes.forEach((freq, i) => {
    const t = c.currentTime + 0.01 + i * 0.13
    const out = c.createGain()
    out.gain.setValueAtTime(VOLUME * 0.5, t)
    out.gain.exponentialRampToValueAtTime(0.0001, t + (i === notes.length - 1 ? 0.5 : 0.15))
    out.connect(c.destination)
    const osc = c.createOscillator()
    osc.type = 'square'
    osc.frequency.value = freq
    const soften = c.createBiquadFilter()
    soften.type = 'lowpass'
    soften.frequency.value = 2400
    osc.connect(soften).connect(out)
    osc.start(t)
    osc.stop(t + 0.6)
  })
}

/** The gruff click bark on every useful click on the page. Returns the uninstaller. */
export function installClickBarks(): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target.closest(CLICKABLE) : null
    if (!target || target.closest('[data-sfx="off"]')) return
    playClickBark()
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
