export function Figure({ label, value, unit, lead }: { label: string; value: string; unit?: string; lead?: boolean }) {
  const missing = value === '—'
  return (
    <div className={lead ? 'figure figure-lead' : 'figure'}>
      <dt>{label}</dt>
      <dd className={missing ? 'num missing' : 'num'}>
        {value}
        {unit && !missing && <span className="unit"> {unit}</span>}
      </dd>
    </div>
  )
}
