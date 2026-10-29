import { useEffect, useState, type ReactNode } from 'react'
import { LevelTrace } from './LevelTrace'
import { LOUDEST_WINDOW_S } from './audio'
import { CALIBRATION_LINE, QUIET_S, calibrationJson, type Calibration } from './calibration'
import { formatClock, formatDb, formatDelta, formatKb, formatSeconds, formatStamp } from './format'
import { scoreLikeness, type LikenessResult } from './likeness'
import { MAX_TAKES, useBarkRecorder, type Cue, type MicInfo, type Take } from './useBarkRecorder'

const LENGTHS_S = [3, 5, 10, 15]
const QUIET_PEAK_DB = -30

function fileName(take: Take): string {
  return `bark-take-${take.id}.${take.extension}`
}

function finding(take: Take, calibration: Calibration | null): ReactNode {
  const name = `Take ${take.id}`
  if (take.clipAtS != null) {
    return (
      <>
        <span className="pill pill-negative">Clipped</span> {name} hit full scale at {formatSeconds(take.clipAtS, 2)} s.
        Back off from the mic and record again.
      </>
    )
  }
  if (take.peakDb < QUIET_PEAK_DB) {
    return `${name} is quiet: it peaked at ${formatDb(take.peakDb)} dBFS. Move closer or bark louder.`
  }
  if (calibration && take.loudest) {
    const over = take.loudest.lufs - calibration.speechLufs
    return `${name}’s loudest ${LOUDEST_WINDOW_S * 1000} ms was ${Math.abs(over).toFixed(1)} dB ${over < 0 ? 'below' : 'above'} your speaking voice, with no clipping.`
  }
  return `${name} peaked at ${formatDb(take.peakDb)} dBFS, ${formatSeconds(take.peakAtS, 2)} s in, with no clipping.`
}

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

function Figure({ label, value, unit, lead }: { label: string; value: string; unit?: string; lead?: boolean }) {
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

function usePlaybackCursor(audio: HTMLAudioElement | null) {
  const [cursorS, setCursorS] = useState<number | null>(null)
  useEffect(() => {
    if (!audio) return
    let rafId = 0
    const follow = () => {
      setCursorS(audio.currentTime)
      rafId = requestAnimationFrame(follow)
    }
    const onPlay = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(follow)
    }
    const onPause = () => cancelAnimationFrame(rafId)
    const onEnded = () => {
      cancelAnimationFrame(rafId)
      setCursorS(null)
    }
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    return () => {
      cancelAnimationFrame(rafId)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      setCursorS(null)
    }
  }, [audio])
  return cursorS
}

// Some browsers report these as strings ("all", "remote-only"); anything but `false` counts as on.
function isOn(value: unknown): boolean | undefined {
  return value === undefined ? undefined : value !== false
}

function MicPanel({ mic }: { mic: MicInfo | null }) {
  const processing: [string, boolean | undefined][] = [
    ['Auto-gain', isOn(mic?.settings.autoGainControl)],
    ['Noise suppression', isOn(mic?.settings.noiseSuppression)],
    ['Echo cancellation', isOn(mic?.settings.echoCancellation)],
  ]
  const rate = mic?.settings.sampleRate

  return (
    <section className="card mic-card" aria-labelledby="mic-heading">
      <div className="card-head">
        <h2 id="mic-heading">Microphone</h2>
        {mic && <span className="quiet mic-name">{mic.label || 'Default input'}</span>}
      </div>
      <dl className="figures figures-small">
        {processing.map(([label, on]) => (
          <div className="figure" key={label}>
            <dt>{label}</dt>
            <dd className={on === undefined ? 'missing' : undefined}>
              {on === undefined ? (
                '—'
              ) : on ? (
                <span className="pill pill-warning" title="The browser ignored the request to turn this off">
                  On
                </span>
              ) : (
                'Off'
              )}
            </dd>
          </div>
        ))}
        <Figure label="Sample rate" value={rate ? rate.toLocaleString() : '—'} unit="Hz" />
      </dl>
    </section>
  )
}

