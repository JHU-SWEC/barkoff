"""Global leaderboard table, kept in sync with users (and solo bests).

A separate `leaderboard` row per account so the rankings page doesn't join
ad-hoc every time, and so Elo/name/best bark stay queryable in one place.
GET /api/leaderboard is public (no sign-in).
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import accounts


def upsert_user(conn, user_id, display_name: str, elo: int, wins: int, losses: int) -> None:
    """Insert or refresh the ranking row for one account (keeps best_solo_score)."""
    conn.execute(
        """
        INSERT INTO leaderboard (user_id, display_name, elo, wins, losses, updated_at)
        VALUES (%s, %s, %s, %s, %s, now())
        ON CONFLICT (user_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            elo = EXCLUDED.elo,
            wins = EXCLUDED.wins,
            losses = EXCLUDED.losses,
            updated_at = now()
        """,
        (user_id, display_name, elo, wins, losses),
    )


def set_best_solo(conn, user_id, score: float) -> None:
    """Raise best_solo_score when a better solo clip is saved."""
    conn.execute(
        """
        UPDATE leaderboard
        SET best_solo_score = GREATEST(COALESCE(best_solo_score, 0), %s),
            updated_at = now()
        WHERE user_id = %s
        """,
        (score, user_id),
    )


def sync_all(conn) -> None:
    """Make sure every user has a leaderboard row (for DBs created before this table)."""
    conn.execute(
        """
        INSERT INTO leaderboard (user_id, display_name, elo, wins, losses, best_solo_score, updated_at)
        SELECT u.id, u.display_name, u.elo, u.wins, u.losses, s.score, now()
        FROM users u
        LEFT JOIN solo_bests s ON s.user_id = u.id
        ON CONFLICT (user_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            elo = EXCLUDED.elo,
            wins = EXCLUDED.wins,
            losses = EXCLUDED.losses,
            best_solo_score = COALESCE(EXCLUDED.best_solo_score, leaderboard.best_solo_score),
            updated_at = now()
        """
    )


def list_entries(limit: int = 50) -> list[dict]:
    with accounts.connect() as conn:
        sync_all(conn)
        rows = conn.execute(
            """
            SELECT user_id, display_name, elo, wins, losses, best_solo_score
            FROM leaderboard
            ORDER BY elo DESC, best_solo_score DESC NULLS LAST, display_name ASC
            LIMIT %s
            """,
            (limit,),
        ).fetchall()
        conn.commit()
    return [
        {
            "userId": str(user_id),
            "displayName": display_name,
            "elo": elo,
            "wins": wins,
            "losses": losses,
            "bestBark": best_solo if best_solo is not None else None,
        }
        for user_id, display_name, elo, wins, losses, best_solo in rows
    ]


def handle(handler: BaseHTTPRequestHandler) -> None:
    try:
        query = parse_qs(urlparse(handler.path).query)
        try:
            limit = min(max(int((query.get("limit") or ["50"])[0]), 1), 100)
        except ValueError as err:
            raise accounts.AccountError(400, "limit must be an integer.") from err
        handler._send_json(200, {"players": list_entries(limit)})
    except accounts.AccountError as err:
        handler._send_json(err.status, {"error": err.message})
    except Exception as err:
        handler._send_json(500, {"error": str(err)})
