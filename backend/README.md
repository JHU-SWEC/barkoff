# Backend: scoring, benchmark and tests

| File | What it does |
| --- | --- |
| `score.py` | Scores a clip: loudness, likeness and the combined score |
| `loudness.py` | Short-term loudness (BS.1770, 400 ms) scored against the player's calibration |
| `likeness.py` | YAMNet dog-likeness (see [README_likeness.md](README_likeness.md)) |
| `audio_io.py` | `load_audio(path)`: WAV directly, anything else through FFmpeg |
| `server.py` | Local HTTP server: scores a take, and signs players in (`accounts.py`) |
| `accounts.py` | Email accounts and session cookies. Needs `DATABASE_URL` and Postgres (`docker compose up -d` from the repo root) |
| `db/schema.sql` | Users, sessions, and the tables duels and solo barks will fill in |
| `benchmark/` | Labelled clips and the likeness report |
| `tests/` | pytest suite |

## Setup

Python 3.10 to 3.14, and FFmpeg for `.webm`/`.m4a` files (Mac: `brew install ffmpeg`).

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Score a take

```bash
python score.py bark.webm
python score.py bark.webm --calibration calibration.json   # from the recorder page's Calibration panel
python score.py bark.webm --json
```

```
Decoded 5.00 s at 48000 Hz
Loudness   -25.0 LUFS, +2.5 LU over your speaking voice  ->  0.50
Likeness  0.61  (YAMNet bark probability)
Score     0.59  (0.2 x loudness + 0.8 x likeness)
```

Loudness is the loudest 400 ms window, so a click or mic bump can't count.
It scores 0 at 10 LU under your speaking voice and 1 at 15 LU over it, and
0 if the take barely clears the room noise. Without a calibration file it
assumes a typical speaking voice (-30 LUFS). These constants and the 0.2/0.8
weights are provisional, at the top of `loudness.py` and `score.py`.

## Benchmark likeness

```bash
python -m benchmark.download                # once: 280 labelled clips into ~/.cache/barkoff
python -m benchmark.likeness_report         # the current scorer
python -m benchmark.likeness_report --scorer my_module:my_function   # a candidate
```

The clips are 1 s WAVs from
[rmarcosg/bark-detection](https://huggingface.co/datasets/rmarcosg/bark-detection)
(Apache 2.0): 82 barks and 198 other household sounds. The report covers
separation (AUC, false alarms), the spread of real-bark scores, and how the
score holds up when the same bark moves within a 5 s take, gets quieter, or
gets noisier. Paste it into your PR.

Baseline, `likeness.bark_probability` on 2026-11-03:

| Measure | Result |
| --- | --- |
| AUC, barks vs non-barks | 0.943 |
| False alarms at 0.5 | 0.5% |
| Real barks scoring under 0.2 | 38% (median 0.36) |
| Strong bark at 0 s / 2 s / 4 s of a take | 0.67 / 0.77 / 0.71 (alone: 0.84) |
| Same bark at x1 / x0.1 / x0.02 volume | 0.84 / 0.70 / 0.35 |
| Same bark at 20 / 10 dB signal-to-noise | 0.60 / 0.28 |

## Tests

```bash
python -m pytest
```

- `test_loudness.py`: known BS.1770 levels, the 400 ms window, the calibration mapping.
- `test_loudness_parity.py`: runs the recorder page's `loudness.ts` in Node
  (22.6+) on the same audio and checks both sides agree within 0.1 LU.
- `test_likeness.py`: behaviour on real barks (needs the benchmark clips).
  Targets the current scorer misses are `xfail(strict=True)`: when a change
  fixes one, pytest fails it on purpose so the marker gets removed and the fix
  stays covered.
