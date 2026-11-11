"""Build the Bark Off likeness test set: clips YAMNet never trained on.

YAMNet was trained on AudioSet, which is cut from YouTube videos. This set
only uses sources that are not from YouTube:
    ESC-50          Freesound recordings, CC BY-NC 3.0  (github.com/karolpiczak/ESC-50)
    Speech Commands volunteers recording single words, CC BY 4.0
                    (download.tensorflow.org/data/speech_commands_v0.02.tar.gz)
    UrbanSound8K    Freesound street recordings, CC BY-NC 4.0 (zenodo.org/records/1203745):
                    real barks in real-world noise, plus a few other sounds
    own recordings  takes from the Bark Off site, added with --add
It also skips the ESC-50 dog clips that backend/likeness.py uses as its
similarity reference, so the model is never tested on its own reference, and
any UrbanSound8K clip cut from the same Freesound recording as an ESC-50 clip.

Every clip is converted to 16 kHz mono WAV and given an opaque id (c001,
c002, ...) so labelling is blind: the label page never shows the source or
category. The choice of clips lives in manifest.csv (committed), so everyone
on the team builds exactly the same set.

Usage (from the repo root):
    python scripts/eval/testset/build_testset.py                 # build audio/ from manifest.csv
    python scripts/eval/testset/build_testset.py --select        # (re)pick clips, rewrite manifest.csv
    python scripts/eval/testset/build_testset.py --add my_takes/ # append your own recordings
    python scripts/eval/testset/build_testset.py --add-urbansound  # append the UrbanSound8K picks (done once)

Then open scripts/eval/testset/label.html in a browser to score the clips.
"""

import argparse
import csv
import io
import random
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))
import likeness  # noqa: E402  (for reference_filenames, so we skip the reference clips)

MANIFEST = HERE / "manifest.csv"
AUDIO_DIR = HERE / "audio"  # gitignored
CACHE = REPO_ROOT / "scripts" / "eval" / "data"  # gitignored, shared with eval_likeness.py
SR = 16000
SEED = 0

ESC50_RAW = "https://raw.githubusercontent.com/karolpiczak/ESC-50/master"
SPEECH_URL = "https://storage.googleapis.com/download.tensorflow.org/data/speech_commands_v0.02.tar.gz"
US8K_URL = "https://zenodo.org/api/records/1203745/files/UrbanSound8K.tar.gz/content"
LICENSES = {"esc50": "CC BY-NC 3.0", "speech_commands": "CC BY 4.0",
            "urbansound8k": "CC BY-NC 4.0", "own": "team recording"}

FIELDS = ["id", "source", "source_file", "category", "tier_prior", "license"]

# tier_prior is only a rough guess from the category, used to make sure the set
# covers the whole range. It is NOT a label: the hand labels are the scores.
#   bark   real dog barks
#   close  things that could be mistaken for a bark: animal calls, short human
#          vocal bursts, sharp impulsive sounds
#   far    nothing like a bark
ESC50_PICKS = {  # category -> (tier_prior, how many)
    "dog": ("bark", None),  # None = every dog clip outside the reference set
    "cat": ("close", 3), "pig": ("close", 3), "cow": ("close", 3), "sheep": ("close", 3),
    "rooster": ("close", 3), "hen": ("close", 3), "crow": ("close", 3), "frog": ("close", 3),
    "coughing": ("close", 3), "sneezing": ("close", 3), "laughing": ("close", 3),
    "crying_baby": ("close", 3), "snoring": ("close", 3), "breathing": ("close", 3),
    "door_wood_knock": ("close", 2), "clapping": ("close", 2),
    "glass_breaking": ("close", 2), "footsteps": ("close", 2),
    "rain": ("far", 2), "sea_waves": ("far", 2), "wind": ("far", 2), "engine": ("far", 2),
    "vacuum_cleaner": ("far", 2), "clock_tick": ("far", 2), "keyboard_typing": ("far", 2),
    "church_bells": ("far", 2), "chirping_birds": ("far", 2), "water_drops": ("far", 2),
    "washing_machine": ("far", 2), "airplane": ("far", 2),
}
# "wow" is the closest public stand-in for a human "woof"; "dog" is a human
# saying the word. One clip per speaker.
SPEECH_PICKS = {"wow": ("close", 8), "dog": ("close", 6),
                "house": ("far", 2), "seven": ("far", 2), "happy": ("far", 2)}
# UrbanSound8K class -> (tier_prior, how many). One clip per Freesound recording.
US8K_PICKS = {"dog_bark": ("bark", 50), "gun_shot": ("close", 5), "children_playing": ("close", 5),
              "car_horn": ("far", 4), "jackhammer": ("far", 3), "siren": ("far", 3)}


# ---------- downloads ----------

def _get(url: str, dest: Path) -> Path:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(dest)
    return dest


