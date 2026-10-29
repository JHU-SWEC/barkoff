// BS.1770 loudness, ported from pyloudnorm (the scorer's library) so this page and
// score.py agree on the same clip. Mono only: channel gain is 1.

const LUFS_OFFSET = -0.691
const BLOCK_S = 0.4
const BLOCK_OVERLAP = 0.75
const ABSOLUTE_GATE = -70
const RELATIVE_GATE = -10

interface Biquad {
  b: [number, number, number]
  a: [number, number]
}

// RBJ cookbook biquads with pyloudnorm's K-weighting parameters, normalised by a0.
function highShelf(rate: number, gainDb: number, q: number, fc: number): Biquad {
  const A = 10 ** (gainDb / 40)
  const w0 = (2 * Math.PI * fc) / rate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const root = 2 * Math.sqrt(A) * alpha
  const a0 = A + 1 - (A - 1) * cos + root
  return {
    b: [(A * (A + 1 + (A - 1) * cos + root)) / a0, (-2 * A * (A - 1 + (A + 1) * cos)) / a0, (A * (A + 1 + (A - 1) * cos - root)) / a0],
    a: [(2 * (A - 1 - (A + 1) * cos)) / a0, (A + 1 - (A - 1) * cos - root) / a0],
  }
}

function highPass(rate: number, q: number, fc: number): Biquad {
  const w0 = (2 * Math.PI * fc) / rate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const a0 = 1 + alpha
  return {
    b: [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0],
    a: [(-2 * cos) / a0, (1 - alpha) / a0],
  }
}

function applyBiquad(input: ArrayLike<number>, { b, a }: Biquad): Float64Array {
  const out = new Float64Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x = input[i]
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

// The ear's frequency response: +4 dB above ~1.5 kHz, rolled off below ~38 Hz.
export function kWeight(samples: ArrayLike<number>, rate: number): Float64Array {
  return applyBiquad(applyBiquad(samples, highShelf(rate, 4, Math.SQRT1_2, 1500)), highPass(rate, 0.5, 38))
}

// Mean square of a K-weighted signal to LUFS.
export function powerToLufs(power: number): number {
  return power > 0 ? LUFS_OFFSET + 10 * Math.log10(power) : -Infinity
}

// Gated loudness of a K-weighted signal: 400 ms blocks every 100 ms, blocks below
// -70 LUFS and then below (mean - 10 LU) dropped, so pauses don't pull the level down.
// Same block bounds and gates as pyloudnorm's Meter.integrated_loudness.
export function integratedLoudness(weighted: Float64Array, rate: number): number {
  const step = 1 - BLOCK_OVERLAP
  const blocks = Math.round((weighted.length / rate - BLOCK_S) / (BLOCK_S * step)) + 1
  if (blocks < 1) return -Infinity

  const z = new Float64Array(blocks)
  for (let j = 0; j < blocks; j++) {
    const lower = Math.trunc(BLOCK_S * (j * step) * rate)
    const upper = Math.min(weighted.length, Math.trunc(BLOCK_S * (j * step + 1) * rate))
    let sum = 0
    for (let i = lower; i < upper; i++) sum += weighted[i] * weighted[i]
    z[j] = sum / (BLOCK_S * rate)
  }
  const loudness = Array.from(z, powerToLufs)

  const gatedMean = (keep: (l: number) => boolean) => {
    let sum = 0
    let n = 0
    loudness.forEach((l, j) => {
      if (keep(l)) {
        sum += z[j]
        n++
      }
    })
    return n ? sum / n : 0
  }

  const relative = powerToLufs(gatedMean((l) => l >= ABSOLUTE_GATE)) + RELATIVE_GATE
  return powerToLufs(gatedMean((l) => l > relative && l > ABSOLUTE_GATE))
}
