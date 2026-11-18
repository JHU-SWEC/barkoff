"""Collect human barks, growls, howls and whimpers: people making dog-like (and other animal) sounds.

Sources (all allow reuse with credit; see README.md):
    VocalImitationSet v1.1.3   CC BY 4.0, zenodo.org/records/1340763
        People imitating AudioSet sounds. We take every imitation (accepted, rejected or
        practice) of Dog > Bark, Dog > Growling, Dog > Howl and Cat > Growling.
    VocalSketch v1.1.2         CC BY 4.0, zenodo.org/records/1251982
        People imitating everyday sounds. We take every take (accepted, rejected or draft) of
        "dog barking", "wolf", "lion" and "seal".
    Freesound (--freesound)    CC0 / CC BY / CC BY-NC, freesound.org
        Searches for human dog impressions, growls and whimpers. Needs a free API key in the
        FREESOUND_API_KEY environment variable (freesound.org/apiv2/apply). Search hits can be
        real dogs: the scorer has a "not a person" flag for those.
    your own (--add DIR)       recordings you or friends made, with their permission

Both research archives are several GB, so we never download them whole: Zenodo serves byte
ranges, so we read each zip's directory from its end and fetch only the files we need.

Every clip becomes 16 kHz mono WAV in audio/<id>.wav (gitignored) with an opaque id (h001,
h002, ...) so scoring stays blind. manifest.csv (committed) records where each clip came from,
what the person was imitating, the dataset's own verdict on the take, who made it (an id, plus
age and gender where the source surveyed them) and the license.

Usage (from the repo root, needs FFmpeg):
    python scripts/data/human_barks/build.py                    # fetch everything in manifest.csv
    python scripts/data/human_barks/build.py --select           # re-read the research datasets
    FREESOUND_API_KEY=... python scripts/data/human_barks/build.py --freesound
    python scripts/data/human_barks/build.py --add path/to/recordings --add-person alex

New clips always get new ids at the end, so existing scores never point at the wrong clip.
Then score them: python scripts/data/human_barks/score_server.py
"""

import argparse
import csv
import io
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import certifi

HERE = Path(__file__).resolve().parent
AUDIO_DIR = HERE / "audio"
OWN_DIR = HERE / "own"
MANIFEST = HERE / "manifest.csv"
SR = 16000
CONTEXT = ssl.create_default_context(cafile=certifi.where())
AUDIO_EXTS = {".wav", ".webm", ".m4a", ".mp3", ".ogg", ".flac", ".mp4", ".aiff", ".aif"}

VIS = {
    "name": "vocal_imitation_set",
    "zip": "https://zenodo.org/api/records/1340763/files/VocalImitationSet_v1.1.3.zip/content",
    "meta": "https://raw.githubusercontent.com/interactiveaudiolab/VocalImitationSet/master/",
    "license": "CC BY 4.0",
    "credit": "Kim, Ghei, Pardo, Duan. Vocal Imitation Set (DCASE 2018), zenodo.org/records/1340763",
}
VS = {
    "name": "vocalsketch",
    "zip": "https://zenodo.org/api/records/1251982/files/interactiveaudiolab/VocalSketchDataSet-1.1.2.zip/content",
    "meta": "https://raw.githubusercontent.com/interactiveaudiolab/VocalSketchDataSet/master/",
    "license": "CC BY 4.0",
    "credit": "Cartwright, Pardo. VocalSketch (CHI 2015), zenodo.org/records/1251982",
}

# VocalImitationSet classes (category path) -> what the person was imitating.
VIS_CLASSES = {
    ("Dog", "Bark"): "dog_bark",
    ("Dog", "Growling"): "dog_growl",
    ("Dog", "Howl"): "dog_howl",
    ("Cat", "Growling"): "cat_growl",
}
VS_LABELS = {"dog barking": "dog_bark", "wolf": "wolf", "lion": "lion", "seal": "seal"}

