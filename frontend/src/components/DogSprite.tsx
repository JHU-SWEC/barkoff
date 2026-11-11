import { spriteUrl, walkUrls, type Dog } from '../dogs'

// A pixel dog, drawn at a whole multiple of its 64px grid so the pixels stay square.
export function DogSprite({
  dog,
  barking = false,
  flip = false,
  scale = 2,
  className,
  label,
}: {
  dog: Dog
  barking?: boolean
  flip?: boolean
  scale?: number
  className?: string
  label?: string
}) {
  const size = 64 * scale
  const classes = ['dog-sprite', flip && 'dog-sprite-flip', barking && 'dog-sprite-barking', className]
  return (
    <img
      className={classes.filter(Boolean).join(' ')}
      src={spriteUrl(dog, barking)}
      width={size}
      height={size}
      alt={label ?? ''}
      draggable={false}
    />
  )
}

/** A dog trotting on the spot: two stride frames swapped by CSS (.dog-walk in index.css). */
export function WalkingDog({ dog, scale = 3, className }: { dog: Dog; scale?: number; className?: string }) {
  const size = 64 * scale
  const [a, b] = walkUrls(dog)
  return (
    <span className={['dog-walk', className].filter(Boolean).join(' ')} style={{ width: size, height: size }}>
      <img className="dog-sprite dog-walk-a" src={a} width={size} height={size} alt="" draggable={false} />
      <img className="dog-sprite dog-walk-b" src={b} width={size} height={size} alt="" draggable={false} />
    </span>
  )
}
