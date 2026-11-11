from http.server import BaseHTTPRequestHandler

import json
from io import BytesIO

import pytest

import accounts


def test_password_round_trip():
    stored = accounts.hash_password("bark-bark-bark")
    assert accounts.verify_password("bark-bark-bark", stored)
    assert not accounts.verify_password("bark-bark-bar", stored)
    assert not accounts.verify_password("bark-bark-bark", "not-a-hash")


def test_display_name_rules():
    assert accounts._clean_name("  Good   Boy ") == "Good Boy"
    with pytest.raises(accounts.AccountError):
        accounts._clean_name("A")
    with pytest.raises(accounts.AccountError):
        accounts._clean_name("x" * 25)


class _FakeHandler(BaseHTTPRequestHandler):
    def __init__(self, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.headers = {"Cookie": "", "Content-Length": str(len(raw))}
        self.rfile = BytesIO(raw)
        self.sent = None

    def _send_json(self, status, body, headers=None):
        self.sent = (status, body, headers or {})


def test_login_without_database(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    handler = _FakeHandler({"email": "ada@example.com", "password": "bark-bark"})
    accounts.handle(handler, "login")
    status, body, _headers = handler.sent
    assert status == 503
    assert "Postgres" in body["error"]
