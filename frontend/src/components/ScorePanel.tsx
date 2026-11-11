import { useState } from 'react'
import { Link } from 'react-router'
import { useAccount } from '../account'
import type { Calibration } from '../calibration'
import { uploadClip } from '../clips'
import { formatDb, formatDelta } from '../format'
import { scoreTake, type ScoreResult } from '../score'
import { saveSoloResult } from '../soloResults'
import type { Take } from '../useBarkRecorder'
import type { Verdict } from '../useHeadGuide'
import { Figure } from './Figure'

type ScoreState =
  | { status: 'scoring' }
  | { status: 'done'; result: ScoreResult; newBest: boolean; clipId?: string; uploadNote?: string }
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
  const { account } = useAccount()
  // Results per take id, so switching takes keeps earlier scores.
  const [byTake, setByTake] = useState<Record<number, ScoreState>>({})
  const state = take ? byTake[take.id] : undefined

  const run = async () => {
    if (!take) return
    const id = take.id
    setByTake((prev) => ({ ...prev, [id]: { status: 'scoring' } }))
    try {
      const result = await scoreTake(take.blob, calibration)
      let clipId: string | undefined
      let uploadNote: string | undefined
      if (verdict.ok && account) {
        try {
          clipId = (await uploadClip(take.blob, result, id)).id
        } catch (err) {
          uploadNote = err instanceof Error ? err.message : 'Could not save the recording to your account.'
        }
      } else if (verdict.ok && !account) {
        uploadNote = 'Sign in to save this recording to your account.'
      }
      // Only takes that passed the camera check count toward the personal best.
      const newBest = verdict.ok ? saveSoloResult(result, id, clipId).newBest : false
      setByTake((prev) => ({ ...prev, [id]: { status: 'done', result, newBest, clipId, uploadNote } }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scoring failed.'
      setByTake((prev) => ({ ...prev, [id]: { status: 'error', message } }))
    }
  }

  const result = state?.status === 'done' ? state.result : null
  const done = state?.status === 'done' ? state : null
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
          {done?.clipId ? (
            <p className="quiet">Recording saved to your account.</p>
          ) : done?.uploadNote ? (
            <p className="quiet">{done.uploadNote}</p>
          ) : null}
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
          <Link
            className="button button-primary"
            to="/results?mode=solo"
            state={{ newBest: done?.newBest ?? false }}
          >
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
