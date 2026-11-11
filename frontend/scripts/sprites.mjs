// Generates the pixel-art dogs and paw cursors in public/sprites/. Run: node scripts/sprites.mjs
//
// Each dog is built from shapes (ellipses, capsules, polygons) on a 64x64 grid, then shaded like
// modern monster-game sprites: a light from the top left, four-step colour ramps, darker far legs,
// lines where a front part overlaps a back one, and a dark outline tinted to the colour beside it.
// Cartoon proportions, four frames per dog (idle, barking, two walking strides). Tweak a breed in BREEDS below.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites')
const SIZE = 64

// ---------- PNG ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(w, h, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(w, 0)
  header.writeUInt32BE(h, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // no filter
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- colour ----------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const scale = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))))
const ramp = (...hs) => hs.map(hex)

const RAMPS = {
  shiba: ramp('#9a4a1c', '#d77a33', '#ee9f57', '#f8c48a'),
  cream: ramp('#c4a27c', '#ecd9b8', '#f8ecd6', '#fffaf0'),
  corgi: ramp('#a0521f', '#dc8a3f', '#f0ab64', '#f9cf98'),
  white: ramp('#a9a6b8', '#dcdbe6', '#f4f3f8', '#ffffff'),
  husky: ramp('#363b48', '#5f677a', '#8a92a4', '#b4bbc9'),
  fawn: ramp('#a6814f', '#d9b682', '#ecd2a3', '#f8e8c8'),
  black: ramp('#141317', '#2a2830', '#403d48', '#5d5966'),
  golden: ramp('#a06a1e', '#d9a142', '#efc46a', '#f9df9c'),
  red: ramp('#6e2f17', '#a64f26', '#c87140', '#e09a66'),
  tan: ramp('#8f5422', '#c98843', '#e3a865', '#f2c993'),
  sclera: ramp('#9c97a8', '#e9e6ef', '#ffffff', '#ffffff'),
  pupil: ramp('#100c0e', '#1a1214', '#1a1214', '#1a1214'),
  iris: ramp('#1c4f8f', '#3d8fd9', '#3d8fd9', '#3d8fd9'),
}

const FLAT = {
  eye: hex('#1a1214'),
  shine: hex('#ffffff'),
  nose: hex('#1a1214'),
  mouth: hex('#6e1f22'),
  tongue: hex('#ec7480'),
  blush: hex('#f4a3a3'),
  tag: hex('#f5c842'),
  tagShine: hex('#fff2b0'),
}

const COLLARS = {
  flare: ramp('#7c1d08', '#d53a15', '#ec6a43', '#f59a7a'),
  ball: ramp('#6f7d10', '#b9d12a', '#d8f23c', '#ecfc8e'),
  blue: ramp('#123d7a', '#2a6fd0', '#5c97ea', '#9cc2f5'),
  green: ramp('#1d5b2c', '#2f9449', '#58bd6c', '#95dca2'),
  purple: ramp('#43206b', '#7440b5', '#9a6bd6', '#c4a3ec'),
  pink: ramp('#7d1f4b', '#d2508a', '#e97fae', '#f6b5d1'),
}

// ---------- shapes ----------
// Each shape answers: does it cover (x, y), and if so, the surface normal there and local coords.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function ellipse(cx, cy, rx, ry, rot = 0) {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return (x, y) => {
    const dx = x - cx
    const dy = y - cy
    const u = (dx * c + dy * s) / rx
    const v = (-dx * s + dy * c) / ry
    const d = u * u + v * v
    if (d > 1) return null
    // Back to world axes for lighting.
    const nx = u * c - v * s
    const ny = u * s + v * c
    return { n: [nx, ny, Math.sqrt(1 - d)], u, v }
  }
}

function capsule(ax, ay, bx, by, ra, rb = ra) {
  const lx = bx - ax
  const ly = by - ay
  const len2 = lx * lx + ly * ly
  return (x, y) => {
    const t = clamp(((x - ax) * lx + (y - ay) * ly) / len2, 0, 1)
    const px = x - (ax + lx * t)
    const py = y - (ay + ly * t)
    const r = ra + (rb - ra) * t
    const d2 = (px * px + py * py) / (r * r)
    if (d2 > 1) return null
    return { n: [px / r, py / r, Math.sqrt(1 - d2)], u: t, v: px / r }
  }
}

function polygon(points) {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const hw = (Math.max(...xs) - Math.min(...xs)) / 2 || 1
  const hh = (Math.max(...ys) - Math.min(...ys)) / 2 || 1
  return (x, y) => {
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]
      const [xj, yj] = points[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    if (!inside) return null
    const u = (x - cx) / hw
    const v = (y - cy) / hh
    return { n: [u * 0.55, v * 0.55, 0.8], u, v }
  }
}

// A ring: the outer ellipse minus the inner one (curled tails).
function ring(cx, cy, rx, ry, inner, rot = 0) {
  const outer = ellipse(cx, cy, rx, ry, rot)
  const hole = ellipse(cx + inner.dx, cy + inner.dy, inner.rx, inner.ry, rot)
  return (x, y) => (hole(x, y) ? null : outer(x, y))
}

