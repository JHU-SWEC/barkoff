"""Download the benchmark clips into ~/.cache/barkoff/bark-detection.

Usage (from backend/):
    python -m benchmark.download                 # test split + validation barks + 150 validation non-barks
    python -m benchmark.download --negatives 400

The audio stays out of the repo. The negatives are a fixed random sample, so
everyone on the team benchmarks the same clips.
"""

import argparse
import json
import random
import ssl
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import certifi

from benchmark.data import DATA_DIR

DATASET = "rmarcosg/bark-detection"
API_URL = f"https://huggingface.co/api/datasets/{DATASET}"
FILE_URL = f"https://huggingface.co/datasets/{DATASET}/resolve/main/"
SEED = 0

CONTEXT = ssl.create_default_context(cafile=certifi.where())


def _get(url: str) -> bytes:
    with urllib.request.urlopen(url, context=CONTEXT, timeout=60) as response:
        return response.read()


def pick(files: list[str], negatives: int) -> list[str]:
    """The test split, every validation bark, and a seeded sample of validation non-barks."""
    test = [f for f in files if f.startswith("test/")]
    val_yes = [f for f in files if f.startswith("validation/yes/")]
    val_no = sorted(f for f in files if f.startswith("validation/no/"))
    return test + val_yes + random.Random(SEED).sample(val_no, min(negatives, len(val_no)))


def fetch(name: str) -> None:
    dest = DATA_DIR / name
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(_get(FILE_URL + name))
    tmp.rename(dest)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--negatives", type=int, default=150, help="validation non-barks to sample")
    args = parser.parse_args()

    siblings = json.loads(_get(API_URL))["siblings"]
    files = [s["rfilename"] for s in siblings if s["rfilename"].endswith(".wav")]
    wanted = pick(files, args.negatives)
    print(f"Fetching {len(wanted)} clips into {DATA_DIR}")
    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(fetch, wanted))
    yes = sum("/yes/" in f for f in wanted)
    print(f"Done: {yes} barks, {len(wanted) - yes} non-barks")


if __name__ == "__main__":
    main()
