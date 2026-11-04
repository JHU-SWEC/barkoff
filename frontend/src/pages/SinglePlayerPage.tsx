import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LOUDEST_WINDOW_S } from '../audio'
import { QUIET_S, type Calibration } from '../calibration'
import { CalibrationPanel } from '../components/CalibrationPanel'
import { CameraPanel } from '../components/CameraPanel'
import { LevelCard } from '../components/LevelCard'
import { MicPanel } from '../components/MicPanel'
import { PageHeader } from '../components/PageHeader'
import { RecordControls } from '../components/RecordControls'
import { ScorePanel } from '../components/ScorePanel'
import { ScoringPanel } from '../components/ScoringPanel'
import { TakesPanel } from '../components/TakesPanel'
import { formatDb, formatSeconds } from '../format'
import { useBarkRecorder, type Take } from '../useBarkRecorder'
import { judgeTake, useHeadGuide, type PositionCheck, type Verdict } from '../useHeadGuide'
import '../components/recorder.css'
import './SinglePlayerPage.css'

const QUIET_PEAK_DB = -30

function finding(take: Take, calibration: Calibration | null, verdict: Verdict): ReactNode {
  const name = `Take ${take.id}`
  if (!verdict.ok && verdict.reason !== 'unchecked') {
    return (
      <>
        <span className="pill pill-negative">{verdict.reason === 'close' ? 'Too close' : 'Off camera'}</span> {name}:{' '}
        {verdict.message}
      </>
    )
  }
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

export default function SinglePlayerPage() {
  const [lengthS, setLengthS] = useState(5)
  const [countdown, setCountdown] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const { status, plan, cue, error, takes, live, mic, calibration, record: recordTake, calibrate, stop } =
    useBarkRecorder()
  const guide = useHeadGuide()
  const { beginWatch, endWatch } = guide
  // Camera check per take id, filled in when the take it watched comes back from analysis.
  const [checks, setChecks] = useState<Record<number, PositionCheck>>({})
  const pendingCheck = useRef<PositionCheck | undefined>(undefined)
  const watching = status === 'recording' && plan?.kind === 'take'

  const capturing = status === 'countdown' || status === 'recording'
  const calibrating = capturing && plan?.kind === 'calibration'
  const busy = status === 'requesting' || status === 'analysing'
  const take = takes.find((t) => t.id === selectedId) ?? takes[0] ?? null
  const captureS = plan?.lengthS ?? lengthS
  const verdict = judgeTake(take ? checks[take.id] : undefined)
  const newestId = takes[0]?.id

  useEffect(() => {
    if (!watching) return
    beginWatch()
    return () => {
      pendingCheck.current = endWatch()
    }
  }, [watching, beginWatch, endWatch])

  useEffect(() => {
    const check = pendingCheck.current
    if (newestId == null || !check) return
    pendingCheck.current = undefined
    setChecks((prev) => (newestId in prev ? prev : { ...prev, [newestId]: check }))
  }, [newestId])

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
  } else if (status === 'recording' && guide.status === 'on' && guide.fit === 'close') {
    subline = 'Too close to the mic. Sit back into the outline.'
  } else if (status === 'recording' && guide.status === 'on' && guide.fit === 'none') {
    subline = 'The camera can’t see you. Get back into the outline.'
  } else if (status === 'recording') {
    subline = plan?.countdown
      ? `Bark! The window closes at ${captureS} s.`
      : `Recording. Bark now; it stops on its own at ${captureS} s.`
  } else if (status === 'analysing') {
    subline = plan?.kind === 'calibration' ? 'Measuring your calibration.' : 'Measuring the take.'
  } else if (take) subline = finding(take, calibration, verdict)
  else if (calibration && plan?.kind === 'calibration') {
    subline = 'Calibrated. Record a bark to see how far it rises above your voice.'
  } else {
    subline = guide.status === 'on' ? 'You’re on camera. Press Record and bark.' : 'Turn on the camera, then record a bark to get it scored.'
  }

  let buttonLabel = `Record ${lengthS} s`
  if (calibrating) buttonLabel = 'Calibrating…'
  else if (status === 'countdown') buttonLabel = 'Cancel'
  else if (status === 'recording') buttonLabel = 'Stop'
  else if (status === 'requesting') buttonLabel = 'Opening mic…'

  return (
    <>
      <PageHeader kicker="Solo" title="Single player">
        <p className="subline" aria-live="polite">
          {subline}
        </p>
      </PageHeader>

      <div className="layout">
        <div className="main">
          <LevelCard
            capturing={capturing}
            calibrating={calibrating}
            captureS={captureS}
            lengthS={lengthS}
            live={live}
            cue={cue}
            take={take}
            calibration={calibration}
            error={error}
            onRetry={plan?.kind === 'calibration' ? startCalibration : record}
          >
            <RecordControls
              lengthS={lengthS}
              countdown={countdown}
              locked={capturing || busy}
              live={capturing && !calibrating}
              disabled={busy || calibrating}
              label={buttonLabel}
              onLength={setLengthS}
              onCountdown={setCountdown}
              onPress={capturing ? stop : record}
            />
          </LevelCard>
          <div className="setup">
            <CalibrationPanel
              calibration={calibration}
              mic={mic}
              disabled={capturing || busy}
              onCalibrate={startCalibration}
            />
            <MicPanel mic={mic} />
            <ScoringPanel take={take} />
          </div>
        </div>

        <div className="rail">
          <CameraPanel
            status={guide.status}
            error={guide.error}
            fit={guide.fit}
            attachVideo={guide.attachVideo}
            onStart={() => void guide.start()}
            onStop={guide.stop}
            disabled={capturing}
          />
          <ScorePanel take={take} calibration={calibration} verdict={verdict} disabled={capturing || busy} />
          <TakesPanel takes={takes} checks={checks} selectedId={take?.id ?? null} onSelect={setSelectedId} />
        </div>
      </div>
    </>
  )
}
