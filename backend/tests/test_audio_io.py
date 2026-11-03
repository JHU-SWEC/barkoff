"""load_audio must read recordings at the mic's real level."""

import shutil
import subprocess

import numpy as np
import pytest
from scipy.io import wavfile

from audio_io import load_audio
from loudness import max_short_term_loudness

SR = 48000


def tone(seconds: float = 2.0, amplitude: float = 0.2) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return (amplitude * np.sin(2 * np.pi * 440 * t)).astype(np.float32)


def test_reads_int16_wav_at_its_level(tmp_path):
    path = tmp_path / "take.wav"
    wavfile.write(path, SR, (tone() * 32767).astype(np.int16))
    audio, sr = load_audio(path)
    assert sr == SR
    assert np.abs(audio).max() == pytest.approx(0.2, abs=1e-3)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
def test_two_channel_webm_reads_like_the_mono_mic(tmp_path):
    # Chrome stores the mono mic as two identical Opus channels. FFmpeg's own
    # mono downmix read these 3 dB hot; the page and the scorer must not.
    # Two full-level copies, like Chrome; FFmpeg's -ac 2 upmix would drop each by 3 dB.
    mono = tone()
    wav = tmp_path / "mic.wav"
    wavfile.write(wav, SR, np.stack([mono, mono], axis=1))
    webm = tmp_path / "take.webm"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(wav), "-c:a", "libopus", "-b:a", "128k", str(webm)],
        check=True,
    )
    audio, sr = load_audio(webm)
    assert max_short_term_loudness(audio, sr) == pytest.approx(max_short_term_loudness(mono, SR), abs=0.2)
