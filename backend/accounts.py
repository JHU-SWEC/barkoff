"""Email accounts stored in Postgres.

The browser never talks to the database. It calls these routes on server.py,
which checks the password and sets an HttpOnly session cookie. DBeaver (or any
other SQL client) can read the same tables; it is an admin window, not the
way players sign in.

DATABASE_URL=postgresql://barkoff:barkoff@localhost:5432/barkoff
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler

try:
    import psycopg
    from psycopg import errors as pg_errors
except ImportError:  # scored takes still work if the driver was never installed
    psycopg = None
    pg_errors = None

# Imported lazily inside register/update to avoid a circular import at module load
# (leaderboard imports accounts.connect).

COOKIE = "barkoff_session"
SESSION_DAYS = 14
MAX_BODY = 8 * 1024
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# scrypt parameters stored beside the hash so they can change later.
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1


class AccountError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt_hex, digest_hex = stored.split("$")
        if kind != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(bytes.fromhex(digest_hex)),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, bytes.fromhex(digest_hex))


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise AccountError(
            503,
            "Accounts need Postgres. Start it with docker compose up -d, then set DATABASE_URL.",
        )
    if psycopg is None:
        raise AccountError(503, "Accounts need the psycopg package. pip install -r backend/requirements.txt")
    return url


def _connect():
    try:
        return psycopg.connect(_database_url())
    except AccountError:
        raise
    except Exception as err:
        raise AccountError(503, f"Could not reach Postgres: {err}") from err


def _user_json(row: tuple) -> dict:
    user_id, email, display_name, elo, wins, losses = row
    return {
        "id": str(user_id),
        "email": email,
        "displayName": display_name,
        "elo": elo,
        "wins": wins,
        "losses": losses,
        "bestSoloScore": None,
    }


_USER_COLUMNS = "id, email, display_name, elo, wins, losses"


def _clean_email(value: object) -> str:
    email = str(value or "").strip().lower()
    if not EMAIL_RE.fullmatch(email) or len(email) > 254:
        raise AccountError(400, "Enter a valid email address.")
    return email


def _clean_password(value: object) -> str:
    password = str(value or "")
    if len(password) < 8:
        raise AccountError(400, "Use at least 8 characters.")
    if len(password) > 200:
        raise AccountError(400, "That password is too long.")
    return password


def _clean_name(value: object) -> str:
    name = " ".join(str(value or "").split())
    if not 2 <= len(name) <= 24:
        raise AccountError(400, "Display name needs 2 to 24 characters.")
    return name


def _read_json(handler: BaseHTTPRequestHandler) -> dict:
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError as err:
        raise AccountError(400, "Content-Length must be an integer.") from err
    if length <= 0 or length > MAX_BODY:
        raise AccountError(400, "Send a JSON body under 8 KB.")
    try:
        body = json.loads(handler.rfile.read(length))
    except json.JSONDecodeError as err:
        raise AccountError(400, "Body must be JSON.") from err
    if not isinstance(body, dict):
        raise AccountError(400, "Body must be a JSON object.")
    return body


def _cookie(handler: BaseHTTPRequestHandler) -> str | None:
    raw = handler.headers.get("Cookie", "")
    for part in raw.split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE and value:
            return value
    return None


def _session_cookie(token: str) -> str:
    max_age = SESSION_DAYS * 24 * 60 * 60
    return f"{COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}"


def _clear_cookie() -> str:
    return f"{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def register(body: dict) -> tuple[dict, str]:
    email = _clean_email(body.get("email"))
    password = _clean_password(body.get("password"))
    display_name = _clean_name(body.get("displayName"))
    with _connect() as conn:
        try:
            row = conn.execute(
                f"""
                INSERT INTO users (email, password_hash, display_name)
                VALUES (%s, %s, %s)
                RETURNING {_USER_COLUMNS}
                """,
                (email, hash_password(password), display_name),
            ).fetchone()
        except pg_errors.UniqueViolation as err:
            raise AccountError(409, "An account with that email already exists.") from err
        import leaderboard as lb

        lb.upsert_user(conn, row[0], row[2], row[3], row[4], row[5])
        token = _start_session(conn, row[0])
        conn.commit()
    return _user_json(row), token


def login(body: dict) -> tuple[dict, str]:
    email = _clean_email(body.get("email"))
    password = str(body.get("password") or "")
    with _connect() as conn:
        row = conn.execute(
            f"SELECT {_USER_COLUMNS}, password_hash FROM users WHERE email = %s",
            (email,),
        ).fetchone()
        if row is None or not verify_password(password, row[-1]):
            raise AccountError(401, "Email or password is wrong.")
        token = _start_session(conn, row[0])
        conn.commit()
    account = current_user(token)
    if account is None:
        raise AccountError(500, "Session was created but could not be loaded.")
    return account, token


def _start_session(conn, user_id) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    conn.execute(
        "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (%s, %s, %s)",
        (user_id, _token_hash(token), expires),
    )
    return token


def session_token(handler: BaseHTTPRequestHandler) -> str | None:
    """Public wrapper so other route modules can read the session cookie."""
    return _cookie(handler)


def require_user(token: str | None) -> dict:
    user = current_user(token)
    if user is None:
        raise AccountError(401, "Sign in first.")
    return user


def connect():
    """Shared Postgres connection for account-backed features (clips, etc.)."""
    return _connect()


def current_user(token: str | None) -> dict | None:
    if not token:
        return None
    with _connect() as conn:
        row = conn.execute(
            f"""
            SELECT {_USER_COLUMNS}, solo_bests.score
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            LEFT JOIN solo_bests ON solo_bests.user_id = users.id
            WHERE sessions.token_hash = %s AND sessions.expires_at > now()
            """,
            (_token_hash(token),),
        ).fetchone()
    if row is None:
        return None
    account = _user_json(row[:-1])
    account["bestSoloScore"] = row[-1]
    return account


def logout(token: str | None) -> None:
    if not token:
        return
    with _connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = %s", (_token_hash(token),))
        conn.commit()


def update_profile(token: str | None, body: dict) -> dict:
    if not token:
        raise AccountError(401, "Sign in first.")
    display_name = _clean_name(body.get("displayName"))
    with _connect() as conn:
        row = conn.execute(
            f"""
            UPDATE users SET display_name = %s
            WHERE id = (
                SELECT user_id FROM sessions
                WHERE token_hash = %s AND expires_at > now()
            )
            RETURNING {_USER_COLUMNS}
            """,
            (display_name, _token_hash(token)),
        ).fetchone()
        if row is None:
            raise AccountError(401, "Sign in first.")
        import leaderboard as lb

        lb.upsert_user(conn, row[0], row[2], row[3], row[4], row[5])
        conn.commit()
    account = _user_json(row)
    # bestSoloScore is not in RETURNING; reload so the client stays consistent.
    return current_user(token) or account


def handle(handler: BaseHTTPRequestHandler, action: str) -> None:
    """Run one account route and write the JSON response on handler."""
    try:
        token = _cookie(handler)
        headers: dict[str, str] = {}
        if action == "me":
            body = {"account": current_user(token)}
            status = 200
        elif action == "logout":
            logout(token)
            body = {"ok": True}
            status = 200
            headers["Set-Cookie"] = _clear_cookie()
        else:
            payload = _read_json(handler)
            if action == "register":
                account, issued = register(payload)
            elif action == "login":
                account, issued = login(payload)
            elif action == "profile":
                account = update_profile(token, payload)
                issued = None
            else:
                raise AccountError(404, "Not found")
            body = {"account": account}
            status = 200
            if issued is not None:
                headers["Set-Cookie"] = _session_cookie(issued)
    except AccountError as err:
        status, body, headers = err.status, {"error": err.message}, {}
    handler._send_json(status, body, headers)