def esc50_meta() -> list[dict]:
    with open(_get(f"{ESC50_RAW}/meta/esc50.csv", CACHE / "esc50" / "esc50.csv"), newline="") as f:
        return list(csv.DictReader(f))


def esc50_file(name: str) -> Path:
    return _get(f"{ESC50_RAW}/audio/{name}", CACHE / "esc50" / "audio" / name)


def speech_commands(words: set[str]) -> Path:
    """Extract only the needed word folders from the 2.3 GB archive (streamed once)."""
    root = CACHE / "speech_commands"
    if all((root / w).is_dir() for w in words):
        return root
    print(f"Streaming Speech Commands (2.3 GB, once) to extract {sorted(words)} ...")
    with urllib.request.urlopen(SPEECH_URL) as resp, tarfile.open(fileobj=resp, mode="r|gz") as tar:
        for member in tar:
            parts = Path(member.name).parts
            if member.isfile() and (parts[-1] == "LICENSE" or (len(parts) >= 2 and parts[-2] in words)):
                try:
                    tar.extract(member, root, filter="data")
                except TypeError:  # Python < 3.10.12 / 3.11.4 has no filter argument
                    tar.extract(member, root)
    return root


def urbansound8k(wanted: set[str] | None = None, per_class: dict[str, int] | None = None) -> Path:
    """Stream the 6 GB UrbanSound8K archive once, keeping only what's needed.

    wanted: exact file names (building from the manifest; stops once all are found).
    per_class: when picking, keep every clip of these classes (n=None) or up to n.
    """
    root = CACHE / "urbansound8k"
    meta = root / "UrbanSound8K.csv"
    if wanted is not None and meta.exists() and all((root / "audio" / w).exists() for w in wanted):
        return root
    if wanted is None and meta.exists() and any((root / "audio").glob("*.wav")):
        return root  # already streamed for picking
    print("Streaming UrbanSound8K (6 GB, once) ...")
    (root / "audio").mkdir(parents=True, exist_ok=True)
    class_ids = {"air_conditioner": 0, "car_horn": 1, "children_playing": 2, "dog_bark": 3, "drilling": 4,
                 "engine_idling": 5, "gun_shot": 6, "jackhammer": 7, "siren": 8, "street_music": 9}
    keep = {class_ids[c]: n for c, n in (per_class or {}).items()}
    kept, remaining = {}, set(wanted or ())
    with urllib.request.urlopen(US8K_URL) as resp, tarfile.open(fileobj=resp, mode="r|gz") as tar:
        for member in tar:
            name = Path(member.name).name
            if not member.isfile():
                continue
            if name == "UrbanSound8K.csv":
                meta.write_bytes(tar.extractfile(member).read())
                continue
            if not name.endswith(".wav"):
                continue
            cls = int(name.split("-")[1])
            if name in remaining or (cls in keep and (keep[cls] is None or kept.get(cls, 0) < keep[cls])):
                (root / "audio" / name).write_bytes(tar.extractfile(member).read())
                kept[cls] = kept.get(cls, 0) + 1
                remaining.discard(name)
                if wanted is not None and not remaining and meta.exists():
                    break
    return root


def add_urbansound(rows: list[dict]) -> list[dict]:
    """Append the UrbanSound8K picks after the existing clips, keeping existing ids stable."""
    if any(r["source"] == "urbansound8k" for r in rows):
        print("UrbanSound8K clips are already in the manifest.")
        return rows
    rng = random.Random(SEED + 1)
    # Freesound ids used anywhere in ESC-50: skip UrbanSound8K slices of the same recordings,
    # so the similarity reference never reappears and no recording is in the set twice.
    esc50_ids = {r["src_file"] for r in esc50_meta()}
    root = urbansound8k(per_class={c: (None if c == "dog_bark" else 60) for c in US8K_PICKS})
    with open(root / "UrbanSound8K.csv", newline="") as f:
        meta = [r for r in csv.DictReader(f) if (root / "audio" / r["slice_file_name"]).exists()]
    new = []
    for cls, (tier, n) in US8K_PICKS.items():
        by_recording = {}
        for r in sorted(meta, key=lambda r: r["slice_file_name"]):
            if r["class"] == cls and r["fsID"] not in esc50_ids:
                by_recording.setdefault(r["fsID"], r["slice_file_name"])
        picks = rng.sample(sorted(by_recording.values()), min(n, len(by_recording)))
        new += [{"source": "urbansound8k", "source_file": f, "category": f"us8k:{cls}", "tier_prior": tier}
                for f in picks]
    rng.shuffle(new)
    next_id = max(int(r["id"][1:]) for r in rows) + 1
    for i, r in enumerate(new):
        r["id"] = f"c{next_id + i:03d}"
        r["license"] = LICENSES["urbansound8k"]
    return rows + new


# ---------- selection ----------

