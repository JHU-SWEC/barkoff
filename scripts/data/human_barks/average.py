"""Combine everyone's scores into one label per clip: python scripts/data/human_barks/average.py

Reads every labels/<scorer>.csv (one per teammate, merged in through git) and writes
average.csv: the mean likeness, the most-voted type, flag counts, how many people scored the
clip, and the spread (max - min likeness), so clips the team disagrees on can be re-listened to.
"""

import csv
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "backend"))
import bark_scores  # noqa: E402

FIELDS = ["id", "scorers", "likeness", "spread", "type", "type_votes", "not_human", "bad_audio"]


def main() -> None:
    avg = bark_scores.averages()
    team = bark_scores.team()
    out = HERE / "average.csv"
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(avg[c] for c in sorted(avg))
    print(f"Wrote {out.relative_to(HERE.parents[2])}: {len(avg)} of {team['clips']} clips have at least one score")
    print("Per scorer:", ", ".join(f"{k} {v}" for k, v in team["scorers"].items()) or "nobody yet")
    print("Clips by number of scorers:", team["clips_by_scorers"])
    split = sorted((a for a in avg.values() if a["spread"] != "" and a["spread"] >= 0.5), key=lambda a: -a["spread"])
    if split:
        print(f"{len(split)} clips where scores differ by 0.5 or more, worth a re-listen:",
              ", ".join(a["id"] for a in split[:20]))


if __name__ == "__main__":
    main()
