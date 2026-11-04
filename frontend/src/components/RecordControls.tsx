const LENGTHS_S = [3, 5, 10, 15]

interface Props {
  lengthS: number
  countdown: boolean
  locked: boolean
  live: boolean
  disabled: boolean
  label: string
  onLength: (s: number) => void
  onCountdown: (on: boolean) => void
  onPress: () => void
}

export function RecordControls({
  lengthS,
  countdown,
  locked,
  live,
  disabled,
  label,
  onLength,
  onCountdown,
  onPress,
}: Props) {
  return (
    <div className="actions">
      <fieldset className="segmented" disabled={locked}>
        <legend className="visually-hidden">Take length</legend>
        {LENGTHS_S.map((s) => (
          <label key={s}>
            <input type="radio" name="length" value={s} checked={lengthS === s} onChange={() => onLength(s)} />
            <span className="num">{s} s</span>
          </label>
        ))}
      </fieldset>
      <label className="toggle" title="3-2-1, then bark on the BARK! cue, like a duel round">
        <input
          type="checkbox"
          role="switch"
          checked={countdown}
          onChange={(e) => onCountdown(e.target.checked)}
          disabled={locked}
        />
        <span>Countdown</span>
      </label>
      <button className="button button-primary button-record" data-live={live} onClick={onPress} disabled={disabled}>
        {label}
      </button>
    </div>
  )
}
