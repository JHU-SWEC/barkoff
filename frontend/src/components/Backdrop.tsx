import type { MapId } from '../maps'
import './Backdrop.css'

// Duel stages drawn in CSS (Backdrop.css), sized off the container so the same art works full
// screen and as a thumbnail in the stage roulette. 'arena' is the menu's sunset.

const BUILDINGS: { w: number; h: number; c: string }[] = [
  { w: 9, h: 62, c: '#6b5b7b' },
  { w: 7, h: 44, c: '#8a6f63' },
  { w: 11, h: 78, c: '#5b6b86' },
  { w: 8, h: 52, c: '#7b8a6a' },
  { w: 10, h: 90, c: '#6a5870' },
  { w: 6, h: 40, c: '#9a7a5c' },
  { w: 12, h: 70, c: '#56708a' },
  { w: 8, h: 58, c: '#80667a' },
  { w: 9, h: 84, c: '#5d6478' },
  { w: 10, h: 48, c: '#86745e' },
  { w: 10, h: 66, c: '#617a6e' },
]

/** A row of buildings with lit windows; `repeat` copies it so it can scroll seamlessly. */
export function Skyline({ repeat = 1, className }: { repeat?: number; className?: string }) {
  return (
    <div className={['skyline', className].filter(Boolean).join(' ')}>
      {Array.from({ length: repeat }, (_, r) =>
        BUILDINGS.map((b, i) => (
          <span
            key={`${r}-${i}`}
            className="building"
            style={{ width: `${b.w / repeat}%`, height: `${b.h}%`, backgroundColor: b.c }}
          />
        )),
      )}
    </div>
  )
}

function Clouds({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`cloud cloud-${i + 1}`} />
      ))}
    </>
  )
}

function Props({ map }: { map: MapId | 'arena' }) {
  switch (map) {
    case 'arena':
      return (
        <>
          <div className="sun" />
          <div className="crowd" />
        </>
      )
    case 'sidewalk':
      return (
        <>
          <Clouds count={2} />
          <div className="wire" />
          <div className="bird bird-1" />
          <div className="bird bird-2" />
          <div className="bird bird-3" />
          <Skyline className="skyline-far" />
          <Skyline />
          <div className="shops">
            <div className="shop shop-red">
              <span className="awning" />
              <span className="shop-window" />
              <span className="shop-door" />
            </div>
            <div className="shop shop-green">
              <span className="awning" />
              <span className="shop-window" />
              <span className="shop-door" />
            </div>
            <div className="shop shop-blue">
              <span className="awning" />
              <span className="shop-window" />
              <span className="shop-door" />
            </div>
          </div>
          <div className="curb" />
          <div className="lamp lamp-1" />
          <div className="lamp lamp-2" />
          <div className="street-tree" />
          <div className="mailbox" />
          <div className="trash" />
          <div className="hydrant" />
        </>
      )
    case 'park':
      return (
        <>
          <div className="park-sun" />
          <Clouds />
          <div className="hills" />
          <div className="trees" />
          <div className="park-tree park-tree-1" />
          <div className="park-tree park-tree-2" />
          <div className="fence" />
          <div className="park-sign">Dog Park</div>
          <div className="bush bush-1" />
          <div className="bush bush-2" />
        </>
      )
    case 'vet':
      return (
        <>
          <div className="ceiling" />
          <div className="wainscot" />
          <div className="vet-window" />
          <div className="vet-sign">
            <span className="vet-cross" />
            <span className="vet-word">VET</span>
          </div>
          <div className="poster">
            <span className="poster-dog" />
          </div>
          <div className="paw-frame" />
          <div className="clock" />
          <div className="vet-door" />
          <div className="desk">
            <span className="monitor" />
            <span className="treat-jar" />
          </div>
          <div className="plant" />
          <div className="bench" />
        </>
      )
    case 'petco':
      return (
        <>
          <div className="ceiling ceiling-store" />
          <div className="store-sign">PET SUPPLIES</div>
          <div className="hang-sign hang-sign-1">Dogs</div>
          <div className="hang-sign hang-sign-2">Cats</div>
          <div className="shelves">
            <span className="shelf" />
            <span className="shelf" />
            <span className="shelf" />
          </div>
          <div className="aquarium">
            <span className="fish fish-1" />
            <span className="fish fish-2" />
            <span className="fish fish-3" />
            <span className="bubbles" />
          </div>
          <div className="aisle-sign">Aisle 4 · Treats</div>
        </>
      )
    case 'playground':
      return (
        <>
          <div className="play-sun" />
          <Clouds count={2} />
          <div className="kite" />
          <div className="houses">
            {['#d98e5e', '#9cb6c9', '#e6c98a', '#c58f9e', '#a9c48a'].map((c) => (
              <span key={c} className="house" style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="tree-solo tree-solo-1" />
          <div className="tree-solo tree-solo-2" />
          <div className="swing-frame">
            <span className="swing swing-1" />
            <span className="swing swing-2" />
          </div>
          <div className="monkey-bars" />
          <div className="slide" />
        </>
      )
  }
}

// Things standing on the floor itself, drawn after it so the tilted floor doesn't cover them.
function FloorProps({ map }: { map: MapId | 'arena' }) {
  switch (map) {
    case 'park':
      return (
        <>
          <div className="tire-jump" />
          <div className="hurdle" />
          <div className="water-bowl" />
          <div className="ball-toy" />
        </>
      )
    case 'vet':
      return <div className="scale" />
    case 'petco':
      return (
        <>
          <div className="pet-bed" />
          <div className="cart" />
        </>
      )
    case 'playground':
      return (
        <>
          <div className="seesaw" />
          <div className="sandbox" />
        </>
      )
    default:
      return null
  }
}

export function Backdrop({ map, className }: { map: MapId | 'arena'; className?: string }) {
  return (
    <div className={['backdrop', `map-${map}`, className].filter(Boolean).join(' ')} aria-hidden="true">
      <div className="bd-sky" />
      <Props map={map} />
      <div className="bd-floor" />
      <FloorProps map={map} />
    </div>
  )
}