const union =
  (...shapes) =>
  (x, y) => {
    for (const s of shapes) {
      const hit = s(x, y)
      if (hit) return hit
    }
    return null
  }

// ---------- rendering ----------

const LIGHT = (() => {
  const l = [-0.55, -0.75, 0.85]
  const m = Math.hypot(...l)
  return l.map((v) => v / m)
})()

function rampIndex(n) {
  const m = Math.hypot(...n) || 1
  const shade = (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / m
  if (shade < 0.28) return 0
  if (shade < 0.72) return 1
  if (shade < 0.93) return 2
  return 3
}

/**
 * parts: drawn back to front. Each: { name, group, shape, mat, far?, flat? }
 * mat: a ramp key, or (hit, x, y) => ramp key for markings.
 * decals: pixel-exact details drawn last: [{ x, y, color }]
 */
/**
 * keep: when set, only parts with these names (and decals marked `over`) are drawn, with an outline
 * of their own. Used for the face-filter frames that sit on top of the player's camera face.
 */
function render({ parts, decals = [], ramps, size = SIZE, keep = null }) {
  const SIZE = size
  const owner = new Int16Array(SIZE * SIZE).fill(-1)
  const color = Array(SIZE * SIZE).fill(null)
  const matOf = Array(SIZE * SIZE).fill(null)

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i]
        const hit = part.shape(x + 0.5, y + 0.5)
        if (!hit) continue
        const key = typeof part.mat === 'function' ? part.mat(hit, x + 0.5, y + 0.5) : part.mat
        const r = ramps[key]
        let idx = part.flat ? 1 : rampIndex(hit.n)
        if (part.far) idx -= 1
        const c = idx < 0 ? scale(r[0], 0.82) : r[idx]
        owner[y * SIZE + x] = i
        color[y * SIZE + x] = c
        matOf[y * SIZE + x] = key
        break
      }
    }
  }

  // Clean up lone pixels: a shade that differs from all four same-part neighbours takes theirs.
  for (let y = 1; y < SIZE - 1; y++) {
    for (let x = 1; x < SIZE - 1; x++) {
      const i = y * SIZE + x
      if (owner[i] < 0) continue
      const ns = [i - 1, i + 1, i - SIZE, i + SIZE]
      if (!ns.every((j) => owner[j] === owner[i] && matOf[j] === matOf[i])) continue
      const same = ns.filter((j) => color[j] === color[i]).length
      if (same === 0) {
        const counts = new Map()
        for (const j of ns) counts.set(color[j], (counts.get(color[j]) ?? 0) + 1)
        color[i] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      }
    }
  }

  // Interior lines: a back-part pixel touching a front part of another group darkens.
  const lines = new Set()
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x
      const a = owner[i]
      if (a < 0) continue
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
        const b = owner[ny * SIZE + nx]
        if (b > a && parts[b].group !== parts[a].group) lines.add(i)
      }
    }
  }
  for (const i of lines) color[i] = scale(ramps[matOf[i]][0], 0.78)

  const keptDecal = new Uint8Array(SIZE * SIZE)
  for (const { x, y, color: c, over } of decals) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
    color[y * SIZE + x] = c
    if (owner[y * SIZE + x] < 0) owner[y * SIZE + x] = parts.length
    keptDecal[y * SIZE + x] = over ? 1 : 0
  }

  if (keep) {
    for (let i = 0; i < SIZE * SIZE; i++) {
      const o = owner[i]
      if (o < 0 || keptDecal[i]) continue
      if (o >= parts.length || !keep.has(parts[o].name)) {
        color[i] = null
        matOf[i] = null
      }
    }
  }

  // Outline: transparent pixels beside the sprite take the darkest shade of what they touch.
  const out = Buffer.alloc(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x
      let c = color[i]
      if (!c) {
        let darkest = null
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
          const j = ny * SIZE + nx
          if (!color[j]) continue
          // In face-filter frames, loose decals (whiskers) stay one pixel thin: no outline round them.
          if (keep && keptDecal[j] && (owner[j] >= parts.length || !keep.has(parts[owner[j]].name))) continue
          const key = matOf[j]
          const base = key ? ramps[key][0] : color[j]
          const candidate = scale(base, 0.5)
          if (!darkest || candidate[0] + candidate[1] + candidate[2] < darkest[0] + darkest[1] + darkest[2]) {
            darkest = candidate
          }
        }
        c = darkest
      }
      if (!c) continue
      out.set([...c, 255], i * 4)
    }
  }
  return out
}

// ---------- dogs ----------
// Cartoon proportions: a head as big as the body, two huge eyes in a three-quarter face, a tongue
// that won't stay in, stubby paws, and one running gag per breed (the corgi's satellite-dish ears,
// the dachshund that goes on forever). Two frames per dog: idle, and barking (head thrown back,
// jaw dropped, eyes squeezed shut). Coordinates: 64x64, facing right, paws on y = 61.

function dot(x, y, c) {
  return { x, y, color: c }
}

function tag(x, y) {
  return [dot(x, y, FLAT.tagShine), dot(x + 1, y, FLAT.tag), dot(x, y + 1, FLAT.tag), dot(x + 1, y + 1, FLAT.tag)]
}

