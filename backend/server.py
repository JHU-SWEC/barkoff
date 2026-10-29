"""Tiny local HTTP server so the frontend can score a take with likeness.py.

Usage:
    python server.py            # listens on http://localhost:8000

POST /api/likeness?sr=16000
    Body: raw mono float32 little-endian samples in [-1, 1].
    The browser decodes and resamples the take itself, so no FFmpeg is needed.
    Returns JSON: {"probability": float, "durationS": float,
                   "top": [{"name": str, "score": float}, ...]}

Standard library only (plus likeness.py's own deps). Single-threaded on
purpose: the TFLite interpreter is shared and not safe to call concurrently.
"""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

import likeness

HOST = "localhost"
PORT = 8000

# 60 s of 48 kHz float32 is ~11.5 MB; anything bigger is not a bark take.
MAX_BODY_BYTES = 12 * 1024 * 1024
TOP_K = 5


def score(audio: np.ndarray, sr: int) -> dict:
    """Bark probability plus the top YAMNet classes, like try_likeness.py prints."""
    mean_scores = likeness.frame_scores(audio, sr).mean(axis=0)
    names = likeness.class_names()
    top = [
        {"name": names[i], "score": float(mean_scores[i])}
        for i in np.argsort(mean_scores)[::-1][:TOP_K]
    ]
    return {
        "probability": likeness.bark_probability(audio, sr),
        "durationS": len(audio) / sr,
        "top": top,
    }


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        url = urlparse(self.path)
        if url.path != "/api/likeness":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            sr = int(parse_qs(url.query).get("sr", ["16000"])[0])
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "sr and Content-Length must be integers"})
            return
        if not 8000 <= sr <= 192000:
            self._send_json(400, {"error": f"Unsupported sample rate {sr}"})
            return
        if length <= 0 or length % 4 or length > MAX_BODY_BYTES:
            self._send_json(400, {"error": "Body must be non-empty float32 samples, at most 12 MB"})
            return

        audio = np.frombuffer(self.rfile.read(length), dtype="<f4")
        try:
            self._send_json(200, score(audio, sr))
        except Exception as err:  # report model errors to the page instead of dropping the connection
            self._send_json(500, {"error": str(err)})


def main() -> None:
    # Load the model before the first request so scoring a take is quick.
    likeness.dog_class_indices()
    likeness.frame_length()
    print(f"Likeness server on http://{HOST}:{PORT}")
    HTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