def select() -> list[dict]:
    """Pick the clips with a fixed seed and return manifest rows (ids assigned in shuffled order)."""
    rng = random.Random(SEED)
    rows = []

    meta = esc50_meta()
    reference = likeness.reference_filenames(meta)
    for category, (tier, n) in ESC50_PICKS.items():
        pool = sorted(r["filename"] for r in meta if r["category"] == category and r["filename"] not in reference)
        picks = pool if n is None else rng.sample(pool, n)
        rows += [{"source": "esc50", "source_file": f, "category": category, "tier_prior": tier} for f in picks]

    sc = speech_commands(set(SPEECH_PICKS))
    for word, (tier, n) in SPEECH_PICKS.items():
        by_speaker = {}
        for p in sorted((sc / word).glob("*.wav")):
            by_speaker.setdefault(p.name.split("_")[0], p.name)
        picks = rng.sample(sorted(by_speaker.values()), n)
        rows += [{"source": "speech_commands", "source_file": f"{word}/{f}", "category": f"word:{word}",
                  "tier_prior": tier} for f in picks]

    rng.shuffle(rows)  # so ids don't give away the category
    for i, r in enumerate(rows, 1):
        r["id"] = f"c{i:03d}"
        r["license"] = LICENSES[r["source"]]
    return rows


def read_manifest() -> list[dict]:
    with open(MANIFEST, newline="") as f:
        return list(csv.DictReader(f))


def write_manifest(rows: list[dict]) -> None:
    with open(MANIFEST, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows({k: r[k] for k in FIELDS} for r in rows)
    print(f"Wrote {MANIFEST.relative_to(REPO_ROOT)} ({len(rows)} clips)")


# ---------- building ----------

def source_path(row: dict) -> Path:
    if row["source"] == "esc50":
        return esc50_file(row["source_file"])
    if row["source"] == "speech_commands":
        return speech_commands({row["source_file"].split("/")[0]}) / row["source_file"]
    if row["source"] == "urbansound8k":
        return CACHE / "urbansound8k" / "audio" / row["source_file"]
    return HERE / "own" / row["source_file"]


def convert(src: Path, dest: Path) -> None:
    """Any audio file -> 16 kHz mono 16-bit WAV (plays in every browser)."""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", str(SR),
                    "-c:a", "pcm_s16le", str(dest)], check=True)


def build(rows: list[dict]) -> None:
    AUDIO_DIR.mkdir(exist_ok=True)
    us8k = {r["source_file"] for r in rows if r["source"] == "urbansound8k"}
    if us8k and any(not (AUDIO_DIR / f"{r['id']}.wav").exists() for r in rows if r["source"] == "urbansound8k"):
        urbansound8k(wanted=us8k)
    for r in rows:
        dest = AUDIO_DIR / f"{r['id']}.wav"
        if not dest.exists():
            convert(source_path(r), dest)
    # The label page reads the clip list from here (works when opened from disk).
    ids = ",".join(f'"{r["id"]}"' for r in rows)
    (AUDIO_DIR / "clips.js").write_text(f"window.CLIPS = [{ids}];\n")
    print(f"Built {len(rows)} clips in {AUDIO_DIR.relative_to(REPO_ROOT)}/")


def add_own(rows: list[dict], folder: Path, tier: str) -> list[dict]:
    """Copy your own takes into own/ and append them to the manifest."""
    own = HERE / "own"
    own.mkdir(exist_ok=True)
    known = {r["source_file"] for r in rows if r["source"] == "own"}
    next_id = max(int(r["id"][1:]) for r in rows) + 1 if rows else 1
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() not in {".wav", ".webm", ".m4a", ".mp3", ".ogg", ".flac", ".mp4"} or p.name in known:
            continue
        (own / p.name).write_bytes(p.read_bytes())
        rows.append({"id": f"c{next_id:03d}", "source": "own", "source_file": p.name,
                     "category": "own", "tier_prior": tier, "license": LICENSES["own"]})
        next_id += 1
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--select", action="store_true", help="re-pick the clips and rewrite manifest.csv")
    ap.add_argument("--add", type=Path, help="folder of your own recordings to append")
    ap.add_argument("--add-tier", default="unknown", help="tier_prior for --add clips (bark/close/far/unknown)")
    ap.add_argument("--add-urbansound", action="store_true", help="append the UrbanSound8K picks (once)")
    args = ap.parse_args()

    if args.select or not MANIFEST.exists():
        rows = select()
        write_manifest(rows)
    else:
        rows = read_manifest()
    if args.add_urbansound:
        rows = add_urbansound(rows)
        write_manifest(rows)
    if args.add:
        rows = add_own(rows, args.add, args.add_tier)
        write_manifest(rows)
    build(rows)

    counts = {}
    for r in rows:
        counts[r["tier_prior"]] = counts.get(r["tier_prior"], 0) + 1
    print("By tier_prior:", ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
