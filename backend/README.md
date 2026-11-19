# Backend: scoring, benchmark and tests

| File | What it does |
| --- | --- |
| `score.py` | Scores a clip: loudness, likeness and the combined score |
| `loudness.py` | Short-term loudness (BS.1770, 400 ms) scored against the player's calibration |
| `likeness.py` | YAMNet dog-likeness (see [README_likeness.md](README_likeness.md)) |
| `audio_io.py` | `load_audio(path)`: WAV directly, anything else through FFmpeg |
| `server.py` | Starts everything: HTTP for the Score take button (same numbers as `score.py`) and the leaderboard, plus the duel socket |
| `realtime.py` | The duel socket: one asyncio game loop for every connection, the matchmaker and every duel |
| `scoring_worker.py` | The one scoring thread every take goes through, solo or duel |
| `duels.py` | Ranked duels: guest players, best-of-three rounds on the server clock, Elo at the end |
| `matchmaking.py` | The ranked queue: pairs players by Elo, widening the range the longer they wait |
| `elo.py` | Elo expectation and update (K = 32, start 1200) |
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

## Duels

`python server.py` also runs ranked duels for the Duel page, over a WebSocket
on port 8001 (Vite proxies `/ws` to it). The protocol is at the top of
`realtime.py`; the rules live in `duels.py`.

How the server is split up:

- **Game loop** (`realtime.py`): one asyncio event loop on one thread handles
  every socket, switching between them while each waits on the network. It
  owns the queue and all duel state, so nothing needs a lock. Every 0.2 s it
  applies the clock (deadlines, the bot's bark); every second it runs the
  matchmaker over the queue. Screens get a fresh duel view whenever the duel
  changes, and work out countdowns and the cue from the round times and a
  ping/pong-synced clock.
- **Scoring** (`scoring_worker.py`): one worker thread runs YAMNet and
  loudness. The loop hands a take over and awaits it, so a slow run never
  blocks other players. The TFLite interpreter isn't safe to share, so solo
  scores from `/api/score` queue on the same thread.
- **HTTP** (`server.py`): a thread per request. Handlers reach game state only
  through `hub.call`, which runs the call on the game loop.

Rules:

- **Queue.** Each player's Elo window starts at ±50 and widens 10 per second
  waited, up to ±400. Two players are paired when their gap fits inside both
  windows, longest-waiting first, closest rating wins. The server checks the
  queue every second and as soon as someone joins, and pushes the match to both.
- **Stage.** Picked when the duel is made (`STAGES`), so both screens' roulettes land on the same map.
- **Rounds.** The server sets each round's countdown start and a random BARK!
  cue 0.5 to 2 s after it. Both pages record the 5 s window and upload it; the
  server scores both with `score.py`. A camera foul or a take that never
  arrives scores 0. A take that arrived in time counts even if scoring it
  runs past the deadline. First to two round wins; a tie is replayed, five
  rounds at most.
- **Connections.** A dropped socket leaves the queue at once. Mid-duel, the
  player has 5 s to reconnect and pick the duel back up before it's forfeited.
  Player ids are public (opponents and the leaderboard see them), so each tab
  also keeps a secret that the first hello binds to its id: knowing someone's
  id isn't enough to act as them.
- **Limits.** Takes are at most 10 s. At most 8 HTTP scoring requests wait at
  once; more get a 503, so a flood of solo takes can't delay duel takes.
- **Elo** updates once, when the duel ends.

- **Practice vs bot** (the socket's `bot` message, easy, normal or hard): the same
  rounds against a bot that barks a score around its level. Unranked: no Elo,
  no record, and bots stay off the leaderboard.

Players and duels are in memory, so a restart resets ratings. Profiles will
own the player record.

## Tests

```bash
python -m pytest
```

- `test_loudness.py`: known BS.1770 levels, the 400 ms window, the calibration mapping.
- `test_loudness_parity.py`: runs the recorder page's `loudness.ts` in Node
  (22.6+) on the same audio and checks both sides agree within 0.1 LU.
- `test_matchmaking.py`, `test_duels.py`: Elo, the queue, and duel rounds on a fake clock.
- `test_realtime.py`: the duel socket on a fake clock: matchmaking pushes, rounds,
  scoring off the loop, reconnects and bad messages, plus one real socket round.
- `test_likeness.py`: behaviour on real barks (needs the benchmark clips).
  Targets the current scorer misses are `xfail(strict=True)`: when a change
  fixes one, pytest fails it on purpose so the marker gets removed and the fix
  stays covered.
