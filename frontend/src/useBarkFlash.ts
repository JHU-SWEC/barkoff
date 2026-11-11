import { useEffect, useState } from 'react'

/** Shows the barking frame for a moment each time `trigger()` is called. */
export function useBarkFlash(ms = 320): [boolean, () => void] {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!until) return
    const id = setTimeout(() => setNow(until), Math.max(0, until - performance.now()))
    return () => clearTimeout(id)
  }, [until])
  return [until > now, () => setUntil(performance.now() + ms)]
}
