# Frontend

Vite + React + TypeScript recorder page. See the root README for how to run it.

| File | What it does |
| --- | --- |
| `src/App.tsx` | The page: record controls, level card, takes, microphone, calibration and scoring panels |
| `src/useBarkRecorder.ts` | Mic capture: raw constraints, MediaRecorder, live levels, countdown, calibration |
| `src/audio.ts` | Analysis of a recorded take: level trace, peak, clipping, loudest 400 ms |
| `src/loudness.ts` | BS.1770 K-weighting and gated loudness, ported from pyloudnorm |
| `src/calibration.ts` | Calibration measurement, `calibration.json` export, browser storage |
| `src/LevelTrace.tsx` | SVG level chart |
| `src/format.ts` | Number formatting |

`npm run build` type-checks and builds; `npm run lint` runs oxlint.
