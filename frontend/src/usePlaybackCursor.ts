import { useEffect, useState } from 'react'

export function usePlaybackCursor(audio: HTMLAudioElement | null) {
  const [cursorS, setCursorS] = useState<number | null>(null)
  useEffect(() => {
    if (!audio) return
    let rafId = 0
    const follow = () => {
      setCursorS(audio.currentTime)
      rafId = requestAnimationFrame(follow)
    }
    const onPlay = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(follow)
    }
    const onPause = () => cancelAnimationFrame(rafId)
    const onEnded = () => {
      cancelAnimationFrame(rafId)
      setCursorS(null)
    }
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    return () => {
      cancelAnimationFrame(rafId)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      setCursorS(null)
    }
  }, [audio])
  return cursorS
}
