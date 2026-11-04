import type { CameraStatus, Fit } from '../useHeadGuide'

const FIT_PROMPT: Record<Fit, string> = {
  none: 'Can’t see your face',
  close: 'Too close. Sit back from the mic',
  far: 'Too far. Come a little closer',
  'off-centre': 'Move into the middle of the outline',
  ok: 'In position',
}

export function CameraPanel({
  status,
  error,
  fit,
  attachVideo,
  onStart,
  onStop,
  disabled,
}: {
  status: CameraStatus
  error: string | null
  fit: Fit
  attachVideo: (el: HTMLVideoElement | null) => void
  onStart: () => void
  onStop: () => void
  disabled: boolean
}) {
  const on = status === 'on'
  return (
    <section className="card camera-card" aria-labelledby="camera-heading">
      <div className="card-head">
        <h2 id="camera-heading">Position</h2>
      </div>
      <div className="camera" data-fit={on ? fit : 'off'}>
        {on && <video ref={attachVideo} muted playsInline aria-label="Your camera" />}
        {/* Head and shoulders: the head fits a face at the target distance (see useHeadGuide). */}
        <svg className="camera-outline" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
          <ellipse cx="200" cy="118" rx="58" ry="74" />
          <path d="M174 186c0 14-4 26-22 33-60 18-104 34-128 81M226 186c0 14 4 26 22 33 60 18 104 34 128 81" />
        </svg>
        <p className="camera-prompt" aria-live="polite">
          {on
            ? FIT_PROMPT[fit]
            : status === 'starting'
              ? 'Starting the camera…'
              : 'Camera is off'}
        </p>
      </div>
      {error ? (
        <p className="score-error camera-note" role="alert">
          {error}
        </p>
      ) : (
        <p className="quiet camera-note">
          Keep your head and shoulders in the outline while you bark. Takes recorded too close to the mic can’t be
          scored. Video never leaves this browser.
        </p>
      )}
      <div className="card-actions">
        <button
          className="button button-secondary"
          onClick={on ? onStop : onStart}
          disabled={disabled || status === 'starting'}
        >
          {on ? 'Turn off camera' : 'Turn on camera'}
        </button>
      </div>
    </section>
  )
}
