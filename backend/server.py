"""Tiny local HTTP server: scoring for the recorder, plus the ranked duel API.

Usage:
    python server.py            # listens on http://localhost:8000

POST /api/score?sr=48000[&noise_lufs=-58.2&speech_lufs=-27.5]
    Body: raw mono float32 little-endian samples in [-1, 1], at the take's
    own sample rate. Not resampled to 16 kHz: loudness weights the range
    above 8 kHz that a 16 kHz copy would drop. likeness.py resamples itself.
    The browser decodes the take itself, so no FFmpeg is needed.
    noise_lufs and speech_lufs are the player's calibration; without them
    loudness is scored against a typical speaking voice.
    Returns JSON: score.py's numbers plus the weights and the top YAMNet classes:
        {"score", "loudness", "likeness", "loudness_lufs", "over_speech_lu",
         "duration_s", "calibrated", "weights": {"loudness", "likeness"},
         "top": [{"name", "score"}, ...]}

Duels (see duels.py for the round timeline; all times are server epoch seconds,
and every duel response carries server_now so clients can sync their clocks):
    POST   /api/players                 {"id", "name", "dog"} -> player (guest, Elo 1200)
    POST   /api/queue?player_id=        join the ranked queue -> queue status
    GET    /api/queue?player_id=        poll ~1/s -> {"status": "waiting", "window", ...}
                                        or {"status": "matched", "duel_id"}
    DELETE /api/queue?player_id=        leave the queue
    POST   /api/duels/forfeit?player_id=   leave an unfinished duel (the opponent wins)
    POST   /api/duels/bot?player_id=&level=easy|normal|hard
                                        unranked practice duel against a bot -> {"duel_id"}
    GET    /api/duels/<id>?player_id=   the duel as that player sees it
    POST   /api/duels/<id>/rounds/<n>?player_id=&sr=&position=[&noise_lufs=&speech_lufs=]
                                        a round's take, same body as /api/score;
                                        position is the camera verdict ("ok" or a foul)
    GET    /api/leaderboard             players by Elo

Players and duels live in memory until profiles land, so a restart resets them.

Standard library only (plus likeness.py's own deps). Single-threaded on
purpose: the TFLite interpreter is shared and not safe to call concurrently,
and it keeps duel state free of locks.
"""

import json
import re
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

import likeness
import score as scorer
from duels import Arena, DuelError, bark_from_score
from loudness import Calibration

HOST = "localhost"
PORT = 8000

# 60 s of 48 kHz float32 is ~11.5 MB; anything bigger is not a bark take.
MAX_BODY_BYTES = 12 * 1024 * 1024
TOP_K = 5
PLAYER_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MAX_NAME = 24
DUEL_ROUND = re.compile(r"^/api/duels/([A-Za-z0-9_-]+)/rounds/(\d+)$")
DUEL = re.compile(r"^/api/duels/([A-Za-z0-9_-]+)$")

arena = Arena()


class BadRequest(Exception):
    pass


class NotFound(Exception):
    pass


def score(audio: np.ndarray, sr: int, calibration: Calibration | None) -> dict:
    """score.py's result for the take, plus the top YAMNet classes."""
    mean_scores = likeness.frame_scores(audio, sr).mean(axis=0)
    names = likeness.class_names()
    top = [
        {"name": names[i], "score": float(mean_scores[i])}
        for i in np.argsort(mean_scores)[::-1][:TOP_K]
    ]
    weights = {"loudness": scorer.LOUDNESS_WEIGHT, "likeness": scorer.LIKENESS_WEIGHT}
    return {**scorer.score(audio, sr, calibration), "weights": weights, "top": top}


