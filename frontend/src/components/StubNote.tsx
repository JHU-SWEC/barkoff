import type { ReactNode } from 'react'

// Says what on a stub page is placeholder, so nobody mistakes sample data for a working feature.
export function StubNote({ children }: { children: ReactNode }) {
  return (
    <p className="stub-note">
      <span className="pill pill-warning">Stub</span> {children}
    </p>
  )
}
