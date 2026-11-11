"""Upload and replay bark clips.

Audio bytes go through storage.get_storage() (local files today). Postgres
holds metadata and the storage key. Sign-in is required so clips attach to
an account; guests keep scores in the browser only.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import accounts
from storage import get_storage

CLIP_DAYS = 30
MAX_AUDIO_BYTES = 12 * 1024 * 1024
MAX_META_BYTES = 16 * 1024
META_HEADER = "X-Barkoff-Meta"

ALLOWED_TYPES = {
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
}

_CLIP_COLUMNS = """
    id, user_id, kind, storage_key, content_type, byte_size, duration_s,
    score, loudness, likeness, loudness_lufs, over_speech_lu, calibrated,
    client_take_id, created_at, expires_at
"""


class ClipError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _clip_json(row: tuple) -> dict:
    (
        clip_id,
        user_id,
        kind,
        storage_key,
        content_type,
        byte_size,
        duration_s,
        score,
        loudness,
        likeness,
        loudness_lufs,
        over_speech_lu,
        calibrated,
        client_take_id,
        created_at,
        expires_at,
    ) = row
    return {
        "id": str(clip_id),
        "userId": str(user_id),
        "kind": kind,
        "contentType": content_type,
        "byteSize": byte_size,
        "durationS": duration_s,
        "score": score,
        "loudness": loudness,
        "likeness": likeness,
        "loudnessLufs": loudness_lufs,
        "overSpeechLu": over_speech_lu,
        "calibrated": calibrated,
        "clientTakeId": client_take_id,
        "createdAt": created_at.isoformat(),
        "expiresAt": expires_at.isoformat(),
        "audioUrl": f"/api/clips/{clip_id}/audio",
        # storage_key stays server-side; the browser only needs audioUrl.
        "_storageKey": storage_key,
    }


def _public_clip(row: tuple) -> dict:
    body = _clip_json(row)
    body.pop("_storageKey", None)
    return body


def _float(meta: dict, key: str) -> float:
    try:
        return float(meta[key])
    except (KeyError, TypeError, ValueError) as err:
        raise ClipError(400, f"meta.{key} must be a number.") from err


def _parse_meta(handler: BaseHTTPRequestHandler) -> dict:
    raw = handler.headers.get(META_HEADER, "")
    if not raw:
        raise ClipError(400, f"Send clip metadata in the {META_HEADER} header.")
    if len(raw.encode()) > MAX_META_BYTES:
        raise ClipError(400, "Clip metadata is too large.")
    try:
        meta = json.loads(raw)
    except json.JSONDecodeError as err:
        raise ClipError(400, "Clip metadata must be JSON.") from err
    if not isinstance(meta, dict):
        raise ClipError(400, "Clip metadata must be a JSON object.")
    return meta


def _content_type(handler: BaseHTTPRequestHandler, meta: dict) -> str:
    declared = (meta.get("contentType") or handler.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if declared not in ALLOWED_TYPES:
        raise ClipError(400, f"Unsupported audio type {declared!r}. Use webm, m4a, ogg, or wav.")
    return declared


def create_clip(handler: BaseHTTPRequestHandler) -> dict:
    user = accounts.require_user(accounts.session_token(handler))
    meta = _parse_meta(handler)
    content_type = _content_type(handler, meta)
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError as err:
        raise ClipError(400, "Content-Length must be an integer.") from err
    if length <= 0 or length > MAX_AUDIO_BYTES:
        raise ClipError(400, "Audio body must be between 1 byte and 12 MB.")

    kind = str(meta.get("kind") or "solo")
    if kind not in ("solo", "duel"):
        raise ClipError(400, "kind must be solo or duel.")

    score = _float(meta, "score")
    loudness = _float(meta, "loudness")
    likeness = _float(meta, "likeness")
    loudness_lufs = float(meta["loudnessLufs"]) if meta.get("loudnessLufs") is not None else None
    over_speech_lu = float(meta["overSpeechLu"]) if meta.get("overSpeechLu") is not None else None
    duration_s = float(meta["durationS"]) if meta.get("durationS") is not None else None
    calibrated = bool(meta.get("calibrated", False))
    client_take_id = meta.get("clientTakeId")
    if client_take_id is not None:
        try:
            client_take_id = int(client_take_id)
        except (TypeError, ValueError) as err:
            raise ClipError(400, "clientTakeId must be an integer.") from err

    audio = handler.rfile.read(length)
    if len(audio) != length:
        raise ClipError(400, "Body shorter than Content-Length.")

    clip_id = uuid.uuid4()
    ext = ALLOWED_TYPES[content_type]
    storage_key = f"{user['id']}/{clip_id}.{ext}"
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=CLIP_DAYS)

    storage = get_storage()
    storage.put(storage_key, audio, content_type)

    try:
        with accounts.connect() as conn:
            row = conn.execute(
                f"""
                INSERT INTO clips (
                    id, user_id, kind, storage_key, content_type, byte_size, duration_s,
                    score, loudness, likeness, loudness_lufs, over_speech_lu, calibrated,
                    client_take_id, created_at, expires_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s
                )
                RETURNING {_CLIP_COLUMNS}
                """,
                (
                    clip_id,
                    user["id"],
                    kind,
                    storage_key,
                    content_type,
                    length,
                    duration_s,
                    score,
                    loudness,
                    likeness,
                    loudness_lufs,
                    over_speech_lu,
                    calibrated,
                    client_take_id,
                    now,
                    expires,
                ),
            ).fetchone()
            if kind == "solo":
                conn.execute(
                    """
                    INSERT INTO solo_bests (user_id, score, loudness, likeness, clip_id, taken_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                        score = EXCLUDED.score,
                        loudness = EXCLUDED.loudness,
                        likeness = EXCLUDED.likeness,
                        clip_id = EXCLUDED.clip_id,
                        taken_at = EXCLUDED.taken_at
                    WHERE solo_bests.score < EXCLUDED.score
                    """,
                    (user["id"], score, loudness, likeness, clip_id, now),
                )
            conn.commit()
    except accounts.AccountError:
        storage.delete(storage_key)
        raise
    except Exception:
        storage.delete(storage_key)
        raise

    return _public_clip(row)


def list_clips(handler: BaseHTTPRequestHandler) -> dict:
    user = accounts.require_user(accounts.session_token(handler))
    query = parse_qs(urlparse(handler.path).query)
    kind = (query.get("kind") or ["solo"])[0]
    if kind not in ("solo", "duel"):
        raise ClipError(400, "kind must be solo or duel.")
    try:
        limit = min(max(int((query.get("limit") or ["10"])[0]), 1), 50)
    except ValueError as err:
        raise ClipError(400, "limit must be an integer.") from err

    with accounts.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT {_CLIP_COLUMNS}
            FROM clips
            WHERE user_id = %s AND kind = %s AND expires_at > now()
            ORDER BY score DESC, created_at DESC
            LIMIT %s
            """,
            (user["id"], kind, limit),
        ).fetchall()
    return {"clips": [_public_clip(row) for row in rows]}


