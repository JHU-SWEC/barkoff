"""Local server: scoring over HTTP, ranked duels over WebSocket.

Usage:
    python server.py            # http://localhost:8000 and ws://localhost:8001/ws

POST /api/score?sr=48000[&noise_lufs=-58.2&speech_lufs=-27.5]
    Body: raw mono float32 little-endian samples in [-1, 1], at the take's
    own sample rate. Not resampled to 16 kHz: loudness weights the range
    above 8 kHz that a 16 kHz copy would drop. likeness.py resamples itself.
    The browser decodes the take itself, so no FFmpeg is needed.
    noise_lufs and speech_lufs are the player's calibration; without them
    loudness is scored against a typical speaking voice.
    Returns JSON: score.py's numbers plus the weights and the top YAMNet classes
    (fields listed in scoring_worker.py).

GET /api/leaderboard
    Players by Elo.

Duels run over the socket on ws://localhost:8001/ws: queue, matchmaking, rounds and
takes. The protocol and the game loop are in realtime.py, the rules in duels.py.
Players and duels live in memory until profiles land, so a restart resets them.

Threads: each HTTP request gets its own (ThreadingHTTPServer), so a take being
scored doesn't hold up the rest of the site. Scoring runs on the one scoring
thread (scoring_worker.py: the TFLite interpreter isn't safe to call
concurrently). Game state belongs to the game loop's thread (realtime.py), so
a handler that needs it goes through hub.call.

Standard library HTTP; websockets for the duel socket.
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

import realtime
import scoring_worker
from duels import Arena, DuelError
from loudness import Calibration

HOST = "localhost"
PORT = 8000
WS_PORT = 8001

# 60 s of 48 kHz float32 is ~11.5 MB; anything bigger is not a bark take.
MAX_BODY_BYTES = 12 * 1024 * 1024

hub = realtime.Hub(Arena(), scoring_worker.score_async)


class BadRequest(Exception):
    pass


class NotFound(Exception):
    pass


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

    def _handle(self, method: str) -> None:
        url = urlparse(self.path)
        query = parse_qs(url.query)
        try:
            self._send_json(200, self._route(method, url.path, query))
        except scoring_worker.Busy as err:
            self._discard_body()
            self._send_json(503, {"error": str(err)})
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
        if path == "/api/score" and method == "POST":
            # Take a place in line before reading up to 12 MB; then wait on the scoring thread,
            # which holds up only this request's thread.
            with scoring_worker.http_slot():
                audio, sr = self._read_audio(query)
                return scoring_worker.score(audio, sr, parse_calibration_or_400(query))
        if path == "/api/leaderboard" and method == "GET":
            return hub.call(hub.arena.leaderboard)
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

    def _discard_body(self) -> None:
        """Read and drop a body we're refusing, a chunk at a time. Closing with it unread makes the
        OS reset the connection, which can destroy the reply before the client reads it."""
        try:
            left = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            return
        if left > MAX_BODY_BYTES:
            return
        while left > 0 and (chunk := self.rfile.read(min(left, 64 * 1024))):
            left -= len(chunk)

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


def main() -> None:
    scoring_worker.warm_up()  # load the model now, so the first take is quick
    realtime.start(hub, HOST, WS_PORT)
    print(f"Scoring on http://{HOST}:{PORT}, duels on ws://{HOST}:{WS_PORT}/ws")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