# Freesound searches (text query -> what the uploader was going for). Kept short and clip-sized.
FREESOUND_QUERIES = {
    "human bark": "dog_bark", "human barking": "dog_bark", "man barking": "dog_bark",
    "woman barking": "dog_bark", "person barking like a dog": "dog_bark", "dog impression": "dog_bark",
    "imitating dog": "dog_bark", "dog imitation voice": "dog_bark", "barking voice": "dog_bark",
    "human growl": "growl", "growling voice": "growl", "monster growl voice": "growl",
    "human whimper": "whimper", "whimpering voice": "whimper", "whining voice": "whimper",
    "puppy whimper imitation": "whimper", "human howl": "howl", "howling voice": "howl",
}
FREESOUND_LICENSES = {
    "Creative Commons 0": "CC0",
    "Attribution": "CC BY",
    "Attribution NonCommercial": "CC BY-NC",
    "http://creativecommons.org/publicdomain/zero/1.0/": "CC0",
    "https://creativecommons.org/licenses/by/4.0/": "CC BY 4.0",
    "http://creativecommons.org/licenses/by/3.0/": "CC BY 3.0",
    "https://creativecommons.org/licenses/by-nc/4.0/": "CC BY-NC 4.0",
    "http://creativecommons.org/licenses/by-nc/3.0/": "CC BY-NC 3.0",
}
FREESOUND_MAX_SECONDS = 12

FIELDS = [
    "id", "source", "source_file", "imitated", "dataset_status", "person", "gender", "age",
    "listener_rating", "license", "credit", "url",
]


# ---------- remote zips ----------

def get_range(url: str, start: int, end: int, attempts: int = 6) -> tuple[bytes, str]:
    """Bytes start..end (inclusive) and the Content-Range header. Zenodo is slow (seconds per
    request) and now and then answers 502/504, so retry with backoff."""
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(req, context=CONTEXT, timeout=180) as r:
                return r.read(), r.headers.get("Content-Range", "")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            if attempt == attempts - 1 or (isinstance(err, urllib.error.HTTPError) and err.code < 500):
                raise
            time.sleep(2 * 2**attempt)
    raise RuntimeError("unreachable")


