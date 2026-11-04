import { useState } from 'react'
import { Link } from 'react-router'
import type { Calibration } from '../calibration'
import { formatDb, formatDelta } from '../format'
import { scoreTake, type ScoreResult } from '../score'
import { saveSoloResult } from '../soloResults'
import type { Take } from '../useBarkRecorder'
import type { Verdict } from '../useHeadGuide'
import { Figure } from './Figure'

type ScoreState =
  | { status: 'scoring' }
  | { status: 'done'; result: ScoreResult; newBest: boolean }
  | { status: 'error'; message: string }

export function ScorePanel({
  take,
  calibration,
  verdict,
  disabled,
}: {
  take: Take | null
  calibration: Calibration | null
  verdict: Verdict
  disabled: boolean
}) {
  // Results per take id, so switching takes keeps earlier scores.
  const [byTake, setByTake] = useState<Record<number, ScoreState>>({})
  const state = take ? byTake[take.id] : undefined

  const run = async () => {
    if (!take) return
    const id = take.id
    setByTake((prev) => ({ ...prev, [id]: { status: 'scoring' } }))
    try {
      const result = await scoreTake(take.blob, calibration)
      // Only takes that passed the camera check count toward the personal best.
      const newBest = verdict.ok ? saveSoloResult(result, id).newBest : false
      setByTake((prev) => ({ ...prev, [id]: { status: 'done', result, newBest } }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scoring failed.'
      setByTake((prev) => ({ ...prev, [id]: { status: 'error', message } }))
    }
  }

  const result = state?.status === 'done' ? state.result : null
  return (
    <section className="card score-card" aria-labelledby="score-heading">
      <div className="card-head">
        <h2 id="score-heading">Score</h2>
        {take && <span className="quiet">Take {take.id}</span>}
      </div>
      {result && verdict.ok ? (
        <>
          <dl className="figures figures-small">
            <Figure lead label="Score" value={result.score.toFixed(2)} />
            <Figure label="Loudness" value={result.loudness.toFixed(2)} />
            <Figure label="Likeness" value={result.likeness.toFixed(2)} />
          </dl>
          <p className="quiet score-detail">
            Loudest 400 ms <span className="num">{formatDb(result.loudness_lufs)} LUFS</span>,{' '}
            <span className="num">{formatDelta(result.over_speech_lu)} LU</span> over{' '}
            {result.calibrated ? 'your speaking voice' : 'a typical speaking voice (calibrate for yours)'}
          </p>
          <dl className="rows score-top">
            {result.top.map((c) => (
              <div className="row" key={c.name}>
                <dt>{c.name}</dt>
                <dd className="num">{c.score.toFixed(3)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : take && !verdict.ok ? (
        <p className="score-error">{verdict.message}</p>
      ) : state?.status === 'error' ? (
        <p className="score-error" role="alert">
          {state.message}
        </p>
      ) : (
        <p className="quiet">
          {take ? 'Score this take for loudness and dog-likeness.' : 'Record a take to score it.'}
        </p>
      )}
      <div className="card-actions">
        {result && verdict.ok && (
          <Link className="button button-primary" to="/results?mode=solo" state={{ newBest: state?.status === 'done' && state.newBest }}>
            See results
          </Link>
        )}
        <button
          className="button button-secondary"
          onClick={() => void run()}
          disabled={!take || !verdict.ok || disabled || state?.status === 'scoring'}
        >
          {state?.status === 'scoring' ? 'Scoring…' : state ? 'Score again' : 'Score take'}
        </button>
      </div>
    </section>
  )
}