// Screwed-shut eyes for the bark frame: ">" on the near eye, "<" on the far one, two pixels thick.
function squint(cx, cy, dir, size) {
  const out = []
  for (let i = -size; i <= size; i++) {
    const x = Math.round(cx + dir * (Math.abs(i) - size / 2))
    const y = Math.round(cy + i)
    out.push(dot(x, y, FLAT.eye), dot(x + dir, y, FLAT.eye))
  }
  return out
}

// Happy closed eyes: an upside-down U.
function happy(cx, cy, w) {
  const out = []
  for (let i = -w; i <= w; i++) {
    const y = Math.round(cy + (Math.abs(i) >= w ? 1 : Math.abs(i) >= w - 1 ? 0 : -1))
    out.push(dot(Math.round(cx + i), y, FLAT.eye))
  }
  return out
}

/**
 * The shared cartoon dog.
 * o: {
 *   coat, marks(part, hit, x, y) -> ramp key | null,
 *   body: shape, haunch?: [cx,cy,rx,ry], chest?: [cx,cy,rx,ry],
 *   legs: { xs: [front, back, ...], top, foot, r, paw: [rx, ry] },
 *   head: [cx,cy,rx,ry], muzzle: [cx,cy,rx,ry], nose?: [rx, ry],
 *   eyes: { near: [x,y,rx,ry], far: [x,y,rx,ry], look: [[dx,dy],[dx,dy]], pupil, iris?, style },
 *   tongue: { len, lean },
 *   ears(lift) -> parts with far flag, tail -> parts (drawn behind), collar: [x1,y1,x2,y2],
 *   extra?(lift, bark) -> { parts, decals }
 * }
 */
// Which walking pose toon() draws: 0 standing, +1 and -1 the two strides. Set by the frame loop below.
let walkStep = 0

