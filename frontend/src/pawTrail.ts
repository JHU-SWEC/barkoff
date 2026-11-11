// Paw prints left behind the mouse: one every STEP_PX, alternating left and right feet, turned to
// face the way the pointer is moving, fading out. Plain DOM, not React, since it runs on every
// mouse move. Off for touch and pen, and for people who prefer reduced motion.

const STEP_PX = 36
const SPREAD_PX = 7
const LIFE_MS = 900
const MAX_PRINTS = 24

export function installPawTrail(): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}

  const layer = document.createElement('div')
  layer.className = 'paw-trail'
  layer.setAttribute('aria-hidden', 'true')
  document.body.appendChild(layer)

  let last: { x: number; y: number } | null = null
  let left = true

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    if (!last) {
      last = { x: e.clientX, y: e.clientY }
      return
    }
    const dx = e.clientX - last.x
    const dy = e.clientY - last.y
    const dist = Math.hypot(dx, dy)
    if (dist < STEP_PX) return
    // Step from the last print toward the pointer; the prints trail just behind it.
    const ux = dx / dist
    const uy = dy / dist
    const side = left ? -1 : 1
    left = !left
    const x = last.x + ux * STEP_PX - uy * SPREAD_PX * side
    const y = last.y + uy * STEP_PX + ux * SPREAD_PX * side
    last = { x: last.x + ux * STEP_PX, y: last.y + uy * STEP_PX }
    // Jumps (leaving the window, a fast flick) restart the trail at the pointer.
    if (dist > STEP_PX * 4) last = { x: e.clientX, y: e.clientY }

    const print = document.createElement('span')
    print.className = 'paw-print'
    print.style.transform = `translate(${x - 8}px, ${y - 8}px) rotate(${Math.atan2(uy, ux) + Math.PI / 2}rad)`
    layer.appendChild(print)
    while (layer.childElementCount > MAX_PRINTS) layer.firstElementChild?.remove()
    setTimeout(() => print.remove(), LIFE_MS)
  }

  window.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    window.removeEventListener('pointermove', onMove)
    layer.remove()
  }
}