def get_clip_meta(handler: BaseHTTPRequestHandler, clip_id: str) -> dict:
    user = accounts.require_user(accounts.session_token(handler))
    row = _owned_clip(user["id"], clip_id)
    return _public_clip(row)


def get_clip_audio(handler: BaseHTTPRequestHandler, clip_id: str) -> tuple[bytes, str]:
    user = accounts.require_user(accounts.session_token(handler))
    row = _owned_clip(user["id"], clip_id)
    storage_key = row[3]
    try:
        return get_storage().open(storage_key)
    except FileNotFoundError as err:
        raise ClipError(404, "Audio file is missing from storage.") from err


_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


def _owned_clip(user_id: str, clip_id: str) -> tuple:
    if not _UUID.fullmatch(clip_id):
        raise ClipError(404, "Clip not found.")
    with accounts.connect() as conn:
        row = conn.execute(
            f"""
            SELECT {_CLIP_COLUMNS}
            FROM clips
            WHERE id = %s AND user_id = %s AND expires_at > now()
            """,
            (clip_id, user_id),
        ).fetchone()
    if row is None:
        raise ClipError(404, "Clip not found.")
    return row


def handle(handler: BaseHTTPRequestHandler, method: str) -> None:
    """Dispatch clip routes. Audio responses use handler._send_bytes."""
    path = urlparse(handler.path).path
    try:
        if method == "POST" and path == "/api/clips":
            handler._send_json(201, {"clip": create_clip(handler)})
            return
        if method == "GET" and path == "/api/clips":
            handler._send_json(200, list_clips(handler))
            return
        audio = re.fullmatch(r"/api/clips/([^/]+)/audio", path)
        if method == "GET" and audio:
            data, content_type = get_clip_audio(handler, audio.group(1))
            handler._send_bytes(200, data, content_type)
            return
        meta = re.fullmatch(r"/api/clips/([^/]+)", path)
        if method == "GET" and meta:
            handler._send_json(200, {"clip": get_clip_meta(handler, meta.group(1))})
            return
        handler._send_json(404, {"error": "Not found"})
    except ClipError as err:
        handler._send_json(err.status, {"error": err.message})
    except accounts.AccountError as err:
        handler._send_json(err.status, {"error": err.message})
    except NotImplementedError as err:
        handler._send_json(501, {"error": str(err)})
    except Exception as err:
        handler._send_json(500, {"error": str(err)})
