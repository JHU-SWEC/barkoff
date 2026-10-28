const MINUS = '−'

// "-12.3" with a real minus sign; null for silence so callers can show a dash.
export function formatDb(db: number): string {
  if (!Number.isFinite(db)) return '—'
  const value = Math.abs(db).toFixed(1)
  return db < 0 && value !== '0.0' ? `${MINUS}${value}` : value
}

// A level difference, always signed: "+14.2", "−3.1".
export function formatDelta(db: number): string {
  if (!Number.isFinite(db)) return '—'
  const value = Math.abs(db).toFixed(1)
  if (value === '0.0') return value
  return `${db < 0 ? MINUS : '+'}${value}`
}

export function formatSeconds(s: number, digits = 1): string {
  return s.toFixed(digits)
}

export function formatKb(bytes: number): string {
  return (bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatStamp(date: Date): string {
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
