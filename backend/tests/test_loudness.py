"""Loudness: known BS.1770 values, the 400 ms window, and the calibration mapping."""

import numpy as np
import pyloudnorm
import pytest

from loudness import (
    FLOOR_LUFS,
    FULL_LU,
    ZERO_LU,
    Calibration,
    load_calibration,
    loudness_score,
    max_short_term_loudness,
    short_term_loudness,
)

SR = 48000


def sine(amplitude: float, seconds: float, hz: float = 997.0, sr: int = SR) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return (amplitude * np.sin(2 * np.pi * hz * t)).astype(np.float32)


@pytest.mark.parametrize("dbfs", [-3.0, -20.0, -40.0])
def test_sine_reads_its_bs1770_level(dbfs):
    # BS.1770: a 997 Hz sine reads 3.01 dB under its peak level in LUFS.
    audio = sine(10 ** (dbfs / 20), 2.0)
    assert max_short_term_loudness(audio, SR) == pytest.approx(dbfs - 3.01, abs=0.05)


@pytest.mark.parametrize("sr", [16000, 44100, 48000])
def test_matches_pyloudnorm_on_a_steady_tone(sr):
    # On a steady signal every 400 ms window equals the integrated loudness.
    audio = sine(0.3, 3.0, hz=440, sr=sr)
    expected = pyloudnorm.Meter(sr).integrated_loudness(audio)
    assert np.median(short_term_loudness(audio, sr)) == pytest.approx(expected, abs=0.05)


def test_one_click_does_not_count_as_loud():
    # A single full-scale sample in silence is a mic bump. Spread over a 400 ms
    # window it reads about -40 LUFS, 20-30 LU under a real bark; a raw peak
    # meter would have called it 0 dBFS.
    audio = np.zeros(SR * 2, dtype=np.float32)
    audio[SR] = 1.0
    assert max_short_term_loudness(audio, SR) < -35


def test_finds_the_loudest_400_ms():
    quiet = sine(0.01, 2.0)
    loud = sine(0.5, 0.4)
    audio = np.concatenate([quiet, loud, quiet])
    assert max_short_term_loudness(audio, SR) == pytest.approx(20 * np.log10(0.5) - 3.01, abs=0.3)


def test_silence_reads_the_floor():
    assert max_short_term_loudness(np.zeros(SR, dtype=np.float32), SR) == FLOOR_LUFS


def test_clip_shorter_than_a_window_still_scores():
    assert np.isfinite(max_short_term_loudness(sine(0.5, 0.2), SR))


def test_score_mapping_against_speech():
    cal = Calibration(noise_lufs=-60, speech_lufs=-30)
    assert loudness_score(-30 + ZERO_LU, cal) == 0.0
    assert loudness_score(-30 + FULL_LU, cal) == 1.0
    assert loudness_score(-30 + FULL_LU + 10, cal) == 1.0
    assert 0 < loudness_score(-30, cal) < 1


def test_same_bark_scores_the_same_on_a_hot_and_a_quiet_mic():
    # A mic 12 dB hotter reads speech and bark 12 dB louder: the score must not change.
    quiet_mic = Calibration(noise_lufs=-62, speech_lufs=-34)
    hot_mic = Calibration(noise_lufs=-50, speech_lufs=-22)
    assert loudness_score(-20, quiet_mic) == pytest.approx(loudness_score(-8, hot_mic))


def test_take_lost_in_room_noise_scores_zero():
    cal = Calibration(noise_lufs=-35, speech_lufs=-30)
    assert loudness_score(-32, cal) == 0.0


def test_reads_the_recorder_pages_calibration_json(tmp_path):
    path = tmp_path / "calibration.json"
    path.write_text('{"noise_lufs": -58.2, "speech_lufs": -27.5, "device": "Mic", "sample_rate": 48000}')
    assert load_calibration(path) == Calibration(-58.2, -27.5)
