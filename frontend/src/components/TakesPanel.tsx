import { formatClock, formatDb, formatSeconds } from '../format'
import { MAX_TAKES, type Take } from '../useBarkRecorder'
import { judgeTake, type PositionCheck } from '../useHeadGuide'

export function TakesPanel({
  takes,
  checks,
  selectedId,
  onSelect,
}: {
  takes: Take[]
  checks: Record<number, PositionCheck>
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  return (
    <section className="card takes-card" aria-labelledby="takes-heading">
      <div className="card-head">
        <h2 id="takes-heading">Takes</h2>
        {takes.length > 0 && (
          <span className="quiet num">
            {takes.length} of {MAX_TAKES} kept
          </span>
        )}
      </div>
      {takes.length ? (
        <ul className="takes">
          {takes.map((take) => {
            const verdict = judgeTake(checks[take.id])
            return (
            <li key={take.id}>
              <button
                className="take"
                aria-pressed={take.id === selectedId}
                onClick={() => onSelect(take.id)}
              >
                <span className="take-name">
                  Take {take.id}
                  {take.round && <span className="pill pill-info">Round</span>}
                  {take.clipAtS != null && <span className="pill pill-negative">Clipped</span>}
                  {!verdict.ok && (
                    <span className={verdict.reason === 'unchecked' ? 'pill pill-warning' : 'pill pill-negative'}>
                      {verdict.reason === 'unchecked' ? 'No camera' : verdict.reason === 'close' ? 'Too close' : 'Off camera'}
                    </span>
                  )}
                </span>
                <span className="take-time num">{formatClock(take.recordedAt)}</span>
                <span className="take-meta num">
                  {formatSeconds(take.durationS)} s · peak {formatDb(take.peakDb)} dB
                </span>
              </button>
            </li>
            )
          })}
        </ul>
      ) : (
        <p className="quiet">Your last {MAX_TAKES} takes show up here.</p>
      )}
    </section>
  )
}
