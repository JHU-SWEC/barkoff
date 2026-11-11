"""Object storage for bark clips.

Local disk is the default. The same put/open/delete interface is what an
S3-compatible backend will implement later; switch with CLIP_STORAGE=s3 once
that class exists. Callers always talk in storage keys, never filesystem paths.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol


class ObjectStorage(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    def open(self, key: str) -> tuple[bytes, str]:
        """Return (bytes, content_type). Raises FileNotFoundError if missing."""
        ...

    def delete(self, key: str) -> None: ...


class LocalObjectStorage:
    """Files under a root directory. Key `a/b.webm` → `{root}/a/b.webm`."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._types = self.root / ".content-types"
        self._types.mkdir(exist_ok=True)

    def _path(self, key: str) -> Path:
        # Reject absolute keys and `..` so a bad key can't leave the root.
        parts = Path(key).parts
        if not parts or Path(key).is_absolute() or ".." in parts:
            raise ValueError(f"Invalid storage key: {key!r}")
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError(f"Invalid storage key: {key!r}")
        return path

    def _type_path(self, key: str) -> Path:
        # Parallel sidecar so content-type survives without guessing from extension.
        safe = key.replace("/", "__")
        return self._types / f"{safe}.type"

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self._type_path(key).write_text(content_type, encoding="utf-8")

    def open(self, key: str) -> tuple[bytes, str]:
        path = self._path(key)
        if not path.is_file():
            raise FileNotFoundError(key)
        content_type = "application/octet-stream"
        type_path = self._type_path(key)
        if type_path.is_file():
            content_type = type_path.read_text(encoding="utf-8").strip() or content_type
        return path.read_bytes(), content_type

    def delete(self, key: str) -> None:
        path = self._path(key)
        path.unlink(missing_ok=True)
        self._type_path(key).unlink(missing_ok=True)


def default_local_root() -> Path:
    override = os.environ.get("CLIP_STORAGE_DIR", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "data" / "clips"


def get_storage() -> ObjectStorage:
    """Factory. CLIP_STORAGE=local (default). s3 is reserved for a later backend."""
    kind = os.environ.get("CLIP_STORAGE", "local").strip().lower() or "local"
    if kind == "local":
        return LocalObjectStorage(default_local_root())
    if kind == "s3":
        raise NotImplementedError(
            "S3-compatible storage is not wired yet. Set CLIP_STORAGE=local, "
            "or add an S3 ObjectStorage and register it here."
        )
    raise ValueError(f"Unknown CLIP_STORAGE={kind!r}; use local (or later s3).")
