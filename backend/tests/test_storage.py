from pathlib import Path

import pytest

from storage import LocalObjectStorage, get_storage


def test_local_round_trip(tmp_path: Path):
    store = LocalObjectStorage(tmp_path)
    store.put("user-1/clip.webm", b"bark-bytes", "audio/webm")
    data, content_type = store.open("user-1/clip.webm")
    assert data == b"bark-bytes"
    assert content_type == "audio/webm"
    store.delete("user-1/clip.webm")
    with pytest.raises(FileNotFoundError):
        store.open("user-1/clip.webm")


def test_rejects_path_escape(tmp_path: Path):
    store = LocalObjectStorage(tmp_path)
    with pytest.raises(ValueError):
        store.put("../escape.webm", b"x", "audio/webm")
    with pytest.raises(ValueError):
        store.put("/abs.webm", b"x", "audio/webm")


def test_factory_default_is_local(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("CLIP_STORAGE", "local")
    monkeypatch.setenv("CLIP_STORAGE_DIR", str(tmp_path))
    store = get_storage()
    store.put("a/b.webm", b"1", "audio/webm")
    assert (tmp_path / "a" / "b.webm").read_bytes() == b"1"


def test_s3_not_wired_yet(monkeypatch):
    monkeypatch.setenv("CLIP_STORAGE", "s3")
    with pytest.raises(NotImplementedError):
        get_storage()
