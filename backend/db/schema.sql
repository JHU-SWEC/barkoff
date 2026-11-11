-- Bark Off accounts and clips. Apply on an empty database (Docker does this on first start).
-- The API writes users, sessions, and clips. Match tables are the shape of data
-- duels will collect; nothing inserts into them yet.

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    display_name text NOT NULL,
    elo integer NOT NULL DEFAULT 1000,
    wins integer NOT NULL DEFAULT 0,
    losses integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_display_name_len CHECK (char_length(display_name) BETWEEN 2 AND 24),
    CONSTRAINT users_elo_nonnegative CHECK (elo >= 0),
    CONSTRAINT users_record_nonnegative CHECK (wins >= 0 AND losses >= 0)
);

CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id ON sessions (user_id);

-- Bark audio lives in object storage (local disk today). This row is the index.
CREATE TABLE clips (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind text NOT NULL DEFAULT 'solo',
    storage_key text NOT NULL UNIQUE,
    content_type text NOT NULL,
    byte_size integer NOT NULL,
    duration_s real,
    score real NOT NULL,
    loudness real NOT NULL,
    likeness real NOT NULL,
    loudness_lufs real,
    over_speech_lu real,
    calibrated boolean NOT NULL DEFAULT false,
    client_take_id integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CONSTRAINT clips_kind CHECK (kind IN ('solo', 'duel')),
    CONSTRAINT clips_byte_size CHECK (byte_size > 0)
);

CREATE INDEX clips_user_score ON clips (user_id, kind, score DESC);

-- Best solo bark for an account. Updated when a higher-scoring clip is uploaded.
CREATE TABLE solo_bests (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    score real NOT NULL,
    loudness real NOT NULL,
    likeness real NOT NULL,
    clip_id uuid REFERENCES clips (id) ON DELETE SET NULL,
    taken_at timestamptz NOT NULL DEFAULT now()
);

-- Rankings snapshot for every account. Synced on register, profile edit, and solo bests.
CREATE TABLE leaderboard (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    display_name text NOT NULL,
    elo integer NOT NULL DEFAULT 1000,
    wins integer NOT NULL DEFAULT 0,
    losses integer NOT NULL DEFAULT 0,
    best_solo_score real,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT leaderboard_elo_nonnegative CHECK (elo >= 0),
    CONSTRAINT leaderboard_record_nonnegative CHECK (wins >= 0 AND losses >= 0)
);

CREATE INDEX leaderboard_elo ON leaderboard (elo DESC, best_solo_score DESC NULLS LAST);

-- Mic check (room noise and speaking voice, LUFS). Still stored in the browser.
CREATE TABLE calibrations (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    noise_lufs real NOT NULL,
    speech_lufs real NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    player_a_id uuid NOT NULL REFERENCES users (id),
    player_b_id uuid NOT NULL REFERENCES users (id),
    winner_id uuid REFERENCES users (id),
    status text NOT NULL DEFAULT 'pending',
    elo_delta_a integer,
    elo_delta_b integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    CONSTRAINT matches_status CHECK (status IN ('pending', 'live', 'finished', 'abandoned')),
    CONSTRAINT matches_distinct_players CHECK (player_a_id <> player_b_id)
);

CREATE INDEX matches_player_a ON matches (player_a_id, created_at DESC);
CREATE INDEX matches_player_b ON matches (player_b_id, created_at DESC);

CREATE TABLE rounds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    round_index smallint NOT NULL,
    score_a real,
    loudness_a real,
    likeness_a real,
    score_b real,
    loudness_b real,
    likeness_b real,
    CONSTRAINT rounds_index CHECK (round_index BETWEEN 1 AND 3),
    CONSTRAINT rounds_one_per_index UNIQUE (match_id, round_index)
);
