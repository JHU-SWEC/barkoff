"""Score a bark: loudness, dog-likeness and the combined score.

Usage:
    python score.py bark.webm
    python score.py bark.webm --calibration calibration.json
    python score.py bark.webm --json

calibration.json is the file the recorder page's Calibration panel downloads.
Without it, loudness is scored against a typical speaking voice.
"""

import argparse
import json
import sys

import likeness
from audio_io import load_audio
from loudness import (
    DEFAULT_CALIBRATION,
    load_calibration,
    loudness_score,
    max_short_term_loudness,
)

# Likeness-heavy, so sounding like a dog matters more than volume; at the
# planning doc's 0.7 loudness, shouting beat barking. Check against a
# hand-ranked set of team recordings before locking these in.
LOUDNESS_WEIGHT = 0.2
LIKENESS_WEIGHT = 0.8


def score(audio, sr, calibration=None) -> dict:
    """All the numbers for one take."""
    cal = calibration or DEFAULT_CALIBRATION
    lufs = max_short_term_loudness(audio, sr)
    loud = loudness_score(lufs, cal)
    like = likeness.bark_probability(audio, sr)
    return {
        "duration_s": len(audio) / sr,
        "loudness_lufs": lufs,
        "over_speech_lu": lufs - cal.speech_lufs,
        "loudness": loud,
        "likeness": like,
        "score": LOUDNESS_WEIGHT * loud + LIKENESS_WEIGHT * like,
        "calibrated": calibration is not None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Score a bark recording.")
    parser.add_argument("clip", help="audio file (.webm, .m4a, .wav, ...)")
    parser.add_argument("--calibration", help="calibration.json from the recorder page")
    parser.add_argument("--json", action="store_true", help="print the result as JSON")
    args = parser.parse_args()

    try:
        audio, sr = load_audio(args.clip)
    except (RuntimeError, ValueError, OSError) as err:
        sys.exit(str(err))
    calibration = load_calibration(args.calibration) if args.calibration else None
    result = score(audio, sr, calibration)

    if args.json:
        print(json.dumps(result, indent=2))
        return

    baseline = "your speaking voice" if result["calibrated"] else "a typical speaking voice (not calibrated)"
    print(f"Decoded {result['duration_s']:.2f} s at {sr} Hz")
    print(
        f"Loudness  {result['loudness_lufs']:6.1f} LUFS, {result['over_speech_lu']:+.1f} LU over {baseline}"
        f"  ->  {result['loudness']:.2f}"
    )
    print(f"Likeness  {result['likeness']:.2f}  (YAMNet bark probability)")
    print(
        f"Score     {result['score']:.2f}  "
        f"({LOUDNESS_WEIGHT} x loudness + {LIKENESS_WEIGHT} x likeness)"
    )


if __name__ == "__main__":
    main()
