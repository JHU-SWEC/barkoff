# Frontend

Vite + React + TypeScript, routed with React Router. See the root README for how to run it, and [PAGES.md](PAGES.md) for the user flow and what each page still needs.

| Path | What it does |
| --- | --- |
| `src/App.tsx` | The route table, nothing else |
| `src/pages/` | One `.tsx` and one `.css` per page: Login, Home, Single player, Duel, Results, Profile, Leaderboard |
| `src/components/` | Shared pieces: the app shell, recorder panels (`recorder.css`) and small UI parts |
| `src/index.css` | Design tokens and shared styles: buttons, cards, figures, tables, pills |
| `src/sampleData.ts` | Placeholder content for the stub pages |
| `src/useBarkRecorder.ts` | Mic capture: raw constraints, MediaRecorder, live levels, countdown, calibration |
| `src/useHeadGuide.ts` | Webcam distance check: face detection and per-take position verdicts |
| `src/usePlaybackCursor.ts` | Follows audio playback for the cursor on the level trace |
| `src/score.ts` | Sends a take to the local scoring server |
| `src/audio.ts` | Analysis of a recorded take: level trace, peak, clipping, loudest 400 ms |
| `src/loudness.ts` | BS.1770 K-weighting and gated loudness, ported from pyloudnorm |
| `src/calibration.ts` | Calibration measurement, `calibration.json` export, browser storage |
| `src/format.ts` | Number and file name formatting |

`npm run build` type-checks and builds; `npm run lint` runs oxlint.
