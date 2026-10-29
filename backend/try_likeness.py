"""Sanity check for likeness.py.

Usage:
    python try_likeness.py path/to/clip.webm

Prints the bark probability and the top 5 YAMNet classes for the clip.
"""

import subprocess
import sys

import numpy as np

import likeness


def load_audio_temp(path: str, sr: int = 16000) -> tuple[np.ndarray, int]:
    """TEMPORARY: minimal FFmpeg decode, to be replaced by the teammate's load_audio().

    Asks FFmpeg for raw mono 32-bit float samples at 16 kHz on stdout.
    """
    cmd = [
        "ffmpeg", "-v", "error", "-i", path,
        "-ac", "1", "-ar", str(sr), "-f", "f32le", "-",
    ]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32), sr


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python try_likeness.py <audio file>")

    audio, sr = load_audio_temp(sys.argv[1])
    print(f"Decoded {len(audio) / sr:.2f} s at {sr} Hz")

    print(f"Bark probability: {likeness.bark_probability(audio, sr):.3f}")

    # Top 5 classes, averaged over all frames.
    mean_scores = likeness.frame_scores(audio, sr).mean(axis=0)
    names = likeness.class_names()
    print("Top 5 YAMNet classes (mean over frames):")
    for i in np.argsort(mean_scores)[::-1][:5]:
        print(f"  {mean_scores[i]:.3f}  {names[i]}")

    print(f"Dog classes used: {', '.join(likeness.DOG_CLASSES)}")


if __name__ == "__main__":
    main()
