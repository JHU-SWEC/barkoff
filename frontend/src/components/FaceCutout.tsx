import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { faceUrl, type Dog } from '../dogs'
import type { FaceBox } from '../useHeadGuide'

// The player's face on their dog, like a camera dog filter: the face is cut out of the camera feed
// with a soft, faded edge and set in the dog's head circle, then the dog's own ears, nose, mouth,
// tongue and whiskers (the -face sprite frame) go on top of it. Mirrored, like a selfie. Only the
// sprite shows while no face is in view.

const PIXELS = 160
// How much around the detected face box to keep: just past the hairline and chin, so the face
// itself fills the circle instead of the room behind it.
const CROP = 1.22
// Shift the crop up by this share of the face box: the detector's box starts at the brows, and
// the forehead matters more than the neck.
const LIFT = 0.1
// The face is fully opaque out to this share of the radius, then fades to nothing at the edge.
const SOLID = 0.68
// The fade is an upright oval, like a face, so less of the room shows at the sides.
const OVAL = 0.82

export function FaceCutout({
  dog,
  barking = false,
  video,
  faceRef,
}: {
  dog: Dog
  barking?: boolean
  video: HTMLVideoElement | null
  faceRef: RefObject<FaceBox | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !video) return
    const fade = ctx.createRadialGradient(0, 0, (PIXELS / 2) * SOLID, 0, 0, PIXELS / 2)
    fade.addColorStop(0, 'rgba(0,0,0,1)')
    fade.addColorStop(1, 'rgba(0,0,0,0)')
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, PIXELS, PIXELS)
      const f = faceRef.current
      if (!f || video.readyState < 2) return
      const crop = f.size * CROP
      ctx.save()
      ctx.translate(PIXELS, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, f.cx - crop / 2, f.cy - f.size * LIFT - crop / 2, crop, crop, 0, 0, PIXELS, PIXELS)
      ctx.restore()
      // Keep only what's under the soft-edged oval.
      ctx.save()
      ctx.globalCompositeOperation = 'destination-in'
      ctx.translate(PIXELS / 2, PIXELS / 2)
      ctx.scale(OVAL, 1)
      ctx.fillStyle = fade
      ctx.fillRect(-PIXELS / OVAL, -PIXELS, (PIXELS * 2) / OVAL, PIXELS * 2)
      ctx.restore()
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [video, faceRef])

  const [hx, hy, hr] = dog.head
  const place = { '--hx': hx / 64, '--hy': hy / 64, '--hr': hr / 64 } as CSSProperties
  return (
    <span className="dog-face" style={place} aria-hidden="true">
      <canvas ref={canvasRef} className="dog-face-video" width={PIXELS} height={PIXELS} />
      <img className="dog-face-over" src={faceUrl(dog, barking)} alt="" draggable={false} />
    </span>
  )
}
