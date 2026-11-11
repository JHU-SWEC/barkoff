"""Elo maths and the ranked queue."""

import pytest

import elo
from matchmaking import BASE_WINDOW, MAX_WINDOW, WIDEN_PER_S, Matchmaker


def test_equal_ratings_expect_half_and_swap_k_over_two():
    assert elo.expected(1200, 1200) == 0.5
    assert elo.update(1200, 1200, 1.0) == (1216, 1184)
    assert elo.update(1200, 1200, 0.5) == (1200, 1200)


def test_upset_moves_more_than_expected_win():
    favourite_wins = elo.update(1400, 1200, 1.0)
    underdog_wins = elo.update(1400, 1200, 0.0)
    assert favourite_wins[0] - 1400 < 1400 - underdog_wins[0]
    assert elo.expected(1600, 1200) == pytest.approx(0.909, abs=0.001)


def test_close_ratings_pair_at_once():
    mm = Matchmaker()
    mm.join("a", 1200, now=0)
    mm.join("b", 1240, now=0)
    assert mm.pair(now=0) == [("a", "b")]
    assert len(mm) == 0


def test_far_ratings_wait_until_both_windows_widen():
    mm = Matchmaker()
    mm.join("a", 1200, now=0)
    mm.join("b", 1400, now=0)
    gap_fits_at = (200 - BASE_WINDOW) / WIDEN_PER_S
    assert mm.pair(now=gap_fits_at - 0.5) == []
    assert mm.pair(now=gap_fits_at + 0.1) == [("a", "b")]


def test_newcomer_is_not_thrown_at_a_far_long_waiter():
    # A has waited long enough for a 200-point gap; B just joined, so B's window is still narrow.
    mm = Matchmaker()
    mm.join("a", 1200, now=0)
    mm.join("b", 1400, now=60)
    assert mm.pair(now=60) == []
    assert mm.window("a", 60) == MAX_WINDOW


def test_longest_waiter_gets_the_closest_rating():
    mm = Matchmaker()
    mm.join("old", 1200, now=0)
    mm.join("near", 1210, now=5)
    mm.join("far", 1240, now=5)
    assert mm.pair(now=5) == [("old", "near")]
    assert "far" in mm


def test_rejoining_keeps_your_place_and_leaving_removes_you():
    mm = Matchmaker()
    mm.join("a", 1200, now=0)
    mm.join("a", 1200, now=30)
    assert mm.waited("a", 30) == 30
    mm.leave("a")
    assert "a" not in mm
    mm.leave("a")  # leaving twice is fine