def parse_calibration(query: dict) -> Calibration | None:
    """Both levels or neither; a half calibration is a client bug, not a default."""
    noise, speech = query.get("noise_lufs"), query.get("speech_lufs")
    if noise is None and speech is None:
        return None
    if noise is None or speech is None:
        raise ValueError("Send both noise_lufs and speech_lufs, or neither")
    return Calibration(float(noise[0]), float(speech[0]))


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: dict | list) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args) -> None:
        # Duel clients poll every second; only log what isn't a poll.
        if self.command != "GET":
            super().log_message(format, *args)

    def _handle(self, method: str) -> None:
        url = urlparse(self.path)
        query = parse_qs(url.query)
        try:
            self._send_json(200, self._route(method, url.path, query))
        except BadRequest as err:
            self._send_json(400, {"error": str(err)})
        except DuelError as err:
            self._send_json(409, {"error": str(err)})
        except NotFound as err:
            self._send_json(404, {"error": str(err)})
        except Exception as err:  # report model errors to the page instead of dropping the connection
            self._send_json(500, {"error": str(err)})

    def do_GET(self) -> None:
        self._handle("GET")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_DELETE(self) -> None:
        self._handle("DELETE")

    def _route(self, method: str, path: str, query: dict) -> dict | list:
        now = time.time()
        if path == "/api/score" and method == "POST":
            audio, sr = self._read_audio(query)
            return score(audio, sr, parse_calibration_or_400(query))
        if path == "/api/players" and method == "POST":
            body = self._read_json()
            player = arena.register(
                player_id(body.get("id")), player_name(body.get("name")), str(body.get("dog", "shiba"))[:24]
            )
            return player.public()
        if path == "/api/leaderboard" and method == "GET":
            return arena.leaderboard()
        if path == "/api/queue":
            pid = player_id(query.get("player_id", [None])[0])
            if method == "POST":
                return arena.join_queue(pid, now)
            if method == "GET":
                return arena.queue_status(pid, now)
            if method == "DELETE":
                arena.leave_queue(pid)
                return {"status": "idle"}
        if path == "/api/duels/forfeit" and method == "POST":
            arena.forfeit(player_id(query.get("player_id", [None])[0]), now)
            return {"status": "idle"}
        if path == "/api/duels/bot" and method == "POST":
            pid = player_id(query.get("player_id", [None])[0])
            return arena.start_bot_duel(pid, query.get("level", ["normal"])[0], now)
        if (m := DUEL.match(path)) and method == "GET":
            return arena.duel_view(m[1], player_id(query.get("player_id", [None])[0]), now)
        if (m := DUEL_ROUND.match(path)) and method == "POST":
            pid = player_id(query.get("player_id", [None])[0])
            audio, sr = self._read_audio(query)
            # The same numbers as /api/score, top classes included, so results can say what was heard.
            result = score(audio, sr, parse_calibration_or_400(query))
            bark = bark_from_score(result, query.get("position", ["unchecked"])[0])
            # Scoring takes a moment: judge the deadline by when the take arrived.
            return arena.submit(m[1], pid, int(m[2]), bark, now)
        raise NotFound("Not found")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if not 0 < length <= 4096:
            raise BadRequest("Send a small JSON body")
        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError as err:
            raise BadRequest("Body must be JSON") from err
        if not isinstance(body, dict):
            raise BadRequest("Body must be a JSON object")
        return body

    def _read_audio(self, query: dict) -> tuple[np.ndarray, int]:
        try:
            sr = int(query.get("sr", ["16000"])[0])
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as err:
            raise BadRequest("sr and Content-Length must be integers") from err
        if not 8000 <= sr <= 192000:
            raise BadRequest(f"Unsupported sample rate {sr}")
        if length <= 0 or length % 4 or length > MAX_BODY_BYTES:
            raise BadRequest("Body must be non-empty float32 samples, at most 12 MB")
        return np.frombuffer(self.rfile.read(length), dtype="<f4"), sr


def parse_calibration_or_400(query: dict) -> Calibration | None:
    try:
        return parse_calibration(query)
    except ValueError as err:
        raise BadRequest(str(err)) from err


def player_id(value: object) -> str:
    if not isinstance(value, str) or not PLAYER_ID.match(value):
        raise BadRequest("player_id must be 8-64 letters, digits, - or _")
    return value


def player_name(value: object) -> str:
    name = " ".join(str(value or "").split())[:MAX_NAME]
    if not name:
        raise BadRequest("Pick a name")
    return name


def main() -> None:
    # Load the model before the first request so scoring a take is quick.
    likeness.dog_class_indices()
    likeness.frame_length()
    print(f"Scoring and duel server on http://{HOST}:{PORT}")
    HTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
