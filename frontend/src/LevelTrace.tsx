import { useEffect, useRef, useState } from 'react'
import { FLOOR_DB, LOUDEST_WINDOW_S, type LevelPoint, type LoudestWindow } from './audio'
import { formatDb } from './format'

const DB_TICKS = [0, -20, -40, -60]
const MARGIN = { top: 28, right: 8, bottom: 28, left: 44 }

interface Props {
  points: LevelPoint[]
  durationS: number
  loudest?: LoudestWindow | null
  cursorS?: number | null
  emptyText?: string
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function secondStep(durationS: number): number {
  if (durationS <= 6) return 1
  if (durationS <= 12) return 2
  return 3
}

export function LevelTrace({ points, durationS, loudest, cursorS, emptyText }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = width < 480 ? 188 : 240
  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const plotH = height - MARGIN.top - MARGIN.bottom
  const domain = Math.max(durationS, 0.1)

  const x = (t: number) => MARGIN.left + (Math.min(t, domain) / domain) * plotW
  const y = (db: number) => MARGIN.top + (Math.max(db, FLOOR_DB) / FLOOR_DB) * plotH

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.db).toFixed(1)}`).join('')

  const step = secondStep(domain)
  const secondTicks: number[] = []
  for (let t = 0; t <= domain + 1e-6; t += step) secondTicks.push(t)

  const loudestLabel = loudest && `Loudest ${LOUDEST_WINDOW_S * 1000} ms · ${formatDb(loudest.lufs)} LUFS`
  const labelAtEnd = loudest && x(loudest.start) > MARGIN.left + plotW * 0.6

  const summary = loudest
    ? `Level over ${domain.toFixed(1)} seconds; loudest ${LOUDEST_WINDOW_S * 1000} ms from ${loudest.start.toFixed(2)} s at ${formatDb(loudest.lufs)} LUFS`
    : `Level over ${domain.toFixed(1)} seconds`

  return (
    <div ref={ref} className="trace">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={summary}>
          {loudest && (
            <g>
              <rect
                className="trace-span"
                x={x(loudest.start)}
                y={MARGIN.top}
                width={Math.max(2, x(loudest.end) - x(loudest.start))}
                height={plotH}
              />
              <text
                className="trace-note"
                x={labelAtEnd ? x(loudest.end) : x(loudest.start)}
                y={MARGIN.top - 10}
                textAnchor={labelAtEnd ? 'end' : 'start'}
              >
                {loudestLabel}
              </text>
            </g>
          )}

          {DB_TICKS.map((db) => (
            <g key={db}>
              <line className="trace-grid" x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(db)} y2={y(db)} />
              <text className="trace-tick" x={MARGIN.left - 8} y={y(db)} textAnchor="end" dominantBaseline="middle">
                {db === 0 ? '0 dB' : `\u2212${-db}`}
              </text>
            </g>
          ))}

          {secondTicks.map((t) => (
            <text key={t} className="trace-tick" x={x(t)} y={height - 8} textAnchor={t === 0 ? 'start' : 'middle'}>
              {t} s
            </text>
          ))}

          {path && <path className="trace-line" d={path} />}

          {cursorS != null && (
            <line className="trace-cursor" x1={x(cursorS)} x2={x(cursorS)} y1={MARGIN.top} y2={MARGIN.top + plotH} />
          )}

          {!points.length && emptyText && (
            <text className="trace-empty" x={MARGIN.left + plotW / 2} y={MARGIN.top + plotH / 2} textAnchor="middle">
              {emptyText}
            </text>
          )}
        </svg>
      )}
    </div>
  )
}
