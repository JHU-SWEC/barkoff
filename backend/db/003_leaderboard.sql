-- Apply if the DB already existed before the leaderboard table.
-- Fresh installs get this from schema.sql.

CREATE TABLE IF NOT EXISTS leaderboard (
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

CREATE INDEX IF NOT EXISTS leaderboard_elo ON leaderboard (elo DESC, best_solo_score DESC NULLS LAST);

INSERT INTO leaderboard (user_id, display_name, elo, wins, losses, best_solo_score, updated_at)
SELECT u.id, u.display_name, u.elo, u.wins, u.losses, s.score, now()
FROM users u
LEFT JOIN solo_bests s ON s.user_id = u.id
ON CONFLICT (user_id) DO NOTHING;