function toon(o, bark) {
  const lift = bark ? -2 : 0
  const tilt = bark ? -0.22 : 0
  const [hx, hy, hrx, hry] = o.head
  const [mx, my, mrx, mry] = o.muzzle
  const coat = (name) => (hit, x, y) => o.marks?.(name, hit, x, y) ?? o.coat
  const L = o.legs
  // Walking: alternate legs swing forward and back; near and far pairs move opposite ways.
  const legsOf = (far) =>
    L.xs.map((x0, i) => {
      const x = x0 + (far ? 3 : 0)
      const swing = walkStep * 2.4 * (i % 2 ? -1 : 1) * (far ? -1 : 1)
      const fx = x + swing
      return {
        name: far ? 'farLeg' : 'leg',
        group: `leg${i}${far}`,
        far,
        shape: union(
          capsule(x, L.top, fx + (far ? 0.4 : -0.4), L.foot - 2, L.r, L.r * 0.9),
          ellipse(fx + 1, L.foot - 1.4, L.paw[0], L.paw[1]),
        ),
        mat: coat(far ? 'farLeg' : 'leg'),
      }
    })

  const head = ellipse(hx, hy + lift, hrx, hry, tilt)
  const muzzle = ellipse(mx + (bark ? 1 : 0), my + lift - (bark ? 1.5 : 0), mrx, mry, tilt)
  const chest = o.chest ? ellipse(...o.chest) : null

  const parts = [
    ...o.tail.map((p) => ({ name: 'tail', group: 'tail', mat: coat('tail'), ...p })),
    ...o.ears(lift).filter((e) => e.far).map((e) => ({ name: 'ear', group: 'farEar', mat: coat('ear'), ...e })),
    ...legsOf(true),
    { name: 'body', group: 'body', shape: o.body, mat: coat('body') },
    ...(o.haunch ? [{ name: 'haunch', group: 'haunch', shape: ellipse(...o.haunch), mat: coat('haunch') }] : []),
    ...(chest ? [{ name: 'chest', group: 'body', shape: chest, mat: coat('chest') }] : []),
    ...legsOf(false),
    {
      name: 'collar',
      group: 'collar',
      shape: (x, y) => {
        const hit = capsule(...o.collar, 2.1)(x, y)
        return hit && ((chest && chest(x, y)) || o.body(x, y) || head(x, y)) ? hit : null
      },
      mat: 'collar',
    },
    { name: 'head', group: 'head', shape: head, mat: coat('head') },
  ]

  // Mouth: an open grin with the tongue flopped out, or for the bark a dropped jaw and fangs.
  const mouthY = my + mry * 0.7 + lift
  if (bark) {
    parts.push(
      { name: 'mouth', group: 'mouth', flat: true, shape: ellipse(mx - 0.5, mouthY + 3.2, mrx * 0.95, 5.2, 0.25), mat: 'mouthRamp' },
      { name: 'tongue', group: 'mouth', shape: ellipse(mx - 1.5, mouthY + 6.2, mrx * 0.6, 2.2, 0.25), mat: 'tongue' },
      { name: 'chin', group: 'head', shape: ellipse(mx - 2.5, mouthY + 8.4, mrx * 0.7, 2.2, 0.35), mat: coat('chin') },
      { name: 'muzzle', group: 'head', shape: muzzle, mat: coat('muzzle') },
    )
  } else {
    const t = o.tongue
    parts.push(
      { name: 'muzzle', group: 'head', shape: muzzle, mat: coat('muzzle') },
      { name: 'chin', group: 'head', shape: ellipse(mx - 1.5, mouthY + 2, mrx * 0.62, 2.4), mat: coat('chin') },
      { name: 'mouth', group: 'mouth', flat: true, shape: ellipse(mx - 0.5, mouthY + 0.6, mrx * 0.62, 1.8), mat: 'mouthRamp' },
      ...(t.len
        ? [{ name: 'tongue', group: 'tongue', shape: capsule(mx - 0.5, mouthY + 0.5, mx - 0.5 + t.lean, mouthY + t.len, 1.9, 2.5), mat: 'tongue' }]
        : []),
    )
  }
  const [nrx, nry] = o.nose ?? [2.6, 2]
  const noseX = mx + mrx - nrx - 0.2 + (bark ? 1 : 0)
  const noseY = my - mry * 0.45 + lift - (bark ? 1.8 : 0)
  parts.push({ name: 'nose', group: 'nose', shape: ellipse(noseX, noseY, nrx, nry), mat: 'black' })

  const over = (d) => ({ ...d, over: true })
  const decals = [over(dot(Math.round(noseX - nrx * 0.4), Math.round(noseY - nry * 0.5), FLAT.shine))]
  // Whiskers: freckle dots on the muzzle, and three whiskers fanning back across the cheek, which
  // is where they land on the player's face in the face-filter frames.
  {
    const wx = Math.round(mx + (bark ? 1 : 0))
    const wy = Math.round(my + lift + (bark ? -1 : 1))
    const ink = scale(FLAT.eye, 1.8)
    decals.push(...[[wx - 1, wy], [wx + 1, wy - 1], [wx + 1, wy + 1]].map(([x, y]) => over(dot(x, y, ink))))
    const cx = Math.round(mx - mrx * 0.75)
    for (const slope of [-0.5, 0, 0.5]) {
      for (let i = 1; i <= 5; i++) decals.push(over(dot(cx - i, Math.round(wy + 1 + slope * i), ink)))
    }
  }
  const E = o.eyes
  const eyeList = [
    { at: E.far, look: E.look[1], dir: -1, key: 'eyeF' },
    { at: E.near, look: E.look[0], dir: 1, key: 'eyeN' },
  ]
  for (const { at, look, dir, key } of eyeList) {
    const [ex, ey0, erx, ery] = at
    const ey = ey0 + lift
    if (bark) {
      decals.push(...squint(ex, ey, dir, Math.round(ery * 0.6)))
      continue
    }
    if (E.style === 'happy') {
      decals.push(...happy(ex, ey, Math.round(erx)))
      continue
    }
    const sclera = ellipse(ex, ey, erx, ery)
    const px = ex + look[0]
    const py = ey + look[1]
    const pr = E.pupil
    parts.push({ name: 'sclera', group: key, shape: sclera, mat: 'sclera' })
    const inside = (s) => (x, y) => (sclera(x, y) ? s(x, y) : null)
    if (E.iris) {
      parts.push({ name: 'iris', group: key, flat: true, shape: inside(ellipse(px, py, erx * pr, ery * pr)), mat: E.iris })
      parts.push({ name: 'pupil', group: key, flat: true, shape: inside(ellipse(px, py, erx * pr * 0.5, ery * pr * 0.5)), mat: 'pupil' })
    } else {
      parts.push({ name: 'pupil', group: key, flat: true, shape: inside(ellipse(px, py, erx * pr, ery * pr)), mat: 'pupil' })
    }
    // Two catch-lights: the big one top-left, a small one lower right.
    const hlx = Math.round(px - erx * pr * 0.45)
    const hly = Math.round(py - ery * pr * 0.5)
    decals.push(dot(hlx, hly, FLAT.shine), dot(hlx + 1, hly, FLAT.shine), dot(hlx, hly + 1, FLAT.shine))
    if (erx * pr >= 2) decals.push(dot(Math.round(px + erx * pr * 0.45), Math.round(py + ery * pr * 0.45), FLAT.shine))
    if (E.style === 'smug') {
      // Heavy lids over the top half: unimpressed.
      parts.push({
        name: 'lid',
        group: `${key}lid`,
        shape: (x, y) => (y < ey - ery * 0.05 ? sclera(x, y) : null),
        mat: coat('head'),
      })
    }
  }
  // Blush under the near eye.
  const [bx, by] = [E.near[0] + 2, E.near[1] + E.near[3] + 2 + lift]
  decals.push(dot(bx, by, FLAT.blush), dot(bx + 1, by, FLAT.blush), dot(bx + 2, by, FLAT.blush))
  if (bark) {
    // Fangs at the corners of the open jaw.
    decals.push(over(dot(Math.round(mx - mrx * 0.4), Math.round(mouthY - 1.2), FLAT.shine)), over(dot(Math.round(mx + mrx * 0.55), Math.round(mouthY - 1.8), FLAT.shine)))
  }

  for (const e of o.ears(lift).filter((e) => !e.far)) parts.push({ name: 'ear', group: 'ear', mat: coat('ear'), ...e })
  if (o.extra) {
    const x = o.extra(lift, bark)
    parts.push(...(x.parts ?? []))
    decals.push(...(x.decals ?? []))
  }
  decals.push(...tag(Math.round(o.collar[2] - 0.5), Math.round(o.collar[3] + 1.5)))
  return { parts, decals }
}

