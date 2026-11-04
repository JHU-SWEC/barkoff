"""Measure how well backend/likeness.py separates barks from everything else.

Runs likeness_parts() on labelled clips and prints, for barks and non-barks
separately, how the scores spread (mean, std, percentiles), plus how well the
two groups separate (AUC, hit rates at a threshold). Reported for each part:
probability (a), similarity (b), and the final likeness (the mix).

Sources (pick one or more):
    --esc50          ESC-50 from GitHub: the 19 "dog" clips that are NOT in the
                     similarity reference set vs N clips from each of the other
                     49 classes (default stand-in until HF works).
    --hf             Hugging Face dataset rmarcosg/bark-detection (needs
                     huggingface.co reachable and `pip install datasets`).
    --clips DIR      Your own clips: DIR/bark/* and DIR/not_bark/*.

Examples (run from the repo root):
    python scripts/eval/eval_likeness.py --esc50
    python scripts/eval/eval_likeness.py --esc50 --clips scripts/eval/clips --out results/baseline.csv
    python scripts/eval/eval_likeness.py --hf --hf-split train

Every clip is decoded with FFmpeg to 16 kHz mono float32, the same input the
site's likeness box sends to server.py.
"""

import argparse
import csv
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

EVAL_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVAL_DIR.parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
import likeness  # noqa: E402  (needs the sys.path line above)

SR = 16000
DATA_DIR = EVAL_DIR / "data"  # downloads go here (gitignored)
AUDIO_EXTS = {".wav", ".webm", ".m4a", ".mp3", ".ogg", ".flac", ".mp4"}

ESC50_RAW = "https://raw.githubusercontent.com/karolpiczak/ESC-50/master"
ESC50_DOG = "dog"

HF_DATASET = "rmarcosg/bark-detection"


# ---------- decoding ----------

def decode(path_or_bytes) -> np.ndarray:
    """Any audio file (path or raw bytes) -> mono float32 at 16 kHz via FFmpeg."""
    is_bytes = isinstance(path_or_bytes, (bytes, bytearray))
    cmd = [
        "ffmpeg", "-v", "error", "-i", "-" if is_bytes else str(path_or_bytes),
        "-ac", "1", "-ar", str(SR), "-f", "f32le", "-",
    ]
    out = subprocess.run(
        cmd, input=path_or_bytes if is_bytes else None, capture_output=True, check=True
    ).stdout
    return np.frombuffer(out, dtype=np.float32)


# ---------- sources: each yields (source, name, is_bark, audio) ----------

def esc50_clips(per_class: int):
    """Dog clips outside the reference set, plus the first `per_class` of every other class."""
    root = DATA_DIR / "esc50"
    (root / "audio").mkdir(parents=True, exist_ok=True)
    meta = root / "esc50.csv"
    if not meta.exists():
        urllib.request.urlretrieve(f"{ESC50_RAW}/meta/esc50.csv", meta)
    with open(meta, newline="") as f:
        rows = sorted(csv.DictReader(f), key=lambda r: r["filename"])
    # Never test on the clips the similarity part compares against.
    reference = likeness.reference_filenames(rows)

    picked, counts = [], {}
    for r in rows:
        cat = r["category"]
        if r["filename"] in reference:
            continue
        if cat == ESC50_DOG or counts.get(cat, 0) < per_class:
            counts[cat] = counts.get(cat, 0) + 1
            picked.append(r)

    def fetch(r):
        dest = root / "audio" / r["filename"]
        if not dest.exists():
            tmp = dest.with_suffix(".part")
            urllib.request.urlretrieve(f"{ESC50_RAW}/audio/{r['filename']}", tmp)
            tmp.rename(dest)
        return dest

    missing = [r for r in picked if not (root / "audio" / r["filename"]).exists()]
    if missing:
        print(f"Downloading {len(missing)} ESC-50 clips to {root / 'audio'} ...")
    with ThreadPoolExecutor(8) as pool:
        paths = list(pool.map(fetch, picked))

    for r, path in zip(picked, paths):
        yield "esc50", f"{r['category']}/{r['filename']}", r["category"] == ESC50_DOG, decode(path)


def hf_clips(split: str, label_col: str | None, bark_label: str):
    """rmarcosg/bark-detection via the `datasets` library.

    Audio is read as raw bytes (decode=False) and decoded with FFmpeg, so no
    torch/torchcodec is needed. The label column is auto-detected unless
    --hf-label-col is given; a clip counts as a bark if its label (or label
    name) equals --hf-bark-label.
    NOTE: written without access to the dataset (huggingface.co was blocked),
    so check the printed columns/labels on the first run.
    """
    from datasets import Audio, load_dataset

    ds = load_dataset(HF_DATASET, split=split)
    audio_col = next(c for c, f in ds.features.items() if isinstance(f, Audio))
    if label_col is None:
        label_col = next(c for c in ds.column_names if c != audio_col)
    ds = ds.cast_column(audio_col, Audio(decode=False))
    feature = ds.features[label_col]
    names = getattr(feature, "names", None)
    print(f"HF columns: {ds.column_names}; audio={audio_col!r}, label={label_col!r}, names={names}")

    for i, ex in enumerate(ds):
        raw = ex[label_col]
        label = names[raw] if names is not None else raw
        a = ex[audio_col]
        audio = decode(a["bytes"]) if a.get("bytes") else decode(a["path"])
        yield "hf", a.get("path") or f"{split}[{i}]", str(label) == bark_label, audio


