import { useState } from 'react'
import { Link } from 'react-router'
import { loadCalibration } from '../calibration'
import { formatDb, formatStamp } from '../format'

// The real calibration from this browser, for pages outside the recorder.
export function CalibrationSummary() {
  const [calibration] = useState(loadCalibration)

  return (
    <section className="card calibration-summary" aria-labelledby="calibration-summary-heading">
      <div className="card-head">
        <h2 id="calibration-summary-heading">Mic check</h2>
        {calibration ? (
          <span className="pill pill-info">Calibrated</span>
        ) : (
          <span className="pill pill-warning">Not calibrated</span>
        )}
      </div>
      {calibration ? (
        <dl className="rows">
          <div className="row">
            <dt>Room noise</dt>
            <dd className="num">{formatDb(calibration.noiseLufs)} LUFS</dd>
          </div>
          <div className="row">
            <dt>Speaking voice</dt>
            <dd className="num">{formatDb(calibration.speechLufs)} LUFS</dd>
          </div>
          <div className="row">
            <dt>Measured</dt>
            <dd className="num">{formatStamp(new Date(calibration.measuredAt))}</dd>
          </div>
        </dl>
      ) : (
        <p className="quiet">Five seconds of quiet and one spoken line, so loudness is scored against your own voice.</p>
      )}
      <div className="card-actions">
        <Link className="button button-secondary" to="/solo#calibration">
          {calibration ? 'Recalibrate' : 'Calibrate now'}
        </Link>
      </div>
    </section>
  )
}
