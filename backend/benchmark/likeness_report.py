"""Benchmark a likeness scorer on the labelled clips.

Usage (from backend/, after `python -m benchmark.download`):
    python -m benchmark.likeness_report
    python -m benchmark.likeness_report --scorer my_module:my_bark_probability

The scorer is any function (audio, sr) -> float in [0, 1]; the default is
likeness.bark_probability. Paste the printed table into your PR so changes
can be compared on the same clips.

What it measures:
  separation  how well barks rank above non-barks (AUC), and false alarms
  spread      how varied real barks score
  placement   the same bark at the start, middle and end of a 5 s take
  gain        the same bark recorded quieter
  noise       the same bark under white noise
"""

import argparse
import importlib
import sys
import time

import numpy as np

from benchmark.data import add_noise, clips, have_data, load, place_in_take

# Placement, gain and noise use the barks the scorer is surest of, so the
# tests measure the effect itself rather than borderline clips.
STRONG_BARKS = 20
PLACEMENTS_S = (0.0, 2.0, 4.0)
GAINS = (0.02, 0.1, 1.0)
SNRS_DB = (20, 10)
THRESHOLDS = (0.2, 0.5)


def auc(pos: np.ndarray, neg: np.ndarray) -> float:
    """Chance a random bark outscores a random non-bark (ties count half)."""
    greater = (pos[:, None] > neg[None, :]).mean()
    ties = (pos[:, None] == neg[None, :]).mean()
    return float(greater + 0.5 * ties)


def resolve(spec: str):
    module, _, name = spec.partition(":")
    return getattr(importlib.import_module(module), name)


def report(scorer) -> None:
    yes, no = clips("yes"), clips("no")
    started = time.perf_counter()
    loaded_yes = [load(p) for p in yes]
    py = np.array([scorer(a, sr) for a, sr in loaded_yes])
    pn = np.array([scorer(*load(p)) for p in no])

    print(f"Separation  ({len(yes)} barks, {len(no)} non-barks)")
    print(f"  AUC                       {auc(py, pn):.3f}")
    for t in THRESHOLDS:
        print(f"  at {t}: barks found {(py >= t).mean():.2f}, false alarms {(pn >= t).mean():.3f}")

    q10, q50, q90 = np.percentile(py, [10, 50, 90])
    print("Spread of real barks")
    print(f"  median {q50:.2f}, 10th-90th percentile {q10:.2f}-{q90:.2f}, under 0.2: {(py < 0.2).mean():.0%}")

    strong = [loaded_yes[i] for i in np.argsort(py)[::-1][:STRONG_BARKS]]
    alone = np.array([scorer(a, sr) for a, sr in strong])
    print(f"Placement   ({STRONG_BARKS} strongest barks in a 5 s take; alone they average {alone.mean():.2f})")
    for at in PLACEMENTS_S:
        s = np.array([scorer(place_in_take(a, sr, at), sr) for a, sr in strong])
        print(f"  bark at {at:.0f} s               {s.mean():.2f}  (worst drop {np.min(s - alone):+.2f})")

    print("Gain        (same barks, scaled)")
    for g in GAINS:
        s = np.mean([scorer(np.clip(a * g, -1, 1), sr) for a, sr in strong])
        print(f"  x{g:<5}                   {s:.2f}")

    print("Noise       (same barks, white noise)")
    for snr in SNRS_DB:
        s = np.mean([scorer(add_noise(a, snr), sr) for a, sr in strong])
        print(f"  SNR {snr} dB                {s:.2f}")

    print(f"({time.perf_counter() - started:.0f} s)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark a likeness scorer.")
    parser.add_argument("--scorer", default="likeness:bark_probability", help="module:function to benchmark")
    args = parser.parse_args()
    if not have_data():
        sys.exit("No benchmark clips yet. Run: python -m benchmark.download")
    print(f"Scorer: {args.scorer}\n")
    report(resolve(args.scorer))


if __name__ == "__main__":
    main()
