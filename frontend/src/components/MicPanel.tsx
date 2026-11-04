import type { MicInfo } from '../useBarkRecorder'
import { Figure } from './Figure'

// Some browsers report these as strings ("all", "remote-only"); anything but `false` counts as on.
function isOn(value: unknown): boolean | undefined {
  return value === undefined ? undefined : value !== false
}

export function MicPanel({ mic }: { mic: MicInfo | null }) {
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
