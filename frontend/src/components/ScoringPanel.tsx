import { takeFileName } from '../format'
import type { Take } from '../useBarkRecorder'

export function ScoringPanel({ take }: { take: Take | null }) {
  const file = take ? takeFileName(take) : 'bark.webm'
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
          <dd className="num">0.2 × loudness + 0.8 × likeness</dd>
        </div>
      </dl>
    </section>
  )
}
