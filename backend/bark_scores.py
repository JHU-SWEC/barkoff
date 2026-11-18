"""Hand scores for the human-bark clips (scripts/data/human_barks/), from everyone on the team.

Each scorer's scores live in their own file, labels/<scorer>.csv, committed to the repo. Once
everyone's branches are merged, the repo holds every teammate's scores, and a clip's label is
their average (see averages()).

Public interface:
    clips() -> {"clips": [ids], "missing_audio": int}
    read(scorer) -> {clip id: row}
    save(scorer, body) -> {"saved", "scored"}       one clip's score, written to disk at once
    team() -> progress per scorer and per clip
    averages() -> {clip id: averaged label}         the combined label, once people have scored

A row (labels/<scorer>.csv):
    id          the clip (h001, ...)
    likeness    0, 0.25, 0.5, 0.75 or 1, the same scale as the likeness test set
    type        playful, aggressive, whimper, growl, alarm or none
    not_human   1 if it's actually an animal
    bad_audio   1 if it's unusable
    notes       free text
    scored_at   when it last changed
"""

import csv
import re
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "scripts" / "data" / "human_barks"
LIKENESS = {0.0, 0.25, 0.5, 0.75, 1.0}
TYPES = ("playful", "aggressive", "whimper", "growl", "alarm", "none")
FIELDS = ["id", "likeness", "type", "not_human", "bad_audio", "notes", "scored_at"]
SCORER = re.compile(r"^[a-z0-9_-]{1,32}$")
CLIP = re.compile(r"^h\d{3,}$")


class ScoreError(ValueError):
    """A request we refuse; the message is safe to show."""


def audio_path(clip: str) -> Path | None:
    path = ROOT / "audio" / f"{clip}.wav"
    return path if CLIP.match(clip) and path.exists() else None


def clip_list() -> list[str]:
    """Every clip in the manifest (whether or not its audio is built here)."""
    with open(ROOT / "manifest.csv", newline="") as f:
        return [r["id"] for r in csv.DictReader(f)]


def clips() -> dict:
    ids = clip_list()
    present = [c for c in ids if audio_path(c)]
    return {"clips": present, "missing_audio": len(ids) - len(present)}


def scorer_name(raw: str) -> str:
    name = (raw or "").strip().lower()
    if not SCORER.match(name):
        raise ScoreError("Pick a scorer name: up to 32 letters, numbers, - or _.")
    return name


def _file(scorer: str) -> Path:
    return ROOT / "labels" / f"{scorer_name(scorer)}.csv"


def _read_file(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with open(path, newline="") as f:
        return {r["id"]: r for r in csv.DictReader(f)}


def read(scorer: str) -> dict[str, dict]:
    return _read_file(_file(scorer))


def complete(row: dict) -> bool:
    """Scored = a likeness and a type, or flagged as not usable."""
    return bool(row.get("bad_audio") or row.get("not_human") or (row.get("likeness") not in ("", None) and row.get("type")))


def save(scorer: str, body: dict) -> dict:
    path = _file(scorer)
    clip = str(body.get("id", ""))
    if not CLIP.match(clip) or clip not in clip_list():
        raise ScoreError(f"Unknown clip {clip!r}.")
    scores = _read_file(path)
    if body.get("clear"):
        scores.pop(clip, None)
    else:
        likeness = body.get("likeness")
        if likeness is not None and float(likeness) not in LIKENESS:
            raise ScoreError("Likeness must be 0, 0.25, 0.5, 0.75 or 1.")
        kind = body.get("type") or ""
        if kind and kind not in TYPES:
            raise ScoreError(f"Type must be one of {', '.join(TYPES)}.")
        scores[clip] = {
            "id": clip,
            "likeness": "" if likeness is None else f"{float(likeness):g}",
            "type": kind,
            "not_human": "1" if body.get("not_human") else "",
            "bad_audio": "1" if body.get("bad_audio") else "",
            "notes": " ".join(str(body.get("notes") or "").split())[:300],
            "scored_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
    # Write a temp file and swap it in, so a crash never leaves half a file.
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for c in sorted(scores):
            w.writerow({k: scores[c].get(k, "") for k in FIELDS})
    tmp.replace(path)
    return {"saved": clip, "scored": sum(1 for r in scores.values() if complete(r))}


def all_scores() -> dict[str, dict[str, dict]]:
    """{scorer: {clip: row}} from every labels/*.csv."""
    return {p.stem: _read_file(p) for p in sorted((ROOT / "labels").glob("*.csv"))}


def team() -> dict:
    """How far the team has got: per scorer, and how many clips have 0, 1, 2, ... scores."""
    ids = clip_list()
    every = all_scores()
    per_clip = Counter(sum(1 for s in every.values() if complete(s.get(c, {}))) for c in ids)
    return {
        "clips": len(ids),
        "scorers": {name: sum(1 for c in ids if complete(rows.get(c, {}))) for name, rows in every.items()},
        "clips_by_scorers": {str(k): v for k, v in sorted(per_clip.items())},
    }


def averages() -> dict[str, dict]:
    """Each clip's combined label across scorers.

    likeness   mean of everyone's likeness (flagged scores don't count)
    type       the most common type, and how many people chose it
    flags      how many people flagged it not_human / bad_audio
    spread     max - min likeness, to find clips the team disagrees on
    """
    every = all_scores()
    out = {}
    for c in clip_list():
        rows = [s[c] for s in every.values() if c in s and complete(s[c])]
        if not rows:
            continue
        rated = [r for r in rows if not r.get("not_human") and not r.get("bad_audio") and r.get("likeness") != ""]
        likes = [float(r["likeness"]) for r in rated]
        votes = Counter(r["type"] for r in rated if r.get("type"))
        top = votes.most_common(1)[0] if votes else ("", 0)
        out[c] = {
            "id": c,
            "scorers": len(rows),
            "likeness": round(sum(likes) / len(likes), 3) if likes else "",
            "spread": round(max(likes) - min(likes), 3) if likes else "",
            "type": top[0],
            "type_votes": f"{top[1]}/{len(rated)}" if rated else "",
            "not_human": sum(1 for r in rows if r.get("not_human")),
            "bad_audio": sum(1 for r in rows if r.get("bad_audio")),
        }
    return out
