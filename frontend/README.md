# Frontend

Vite + React + TypeScript, routed with React Router. See the root README for how to run it, and [PAGES.md](PAGES.md) for the user flow and what each page still needs.

| Path | What it does |
| --- | --- |
| `src/App.tsx` | The route table, nothing else |
| `src/pages/` | One `.tsx` and one `.css` per page: Login, Home, Single player, Duel, Results, Profile, Leaderboard |
| `src/components/` | Shared pieces: the app shell, recorder panels (`recorder.css`) and small UI parts |
| `src/index.css` | Design tokens and shared styles: buttons, cards, figures, tables, pills |
| `src/sampleData.ts` | Placeholder content for the stub pages |
| `src/dogs.ts` | The eight dogs and their voices, the player's pick (`useDog`), sprite URLs |
| `src/components/DogSprite.tsx` | A pixel dog at a whole-number scale, idle or barking |
| `src/sfx.ts` | Synthesized barks (a gruff click bark, each dog's own voice), duel hits and jingles, the mute setting; silent while the mic is open |
| `src/pawTrail.ts` | Paw prints behind the mouse |
| `src/maps.ts`, `src/components/Backdrop.tsx` | Duel stages (sidewalk, dog park, vet, Petco, playground), drawn in CSS |
| `src/components/FaceCutout.tsx` | The player's face from the camera, pixelated, for the dog's head |
| `src/components/Root.tsx` | Wraps every route: click barks, paw trail, sprite preload |
| `src/useDuel.ts`, `src/duelApi.ts` | Duel client: queue, polling, server clock sync, round uploads |
| `src/player.ts` | Guest duel identity (per tab) and display name |
| `scripts/sprites.mjs` | Draws the dogs and paw cursors into `public/sprites/` (`node scripts/sprites.mjs`) |
| `src/useBarkRecorder.ts` | Mic capture: raw constraints, MediaRecorder, live levels, countdown, calibration |
| `src/useHeadGuide.ts` | Webcam distance check: face detection and per-take position verdicts |
| `src/usePlaybackCursor.ts` | Follows audio playback for the cursor on the level trace |
| `src/score.ts` | Sends a take to the local scoring server |
| `src/audio.ts` | Analysis of a recorded take: level trace, peak, clipping, loudest 400 ms |
| `src/loudness.ts` | BS.1770 K-weighting and gated loudness, ported from pyloudnorm |
| `src/calibration.ts` | Calibration measurement, `calibration.json` export, browser storage |
| `src/format.ts` | Number and file name formatting |

`npm run build` type-checks and builds; `npm run lint` runs oxlint.