class RangeFile(io.RawIOBase):
    """A read-only, seekable view of a remote file, fetched in blocks with HTTP Range requests."""

    BLOCK = 1 << 20

    def __init__(self, url: str):
        self.url = url
        self.pos = 0
        self.cache: dict[int, bytes] = {}
        _, content_range = get_range(url, 0, 0)
        self.size = int(content_range.split("/")[-1])

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = 0) -> int:
        self.pos = {0: offset, 1: self.pos + offset, 2: self.size + offset}[whence]
        return self.pos

    def _block(self, n: int) -> bytes:
        if n not in self.cache:
            start = n * self.BLOCK
            self.cache[n] = get_range(self.url, start, min(start + self.BLOCK, self.size) - 1)[0]
        return self.cache[n]

    def prefetch(self, spans: list[tuple[int, int]], workers: int = 8) -> None:
        """Fetch every block these (start, length) spans touch, several at a time."""
        blocks = sorted({b for s, n in spans for b in range(s // self.BLOCK, (s + n) // self.BLOCK + 1)} - set(self.cache))
        with ThreadPoolExecutor(workers) as pool:
            list(pool.map(self._block, blocks))

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            n = self.size - self.pos
        out = bytearray()
        while n > 0 and self.pos < self.size:
            block, offset = divmod(self.pos, self.BLOCK)
            chunk = self._block(block)[offset : offset + n]
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def readinto(self, buffer) -> int:
        data = self.read(len(buffer))
        buffer[: len(data)] = data
        return len(data)


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, context=CONTEXT, timeout=60) as r:
        return r.read().decode("utf-8", errors="replace")


def fetch_json(url: str) -> dict:
    return json.loads(fetch_text(url))


# ---------- the research datasets ----------

def select_vis() -> list[dict]:
    imitations = list(csv.DictReader(io.StringIO(fetch_text(VIS["meta"] + "vocal_imitations.txt")), delimiter="\t"))
    survey = list(csv.DictReader(io.StringIO(fetch_text(VIS["meta"] + "participant_survey.csv"))))
    ratings: dict[str, list[float]] = {}
    for r in csv.DictReader(io.StringIO(fetch_text(VIS["meta"] + "vocal_imitations_assessment.txt")), delimiter="\t"):
        if r["rating"]:
            ratings.setdefault(r["imitation_filename"], []).append(float(r["rating"]))
    # vocal_imitations.txt stores participant ids as rounded floats (5073520000000000.0), so
    # they're matched to the survey's full ids by their first 6 digits, only when that's unique.
    by_prefix: dict[str, list[dict]] = {}
    for s in survey:
        by_prefix.setdefault(s["participant_id"][:6], []).append(s)

    out = []
    for r in imitations:
        cats = [r[f"category_d{i}"] for i in range(1, 7)]
        imitated = next((v for (animal, sound), v in VIS_CLASSES.items() if animal in cats and sound in cats), None)
        if imitated is None:
            continue
        pid = str(int(float(r["participant_id"])))[:6] if r["participant_id"] else ""
        match = by_prefix.get(pid, [])
        who = match[0] if len(match) == 1 else {}
        rs = ratings.get(r["imitation_filename"], [])
        status = "accepted" if r["included"].upper() == "TRUE" else "practice" if r["training"].upper() == "TRUE" else "rejected"
        out.append({
            "source": VIS["name"], "source_file": r["imitation_filename"], "imitated": imitated,
            "dataset_status": status, "person": f"vis:{pid}" if pid else "",
            "gender": who.get("gender", ""), "age": who.get("age", ""),
            "listener_rating": f"{sum(rs) / len(rs):.0f}" if rs else "",
            "license": VIS["license"], "credit": VIS["credit"],
        })
    return out


def select_vs() -> list[dict]:
    rows = list(csv.DictReader(io.StringIO(fetch_text(VS["meta"] + "vocal_imitations.csv"))))
    survey = {s["participant_id"]: s for s in csv.DictReader(io.StringIO(fetch_text(VS["meta"] + "participant_survey.csv")))}
    out = []
    for r in rows:
        if r["sound_label"] not in VS_LABELS:
            continue
        who = survey.get(r["participant_id"], {})
        status = "accepted" if r["included"] == "True" else "draft" if r["draft"] == "True" else "rejected"
        out.append({
            "source": VS["name"], "source_file": r["filename"], "imitated": VS_LABELS[r["sound_label"]],
            "dataset_status": status, "person": f"vs:{r['participant_id']}",
            "gender": who.get("gender", ""), "age": who.get("age", ""), "listener_rating": "",
            "license": VS["license"], "credit": VS["credit"],
        })
    return out


# ---------- Freesound ----------

def select_freesound(key: str, per_query: int = 50) -> list[dict]:
    """Search Freesound for human barks, growls, howls and whimpers (previews only, no OAuth)."""
    fields = "id,name,username,license,duration,tags,description,previews"
    seen: dict[str, dict] = {}
    for query, imitated in FREESOUND_QUERIES.items():
        params = urllib.parse.urlencode({
            "query": query, "fields": fields, "page_size": per_query, "token": key,
            "filter": f"duration:[0.3 TO {FREESOUND_MAX_SECONDS}]",
        })
        try:
            results = fetch_json(f"https://freesound.org/apiv2/search/text/?{params}")["results"]
        except urllib.error.HTTPError as err:
            sys.exit(f"Freesound refused the search ({err.code}). Check FREESOUND_API_KEY.")
        for s in results:
            license_ = FREESOUND_LICENSES.get(s["license"], s["license"])
            if "Sampling+" in license_ or str(s["id"]) in seen:
                continue
            seen[str(s["id"])] = {
                "source": "freesound", "source_file": f"{s['id']}.mp3", "imitated": imitated,
                "dataset_status": f"search: {query}", "person": f"fs:{s['username']}",
                "gender": "", "age": "", "listener_rating": "",
                "license": license_, "credit": f"\"{s['name']}\" by {s['username']}, freesound.org/s/{s['id']}",
                "url": s["previews"]["preview-hq-mp3"],
            }
        print(f"  freesound {query!r}: {len(results)} hits ({len(seen)} distinct so far)")
    return list(seen.values())


# ---------- your own recordings ----------

def own_rows(folder: Path, person: str) -> list[dict]:
    OWN_DIR.mkdir(exist_ok=True)
    out = []
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() not in AUDIO_EXTS:
            continue
        name = f"{person}-{p.name}" if person else p.name
        (OWN_DIR / name).write_bytes(p.read_bytes())
        out.append({
            "source": "own", "source_file": name, "imitated": "", "dataset_status": "own recording",
            "person": f"own:{person}" if person else "own", "gender": "", "age": "", "listener_rating": "",
            "license": "recorded with permission, team use only", "credit": "",
        })
    return out


# ---------- manifest ----------

def read_manifest() -> list[dict]:
    if not MANIFEST.exists():
        return []
    with open(MANIFEST, newline="") as f:
        return list(csv.DictReader(f))


def write_manifest(rows: list[dict]) -> None:
    with open(MANIFEST, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def append(rows: list[dict], new: list[dict]) -> list[dict]:
    """Add clips we don't have yet, with fresh ids after the last one."""
    known = {(r["source"], r["source_file"]) for r in rows}
    fresh = [r for r in new if (r["source"], r["source_file"]) not in known]
    start = max((int(r["id"][1:]) for r in rows), default=0) + 1
    for i, r in enumerate(fresh):
        r["id"] = f"h{start + i:03d}"
    if fresh:
        print(f"Added {len(fresh)} new clips")
    return rows + fresh


# ---------- audio ----------

def to_wav16k(data: bytes, dest: Path) -> None:
    """Any audio bytes -> 16 kHz mono 16-bit WAV."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", "-", "-ac", "1", "-ar", str(SR), "-sample_fmt", "s16", str(dest)],
        input=data, check=True,
    )


def build_audio(rows: list[dict]) -> None:
    AUDIO_DIR.mkdir(exist_ok=True)
    missing = [r for r in rows if not (AUDIO_DIR / f"{r['id']}.wav").exists()]
    for source, cfg in (("vocal_imitation_set", VIS), ("vocalsketch", VS)):
        todo = [r for r in missing if r["source"] == source]
        if not todo:
            continue
        print(f"{source}: reading the archive's directory, then fetching {len(todo)} clips ...")
        zf = zipfile.ZipFile(RangeFile(cfg["zip"]))
        index: dict[str, str] = {}
        for name in zf.namelist():
            if name.endswith("/"):
                continue
            # A name can sit in both included/ and excluded/; prefer the included copy.
            base = Path(name).name
            if base not in index or "/included/" in name:
                index[base] = name
        found = [r for r in todo if r["source_file"] in index]
        infos = [zf.getinfo(index[r["source_file"]]) for r in found]
        zf.fp.prefetch([(i.header_offset, i.compress_size + 1024) for i in infos])
        for r in todo:
            if r["source_file"] not in index:
                print(f"  not in archive: {r['source_file']}", file=sys.stderr)
                continue
            to_wav16k(zf.read(index[r["source_file"]]), AUDIO_DIR / f"{r['id']}.wav")

    for r in (r for r in missing if r["source"] == "freesound" and r.get("url")):
        with urllib.request.urlopen(r["url"], context=CONTEXT, timeout=60) as resp:
            to_wav16k(resp.read(), AUDIO_DIR / f"{r['id']}.wav")
    for r in (r for r in missing if r["source"] == "own"):
        to_wav16k((OWN_DIR / r["source_file"]).read_bytes(), AUDIO_DIR / f"{r['id']}.wav")

    present = [r["id"] for r in rows if (AUDIO_DIR / f"{r['id']}.wav").exists()]
    print(f"{len(present)} of {len(rows)} clips in {AUDIO_DIR.relative_to(HERE.parents[2])}/")


def summary(rows: list[dict]) -> None:
    from collections import Counter

    people = {r["person"] for r in rows if r["person"]}
    print(f"\n{len(rows)} clips from at least {len(people)} people")
    for key in ("source", "imitated", "dataset_status", "gender"):
        print(f"  {key}: {dict(Counter(r[key] or '?' for r in rows))}")
    ages = sorted(int(r["age"]) for r in rows if r["age"].isdigit())
    if ages:
        print(f"  age: {ages[0]}-{ages[-1]}, median {ages[len(ages) // 2]} ({len(ages)} clips with an age)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--select", action="store_true", help="re-read the research datasets for clips not in the manifest")
    ap.add_argument("--freesound", action="store_true", help="search Freesound (needs FREESOUND_API_KEY)")
    ap.add_argument("--add", type=Path, help="folder of your own recordings to add")
    ap.add_argument("--add-person", default="", help="a short tag for whoever recorded --add (no real names needed)")
    args = ap.parse_args()

    rows = read_manifest()
    if args.select or not rows:
        rows = append(rows, select_vis() + select_vs())
    if args.freesound:
        key = os.environ.get("FREESOUND_API_KEY")
        if not key:
            sys.exit("Set FREESOUND_API_KEY first (free: freesound.org/apiv2/apply).")
        rows = append(rows, select_freesound(key))
    if args.add:
        rows = append(rows, own_rows(args.add, args.add_person))
    write_manifest(rows)
    build_audio(rows)
    summary(rows)


if __name__ == "__main__":
    main()
