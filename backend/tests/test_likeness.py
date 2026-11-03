"""Likeness behaviour on real barks from the benchmark clips.

Skipped until the clips are downloaded (python -m benchmark.download). The
tests marked xfail are targets the current scorer misses, measured on
2026-11-03; they are strict, so once a change fixes one, pytest reports it
and the marker must come off. That keeps fixes from quietly regressing.
"""

import numpy as np
import pytest

import likeness
from benchmark.data import clips, have_data, load, place_in_take

pytestmark = pytest.mark.skipif(not have_data(), reason="run python -m benchmark.download first")

STRONG = 20  # same count as benchmark.likeness_report


@pytest.fixture(scope="module")
def strong_barks():
    """The barks the scorer is surest of, so each test isolates one effect."""
    loaded = [load(p) for p in clips("yes")]
    scores = np.array([likeness.bark_probability(a, sr) for a, sr in loaded])
    return [loaded[i] for i in np.argsort(scores)[::-1][:STRONG]]


def mean_score(barks, transform=lambda a, sr: a):
    return float(np.mean([likeness.bark_probability(transform(a, sr), sr) for a, sr in barks]))


def test_strong_barks_score_high(strong_barks):
    assert mean_score(strong_barks) > 0.8


def test_non_barks_rarely_score(strong_barks):
    scores = np.array([likeness.bark_probability(*load(p)) for p in clips("no")])
    assert (scores >= 0.5).mean() <= 0.02


def test_silence_scores_zero():
    assert likeness.bark_probability(np.zeros(16000 * 3, dtype=np.float32), 16000) < 0.05


@pytest.mark.xfail(strict=True, reason="volume leaks into likeness: 0.70 at x0.1 gain vs 0.84")
def test_volume_does_not_change_likeness(strong_barks):
    full = mean_score(strong_barks)
    quiet = mean_score(strong_barks, lambda a, sr: a * 0.1)
    assert abs(full - quiet) < 0.05


@pytest.mark.xfail(strict=True, reason="edges are penalised: 0.67 at 0 s and 0.71 at 4 s vs 0.77 mid-take")
@pytest.mark.parametrize("at_s", [0.0, 4.0])
def test_bark_scores_the_same_anywhere_in_the_take(strong_barks, at_s):
    middle = mean_score(strong_barks, lambda a, sr: place_in_take(a, sr, 2.0))
    edge = mean_score(strong_barks, lambda a, sr: place_in_take(a, sr, at_s))
    assert abs(middle - edge) < 0.05