function CalibrationPanel({
  calibration,
  mic,
  disabled,
  onCalibrate,
}: {
  calibration: Calibration | null
  mic: MicInfo | null
  disabled: boolean
  onCalibrate: () => void
}) {
  const otherMic = calibration != null && mic != null && mic.label !== calibration.device

  return (
    <section className="card calibration-card" aria-labelledby="calibration-heading">
      <div className="card-head">
        <h2 id="calibration-heading">Calibration</h2>
        {otherMic ? (
          <span className="pill pill-warning" title={`Measured on ${calibration.device || 'another input'}`}>
            Different mic
          </span>
        ) : (
          calibration && <span className="quiet mic-name">{calibration.device || 'Default input'}</span>
        )}
      </div>
      {calibration ? (
        <dl className="figures figures-small">
          <Figure label="Room noise" value={formatDb(calibration.noiseLufs)} unit="LUFS" />
          <Figure label="Speaking voice" value={formatDb(calibration.speechLufs)} unit="LUFS" />
          <Figure label="Voice over room" value={formatDelta(calibration.speechLufs - calibration.noiseLufs)} unit="dB" />
          <Figure label="Measured" value={formatStamp(new Date(calibration.measuredAt))} />
        </dl>
      ) : (
        <p className="quiet calibration-intro">
          Five seconds: stay quiet for two, then read one line at your normal volume. Takes are then measured
          against your speaking voice, the baseline the scorer uses.
        </p>
      )}
      <div className="card-actions">
        <button className="button button-secondary" onClick={onCalibrate} disabled={disabled}>
          {calibration ? 'Recalibrate' : 'Calibrate 5 s'}
        </button>
        {calibration && (
          <a
            className="button button-secondary"
            href={`data:application/json;charset=utf-8,${encodeURIComponent(calibrationJson(calibration))}`}
            download="calibration.json"
          >
            Download JSON
          </a>
        )}
      </div>
    </section>
  )
}

type LikenessState = { status: 'scoring' } | { status: 'done'; result: LikenessResult } | { status: 'error'; message: string }