const pointyEars = ({ near, far }) => (lift) => [
  { far: true, shape: polygon(far.map(([x, y]) => [x, y + lift])) },
  { far: false, shape: polygon(near.map(([x, y]) => [x, y + lift])) },
]

const floppyEar = ({ cx, cy, rx, ry, rot }) => (lift) => [{ far: false, shape: ellipse(cx, cy + lift, rx, ry, rot) }]

const stdLegs = (xs, top, foot = 61, r = 3, paw = [4, 2.4]) => ({ xs, top, foot, r, paw })

const BREEDS = [
  {
    // Smug. Heavy lids, raised brow dots, a tongue blep.
    id: 'shiba',
    name: 'Mochi',
    breed: 'Shiba Inu',
    collar: 'flare',
    build: (bark) =>
      toon(
        {
          coat: 'shiba',
          body: ellipse(23, 47, 12, 8),
          haunch: [15, 48, 6.5, 6.5],
          chest: [31, 47, 7, 7.5],
          legs: stdLegs([31, 17], 51),
          head: [40, 28, 15, 13],
          muzzle: [52, 34, 7.5, 5.5],
          eyes: { near: [39, 26, 4.2, 4.6], far: [50, 25, 3.4, 4], look: [[1.4, 0.6], [1.2, 0.6]], pupil: 0.55, style: 'smug' },
          tongue: { len: 4, lean: 0 },
          ears: pointyEars({
            far: [
              [40, 18],
              [46, 3],
              [51, 17],
            ],
            near: [
              [26, 23],
              [28, 5],
              [37, 16],
            ],
          }),
          tail: [{ shape: ring(9, 38, 6.5, 6, { dx: 0.5, dy: 0.5, rx: 2.6, ry: 2.4 }) }],
          marks: (part, hit) => {
            if (part === 'muzzle' || part === 'chin') return 'cream'
            if (part === 'head' && hit.v > 0.3 && hit.u > -0.1) return 'cream'
            if (part === 'chest' && hit.u > -0.2) return 'cream'
            if (part === 'body' && hit.v > 0.45) return 'cream'
            if ((part === 'leg' || part === 'farLeg') && hit.u > 0.6) return 'cream'
            if (part === 'tail' && hit.v > 0.2) return 'cream'
            if (part === 'ear' && Math.abs(hit.u) < 0.3 && hit.v > -0.2) return 'cream'
            return null
          },
          collar: [34, 39, 31, 47],
          extra: (lift, bark) =>
            bark
              ? {}
              : { decals: [dot(37, 19 + lift, FLAT.eye), dot(38, 19 + lift, FLAT.eye), dot(49, 19 + lift, FLAT.eye), dot(50, 19 + lift, FLAT.eye)] },
        },
        bark,
      ),
  },
  {
    // Satellite-dish ears, no legs to speak of, a loaf of a body.
    id: 'corgi',
    name: 'Biscuit',
    breed: 'Corgi',
    collar: 'blue',
    build: (bark) =>
      toon(
        {
          coat: 'corgi',
          body: ellipse(22, 51, 15, 7.5),
          haunch: [11, 50, 8.5, 8],
          chest: [33, 50, 7, 7.5],
          legs: stdLegs([33, 13], 56, 61, 2.8, [4.2, 2.3]),
          head: [43, 34, 14, 12],
          muzzle: [55, 40, 7, 5],
          eyes: { near: [42, 32, 4.4, 4.8], far: [53, 31, 3.5, 4.2], look: [[0.8, 0.4], [0.8, 0.4]], pupil: 0.62 },
          tongue: { len: 6, lean: -1 },
          ears: pointyEars({
            far: [
              [43, 25],
              [52, 0],
              [57, 24],
            ],
            near: [
              [28, 29],
              [27, 1],
              [41, 22],
            ],
          }),
          tail: [{ shape: ellipse(4, 48, 3.5, 3.5) }],
          marks: (part, hit) => {
            if (part === 'muzzle' || part === 'chin') return 'white'
            if (part === 'head' && hit.u > 0.15 && hit.v > 0) return 'white'
            if (part === 'head' && Math.abs(hit.u - 0.25) < 0.12 && hit.v < 0.1) return 'white'
            if (part === 'chest' && hit.u > -0.3) return 'white'
            if (part === 'body' && hit.v > 0.5) return 'white'
            if ((part === 'leg' || part === 'farLeg') && hit.u > 0.3) return 'white'
            if (part === 'tail') return 'white'
            if (part === 'ear' && Math.abs(hit.u) < 0.28 && hit.v > -0.2) return 'cream'
            return null
          },
          collar: [36, 44, 33, 51],
        },
        bark,
      ),
  },
  {
    // Wild eyes pointing two ways, tongue swinging out the side, a ruff of chest fluff.
    id: 'husky',
    name: 'Blizzard',
    breed: 'Husky',
    collar: 'flare',
    build: (bark) =>
      toon(
        {
          coat: 'husky',
          body: ellipse(23, 46, 13, 9),
          haunch: [14, 47, 7, 7.5],
          chest: [31, 46, 8.5, 9],
          legs: stdLegs([31, 16], 51),
          head: [40, 27, 15.5, 13.5],
          muzzle: [53, 33, 8, 5.5],
          eyes: {
            near: [39, 25, 4.8, 5.2],
            far: [51, 24, 3.8, 4.6],
            look: [[-1.6, -1.2], [1.6, 1.4]],
            pupil: 0.42,
            iris: 'iris',
          },
          tongue: { len: 7, lean: 3 },
          ears: pointyEars({
            far: [
              [40, 17],
              [46, 2],
              [51, 16],
            ],
            near: [
              [26, 22],
              [27, 4],
              [36, 15],
            ],
          }),
          tail: [{ shape: ring(8, 34, 7, 7, { dx: 1, dy: 1, rx: 3, ry: 3 }, -0.3) }],
          marks: (part, hit) => {
            if (part === 'muzzle' || part === 'chin') return 'white'
            if (part === 'head' && (hit.v > 0.15 || (hit.u > 0.1 && hit.v > -0.35))) return 'white'
            if (part === 'chest' && hit.u > -0.5) return 'white'
            if (part === 'body' && hit.v > 0.35) return 'white'
            if (part === 'haunch' && hit.v > 0.3) return 'white'
            if (part === 'leg' || part === 'farLeg') return hit.u > 0.2 ? 'white' : null
            if (part === 'tail' && hit.v > 0.3) return 'white'
            if (part === 'ear' && Math.abs(hit.u) < 0.3 && hit.v > -0.2) return 'white'
            return null
          },
          collar: [34, 39, 31, 47],
          extra: () => ({
            // Fluff tufts on the chest.
            parts: [
              { name: 'chest', group: 'fluff', shape: union(ellipse(36, 44, 3, 3.5), ellipse(34, 49, 3, 3)), mat: 'white' },
            ],
          }),
        },
        bark,
      ),
  },
  {
    // A ball with a face: bulging googly eyes looking anywhere but at you.
    id: 'pug',
    name: 'Nugget',
    breed: 'Pug',
    collar: 'green',
    build: (bark) =>
      toon(
        {
          coat: 'fawn',
          body: ellipse(23, 47, 13, 10.5),
          legs: stdLegs([30, 16], 55, 61, 2.6, [3.6, 2.2]),
          head: [39, 31, 16, 14.5],
          muzzle: [51, 37, 6, 5.5],
          nose: [3, 2.2],
          eyes: {
            near: [37, 28, 5.6, 6],
            far: [50, 27, 4.6, 5.4],
            look: [[-1.8, 1.6], [2, -1.6]],
            pupil: 0.5,
          },
          tongue: { len: 5, lean: 1 },
          ears: (lift) => [
            { far: false, shape: polygon([[26, 22 + lift], [31, 19 + lift], [33, 26 + lift], [28, 28 + lift]]) },
            { far: true, shape: polygon([[47, 17 + lift], [52, 16 + lift], [52, 21 + lift]]) },
          ],
          tail: [{ shape: ring(10, 40, 4.5, 4, { dx: 0.5, dy: 0.5, rx: 1.8, ry: 1.6 }) }],
          marks: (part, hit) => {
            if (part === 'muzzle' || part === 'chin' || part === 'ear') return 'black'
            if (part === 'head' && hit.u > 0.45 && hit.v > 0) return 'black'
            return null
          },
          collar: [31, 43, 29, 52],
          extra: (lift, bark) =>
            bark
              ? {}
              : {
                  // Forehead wrinkles.
                  decals: [36, 37, 38, 39, 40, 41].flatMap((x, i) => [dot(x + 3, 19 + lift + (i % 3 === 1 ? 1 : 0), scale(hex('#a6814f'), 0.8))]),
                },
        },
        bark,
      ),
  },
  {
    // All legs. Stilts, a small body up top, ears like flags.
    id: 'dalmatian',
    name: 'Domino',
    breed: 'Dalmatian',
    collar: 'flare',
    build: (bark) => {
      const spots = seededSpots(11, 30)
      return toon(
        {
          coat: 'white',
          body: ellipse(23, 35, 12, 6.5),
          haunch: [15, 36, 6, 6],
          chest: [31, 35, 6.5, 6.5],
          legs: { xs: [32, 16], top: 38, foot: 61, r: 2.2, paw: [3.6, 2.2] },
          head: [41, 19, 13.5, 11.5],
          muzzle: [53, 25, 8, 4.8],
          eyes: { near: [40, 17, 4.2, 4.8], far: [51, 16, 3.4, 4.2], look: [[1.2, -1.4], [-0.6, -1.4]], pupil: 0.55 },
          tongue: { len: 8, lean: -2 },
          ears: floppyEar({ cx: 31, cy: 21, rx: 4, ry: 8, rot: 0.35 }),
          tail: [{ shape: capsule(11, 33, 3, 24, 1.8, 1.1) }],
          marks: (part, hit, x, y) => {
            if (part === 'ear') return 'black'
            if (part === 'muzzle' || part === 'chin' || part === 'sclera') return null
            return spots(x, y) ? 'black' : null
          },
          collar: [34, 28, 31, 35],
        },
        bark,
      )
    },
  },
  {
    // Pure joy: eyes shut in a grin, a tongue that reaches the floor.
    id: 'golden',
    name: 'Sunny',
    breed: 'Golden Retriever',
    collar: 'blue',
    build: (bark) =>
      toon(
        {
          coat: 'golden',
          body: ellipse(23, 46, 13, 9),
          haunch: [14, 47, 7.5, 7.5],
          chest: [31, 46, 8, 9],
          legs: stdLegs([31, 16], 51),
          head: [40, 28, 15, 13],
          muzzle: [53, 34, 8, 5.5],
          eyes: { near: [39, 26, 4.2, 4.6], far: [50, 25, 3.4, 4], look: [[0, 0], [0, 0]], pupil: 0.6, style: 'happy' },
          tongue: { len: 13, lean: -1 },
          ears: floppyEar({ cx: 30, cy: 30, rx: 4.5, ry: 8.5, rot: 0.2 }),
          tail: [{ shape: union(capsule(12, 40, 4, 30, 2.6, 1.8), ellipse(4, 28, 3.4, 4.6, -0.5)) }],
          marks: (part, hit) => {
            if (part === 'chest' && hit.u > 0.2 && hit.v > -0.2) return 'cream'
            if (part === 'tail' && hit.v < -0.3) return 'cream'
            return null
          },
          collar: [34, 39, 31, 47],
        },
        bark,
      ),
  },
  {
    // The long boy: a body that runs the width of the frame on four nubs.
    id: 'dachshund',
    name: 'Frank',
    breed: 'Dachshund',
    collar: 'ball',
    build: (bark) =>
      toon(
        {
          coat: 'red',
          body: capsule(6, 50, 41, 50, 6.5, 7),
          haunch: [7, 50, 6, 6.5],
          legs: { xs: [40, 34, 13, 7], top: 54, foot: 61, r: 2.2, paw: [3.2, 2] },
          head: [48, 38, 11.5, 10.5],
          muzzle: [58, 43, 6, 4],
          eyes: { near: [47, 36, 3.8, 4.4], far: [56, 35, 3, 3.6], look: [[1.4, 0], [1.2, 0]], pupil: 0.6 },
          tongue: { len: 5, lean: 0 },
          ears: floppyEar({ cx: 40, cy: 43, rx: 3.8, ry: 9, rot: 0.15 }),
          tail: [{ shape: capsule(3, 47, 1, 38, 1.6, 0.9) }],
          marks: (part, hit) => {
            if (part === 'body' && hit.v > 0.5) return 'tan'
            return null
          },
          collar: [41, 44, 39, 51],
        },
        bark,
      ),
  },
  {
    // Sad puppy eyes and ears so long it trips on them.
    id: 'beagle',
    name: 'Scout',
    breed: 'Beagle',
    collar: 'purple',
    build: (bark) =>
      toon(
        {
          coat: 'tan',
          body: ellipse(23, 47, 12, 8.5),
          haunch: [15, 48, 6.5, 7],
          chest: [31, 47, 7, 8],
          legs: stdLegs([31, 16], 51),
          head: [40, 28, 15, 13],
          muzzle: [53, 34, 8, 5.5],
          eyes: { near: [40, 27, 4.8, 5.4], far: [51, 26, 3.8, 4.6], look: [[0.6, -1.4], [0.4, -1.4]], pupil: 0.7 },
          tongue: { len: 3, lean: 0 },
          ears: floppyEar({ cx: 29, cy: 39, rx: 5, ry: 15, rot: 0.08 }),
          tail: [{ shape: capsule(11, 42, 6, 28, 2, 1.6) }],
          marks: (part, hit) => {
            if (part === 'muzzle' || part === 'chin') return 'white'
            if (part === 'head' && Math.abs(hit.u - 0.15) < 0.13 && hit.v < 0.3) return 'white'
            if (part === 'chest' && hit.u > -0.3) return 'white'
            if (part === 'body') return hit.v > 0.4 ? 'white' : hit.v < 0.1 && hit.u < 0.5 ? 'black' : null
            if (part === 'haunch' && hit.v < 0 && hit.u > -0.3) return 'black'
            if (part === 'leg' || part === 'farLeg') return hit.u > 0.3 ? 'white' : null
            if (part === 'tail') return hit.u > 0.7 ? 'white' : null
            if (part === 'ear') return hit.v > 0.75 ? 'black' : null
            return null
          },
          collar: [34, 39, 31, 47],
          extra: (lift, bark) =>
            bark
              ? {}
              : {
                  // Worried brows, angled up toward the middle.
                  decals: [dot(36, 20 + lift, FLAT.eye), dot(37, 19 + lift, FLAT.eye), dot(38, 19 + lift, FLAT.eye), dot(49, 19 + lift, FLAT.eye), dot(50, 19 + lift, FLAT.eye)],
                },
        },
        bark,
      ),
  },
]

