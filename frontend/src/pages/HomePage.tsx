import { Link } from 'react-router'
import { CalibrationSummary } from '../components/CalibrationSummary'
import { DogSprite } from '../components/DogSprite'
import { DOGS, dogById, saveDog, useDog } from '../dogs'
import { playBark } from '../sfx'
import { useBarkFlash } from '../useBarkFlash'
import { loadSoloRecord } from '../soloResults'
import { SAMPLE_LEADERBOARD, SAMPLE_ME } from '../sampleData'
import './HomePage.css'

function DogPicker() {
  const dog = useDog()
  const [barking, flash] = useBarkFlash()

  const choose = (id: string) => {
    saveDog(id)
    playBark(dogById(id))
    flash()
  }

  return (
    <section className="card dog-picker" id="your-dog" aria-labelledby="dog-heading">
      <div className="dog-stage on-ink">
        <p className="kicker">Your fighter</p>
        <DogSprite dog={dog} barking={barking} scale={4} className="dog-idle" label={dog.name} />
        <div className="dog-plate">
          <p className="dog-plate-name">{dog.name}</p>
        </div>
      </div>
      <div className="dog-choices">
        <h2 id="dog-heading">Pick your dog</h2>
        <p className="quiet">Your dog fights for you in duels and shows next to your name. Saved in this browser.</p>
        {/* data-sfx off: choose() barks with the new dog, not the one the click started on. */}
        <fieldset className="dog-grid" data-sfx="off">
          <legend className="visually-hidden">Dog</legend>
          {DOGS.map((d) => (
            <label className="dog-option" key={d.id}>
              <input
                type="radio"
                name="dog"
                value={d.id}
                checked={dog.id === d.id}
                onChange={() => choose(d.id)}
                onClick={() => dog.id === d.id && choose(d.id)}
              />
              <DogSprite dog={d} scale={1.5} label={d.breed} />
              <span className="dog-option-name">{d.name}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </section>
  )
}

export default function HomePage() {
  const { best } = loadSoloRecord()
  const dog = useDog()
  return (
    <>
      <title>Bark Off</title>
      <div className="bone-field" aria-hidden="true" />
      <div className="page-header">
        <h1>Pick your fight</h1>
        <p className="subline">Bark into your mic. You’re scored on how loud you are and how much you sound like a dog.</p>
      </div>

      <div className="fight-card">
        <Link className="fight-side fight-solo" to="/solo">
          <span className="kicker">Single player</span>
          <span className="fight-title">Solo</span>
          <span className="fight-copy">One bark, one score. Keep going until you beat your best.</span>
          <span className="fight-cta">Start barking →</span>
          <DogSprite dog={dog} scale={3} className="fight-dog fight-dog-solo dog-idle" />
        </Link>
        <Link className="fight-side fight-duel" to="/duel">
          <span className="kicker">Ranked 1v1</span>
          <span className="fight-title">Duel</span>
          <span className="fight-copy">Best of three, same cue, same second. Elo on the line.</span>
          <span className="fight-cta">Find a match →</span>
          <span className="fight-dogs" aria-hidden="true">
            <DogSprite dog={dog} scale={2} />
            <DogSprite dog={dogById(dog.id === 'husky' ? 'golden' : 'husky')} scale={2} flip />
          </span>
        </Link>
        <span className="fight-vs" aria-hidden="true">
          VS
        </span>
      </div>

      <DogPicker />

      <div className="home-strip">
        <CalibrationSummary />

        <section className="card" aria-labelledby="record-heading">
          <div className="card-head">
            <h2 id="record-heading">Your record</h2>
            <span className="pill pill-warning">Elo is sample data</span>
          </div>
          <dl className="rows">
            <div className="row">
              <dt>Elo</dt>
              <dd className="num">{SAMPLE_ME.elo}</dd>
            </div>
            <div className="row">
              <dt>Wins – losses</dt>
              <dd className="num">
                {SAMPLE_ME.wins} – {SAMPLE_ME.losses}
              </dd>
            </div>
            <div className="row">
              <dt>Best solo bark</dt>
              <dd className="num">{best ? best.score.toFixed(2) : '—'}</dd>
            </div>
          </dl>
          <div className="card-actions">
            <Link className="button button-secondary" to="/profile">
              View profile
            </Link>
          </div>
        </section>

        <section className="card" aria-labelledby="top-heading">
          <div className="card-head">
            <h2 id="top-heading">Top dogs</h2>
            <span className="pill pill-warning">Sample data</span>
          </div>
          <ol className="rows top-dogs">
            {SAMPLE_LEADERBOARD.slice(0, 3).map((player, i) => (
              <li className="row" key={player.name}>
                <span>
                  <span className="top-rank num">{i + 1}</span> {player.name}
                </span>
                <span className="num">{player.elo}</span>
              </li>
            ))}
          </ol>
          <div className="card-actions">
            <Link className="button button-secondary" to="/leaderboard">
              Full leaderboard
            </Link>
          </div>
        </section>
      </div>
    </>
  )
}
