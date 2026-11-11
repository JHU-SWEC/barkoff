import { calibrationJson, type Calibration } from '../calibration'
import { formatDb, formatDelta, formatStamp } from '../format'
import type { MicInfo } from '../useBarkRecorder'
import { Figure } from './Figure'

export function CalibrationPanel({
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
    <section id="calibration" className="card calibration-card" aria-labelledby="calibration-heading">
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
        <button className="button button-secondary" data-sfx="off" onClick={onCalibrate} disabled={disabled}>
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
