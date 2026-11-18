import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { PageHeader } from '../components/PageHeader'
import {
  TYPES,
  clipUrl,
  fetchClips,
  fetchScores,
  fetchTeam,
  isComplete,
  isFlagged,
  saveScore,
  type BarkType,
  type ClipScore,
  type Team,
} from '../scoringApi'
import './ScoreBarksPage.css'

// Score the human-bark clips by hand: how dog-like each one is and what kind of bark. Every
// change is saved on the server (backend/bark_scores.py) under the scorer's name; the team's
// files are combined through git, and each clip's label is the average of everyone's scores.
// Blind on purpose: only clip ids are shown, never what the person was imitating.

const LIKENESS: [string, string, string][] = [
  ['0', 'Not at all', 'Nothing like a dog'],
  ['0.25', 'A little', 'Bark-ish, but clearly a person'],
  ['0.5', 'Could pass', 'If you weren’t paying attention'],
  ['0.75', 'Convincing', 'A great impression'],
  ['1', 'Real dog', 'Unmistakably a dog'],
]

const TYPE_INFO: Record<BarkType, [string, string, string]> = {
  playful: ['Playful', 'Light, bouncy, “let’s play”', 'q'],
  aggressive: ['Aggressive', 'Threatening, harsh, snarly', 'w'],
  whimper: ['Whimper', 'Whine, cry, pleading', 'e'],
  growl: ['Growl', 'Low, rumbling, sustained', 'r'],
  alarm: ['Alarm', 'Sharp, urgent, “someone’s here!”', 't'],
  none: ['None', 'Not a dog sound at all', 'y'],
}

const SCORER_KEY = 'barkoff.scorer'
const NAME = /^[a-z0-9_-]{1,32}$/

function blank(id: string): ClipScore {
  return { id, likeness: '', type: '', not_human: '', bad_audio: '', notes: '' }
}

function loadScorer(): string {
  try {
    return localStorage.getItem(SCORER_KEY) ?? ''
  } catch {
    return ''
  }
}

// Each scorer hears the clips in their own stable random order, so nobody's scores follow the
// order the clips were collected in.
function shuffled(list: string[], seedText: string): string[] {
  let h = 2166136261
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function Waveform({
  id,
  audio,
  onSeek,
}: {
  id: string
  audio: RefObject<HTMLAudioElement | null>
  onSeek: (fraction: number) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const [peaks, setPeaks] = useState<[number, number][] | null>(null)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => !cancelled && setPeaks(null))
    fetch(clipUrl(id))
      .then((r) => r.arrayBuffer())
      .then((buf) => new OfflineAudioContext(1, 1, 16000).decodeAudioData(buf))
      .then((decoded) => {
        if (cancelled) return
        const data = decoded.getChannelData(0)
        const cols = 600
        const step = Math.max(1, Math.floor(data.length / cols))
        const out: [number, number][] = []
        for (let c = 0; c < cols; c++) {
          let lo = 0
          let hi = 0
          for (let i = c * step; i < Math.min(data.length, (c + 1) * step); i++) {
            lo = Math.min(lo, data[i])
            hi = Math.max(hi, data[i])
          }
          out.push([lo, hi])
        }
        setPeaks(out)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const paint = () => {
      const r = cv.getBoundingClientRect()
      const dpr = devicePixelRatio || 1
      cv.width = r.width * dpr
      cv.height = r.height * dpr
      const g = cv.getContext('2d')
      if (!g) return
      g.scale(dpr, dpr)
      g.fillStyle = '#e9e0cf'
      g.fillRect(0, r.height / 2 - 0.5, r.width, 1)
      if (!peaks) return
      const max = Math.max(1e-4, ...peaks.map(([lo, hi]) => Math.max(-lo, hi)))
      g.fillStyle = '#1c1714'
      peaks.forEach(([lo, hi], i) => {
        const x = (i / peaks.length) * r.width
        const y1 = r.height / 2 - (hi / max) * (r.height / 2 - 6)
        const y2 = r.height / 2 - (lo / max) * (r.height / 2 - 6)
        g.fillRect(x, y1, Math.max(1, r.width / peaks.length - 0.4), Math.max(1, y2 - y1))
      })
    }
    paint()
    addEventListener('resize', paint)
    return () => removeEventListener('resize', paint)
  }, [peaks])

  useEffect(() => {
    let raf = 0
    const follow = () => {
      const a = audio.current
      if (head.current) head.current.style.left = a?.duration ? `${(a.currentTime / a.duration) * 100}%` : '0'
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(raf)
  }, [audio])

  return (
    <div
      className="sb-wave"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onSeek((e.clientX - r.left) / r.width)
      }}
    >
      <canvas ref={canvas} />
      <div className="sb-playhead" ref={head} />
    </div>
  )
}

