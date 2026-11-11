-- Apply on a database that already ran schema.sql before clips existed.
-- Fresh installs get this from schema.sql and can skip this file.

CREATE TABLE IF NOT EXISTS clips (
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

CREATE INDEX IF NOT EXISTS clips_user_score ON clips (user_id, kind, score DESC);

ALTER TABLE solo_bests
    ADD COLUMN IF NOT EXISTS clip_id uuid REFERENCES clips (id) ON DELETE SET NULL;