def folder_clips(root: Path):
    """root/bark/* are barks, root/not_bark/* are not."""
    for sub, is_bark in (("bark", True), ("not_bark", False)):
        for p in sorted((root / sub).glob("*")):
            if p.suffix.lower() in AUDIO_EXTS:
                yield "clips", f"{sub}/{p.name}", is_bark, decode(p)


# ---------- metrics ----------

def auc(pos: np.ndarray, neg: np.ndarray) -> float:
    """Chance a random bark outscores a random non-bark (ties count half)."""
    if not len(pos) or not len(neg):
        return float("nan")
    wins = (pos[:, None] > neg[None, :]).sum() + 0.5 * (pos[:, None] == neg[None, :]).sum()
    return float(wins / (len(pos) * len(neg)))


def describe(name: str, s: np.ndarray) -> str:
    if not len(s):
        return f"{name:<10} n=0"
    p10, p50, p90 = np.percentile(s, [10, 50, 90])
    return (
        f"{name:<10} n={len(s):<4} mean={s.mean():.3f}  std={s.std():.3f}  "
        f"min={s.min():.3f}  p10={p10:.3f}  median={p50:.3f}  p90={p90:.3f}  max={s.max():.3f}"
    )


def histogram(s: np.ndarray, bins: int = 10, width: int = 40) -> list[str]:
    counts, edges = np.histogram(s, bins=bins, range=(0, 1))
    top = max(counts.max(), 1)
    return [
        f"  {edges[i]:.1f}-{edges[i + 1]:.1f} {'#' * round(width * c / top):<{width}} {c}"
        for i, c in enumerate(counts)
    ]


PARTS = ["probability", "similarity", "likeness"]


def report(rows: list[dict], threshold: float) -> None:
    for source in sorted({r["source"] for r in rows}) + ["ALL"]:
        sub = rows if source == "ALL" else [r for r in rows if r["source"] == source]
        print(f"\n=== {source} ===")
        for part in PARTS:
            pos = np.array([r[part] for r in sub if r["is_bark"]])
            neg = np.array([r[part] for r in sub if not r["is_bark"]])
            print(f"-- {part}")
            print(describe("barks", pos))
            print(describe("non-barks", neg))
            if len(pos) and len(neg):
                print(f"AUC={auc(pos, neg):.3f}   at threshold {threshold}: "
                      f"barks >= thr {np.mean(pos >= threshold):.0%}, "
                      f"non-barks >= thr {np.mean(neg >= threshold):.1%}")
            if part == "likeness":
                for label, s in (("barks", pos), ("non-barks", neg)):
                    if len(s):
                        print(f" {label} histogram:")
                        print("\n".join(histogram(s)))

    # Non-barks that scored highest: the false alarms worth listening to.
    neg_rows = sorted((r for r in rows if not r["is_bark"]), key=lambda r: -r["likeness"])[:8]
    if neg_rows:
        print("\nHighest-scoring non-barks (likeness / probability / similarity):")
        for r in neg_rows:
            print(f"  {r['likeness']:.3f} / {r['probability']:.3f} / {r['similarity']:.3f}  "
                  f"{r['source']}:{r['name']}")
    pos_rows = sorted((r for r in rows if r["is_bark"]), key=lambda r: r["likeness"])[:8]
    if pos_rows:
        print("Lowest-scoring barks (likeness / probability / similarity):")
        for r in pos_rows:
            print(f"  {r['likeness']:.3f} / {r['probability']:.3f} / {r['similarity']:.3f}  "
                  f"{r['source']}:{r['name']}")


# ---------- main ----------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--esc50", action="store_true", help="use ESC-50 (dog vs other classes)")
    ap.add_argument("--esc50-per-class", type=int, default=10,
                    help="non-dog clips per ESC-50 class (default 10, max 40)")
    ap.add_argument("--hf", action="store_true", help=f"use Hugging Face {HF_DATASET}")
    ap.add_argument("--hf-split", default="train")
    ap.add_argument("--hf-label-col", default=None, help="label column (auto-detected if omitted)")
    ap.add_argument("--hf-bark-label", default="bark", help="label value/name that means bark")
    ap.add_argument("--clips", type=Path, help="folder with bark/ and not_bark/ subfolders")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--out", type=Path, help="write per-clip scores to this CSV")
    args = ap.parse_args()

    sources = []
    if args.esc50:
        sources.append(esc50_clips(args.esc50_per_class))
    if args.hf:
        sources.append(hf_clips(args.hf_split, args.hf_label_col, args.hf_bark_label))
    if args.clips:
        sources.append(folder_clips(args.clips))
    if not sources:
        ap.error("pick at least one of --esc50, --hf, --clips")

    rows = []
    for src in sources:
        for source, name, is_bark, audio in src:
            parts = likeness.likeness_parts(audio, SR)
            rows.append({
                "source": source, "name": name, "is_bark": is_bark,
                **{p: parts[p] for p in PARTS},
            })
            if len(rows) % 50 == 0:
                print(f"  scored {len(rows)} clips", file=sys.stderr)

    report(rows, args.threshold)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["source", "name", "is_bark", *PARTS])
            w.writeheader()
            w.writerows(rows)
        print(f"\nPer-clip scores written to {args.out}")


if __name__ == "__main__":
    main()
