"""Tiny local HTTP server so the frontend can score a take like score.py does.

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

POST /api/clips  (signed in)
    Header X-Barkoff-Meta: JSON score fields + contentType
    Body: raw audio bytes (webm/m4a/…). Stored via storage.get_storage()
    (local disk by default; CLIP_STORAGE=s3 later).

GET /api/clips, /api/clips/:id, /api/clips/:id/audio  (signed in)

Standard library only (plus likeness.py's own deps and psycopg for accounts/clips).
Single-threaded on purpose: the TFLite interpreter is shared and not safe to
call concurrently.
"""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

import accounts
import clips
import likeness
import score as scorer
from loudness import Calibration

HOST = "localhost"
PORT = 8000

# 60 s of 48 kHz float32 is ~11.5 MB; anything bigger is not a bark take.
MAX_BODY_BYTES = 12 * 1024 * 1024
TOP_K = 5


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
    def _send_json(self, status: int, body: dict, headers: dict | None = None) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def _send_bytes(self, status: int, data: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/me":
            accounts.handle(self, "me")
            return
        if path == "/api/clips" or path.startswith("/api/clips/"):
            clips.handle(self, "GET")
            return
        self._send_json(404, {"error": "Not found"})

    def do_PATCH(self) -> None:
        if urlparse(self.path).path == "/api/me":
            accounts.handle(self, "profile")
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        url = urlparse(self.path)
        if url.path == "/api/register":
            accounts.handle(self, "register")
            return
        if url.path == "/api/login":
            accounts.handle(self, "login")
            return
        if url.path == "/api/logout":
            accounts.handle(self, "logout")
            return
        if url.path == "/api/clips":
            clips.handle(self, "POST")
            return
        if url.path != "/api/score":
            self._send_json(404, {"error": "Not found"})
            return

        query = parse_qs(url.query)
        try:
            sr = int(query.get("sr", ["16000"])[0])
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "sr and Content-Length must be integers"})
            return
        try:
            calibration = parse_calibration(query)
        except ValueError as err:
            self._send_json(400, {"error": str(err)})
            return
        if not 8000 <= sr <= 192000:
            self._send_json(400, {"error": f"Unsupported sample rate {sr}"})
            return
        if length <= 0 or length % 4 or length > MAX_BODY_BYTES:
            self._send_json(400, {"error": "Body must be non-empty float32 samples, at most 12 MB"})
            return

        audio = np.frombuffer(self.rfile.read(length), dtype="<f4")
        try:
            self._send_json(200, score(audio, sr, calibration))
        except Exception as err:  # report model errors to the page instead of dropping the connection
            self._send_json(500, {"error": str(err)})


def main() -> None:
    # Load the model before the first request so scoring a take is quick.
    likeness.dog_class_indices()
    likeness.frame_length()
    print(f"Scoring server on http://{HOST}:{PORT}")
    HTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
