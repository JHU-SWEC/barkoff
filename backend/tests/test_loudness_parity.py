"""The recorder page and the scorer must agree on loudness.

Runs frontend/src/loudness.ts (Aiden's port of pyloudnorm) in Node on the
same audio as the Python side and compares:
  - integrated loudness, which the page's calibration uses
  - every 400 ms window on the scorer's 100 ms grid, which checks the
    K-weighting filters themselves

The page's "Loudest 400 ms" slides in 20 ms steps, so it can read a little
higher than the scorer's 100 ms grid on the same take; that difference is
window placement, not the filter. Skipped when Node 22.6+ isn't installed.
"""

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pyloudnorm
import pytest

from benchmark.data import clips, have_data, load, place_in_take
from loudness import FLOOR_LUFS, HOP_S, LUFS_OFFSET, WINDOW_S, short_term_loudness

LOUDNESS_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "loudness.ts"

# Node reads raw float32 samples, runs the page's code, prints JSON.
NODE_SCRIPT = """
import { readFileSync } from 'node:fs'
import { kWeight, integratedLoudness } from %s
const [path, rate, windowS, hopS, offset] = process.argv.slice(2).map((v, i) => (i ? Number(v) : v))
const buf = readFileSync(path)
const x = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
const w = kWeight(x, rate)
const win = Math.round(windowS * rate), hop = Math.round(hopS * rate)
const shortTerm = []
for (let s = 0; s + win <= w.length; s += hop) {
  let sum = 0
  for (let i = s; i < s + win; i++) sum += w[i] * w[i]
  shortTerm.push(offset + 10 * Math.log10(sum / win))
}
console.log(JSON.stringify({ integrated: integratedLoudness(w, rate), shortTerm }))
"""

TOLERANCE_LU = 0.1


def node_supports_typescript() -> bool:
    node = shutil.which("node")
    if not node:
        return False
    major, minor = (int(v) for v in subprocess.run([node, "-v"], capture_output=True, text=True).stdout[1:].split(".")[:2])
    return (major, minor) >= (22, 6)


pytestmark = pytest.mark.skipif(not node_supports_typescript(), reason="needs Node 22.6+ to run loudness.ts")


def run_page_loudness(audio: np.ndarray, sr: int, tmp_path: Path) -> dict:
    samples = tmp_path / "samples.f32"
    samples.write_bytes(audio.astype("<f4").tobytes())
    script = tmp_path / "page_loudness.mjs"
    script.write_text(NODE_SCRIPT % json.dumps(LOUDNESS_TS.as_uri()))
    out = subprocess.run(
        ["node", "--no-warnings", str(script), str(samples), str(sr), str(WINDOW_S), str(HOP_S), str(LUFS_OFFSET)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def takes() -> list[tuple[str, np.ndarray, int]]:
    rng = np.random.default_rng(0)
    sr = 48000
    t = np.arange(3 * sr) / sr
    out = [
        ("tone", (0.2 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), sr),
        ("noise", rng.normal(0, 0.05, 3 * sr).astype(np.float32), sr),
    ]
    if have_data():
        for path in clips("yes")[:3]:
            bark, bsr = load(path)
            out.append((path.name, place_in_take(bark, bsr, 1.5), bsr))
    return out


@pytest.mark.parametrize("name,audio,sr", takes(), ids=lambda v: v if isinstance(v, str) else "")
def test_page_and_scorer_agree(name, audio, sr, tmp_path):
    page = run_page_loudness(audio, sr, tmp_path)
    assert page["integrated"] == pytest.approx(pyloudnorm.Meter(sr).integrated_loudness(audio), abs=TOLERANCE_LU)
    ours = short_term_loudness(audio, sr)
    # The scorer floors silence at -70 LUFS; the page's raw windows don't.
    theirs = np.maximum(np.array(page["shortTerm"]), FLOOR_LUFS)
    assert len(theirs) == len(ours)
    assert np.max(np.abs(theirs - ours)) < TOLERANCE_LU