function LikenessPanel({ take, disabled }: { take: Take | null; disabled: boolean }) {
  // Results per take id, so switching takes keeps earlier scores.
  const [byTake, setByTake] = useState<Record<number, LikenessState>>({})
  const state = take ? byTake[take.id] : undefined

  const run = async () => {
    if (!take) return
    const id = take.id
    setByTake((prev) => ({ ...prev, [id]: { status: 'scoring' } }))
    try {
      const result = await scoreLikeness(take.blob)
      setByTake((prev) => ({ ...prev, [id]: { status: 'done', result } }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scoring failed.'
      setByTake((prev) => ({ ...prev, [id]: { status: 'error', message } }))
    }
  }

  return (
    <section className="card likeness-card" aria-labelledby="likeness-heading">
      <div className="card-head">
        <h2 id="likeness-heading">Likeness</h2>
        {take && <span className="quiet">Take {take.id}</span>}
      </div>
      {state?.status === 'done' ? (
        <>
          <dl className="figures figures-small">
            <Figure lead label="Bark probability" value={state.result.probability.toFixed(2)} />
          </dl>
          <dl className="rows likeness-top">
            {state.result.top.map((c) => (
              <div className="row" key={c.name}>
                <dt>{c.name}</dt>
                <dd className="num">{c.score.toFixed(3)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : state?.status === 'error' ? (
        <p className="likeness-error" role="alert">
          {state.message}
        </p>
      ) : (
        <p className="quiet">
          {take ? 'Score this take with the YAMNet dog classifier.' : 'Record a take to score it.'}
        </p>
      )}
      <div className="card-actions">
        <button
          className="button button-secondary"
          onClick={() => void run()}
          disabled={!take || disabled || state?.status === 'scoring'}
        >
          {state?.status === 'scoring' ? 'Scoring…' : state ? 'Score again' : 'Score likeness'}
        </button>
      </div>
    </section>
  )
}

function ScoringPanel({ take }: { take: Take | null }) {
  const file = take ? fileName(take) : 'bark.webm'
  return (
    <section className="card scoring-card" aria-labelledby="scoring-heading">
      <h2 id="scoring-heading">Scoring</h2>
      <p>
        <code>python score.py {file}</code> decodes the clip with FFmpeg and prints three numbers:
      </p>
      <dl className="rows scoring">
        <div className="row">
          <dt>Loudness</dt>
          <dd>Short-term LUFS, 400 ms</dd>
        </div>
        <div className="row">
          <dt>Likeness</dt>
          <dd>YAMNet bark probability</dd>
        </div>
        <div className="row">
          <dt>Score</dt>
          <dd className="num">0.7 × loudness + 0.3 × likeness</dd>
        </div>
      </dl>
    </section>
  )
}

function TakesPanel({
  takes,
  selectedId,
  onSelect,
}: {
  takes: Take[]
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
          {takes.map((take) => (
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
                </span>
                <span className="take-time num">{formatClock(take.recordedAt)}</span>
                <span className="take-meta num">
                  {formatSeconds(take.durationS)} s · peak {formatDb(take.peakDb)} dB
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function App() {
  const [lengthS, setLengthS] = useState(5)
  const [countdown, setCountdown] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const { status, plan, cue, error, takes, live, mic, calibration, record: recordTake, calibrate, stop } =
    useBarkRecorder()
  const cursorS = usePlaybackCursor(audio)

  const capturing = status === 'countdown' || status === 'recording'
  const calibrating = capturing && plan?.kind === 'calibration'
  const busy = status === 'requesting' || status === 'analysing'
  const take = takes.find((t) => t.id === selectedId) ?? takes[0] ?? null
  const captureS = plan?.lengthS ?? lengthS

  const record = () => {
    setSelectedId(null)
    void recordTake(lengthS, countdown)
  }
  const startCalibration = () => void calibrate()

  let subline: ReactNode = null
  if (status === 'requesting') subline = 'Waiting for microphone permission.'
  else if (status === 'countdown') subline = 'Get ready. Bark the moment you see BARK!'
  else if (calibrating) {
    subline = live.elapsedS < QUIET_S ? 'Calibrating. Stay quiet for a moment.' : 'Now read the line aloud.'
  } else if (status === 'recording') {
    subline = plan?.countdown
      ? `Bark! The window closes at ${captureS} s.`
      : `Recording. Bark now; it stops on its own at ${captureS} s.`
  } else if (status === 'analysing') {
    subline = plan?.kind === 'calibration' ? 'Measuring your calibration.' : 'Measuring the take.'
  } else if (take) subline = finding(take, calibration)
  else if (calibration && plan?.kind === 'calibration') {
    subline = 'Calibrated. Record a bark to see how far it rises above your voice.'
  }

  let buttonLabel = `Record ${lengthS} s`
  if (calibrating) buttonLabel = 'Calibrating…'
  else if (status === 'countdown') buttonLabel = 'Cancel'
  else if (status === 'recording') buttonLabel = 'Stop'
  else if (status === 'requesting') buttonLabel = 'Opening mic…'

  return (
    <>
      <header className="topbar">
        <div className="column topbar-inner">
          <a className="brand" href="/" aria-label="Bark Off home">
            <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 4.5h3.5c1.4 0 2.6.9 3 2.2l.4 1.3H19a2 2 0 0 1 2 2v1.2a2.3 2.3 0 0 1-2.3 2.3H16l-1.2 6a1 1 0 0 1-1 .8H9.2a1 1 0 0 1-1-1v-5.6L7 14.8a1.4 1.4 0 0 1-2-.7L3.6 9.9A3.6 3.6 0 0 1 6.9 5.1z" />
              <circle className="mark-eye" cx="13" cy="8.6" r="1" />
            </svg>
            Bark Off
          </a>
        </div>
      </header>

      <main className="column canvas">
        <div className="title-row">
          <div>
            <h1>Recorder</h1>
            <p className="subline" aria-live="polite">
              {subline}
            </p>
          </div>

          <div className="actions">
            <fieldset className="segmented" disabled={capturing || busy}>
              <legend className="visually-hidden">Take length</legend>
              {LENGTHS_S.map((s) => (
                <label key={s}>
                  <input
                    type="radio"
                    name="length"
                    value={s}
                    checked={lengthS === s}
                    onChange={() => setLengthS(s)}
                  />
                  <span className="num">{s} s</span>
                </label>
              ))}
            </fieldset>
            <label className="toggle" title="3-2-1, then bark on the BARK! cue, like a duel round">
              <input
                type="checkbox"
                role="switch"
                checked={countdown}
                onChange={(e) => setCountdown(e.target.checked)}
                disabled={capturing || busy}
              />
              <span>Countdown</span>
            </label>
            <button
              className="button button-primary"
              onClick={capturing ? stop : record}
              disabled={busy || calibrating}
            >
              {buttonLabel}
            </button>
          </div>
        </div>

        {/* 1100px column: 2fr + 12px gap + 1fr = 725.3 + 12 + 362.7 */}
        <div className="layout">
          <div className="main">
            <section className="card level-card" aria-labelledby="level-heading">
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
                  <button className="text-button" onClick={plan?.kind === 'calibration' ? startCalibration : record}>
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

              {take && !capturing && (
                <div className="player">
                  <audio key={take.id} ref={setAudio} controls src={take.url} />
                  <div className="player-actions">
                    <a className="button button-secondary" href={take.url} download={fileName(take)}>
                      Download {take.extension}
                    </a>
                    <span className="quiet num">
                      {fileName(take)} · {formatKb(take.blob.size)} KB
                    </span>
                  </div>
                </div>
              )}
            </section>
            <MicPanel mic={mic} />
            <CalibrationPanel
              calibration={calibration}
              mic={mic}
              disabled={capturing || busy}
              onCalibrate={startCalibration}
            />
          </div>

          <div className="rail">
            <TakesPanel takes={takes} selectedId={take?.id ?? null} onSelect={setSelectedId} />
            <LikenessPanel take={take} disabled={capturing || busy} />
            <ScoringPanel take={take} />
          </div>
        </div>
      </main>
    </>
  )
}

export default App
