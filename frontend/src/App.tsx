import { useEffect, useState, type ReactNode } from 'react'
import { LevelTrace } from './LevelTrace'
import { LOUDEST_WINDOW_S } from './audio'
import { formatClock, formatDb, formatKb, formatSeconds } from './format'
import { MAX_TAKES, useBarkRecorder, type MicInfo, type Take } from './useBarkRecorder'

const LENGTHS_S = [3, 5, 10, 15]
const QUIET_PEAK_DB = -30

function fileName(take: Take): string {
  return `bark-take-${take.id}.${take.extension}`
}

function finding(take: Take): ReactNode {
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
  return `${name} peaked at ${formatDb(take.peakDb)} dBFS, ${formatSeconds(take.peakAtS, 2)} s in, with no clipping.`
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
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const { status, error, takes, live, mic, start, stop } = useBarkRecorder(lengthS)
  const cursorS = usePlaybackCursor(audio)

  const recording = status === 'recording'
  const busy = status === 'requesting' || status === 'analysing'
  const take = takes.find((t) => t.id === selectedId) ?? takes[0] ?? null

  const record = () => {
    setSelectedId(null)
    void start()
  }

  let subline: ReactNode = null
  if (status === 'requesting') subline = 'Waiting for microphone permission.'
  else if (recording) subline = `Recording. Bark now; it stops on its own at ${lengthS} s.`
  else if (status === 'analysing') subline = 'Measuring the take.'
  else if (take) subline = finding(take)

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
            <fieldset className="segmented" disabled={recording || busy}>
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
            <button
              className="button button-primary"
              onClick={recording ? stop : record}
              disabled={busy}
            >
              {recording ? 'Stop' : status === 'requesting' ? 'Opening mic…' : `Record ${lengthS} s`}
            </button>
          </div>
        </div>

        {/* 1100px column: 2fr + 12px gap + 1fr = 725.3 + 12 + 362.7 */}
        <div className="layout">
          <div className="main">
            <section className="card level-card" aria-labelledby="level-heading">
              <div className="card-head">
                <h2 id="level-heading">{recording ? 'Live level' : take ? `Take ${take.id} level` : 'Level'}</h2>
              </div>

              <dl className="figures">
                {recording ? (
                  <>
                    <Figure lead label="Level now" value={formatDb(live.levelDb)} unit="dBFS" />
                    <Figure label="Peak so far" value={formatDb(live.peakDb)} unit="dBFS" />
                    <Figure label="Time left" value={formatSeconds(Math.max(0, lengthS - live.elapsedS))} unit="s" />
                    <Figure label="Length" value={formatSeconds(lengthS, 2)} unit="s" />
                  </>
                ) : (
                  <>
                    <Figure
                      lead
                      label={`Loudest ${LOUDEST_WINDOW_S * 1000} ms`}
                      value={take?.loudest ? formatDb(take.loudest.db) : '—'}
                      unit="dBFS"
                    />
                    <Figure label="Peak" value={take ? formatDb(take.peakDb) : '—'} unit="dBFS" />
                    <Figure label="Length" value={take ? formatSeconds(take.durationS, 2) : '—'} unit="s" />
                    <Figure label="File" value={take ? formatKb(take.blob.size) : '—'} unit="KB" />
                  </>
                )}
              </dl>

              {error ? (
                <div className="error" role="alert">
                  <p>{error}</p>
                  <button className="text-button" onClick={record}>
                    Try again
                  </button>
                </div>
              ) : (
                <LevelTrace
                  points={recording ? live.trace : (take?.trace ?? [])}
                  durationS={recording ? lengthS : (take?.durationS ?? lengthS)}
                  loudest={recording ? null : take?.loudest}
                  cursorS={recording ? null : cursorS}
                  emptyText={recording ? undefined : 'No take yet. Press Record and bark.'}
                />
              )}

              {take && !recording && (
                <div className="player">
                  <audio key={take.id} ref={setAudio} controls src={take.url} />
                  <div className="player-actions">
                    <a className="button button-secondary" href={take.url} download={fileName(take)}>
                      Download {take.extension}
                    </a>
                    <span className="quiet">{fileName(take)}</span>
                  </div>
                </div>
              )}
            </section>
            <MicPanel mic={mic} />
          </div>

          <div className="rail">
            <TakesPanel takes={takes} selectedId={take?.id ?? null} onSelect={setSelectedId} />
            <ScoringPanel take={take} />
          </div>
        </div>
      </main>
    </>
  )
}

export default App
