"""Decode an audio file to a mono float32 waveform for the scorers.

Public interface:
    load_audio(path) -> (audio, sr)

WAV files are read directly. Anything else (the recorder's .webm, Safari's
.m4a) is decoded with FFmpeg, which must be on PATH.
"""

import shutil
import subprocess
from pathlib import Path

import numpy as np
from scipy.io import wavfile

# Rate FFmpeg decodes to. Browsers record at 44.1 or 48 kHz; 48 kHz keeps
# everything up to 24 kHz, which the loudness filter's high shelf weights.
# likeness.py resamples to 16 kHz on its own.
DECODE_SR = 48000


def _wav(path: Path) -> tuple[np.ndarray, int]:
    """Read a WAV file and scale integer PCM to [-1, 1]."""
    sr, data = wavfile.read(path)
    if data.dtype == np.uint8:
        audio = (data.astype(np.float32) - 128) / 128
    elif np.issubdtype(data.dtype, np.integer):
        audio = data.astype(np.float32) / np.iinfo(data.dtype).max
    else:
        audio = data.astype(np.float32)
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    return audio, int(sr)


def _channels(path: Path) -> int:
    """Channel count of the first audio stream, from ffprobe (installed with FFmpeg)."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=channels", "-of", "csv=p=0", str(path),
    ]
    return int(subprocess.run(cmd, capture_output=True, check=True, text=True).stdout.strip() or 1)


def _ffmpeg(path: Path) -> tuple[np.ndarray, int]:
    """Ask FFmpeg for raw 32-bit float samples at DECODE_SR on stdout, then average to mono."""
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        raise RuntimeError(
            f"FFmpeg is needed to decode {path.suffix} files. "
            "Install it (Mac: brew install ffmpeg) or pass a .wav file."
        )
    # Chrome stores the mono mic as two identical channels. FFmpeg's own
    # downmix (-ac 1) adds them at about 0.7 each, reading 3 dB hot; averaging
    # matches the recorder page and the mic's real level.
    channels = _channels(path)
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(path),
        "-ar", str(DECODE_SR), "-f", "f32le", "-",
    ]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    audio = np.frombuffer(raw, dtype=np.float32).reshape(-1, channels).mean(axis=1)
    return audio.astype(np.float32), DECODE_SR


def load_audio(path: str | Path) -> tuple[np.ndarray, int]:
    """Mono float32 waveform in [-1, 1] and its sample rate."""
    path = Path(path)
    audio, sr = _wav(path) if path.suffix.lower() == ".wav" else _ffmpeg(path)
    if not len(audio):
        raise ValueError(f"{path} decoded to no audio")
    return audio, sr
