import type { ReactNode } from 'react'

export function PageHeader({ kicker, title, children }: { kicker?: string; title: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      <title>{`${title} · Bark Off`}</title>
      {kicker && <p className="kicker">{kicker}</p>}
      <h1>{title}</h1>
      {children}
    </div>
  )
}
