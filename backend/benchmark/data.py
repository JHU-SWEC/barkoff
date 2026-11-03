"""Labelled bark clips for the benchmark and tests.

The clips come from the rmarcosg/bark-detection dataset on Hugging Face
(Apache 2.0): 1 s mono WAVs at 44.1 kHz, labelled yes (bark) or no (other
household sounds). Its card notes that some positives are human barks and a
few are false positives. `python -m benchmark.download` fetches them.
"""

from pathlib import Path

import numpy as np

from audio_io import load_audio

DATA_DIR = Path.home() / ".cache" / "barkoff" / "bark-detection"


def clips(label: str) -> list[Path]:
    """Every downloaded clip with this label ("yes" or "no"), test and validation splits."""
    return sorted(DATA_DIR.glob(f"*/{label}/*.wav"))


def have_data() -> bool:
    return bool(clips("yes")) and bool(clips("no"))


def place_in_take(
    bark: np.ndarray, sr: int, at_s: float, take_s: float = 5.0, noise_dbfs: float = -60.0, seed: int = 0
) -> np.ndarray:
    """Put a bark at at_s inside a take_s recording of faint room noise, like a real take."""
    rng = np.random.default_rng(seed)
    take = rng.normal(0, 10 ** (noise_dbfs / 20), int(take_s * sr)).astype(np.float32)
    start = int(at_s * sr)
    end = min(len(take), start + len(bark))
    take[start:end] += bark[: end - start]
    return take


def add_noise(audio: np.ndarray, snr_db: float, seed: int = 0) -> np.ndarray:
    """White noise at the given signal-to-noise ratio."""
    rng = np.random.default_rng(seed)
    noise_power = np.mean(audio**2) / 10 ** (snr_db / 10)
    return (audio + rng.normal(0, np.sqrt(noise_power), len(audio))).astype(np.float32)


def load(path: Path) -> tuple[np.ndarray, int]:
    return load_audio(path)
