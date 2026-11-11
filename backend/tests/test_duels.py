"""Duel rounds on a fake clock: cue timing, scoring, replays, forfeits and Elo."""

import random

import pytest

from duels import (
    COUNTDOWN_S,
    CUE_DELAY_S,
    INTRO_S,
    STAGES,
    MAX_ROUNDS,
    RESULT_S,
    SUBMIT_GRACE_S,
    Arena,
    Bark,
    DuelError,
    bark_from_score,
)


def bark(score: float) -> Bark:
    return Bark(score, score, score)


@pytest.fixture
def match():
    arena = Arena(rng=random.Random(1))
    arena.register("a", "Alice", "shiba")
    arena.register("b", "Bob", "pug")
    arena.join_queue("a", now=0)
    status = arena.join_queue("b", now=0)
    assert status["status"] == "matched"
    return arena, status["duel_id"]


def play_round(arena, duel_id, score_a, score_b):
    """Both players bark in the current round; returns the time it resolved."""
    view = arena.duel_view(duel_id, "a", now=0)
    r = view["round"]
    at = max(r["window_ends"], view["server_now"])
    arena.submit(duel_id, "a", r["index"], bark(score_a), now=at)
    arena.submit(duel_id, "b", r["index"], bark(score_b), now=at)
    return at


def test_both_players_see_the_same_cue_inside_the_planned_gap(match):
    arena, duel_id = match
    a = arena.duel_view(duel_id, "a", now=0)
    b = arena.duel_view(duel_id, "b", now=0)
    assert a["phase"] == "intro"
    assert a["round"]["cue_at"] == b["round"]["cue_at"]
    gap = a["round"]["cue_at"] - (INTRO_S + COUNTDOWN_S)
    assert CUE_DELAY_S[0] <= gap <= CUE_DELAY_S[1]
    assert a["opponent"]["name"] == "Bob" and b["opponent"]["name"] == "Alice"
    # Same map and intro clock on both screens.
    assert a["stage"] == b["stage"] and a["stage"] in STAGES
    assert a["intro_at"] == b["intro_at"] == 0


def test_phases_follow_the_clock(match):
    arena, duel_id = match
    r = arena.duel_view(duel_id, "a", now=0)["round"]
    phase = lambda t: arena.duel_view(duel_id, "a", now=t)["phase"]  # noqa: E731
    assert phase(r["starts_at"] + 0.1) == "countdown"
    assert phase(r["cue_at"] + 0.1) == "bark"
    assert phase(r["window_ends"] + 0.1) == "scoring"


def test_cannot_bark_before_the_cue(match):
    arena, duel_id = match
    r = arena.duel_view(duel_id, "a", now=0)["round"]
    with pytest.raises(DuelError, match="Too early"):
        arena.submit(duel_id, "a", 1, bark(0.9), now=r["cue_at"] - 0.1)


def test_opponent_score_is_hidden_until_the_round_resolves(match):
    arena, duel_id = match
    r = arena.duel_view(duel_id, "a", now=0)["round"]
    view = arena.submit(duel_id, "a", 1, bark(0.9), now=r["window_ends"])
    assert view["rounds"] == []
    assert view["round"]["submitted"] == {"you": True, "opponent": False}
    assert arena.duel_view(duel_id, "b", now=r["window_ends"])["round"]["submitted"]["opponent"] is True


def test_two_round_wins_end_the_duel_and_move_elo(match):
    arena, duel_id = match
    play_round(arena, duel_id, 0.8, 0.5)
    after_one = arena.duel_view(duel_id, "a", now=0)
    assert after_one["wins"] == {"you": 1, "opponent": 0}
    assert after_one["round"]["index"] == 2
    at = play_round(arena, duel_id, 0.7, 0.6)

    a = arena.duel_view(duel_id, "a", now=at)
    b = arena.duel_view(duel_id, "b", now=at)
    assert a["phase"] == "over"
    assert a["result"]["winner"] == "you" and b["result"]["winner"] == "opponent"
    assert a["result"]["elo_change"] == 16 and b["result"]["elo_change"] == -16
    assert [r["winner"] for r in b["rounds"]] == ["opponent", "opponent"]
    assert arena.players["a"].wins == 1 and arena.players["b"].losses == 1
    # Free to queue again.
    assert arena.queue_status("a", now=at)["status"] == "idle"


def test_next_round_starts_after_the_result_pause(match):
    arena, duel_id = match
    at = play_round(arena, duel_id, 0.8, 0.5)
    view = arena.duel_view(duel_id, "a", now=at + 1)
    assert view["phase"] == "result"
    assert view["next_at"] == pytest.approx(at + RESULT_S)


def test_tied_round_is_replayed(match):
    arena, duel_id = match
    play_round(arena, duel_id, 0.6, 0.6)
    view = arena.duel_view(duel_id, "a", now=0)
    assert view["rounds"][0]["winner"] == "tie"
    assert view["wins"] == {"you": 0, "opponent": 0}
    assert view["round"]["index"] == 2


def test_a_take_that_never_arrives_scores_zero(match):
    arena, duel_id = match
    r = arena.duel_view(duel_id, "a", now=0)["round"]
    arena.submit(duel_id, "a", 1, bark(0.4), now=r["window_ends"])
    view = arena.duel_view(duel_id, "a", now=r["window_ends"] + SUBMIT_GRACE_S + 0.1)
    assert view["rounds"][0]["opponent"]["foul"] == "missed"
    assert view["rounds"][0]["winner"] == "you"


