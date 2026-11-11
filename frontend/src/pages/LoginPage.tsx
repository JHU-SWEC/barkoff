import { Link } from 'react-router'
import { DogSprite } from '../components/DogSprite'
import { StubNote } from '../components/StubNote'
import { dogById } from '../dogs'
import './LoginPage.css'

export default function LoginPage() {
  return (
    <main className="login">
      <title>Sign in · Bark Off</title>
      <div className="login-poster on-ink">
        {/* The pack, mid-bark. */}
        <div className="login-pack" aria-hidden="true">
          {['corgi', 'husky', 'pug', 'beagle'].map((id, i) => (
            <DogSprite key={id} dog={dogById(id)} scale={2} barking={i % 2 === 0} flip={i % 2 === 1} />
          ))}
        </div>
        <p className="login-wordmark">
          Bark
          <br />
          Off
        </p>
        <p className="login-tagline">Loudest, doggiest bark wins.</p>
      </div>

      <div className="login-panel">
        <div className="login-form">
          <h1>Sign in</h1>
          <StubNote>Accounts aren’t connected yet, so you can only continue as a guest.</StubNote>

          <fieldset className="login-fields" disabled>
            <legend className="visually-hidden">Sign-in options</legend>
            <label className="field">
              <span>Email</span>
              <input type="email" autoComplete="email" placeholder="you@example.com" />
            </label>
            <button className="button button-primary">Continue with email</button>
            <p className="login-or">or</p>
            <button className="button button-secondary">Continue with Google</button>
            <button className="button button-secondary">Continue with Apple</button>
          </fieldset>

          <Link className="button button-primary login-guest" to="/">
            Continue as guest
          </Link>
        </div>
      </div>
    </main>
  )
}
