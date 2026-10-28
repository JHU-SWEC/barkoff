# Bark Off

Bark Off is a browser game where players bark into their microphone and are scored on two things: how loud the bark is and how much it sounds like a real dog. Players compete solo for a personal best or head-to-head in ranked duels, with an Elo rating and a global leaderboard.

## Core features

- Accounts (email + Google/Apple sign-in), display name
- Mic setup and calibration check
- Single player: 1 bark per run, 15 seconds, best score saved
- Ranked duel: 1v1, best bark in 15 seconds
- Matchmaking queue by Elo
- Elo rating with win/loss history
- Global leaderboard (Elo)
- Bark replay of your own rounds
- Anti-cheat (liveness, clipping, replay detection)
- Unranked play with friends via invite link

## User flow

Open site → mic check (allow mic, calibrate) → sign in → home (pick a mode)

- **Solo:** single player → scores shown (loud + dog-like) → personal best / solo leaderboard
- **Ranked duel:** ranked queue (matched by Elo) → match found (synced countdown) → best of 3 rounds (both bark at once) → Elo updated / global leaderboard

## Round workflow (ranked duel)

1. Both clients get a shared start time from the server and show a 3-2-1 countdown.
2. A random on-screen cue ("BARK!") appears; both players bark within the 3-second window.
3. Each client uploads its clip; the server scores both and pushes the round result to both players.
4. Scores, loudness and dog-likeness bars are shown side by side, then the next round starts.
5. After the deciding round, the server updates Elo for both players and shows the rating change.

## Scoring

**Bark score = 0.7 × Loudness + 0.3 × Likeness**

- **Loudness:** peak short-term loudness (LUFS over a 400 ms window) rather than raw peak, so a single click or mic bump doesn't count. Each player does a 5-second calibration at setup (a normal speaking line and silence); loudness is scored relative to that baseline and room noise, capped to a sane range.
- **Dog-likeness:** a pretrained audio classifier (YAMNet, trained on AudioSet, which has "Dog" and "Bark" classes) is the v1 model; likeness is its bark probability, smoothed over the bark window. A similarity term compares the bark's embedding to a reference set of real dog barks (cosine similarity), so barks get credit for sounding like a dog, not just triggering the label.

## Architecture

One app server runs the game; scoring is its own service.

| Component | Role |
| --- | --- |
| Web client | Mic capture, countdown, game UI |
| API + realtime server | Auth, duels, Elo, leaderboard (REST + WebSocket) |
| Matchmaker worker | Pairs the queue by Elo every 1 s, widening the window while waiting |
| Scoring service | Loudness + dog score, anti-cheat checks |
| Audio storage | Clips kept 30 days |
| PostgreSQL | Users, matches, rounds; source of truth |
| Redis | Queue, leaderboard, match events pub/sub |

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js (React, TypeScript), Tailwind |
| Audio capture | Web Audio API + AudioWorklet, Opus upload |
| Realtime | WebSockets |
| API | Node.js + TypeScript (Fastify) |
| Scoring | Python, FastAPI, YAMNet (TensorFlow Lite), pyloudnorm |
| Database | PostgreSQL |
| Queue + cache | Redis |
| Audio files | S3-compatible object storage |
| Auth | Managed auth (e.g. Clerk, Auth0 or Supabase Auth) |
| Hosting | Containers (e.g. Fly.io, Render or AWS ECS) |
| Monitoring | Sentry, OpenTelemetry + Grafana |

## Current milestone

A website running locally that can record a bark in the browser, then run it through the scorer from the command line to get back a loudness number, a bark probability, and a combined score. Login, accounts, queues and server integration come later.

- `frontend/`: Vite + React recorder page (record, playback, download, live level meter)
- Scorer: `score.py bark.webm`, which decodes with FFmpeg and prints loudness, likeness and the final score

## Running the frontend

Requires Node.js 20+.

```sh
cd frontend
npm install
npm run dev
```

Open the printed localhost URL, allow microphone access, and press **Record**. Auto-gain, noise suppression and echo cancellation are turned off so the scorer gets the raw signal; the "Microphone" panel shows what the browser actually applied. Chrome and Firefox record `.webm` (Opus); Safari records `.m4a` (AAC).

- **Calibrate:** two seconds of silence, then read one line at a normal volume. The page measures room noise and your speaking voice in LUFS and keeps them in this browser; **Download JSON** saves `calibration.json` for the scorer. Each take then shows how far its loudest 400 ms rose above your voice.
- **Countdown:** 3-2-1, a random pause, then **BARK!** Recording starts on the cue, like a duel round. Stop during the countdown cancels.
- **Loudest 400 ms** is K-weighted LUFS using pyloudnorm's filters and math, so it is directly comparable to loudness the scorer computes with pyloudnorm.