function seededSpots(seed, count) {
  let s = seed
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  const spots = Array.from({ length: count }, () => [6 + rand() * 54, 6 + rand() * 54, 1.5 + rand() * 1.5])
  return (x, y) => spots.some(([sx, sy, r]) => (x - sx) ** 2 + (y - sy) ** 2 <= r * r)
}

// ---------- paw cursors ----------
// Drawn on a 16x16 grid with the same shading and outline, then doubled to a crisp 32px cursor.
// A paw print: four toe beans over a pad. The hotspot is the top-left toe (see index.css).

const PAW_SIZE = 16

function pawParts(bean) {
  const toes = [
    [3.1, 7.2, 1.6, 2],
    [6.4, 3.4, 1.7, 2.1],
    [10.6, 3.4, 1.7, 2.1],
    [13.9, 7.2, 1.6, 2],
  ]
  return [
    { name: 'pad', group: 'pad', shape: ellipse(8.5, 11.6, 4, 3.1), mat: bean },
    ...toes.map(([x, y, rx, ry], i) => ({ name: 'toe', group: `toe${i}`, shape: ellipse(x, y, rx, ry, (i - 1.5) * 0.3), mat: bean })),
  ]
}

function upscale(buf, size, k) {
  const w = size * k
  const out = Buffer.alloc(w * w * 4)
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) buf.copy(out, (y * w + x) * 4, (((y / k) | 0) * size + ((x / k) | 0)) * 4, (((y / k) | 0) * size + ((x / k) | 0)) * 4 + 4)
  return { w, buf: out }
}