def test_abandoned_duel_ends_in_a_draw(match):
    arena, duel_id = match
    view = arena.duel_view(duel_id, "a", now=10_000)
    assert view["phase"] == "over"
    assert len(view["rounds"]) == MAX_ROUNDS
    assert view["result"]["winner"] == "draw"
    assert view["result"]["elo_change"] == 0


def test_camera_foul_zeroes_the_score():
    result = {"score": 0.9, "loudness": 1.0, "likeness": 0.88}
    assert bark_from_score(result, "ok").score == 0.9
    foul = bark_from_score(result, "close")
    assert foul.score == 0 and foul.foul == "close" and foul.likeness == 0.88
    assert bark_from_score(result, "anything else").foul == "unchecked"


def test_bark_keeps_the_measurements_behind_its_scores():
    result = {
        "score": 0.74, "loudness": 0.6, "likeness": 0.8, "loudness_lufs": -24.5,
        "over_speech_lu": 5.0, "calibrated": True, "top": [{"name": "Bark", "score": 0.71}],
    }
    shown = bark_from_score(result, "ok").public()
    assert shown["lufs"] == -24.5 and shown["over_speech_lu"] == 5.0 and shown["calibrated"] is True
    assert shown["heard"] == "Bark" and shown["heard_score"] == 0.71
    assert Bark.missed().public()["lufs"] is None


def test_bot_barks_come_with_believable_measurements():
    b = Arena(rng=random.Random(2))._bot_bark("bot-hard-x")
    assert b.lufs is not None and b.heard in {"Bark", "Dog", "Animal"}
    # The loudness score and the LU over speech agree (loudness.py's mapping).
    assert b.loudness == pytest.approx((b.over_speech_lu + 10) / 25, abs=0.01)


def test_strangers_cannot_read_or_bark_in_a_duel(match):
    arena, duel_id = match
    arena.register("c", "Carol", "corgi")
    with pytest.raises(DuelError):
        arena.duel_view(duel_id, "c", now=0)


def test_queueing_again_forfeits_the_unfinished_duel(match):
    # A reload mid-duel, then Find a match: the old duel goes to the opponent.
    arena, duel_id = match
    assert arena.join_queue("a", now=1)["status"] == "waiting"
    them = arena.duel_view(duel_id, "b", now=1)
    assert them["phase"] == "over"
    assert them["result"]["winner"] == "you" and them["result"]["forfeit"] == "opponent"
    assert them["result"]["elo_change"] == 16
    assert arena.players["a"].losses == 1


def test_leaderboard_orders_by_elo(match):
    arena, duel_id = match
    play_round(arena, duel_id, 0.2, 0.9)
    play_round(arena, duel_id, 0.2, 0.9)
    assert [p["name"] for p in arena.leaderboard()] == ["Bob", "Alice"]


@pytest.fixture
def bot_match():
    arena = Arena(rng=random.Random(3))
    arena.register("a", "Alice", "shiba")
    status = arena.start_bot_duel("a", "hard", now=0)
    return arena, status["duel_id"]


def test_bot_barks_on_its_own_and_the_round_resolves(bot_match):
    arena, duel_id = bot_match
    view = arena.duel_view(duel_id, "a", now=0)
    assert view["ranked"] is False
    assert view["opponent"]["id"].startswith("bot-hard")
    assert view["opponent"]["dog"] != view["you"]["dog"]
    assert view["window_s"] == 5.0
    r = view["round"]
    view = arena.submit(duel_id, "a", 1, bark(0.5), now=r["window_ends"] + 1)
    assert len(view["rounds"]) == 1
    assert 0 < view["rounds"][0]["opponent"]["score"] <= 1


def test_bot_duels_are_unranked_and_off_the_leaderboard(bot_match):
    arena, duel_id = bot_match
    view = arena.duel_view(duel_id, "a", now=10_000)
    assert view["phase"] == "over"
    assert view["result"]["elo_change"] == 0
    assert arena.players["a"].elo == 1200 and arena.players["a"].wins == 0 and arena.players["a"].losses == 0
    assert [p["name"] for p in arena.leaderboard()] == ["Alice"]
    # Free to play again afterwards.
    assert arena.start_bot_duel("a", "easy", now=10_001)["status"] == "matched"


def test_hard_bot_outscores_easy_bot_on_average():
    arena = Arena(rng=random.Random(5))
    easy = [arena._bot_bark("bot-easy-x").score for _ in range(200)]
    hard = [arena._bot_bark("bot-hard-x").score for _ in range(200)]
    assert sum(hard) / 200 > sum(easy) / 200 + 0.3
    assert all(0 < s <= 1 for s in easy + hard)


def test_new_bot_duel_replaces_an_unfinished_one(bot_match):
    # The reported bug: leaving a bot duel early and starting another said "Finish your current duel first".
    arena, old_id = bot_match
    new = arena.start_bot_duel("a", "easy", now=1)
    assert new["status"] == "matched" and new["duel_id"] != old_id
    old = arena.duel_view(old_id, "a", now=1)
    assert old["phase"] == "over" and old["result"]["forfeit"] == "you"
    assert arena.players["a"].elo == 1200 and arena.players["a"].losses == 0  # practice: no record
    assert arena.duel_view(new["duel_id"], "a", now=1)["phase"] == "intro"


def test_forfeit_without_a_duel_does_nothing():
    arena = Arena()
    arena.register("a", "Alice", "shiba")
    arena.forfeit("a", now=0)


def test_bot_needs_a_known_level(bot_match):
    arena, _ = bot_match
    arena.register("b", "Bob", "pug")
    with pytest.raises(DuelError, match="level"):
        arena.start_bot_duel("b", "impossible", now=1)
