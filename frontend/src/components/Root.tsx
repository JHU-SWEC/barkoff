import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { preloadSprites } from '../dogs'
import { installPawTrail } from '../pawTrail'
import { installClickBarks } from '../sfx'

// Wraps every page, full-screen or not: click barks, the paw trail and the sprite preload.
export function Root() {
  useEffect(() => {
    preloadSprites()
    const uninstallBarks = installClickBarks()
    const uninstallTrail = installPawTrail()
    return () => {
      uninstallBarks()
      uninstallTrail()
    }
  }, [])
  return <Outlet />
}