// ---------- bones ----------
// A tile of bones at odd angles for the home page background. Every bone stays clear of the
// tile's edges, so it repeats without seams.

const BONE_TILE = 120

function bone(cx, cy, length, angle, r = 2.4) {
  const dx = Math.cos(angle) * (length / 2)
  const dy = Math.sin(angle) * (length / 2)
  // Knobs sit either side of each end, across the shaft.
  const px = -Math.sin(angle) * r * 0.9
  const py = Math.cos(angle) * r * 0.9
  const knob = r * 1.15
  return union(
    capsule(cx - dx, cy - dy, cx + dx, cy + dy, r * 0.8),
    ellipse(cx - dx + px, cy - dy + py, knob, knob),
    ellipse(cx - dx - px, cy - dy - py, knob, knob),
    ellipse(cx + dx + px, cy + dy + py, knob, knob),
    ellipse(cx + dx - px, cy + dy - py, knob, knob),
  )
}

const BONES = [
  [22, 20, 16, 0.5],
  [78, 16, 12, -0.3],
  [50, 52, 18, 1.25],
  [96, 64, 14, 0.15],
  [18, 78, 13, -0.9],
  [66, 98, 16, 2.6],
  [104, 104, 10, 1.9],
]

// ---------- main ----------

// What of the dog goes over the player's face: ears, nose, mouth, tongue and chin (plus whiskers).
const FACE_PARTS = new Set(['ear', 'nose', 'mouth', 'tongue', 'chin'])

