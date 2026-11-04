import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LOUDEST_WINDOW_S } from '../audio'
import { CALIBRATION_LINE, QUIET_S, type Calibration } from '../calibration'
import { formatDb, formatDelta, formatKb, formatSeconds, takeFileName } from '../format'
import type { Cue, LiveLevels, Take } from '../useBarkRecorder'
import { usePlaybackCursor } from '../usePlaybackCursor'
import { Figure } from './Figure'
import { LevelTrace } from './LevelTrace'

// What the level card says over the trace: the round countdown, or the calibration step.
function cuePrompt(cue: Cue, calibrating: boolean, elapsedS: number): ReactNode {
  if (cue === 'bark') return <span className="cue-bark">BARK!</span>
  if (cue === 'wait') return <span className="cue-note">Wait for it…</span>
  if (typeof cue === 'number') {
    return (
      <span key={cue} className="cue-count num">
        {cue}
      </span>
    )
  }
  if (!calibrating) return null
  if (elapsedS < QUIET_S) {
    return (
      <>
        <span className="cue-line">Stay quiet</span>
        <span className="cue-note">Measuring the room</span>
      </>
    )
  }
  return (
    <>
      <span className="cue-note">Read aloud at your normal volume</span>
      <span className="cue-line">“{CALIBRATION_LINE}”</span>
    </>
  )
}

interface Props {
  capturing: boolean
  calibrating: boolean
  captureS: number
  lengthS: number
  live: LiveLevels
  cue: Cue
  take: Take | null
  calibration: Calibration | null
  error: string | null
  onRetry: () => void
  children: ReactNode
}

export function LevelCard({
  capturing,
  calibrating,
  captureS,
  lengthS,
  live,
  cue,
  take,
  calibration,
  error,
  onRetry,
  children,
}: Props) {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const cursorS = usePlaybackCursor(audio)
  const cardRef = useRef<HTMLElement>(null)

  // Calibrate is pressed further down the page, but its prompts and any error appear here.
  useEffect(() => {
    if (calibrating || error) cardRef.current?.scrollIntoView({ block: 'start' })
  }, [calibrating, error])

  return (
    <section ref={cardRef} className="card level-card on-ink" aria-labelledby="level-heading">
      <div className="card-head">
        <h2 id="level-heading">
          {calibrating ? 'Calibration' : capturing ? 'Live level' : take ? `Take ${take.id} level` : 'Level'}
        </h2>
      </div>

      <dl className="figures">
        {capturing ? (
          <>
            <Figure lead label="Level now" value={formatDb(live.levelDb)} unit="dBFS" />
            <Figure label="Peak so far" value={formatDb(live.peakDb)} unit="dBFS" />
            <Figure label="Time left" value={formatSeconds(Math.max(0, captureS - live.elapsedS))} unit="s" />
            <Figure label="Length" value={formatSeconds(captureS, 2)} unit="s" />
          </>
        ) : (
          <>
            <Figure
              lead
              label={`Loudest ${LOUDEST_WINDOW_S * 1000} ms`}
              value={take?.loudest ? formatDb(take.loudest.lufs) : '—'}
              unit="LUFS"
            />
            <Figure
              label="Above your voice"
              value={take?.loudest && calibration ? formatDelta(take.loudest.lufs - calibration.speechLufs) : '—'}
              unit="dB"
            />
            <Figure label="Peak" value={take ? formatDb(take.peakDb) : '—'} unit="dBFS" />
            <Figure label="Length" value={take ? formatSeconds(take.durationS, 2) : '—'} unit="s" />
          </>
        )}
      </dl>

      {error ? (
        <div className="error" role="alert">
          <p>{error}</p>
          <button className="text-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <div className="stage">
          <LevelTrace
            points={capturing ? live.trace : (take?.trace ?? [])}
            durationS={capturing ? captureS : (take?.durationS ?? lengthS)}
            loudest={capturing ? null : take?.loudest}
            cursorS={capturing ? null : cursorS}
            emptyText={capturing ? undefined : 'No take yet. Press Record and bark.'}
          />
          <div className="cue" aria-live="assertive">
            {cuePrompt(cue, calibrating, live.elapsedS)}
          </div>
        </div>
      )}

      {children}

      {take && !capturing && (
        <div className="player">
          <audio key={take.id} ref={setAudio} controls src={take.url} />
          <div className="player-actions">
            <a className="button button-secondary" href={take.url} download={takeFileName(take)}>
              Download {take.extension}
            </a>
            <span className="quiet num">
              {takeFileName(take)} · {formatKb(take.blob.size)} KB
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