function ScorerGate({ onPick }: { onPick: (name: string) => void }) {
  const [name, setName] = useState('')
  const clean = name.trim().toLowerCase()
  return (
    <form
      className="card sb-gate"
      onSubmit={(e) => {
        e.preventDefault()
        if (NAME.test(clean)) onPick(clean)
      }}
    >
      <h2>Who’s scoring?</h2>
      <p>
        Pick a short name (letters, numbers, - or _), the same one every time. Your scores save under it as you go,
        and come back when you return.
      </p>
      <div className="sb-gate-row">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="e.g. leo" autoFocus />
        <button className="button button-primary" disabled={!NAME.test(clean)}>
          Start scoring
        </button>
      </div>
      {name && !NAME.test(clean) && <p className="sb-error">Letters, numbers, - or _ only, no spaces.</p>}
    </form>
  )
}

export default function ScoreBarksPage() {
  const [scorer, setScorer] = useState(loadScorer)
  const [clips, setClips] = useState<string[]>([])
  const [missing, setMissing] = useState(0)
  const [scores, setScores] = useState<Record<string, ClipScore>>({})
  const [team, setTeam] = useState<Team | null>(null)
  const [at, setAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [autoplay, setAutoplay] = useState(true)
  const [advance, setAdvance] = useState(true)
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const notesTimer = useRef(0)

  const order = useMemo(() => (scorer ? shuffled(clips, scorer) : []), [clips, scorer])
  const id = order[at]
  const current = id ? (scores[id] ?? blank(id)) : null
  const done = order.filter((c) => isComplete(scores[c])).length

  useEffect(() => {
    fetchClips()
      .then((r) => {
        setClips(r.clips)
        setMissing(r.missing_audio)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const refreshTeam = useCallback(() => {
    fetchTeam()
      .then(setTeam)
      .catch(() => {})
  }, [])

  // Load this scorer's saved scores, and pick up where they left off.
  useEffect(() => {
    if (!scorer || !clips.length) return
    let cancelled = false
    fetchScores(scorer)
      .then((s) => {
        if (cancelled) return
        setScores(s)
        const list = shuffled(clips, scorer)
        const first = list.findIndex((c) => !isComplete(s[c]))
        setAt(first < 0 ? 0 : first)
        refreshTeam()
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      cancelled = true
    }
  }, [scorer, clips, refreshTeam])

  const playing_ = (on: boolean) => () => setPlaying(on)

  // Load each clip as it comes up; autoplay is read through a ref so toggling it doesn't reload.
  const autoplayRef = useRef(autoplay)
  useEffect(() => {
    autoplayRef.current = autoplay
  }, [autoplay])
  useEffect(() => {
    const a = audio.current
    if (!id || !a) return
    a.src = clipUrl(id)
    if (autoplayRef.current) void a.play().catch(() => {})
  }, [id])

  const seek = useCallback((fraction: number) => {
    const a = audio.current
    if (!a?.duration) return
    a.currentTime = fraction * a.duration
    void a.play()
  }, [])

  const togglePlay = useCallback(() => {
    const a = audio.current
    if (!a) return
    if (a.paused) {
      if (a.ended) a.currentTime = 0
      void a.play()
    } else a.pause()
  }, [])

  const goNextOpen = useCallback(
    (from: number, known: Record<string, ClipScore>) => {
      const i = nextOpen(order, known, from)
      if (i != null) setAt(i)
    },
    [order],
  )

  const persist = useCallback(
    (row: ClipScore | null, clip: string) => {
      setSaved('Saving…')
      saveScore(scorer, row ?? { id: clip, clear: true })
        .then(() => {
          setSaved(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`)
          setError(null)
          refreshTeam()
        })
        .catch((e: Error) => {
          setSaved('')
          setError(e.message)
        })
    },
    [scorer, refreshTeam],
  )

  const setField = useCallback(
    (field: 'likeness' | 'type' | 'not_human' | 'bad_audio', value: string) => {
      if (!id) return
      const row = { ...(scores[id] ?? blank(id)) }
      // Picking the chosen option again clears it.
      ;(row as Record<string, string>)[field] = row[field] === value ? '' : value
      const next = { ...scores, [id]: row }
      setScores(next)
      persist(row, id)
      if (advance && isComplete(row) && !isComplete(scores[id])) {
        const here = at
        setTimeout(() => setAt((now) => (now === here ? (nextOpen(order, next, here) ?? now) : now)), 350)
      }
    },
    [id, scores, persist, advance, at, order],
  )

  const setNotes = (value: string) => {
    if (!id) return
    const row = { ...(scores[id] ?? blank(id)), notes: value }
    setScores((s) => ({ ...s, [id]: row }))
    clearTimeout(notesTimer.current)
    notesTimer.current = window.setTimeout(() => persist(row, id), 500)
  }

  const clear = () => {
    if (!id) return
    setScores((s) => {
      const next = { ...s }
      delete next[id]
      return next
    })
    persist(null, id)
  }

  // Keyboard: Space play, 1-5 likeness, Q W E R T Y type, X not a person, B bad audio, arrows, N next unscored.
  useEffect(() => {
    if (!scorer) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase()
      if (e.metaKey || e.ctrlKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if (k === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (k >= '1' && k <= '5') setField('likeness', LIKENESS[Number(k) - 1][0])
      else if (TYPES.some((t) => TYPE_INFO[t][2] === k)) setField('type', TYPES.find((t) => TYPE_INFO[t][2] === k)!)
      else if (k === 'x') setField('not_human', '1')
      else if (k === 'b') setField('bad_audio', '1')
      else if (k === 'arrowright') setAt((a) => Math.min(order.length - 1, a + 1))
      else if (k === 'arrowleft') setAt((a) => Math.max(0, a - 1))
      else if (k === 'n') goNextOpen(at, scores)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [scorer, togglePlay, setField, order.length, goNextOpen, at, scores])

  const pickScorer = (name: string) => {
    try {
      localStorage.setItem(SCORER_KEY, name)
    } catch {
      // Private mode: asked again next visit.
    }
    setScorer(name)
  }

  const tally = useMemo(() => {
    const t: Record<string, number> = {}
    let flagged = 0
    for (const c of order) {
      const s = scores[c]
      if (!isComplete(s)) continue
      if (isFlagged(s)) flagged++
      else t[s!.type] = (t[s!.type] ?? 0) + 1
    }
    return { t, flagged }
  }, [order, scores])

  const header = (
    <PageHeader kicker="Help train the model" title="Score barks">
      <p className="subline">
        People imitating dogs. Score how dog-like each clip sounds and what kind of bark it is. Every teammate’s scores
        are averaged into the label.
      </p>
    </PageHeader>
  )

  if (!scorer) {
    return (
      <div data-sfx="off">
        {header}
        <ScorerGate onPick={pickScorer} />
      </div>
    )
  }

  return (
    // Silent page: the click-bark sound would land on top of the clips being judged.
    <div data-sfx="off">
      {header}
      <audio ref={audio} preload="auto" hidden onPlay={playing_(true)} onPause={playing_(false)} onEnded={playing_(false)} />
      {error && (
        <p className="sb-error" role="alert">
          {error}
        </p>
      )}
      {missing > 0 && (
        <p className="sb-note">
          {clips.length ? `${missing} of ${missing + clips.length} clips` : 'The clips'} aren’t downloaded on this
          machine yet. Run <code>python scripts/data/human_barks/build.py</code> once (a few minutes), then reload.
        </p>
      )}

      {id && current && (
        <div className="sb-layout">
          <section className="card sb-main" aria-labelledby="sb-clip">
            <div className="sb-head">
              <h2 id="sb-clip" className="sb-clip-id">
                {id}
              </h2>
              <span className="quiet num">
                {at + 1} of {order.length}
              </span>
            </div>
            <Waveform id={id} audio={audio} onSeek={seek} />
            <div className="sb-play-row">
              <button className="button button-primary" onClick={togglePlay}>
                {playing ? 'Pause' : 'Play'} <span className="sb-kbd">Space</span>
              </button>
              <label className="sb-toggle">
                <input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} /> Autoplay
              </label>
              <label className="sb-toggle">
                <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} /> Move on when
                scored
              </label>
            </div>

            <h3 className="sb-h">Likeness: how much like a real dog?</h3>
            <div className="sb-choices sb-likeness">
              {LIKENESS.map(([v, name, help], i) => (
                <button
                  key={v}
                  className={current.likeness !== '' && Number(current.likeness) === Number(v) ? 'sb-choice on' : 'sb-choice'}
                  onClick={() => setField('likeness', v)}
                >
                  <b>
                    {name} <span className="sb-kbd">{i + 1}</span>
                  </b>
                  <small>
                    {v} · {help}
                  </small>
                </button>
              ))}
            </div>

            <h3 className="sb-h">Type of bark</h3>
            <div className="sb-choices sb-types">
              {TYPES.map((t) => (
                <button key={t} className={current.type === t ? 'sb-choice on' : 'sb-choice'} onClick={() => setField('type', t)}>
                  <b>
                    {TYPE_INFO[t][0]} <span className="sb-kbd">{TYPE_INFO[t][2].toUpperCase()}</span>
                  </b>
                  <small>{TYPE_INFO[t][1]}</small>
                </button>
              ))}
            </div>

            <div className="sb-flags">
              <button className={current.not_human === '1' ? 'sb-flag on' : 'sb-flag'} onClick={() => setField('not_human', '1')}>
                Not a person (a real animal) <span className="sb-kbd">X</span>
              </button>
              <button className={current.bad_audio === '1' ? 'sb-flag on' : 'sb-flag'} onClick={() => setField('bad_audio', '1')}>
                Bad audio / unusable <span className="sb-kbd">B</span>
              </button>
            </div>
            <textarea
              className="sb-notes"
              placeholder="Notes (optional)"
              value={current.notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            <div className="card-actions sb-nav">
              <button className="button button-secondary" onClick={() => setAt((a) => Math.max(0, a - 1))}>
                ← Previous
              </button>
              <button className="button button-secondary" onClick={() => setAt((a) => Math.min(order.length - 1, a + 1))}>
                Next →
              </button>
              <button className="button button-secondary" onClick={() => goNextOpen(at, scores)}>
                Next unscored <span className="sb-kbd">N</span>
              </button>
              <button className="text-button" onClick={clear}>
                Clear this clip
              </button>
            </div>
            <p className="quiet sb-status" aria-live="polite">
              {done === order.length
                ? 'Every clip is scored. Thank you!'
                : isComplete(current)
                  ? 'This clip is scored.'
                  : current.likeness !== ''
                    ? 'Now pick a type.'
                    : current.type
                      ? 'Now pick a likeness.'
                      : 'Pick a likeness and a type, or flag it.'}
              {saved && <span className="sb-saved"> · {saved}</span>}
            </p>
          </section>

          <aside className="sb-side">
            <section className="card">
              <div className="card-head">
                <h2>You</h2>
                <button
                  className="text-button"
                  onClick={() => {
                    audio.current?.pause()
                    setScorer('')
                    setScores({})
                  }}
                >
                  Not {scorer}?
                </button>
              </div>
              <p className="sb-progress num">
                {done} <span className="quiet">/ {order.length} scored</span>
              </p>
              <div className="sb-bar" aria-hidden="true">
                <span style={{ width: `${order.length ? (done / order.length) * 100 : 0}%` }} />
              </div>
              <dl className="rows sb-tally">
                {TYPES.map((t) => (
                  <div className="row" key={t}>
                    <dt>{TYPE_INFO[t][0]}</dt>
                    <dd className="num">{tally.t[t] ?? 0}</dd>
                  </div>
                ))}
                <div className="row">
                  <dt>Flagged</dt>
                  <dd className="num">{tally.flagged}</dd>
                </div>
              </dl>
            </section>

            {team && (
              <section className="card">
                <h2>Team</h2>
                <dl className="rows sb-tally">
                  {Object.entries(team.scorers).map(([name, n]) => (
                    <div className="row" key={name}>
                      <dt>{name === scorer ? `${name} (you)` : name}</dt>
                      <dd className="num">
                        {n} / {team.clips}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="quiet sb-team-note">
                  Scores in this copy of the repo. Commit <code>scripts/data/human_barks/labels/</code> to share yours;
                  pull to see everyone else’s.
                </p>
              </section>
            )}

            <section className="card">
              <div className="card-head">
                <h2>Clips</h2>
                <label className="sb-toggle">
                  <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Unscored
                  only
                </label>
              </div>
              <div className="sb-grid">
                {order.map((c, i) => {
                  const s = scores[c]
                  if (onlyOpen && isComplete(s) && i !== at) return null
                  const state = isFlagged(s) ? 'flagged' : isComplete(s) ? 'done' : s ? 'partial' : ''
                  return (
                    <button key={c} className={`sb-chip ${state} ${i === at ? 'here' : ''}`} onClick={() => setAt(i)}>
                      {c}
                    </button>
                  )
                })}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}

/** The next clip after `from` (wrapping round) that isn't scored yet. */
function nextOpen(order: string[], known: Record<string, ClipScore>, from: number): number | null {
  for (let k = 1; k <= order.length; k++) {
    const i = (from + k) % order.length
    if (!isComplete(known[order[i]])) return i
  }
  return null
}