mkdirSync(OUT, { recursive: true })
for (const breed of BREEDS) {
  const ramps = { ...RAMPS, collar: COLLARS[breed.collar], mouthRamp: [scale(FLAT.mouth, 0.6), FLAT.mouth, FLAT.mouth, FLAT.mouth], tongue: ramp('#a8404c', '#e8606f', '#f38a96', '#fbb8c0') }
  for (const [suffix, bark, step, keep] of [
    ['', false, 0, null],
    ['-bark', true, 0, null],
    ['-walk1', false, 1, null],
    ['-walk2', false, -1, null],
    // Face-filter layers: drawn over the player's camera face on the dog's head.
    ['-face', false, 0, FACE_PARTS],
    ['-face-bark', true, 0, FACE_PARTS],
  ]) {
    walkStep = step
    const png = encodePng(SIZE, SIZE, render({ ...breed.build(bark), ramps, keep }))
    writeFileSync(join(OUT, `${breed.id}${suffix}.png`), png)
  }
  walkStep = 0
}

{
  const parts = BONES.map(([x, y, len, a], i) => ({ name: 'bone', group: `bone${i}`, shape: bone(x, y, len, a), mat: 'bone' }))
  const ramps = { bone: ramp('#bfa77d', '#eadcbf', '#f6edda', '#fffaf0') }
  // Mostly transparent: it's a background texture, not something to look at.
  const tile = render({ parts, ramps, size: BONE_TILE })
  for (let i = 3; i < tile.length; i += 4) tile[i] = Math.round(tile[i] * 0.32)
  writeFileSync(join(OUT, 'bones.png'), encodePng(BONE_TILE, BONE_TILE, tile))
}

// Ramps whose darkest step is ink, so the outline reads black at cursor size.
const PAW_RAMPS = {
  pink: ramp('#3a1d1d', '#f08c98', '#f6aab3', '#fde0e4'),
  ball: ramp('#2a2a08', '#c5df2c', '#d8f23c', '#f1fca6'),
}
for (const [name, bean] of [
  ['paw', 'pink'],
  ['paw-pointer', 'ball'],
]) {
  const sprite = render({ parts: pawParts(bean), ramps: PAW_RAMPS, size: PAW_SIZE })
  const { w, buf } = upscale(sprite, PAW_SIZE, 2)
  writeFileSync(join(OUT, `${name}.png`), encodePng(w, w, buf))
}

console.log(`Wrote ${BREEDS.length * 6 + 3} sprites to ${OUT}`)
console.log(JSON.stringify(BREEDS.map(({ id, name, breed }) => ({ id, name, breed }))))
