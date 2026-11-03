"""Loudness scoring for Bark Off.

Measures the loudest moment of a take as short-term loudness (BS.1770
K-weighted, 400 ms windows) and scores it against the player's calibration,
so a quiet mic and a hot mic are judged on the same scale.

Public interface:
    short_term_loudness(audio, sr)      -> np.ndarray of LUFS, one per 100 ms
    max_short_term_loudness(audio, sr)  -> float LUFS
    loudness_score(lufs, calibration)   -> float in [0, 1]
    load_calibration(path)              -> Calibration

`audio` is a mono float32 waveform in [-1, 1] at its original sample rate.
Don't pass the 16 kHz copy made for YAMNet: the K-weighting boosts the
range above 1.5 kHz, and 16 kHz audio stops at 8 kHz.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyloudnorm

# Short-term loudness: 400 ms windows, matching the planning doc and the
# recorder page's "Loudest 400 ms" figure. A new window every 100 ms.
WINDOW_S = 0.4
HOP_S = 0.1

# BS.1770 constant that makes a full-scale 997 Hz sine read -3.01 LUFS.
LUFS_OFFSET = -0.691

# Anything quieter reads as this, the same floor as the frontend calibration.
FLOOR_LUFS = -70.0

# The score is 0 at ZERO_LU and 1 at FULL_LU, measured against the player's
# speaking voice from calibration. A bark at talking volume earns 0.4; one
# 15 LU (about 3x as loud to the ear) over it earns full marks.
# Provisional: tune these against hand-ranked takes.
ZERO_LU = -10.0
FULL_LU = 15.0

# A take must clear the room noise by this much to count as a bark at all.
MIN_OVER_NOISE_LU = 6.0

# Used when a player hasn't calibrated: a typical laptop mic reading of a
# normal speaking voice. Provisional, from the team's own calibrations.
DEFAULT_SPEECH_LUFS = -30.0
DEFAULT_NOISE_LUFS = -60.0


@dataclass(frozen=True)
class Calibration:
    """A player's baseline, from the recorder page's calibration.json."""

    noise_lufs: float
    speech_lufs: float


DEFAULT_CALIBRATION = Calibration(DEFAULT_NOISE_LUFS, DEFAULT_SPEECH_LUFS)


def load_calibration(path: str | Path) -> Calibration:
    """Read calibration.json as downloaded from the recorder page."""
    data = json.loads(Path(path).read_text())
    return Calibration(float(data["noise_lufs"]), float(data["speech_lufs"]))


def _k_weight(audio: np.ndarray, sr: int) -> np.ndarray:
    """Apply pyloudnorm's own K-weighting stages, the same ones its Meter uses."""
    weighted = np.asarray(audio, dtype=np.float64)
    for stage in pyloudnorm.Meter(sr)._filters.values():
        weighted = stage.apply_filter(weighted)
    return weighted


def short_term_loudness(audio: np.ndarray, sr: int) -> np.ndarray:
    """LUFS of every 400 ms window, one every 100 ms. A clip shorter than a window is one window."""
    weighted = _k_weight(audio, sr)
    window = int(round(WINDOW_S * sr))
    hop = int(round(HOP_S * sr))

    # Cumulative sum of squares turns each window's mean square into one subtraction.
    energy = np.concatenate(([0.0], np.cumsum(weighted**2)))
    if len(weighted) <= window:
        mean_squares = np.array([energy[-1] / max(1, len(weighted))])
    else:
        starts = np.arange(0, len(weighted) - window + 1, hop)
        mean_squares = (energy[starts + window] - energy[starts]) / window

    with np.errstate(divide="ignore"):
        lufs = LUFS_OFFSET + 10 * np.log10(mean_squares)
    return np.maximum(lufs, FLOOR_LUFS)


def max_short_term_loudness(audio: np.ndarray, sr: int) -> float:
    """Loudness of the loudest 400 ms of the take, so one click can't count."""
    return float(short_term_loudness(audio, sr).max())


def loudness_score(lufs: float, calibration: Calibration | None = None) -> float:
    """Map a take's loudest LUFS to [0, 1] against the player's speaking voice."""
    cal = calibration or DEFAULT_CALIBRATION
    if lufs - cal.noise_lufs < MIN_OVER_NOISE_LU:
        return 0.0
    over_speech = lufs - cal.speech_lufs
    return float(np.clip((over_speech - ZERO_LU) / (FULL_LU - ZERO_LU), 0.0, 1.0))
