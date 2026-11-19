"""The duel socket's game loop: messages, pushes, the clock, reconnects, and scoring off the loop."""

import asyncio
import functools
import json
import random
import threading

import numpy as np
import pytest
from websockets.sync.client import connect

import realtime
import likeness
import score as scorer
import scoring_worker
from duels import Arena
from realtime import MAX_TAKE_S, RECONNECT_GRACE_S, Hub, start

A, B = "player-alice", "player-bob"


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


class FakePeer:
    def __init__(self) -> None:
        self.player_id = None
        self.inbox: list[dict] = []
        self.closed = None

    def send(self, message: dict) -> None:
        self.inbox.append(message)

    def close(self, code: int, reason: str) -> None:
        self.closed = (code, reason)

    def of(self, kind: str) -> list[dict]:
        return [m for m in self.inbox if m["type"] == kind]

    def last(self, kind: str) -> dict:
        return self.of(kind)[-1]

    def view(self) -> dict:
        return self.last("duel")["view"]


async def fixed_score(audio, sr, calibration):
    """The take's first sample is its score, so a test picks who wins."""
    return {
        "score": float(audio[0]), "loudness": 0.5, "likeness": 0.6, "loudness_lufs": -25.0,
        "over_speech_lu": 5.0, "calibrated": calibration is not None, "top": [{"name": "Bark", "score": 0.7}],
    }


def take(duel_id: str, round_index: int, score: float, sr: int = 16000, samples: int = 1600, **header) -> bytes:
    head = json.dumps({"duel_id": duel_id, "round": round_index, "sr": sr, "position": "ok", **header}).encode()
    return len(head).to_bytes(4, "little") + head + np.full(samples, score, dtype="<f4").tobytes()


def make_hub(score=fixed_score) -> tuple[Hub, Clock]:
    clock = Clock()
    return Hub(Arena(rng=random.Random(1)), score, clock), clock


async def say(hub: Hub, peer: FakePeer, **msg) -> None:
    await hub.receive(peer, json.dumps(msg))


def secret(pid: str) -> str:
    return f"{pid}-secret"


async def hello(hub: Hub, pid: str, resume: str | None = None, key: str | None = None) -> FakePeer:
    peer = FakePeer()
    await say(hub, peer, type="hello", id=pid, secret=key or secret(pid), resume=resume)
    return peer


async def matched(hub: Hub) -> tuple[str, FakePeer, FakePeer]:
    a, b = await hello(hub, A), await hello(hub, B)
    await say(hub, a, type="queue", name="Alice", dog="shiba")
    await say(hub, b, type="queue", name="Bob", dog="pug")
    return a.view()["id"], a, b


def run(test):
    @functools.wraps(test)
    def sync(*args, **kwargs):
        return asyncio.run(test(*args, **kwargs))

    return sync


# ---------- queue and matchmaking ----------


@run
async def test_two_queued_players_are_matched_and_both_told():
    hub, _ = make_hub()
    a, b = await hello(hub, A), await hello(hub, B)
    assert a.last("welcome")["server_now"] == 1000.0
    await say(hub, a, type="queue", name="Alice", dog="shiba")
    assert a.last("queue") == {"type": "queue", "status": "waiting", "waited_s": 0.0, "window": 50, "in_queue": 1}
    await say(hub, b, type="queue", name="Bob", dog="pug")
    assert b.of("queue") == []  # matched on joining, never waited
    assert a.view()["id"] == b.view()["id"]
    assert a.view()["phase"] == "intro"
    assert a.view()["opponent"]["name"] == "Bob" and b.view()["opponent"]["name"] == "Alice"


@run
async def test_the_matchmaker_keeps_checking_the_queue_as_windows_widen():
    hub, clock = make_hub()
    a, b = await hello(hub, A), await hello(hub, B)
    hub.arena.register(B, "Bob", "pug").elo = 1400  # 200 apart: windows reach that after 15 s
    await say(hub, a, type="queue", name="Alice", dog="shiba")
    await say(hub, b, type="queue", name="Bob", dog="pug")
    waited = 0
    while not a.of("duel") and waited < 30:
        clock.t += 1
        waited += 1
        hub.tick()
    assert waited == 15
    updates = a.of("queue")
    assert [u["waited_s"] for u in updates[1:4]] == [1.0, 2.0, 3.0]
    assert updates[-1]["window"] > updates[0]["window"]
    assert a.view()["id"] == b.view()["id"]


@run
async def test_leaving_the_queue_or_dropping_takes_you_out():
    hub, _ = make_hub()
    a = await hello(hub, A)
    await say(hub, a, type="queue", name="Alice", dog="shiba")
    await say(hub, a, type="leave_queue")
    assert a.last("queue") == {"type": "queue", "status": "idle"}
    assert A not in hub.arena.queue
    await say(hub, a, type="queue", name="Alice", dog="shiba")
    hub.disconnect(a)
    assert A not in hub.arena.queue


# ---------- rounds ----------


@run
async def test_a_round_plays_out_over_the_socket():
    hub, clock = make_hub()
    duel_id, a, b = await matched(hub)
    r = a.view()["round"]
    clock.t = r["window_ends"]
    await hub.receive(a, take(duel_id, 1, 0.9))
    assert a.view()["round"]["submitted"] == {"you": True, "opponent": False}
    assert b.view()["round"]["submitted"] == {"you": False, "opponent": True}
    assert b.view()["rounds"] == []  # the score stays hidden until both are in
    await hub.receive(b, take(duel_id, 1, 0.3))
    mine = a.view()["rounds"][0]
    assert mine["winner"] == "you" and mine["you"]["score"] == pytest.approx(0.9)
    assert b.view()["rounds"][0]["winner"] == "opponent"
    assert a.view()["round"]["index"] == 2


@run
async def test_a_take_before_the_cue_is_refused():
    hub, clock = make_hub()
    duel_id, a, _ = await matched(hub)
    clock.t = a.view()["round"]["cue_at"] - 0.5
    await hub.receive(a, take(duel_id, 1, 0.9))
    assert "Too early" in a.last("error")["message"]


@run
async def test_calibration_travels_with_the_take():
    hub, clock = make_hub()
    duel_id, a, _ = await matched(hub)
    clock.t = a.view()["round"]["window_ends"]
    await hub.receive(a, take(duel_id, 1, 0.9, noise_lufs=-58.0, speech_lufs=-27.5))
    clock.t = a.view()["round"]["deadline"] + 1
    hub.tick()
    assert a.view()["rounds"][0]["you"]["calibrated"] is True


@run
async def test_the_clock_closes_a_round_nobody_barked_in():
    hub, clock = make_hub()
    duel_id, a, b = await matched(hub)
    clock.t = a.view()["round"]["deadline"] + 0.1
    hub.tick()
    for peer in (a, b):
        r = peer.view()["rounds"][0]
        assert r["you"]["foul"] == r["opponent"]["foul"] == "missed"


@run
async def test_scoring_happens_off_the_loop_and_holds_the_round_open():
    gate = asyncio.Event()

    async def slow_score(audio, sr, calibration):
        await gate.wait()
        return await fixed_score(audio, sr, calibration)

    hub, clock = make_hub(slow_score)
    duel_id, a, b = await matched(hub)
    r = a.view()["round"]
    clock.t = r["window_ends"]
    scoring = asyncio.create_task(hub.receive(a, take(duel_id, 1, 0.9)))
    await asyncio.sleep(0)  # Alice's take is now waiting on the scorer...
    await say(hub, b, type="ping", t=42)
    assert b.last("pong") == {"type": "pong", "t": 42, "server_now": r["window_ends"]}  # ...and Bob is still served
    clock.t = r["deadline"] + 2
    hub.tick()
    assert hub.arena.duel_view(duel_id, B, clock.t)["rounds"] == []  # it arrived in time, so the round waits
    gate.set()
    await scoring
    first = a.view()["rounds"][0]
    assert first["you"]["score"] == pytest.approx(0.9) and first["opponent"]["foul"] == "missed"


@run
async def test_a_take_that_fails_to_score_reports_and_lets_the_round_close():
    async def broken(audio, sr, calibration):
        raise RuntimeError("model fell over")

    hub, clock = make_hub(broken)
    duel_id, a, _ = await matched(hub)
    clock.t = a.view()["round"]["window_ends"]
    await hub.receive(a, take(duel_id, 1, 0.9))
    assert a.last("error")["message"] == "model fell over"
    clock.t = a.view()["round"]["deadline"] + 0.1
    hub.tick()
    assert a.view()["rounds"][0]["you"]["foul"] == "missed"


@run
async def test_a_stuck_scorer_cannot_hold_the_round_forever(monkeypatch):
    async def stuck(audio, sr, calibration):
        await asyncio.Event().wait()

    monkeypatch.setattr(realtime, "SCORE_TIMEOUT_S", 0.05)
    hub, clock = make_hub(stuck)
    duel_id, a, _ = await matched(hub)
    clock.t = a.view()["round"]["window_ends"]
    await hub.receive(a, take(duel_id, 1, 0.9))
    assert "took too long" in a.last("error")["message"]
    clock.t = a.view()["round"]["deadline"] + 0.1
    hub.tick()
    assert a.view()["rounds"][0]["you"]["foul"] == "missed"


def test_scoring_worker_runs_every_take_on_one_thread_of_its_own(monkeypatch):
    monkeypatch.setattr(scoring_worker, "score_take", lambda *_: {"thread": threading.current_thread().name})

    async def from_the_loop():
        return await scoring_worker.score_async(np.zeros(4, "<f4"), 16000, None), threading.current_thread().name

    result, loop_thread = asyncio.run(from_the_loop())
    assert result["thread"].startswith("scoring") and result["thread"] != loop_thread
    assert scoring_worker.score(np.zeros(4, "<f4"), 16000, None) == result  # HTTP takes queue on the same thread


# ---------- bots ----------


@run
async def test_a_bot_duel_runs_over_the_socket():
    hub, clock = make_hub()
    a = await hello(hub, A)
    await say(hub, a, type="bot", name="Alice", dog="shiba", level="hard")
    view = a.view()
    assert view["ranked"] is False and view["opponent"]["id"].startswith("bot-hard")
    clock.t = view["round"]["window_ends"]
    await hub.receive(a, take(view["id"], 1, 0.5))
    assert len(a.view()["rounds"]) == 1  # the bot barked on its own


# ---------- connections ----------


@run
async def test_a_dropped_player_can_come_back_to_the_duel():
    hub, clock = make_hub()
    duel_id, a, b = await matched(hub)
    hub.disconnect(a)
    clock.t += RECONNECT_GRACE_S - 1
    hub.tick()
    back = await hello(hub, A, resume=duel_id)
    assert back.view()["id"] == duel_id and back.view()["result"] is None
    clock.t += RECONNECT_GRACE_S
    hub.tick()
    assert hub.arena.duels[duel_id].ended_at is None
    assert b.view()["result"] is None


@run
async def test_a_dropped_player_forfeits_once_the_grace_runs_out():
    hub, clock = make_hub()
    duel_id, a, b = await matched(hub)
    hub.disconnect(a)
    clock.t += RECONNECT_GRACE_S + 0.1
    hub.tick()
    result = b.view()["result"]
    assert result["winner"] == "you" and result["forfeit"] == "opponent" and result["elo_change"] == 16


@run
async def test_a_fresh_page_gives_up_the_old_duel_and_closes_the_old_socket():
    # A reload mid-duel: same player id, nothing to resume.
    hub, _ = make_hub()
    duel_id, a, b = await matched(hub)
    await hello(hub, A)
    assert a.closed is not None and a.closed[0] == 4000
    assert b.view()["result"]["forfeit"] == "opponent"
    await say(hub, a, type="forfeit")  # the replaced socket is ignored from now on
    assert a.of("error") == []


@run
async def test_forfeit_tells_the_opponent():
    hub, _ = make_hub()
    _, a, b = await matched(hub)
    await say(hub, a, type="forfeit")
    assert a.view()["result"]["winner"] == "opponent"
    assert b.view()["result"]["forfeit"] == "opponent"


@run
async def test_bad_messages_get_an_error_not_a_crash():
    hub, _ = make_hub()
    peer = FakePeer()
    await say(hub, peer, type="ping", t=1)
    await say(hub, peer, type="hello", id="no", secret=secret(A))
    await say(hub, peer, type="hello", id=A)
    await hub.receive(peer, b"\x00\x01")
    assert [m["message"] for m in peer.of("error")] == [
        "Say hello first.",
        "id must be 8-64 letters, digits, - or _",
        "secret must be 8-64 letters, digits, - or _",
        "Say hello first.",
    ]
    peer = await hello(hub, A)
    for bad in ["not json", "[1, 2]", json.dumps({"type": "dance"}), "x" * 5000]:
        await hub.receive(peer, bad)
    await say(hub, peer, type="queue", name="   ", dog="shiba")
    await hub.receive(peer, b"\xff\xff\xff\xff{}")
    await hub.receive(peer, take("nope", 1, 0.5)[:-1])
    await hub.receive(peer, take("nope", 1, 0.5, sr=4000))
    await hub.receive(peer, take("nope", 1, 0.5, noise_lufs=-50.0))
    await hub.receive(peer, take("nope", 1, 0.5, samples=int(16000 * MAX_TAKE_S) + 1))
    await hub.receive(peer, take("nope", 1, 0.5))
    assert len(peer.of("error")) == 11
    assert peer.of("error")[-2]["message"] == f"A take is at most {MAX_TAKE_S:g} s."
    assert peer.of("error")[-1]["message"] == "No such duel for this player."


@run
async def test_knowing_a_players_id_is_not_enough_to_be_them():
    # Opponents see each other's id in every duel view, so the id can't be the credential.
    hub, _ = make_hub()
    duel_id, a, b = await matched(hub)
    impostor = await hello(hub, A, key="bob-guessing-the-secret")
    assert impostor.last("error")["message"] == "That player id belongs to someone else."
    assert impostor.player_id is None and a.closed is None
    await say(hub, impostor, type="forfeit")
    assert hub.arena.duels[duel_id].ended_at is None


@run
async def test_resuming_a_duel_the_server_no_longer_has():
    # The server restarted: everything in memory is gone, so the page must leave that duel.
    hub, _ = make_hub()
    back = await hello(hub, A, resume="duel-from-before")
    assert back.last("duel_gone") == {"type": "duel_gone", "duel_id": "duel-from-before"}


@run
async def test_one_broken_duel_does_not_stop_the_others(monkeypatch, caplog):
    hub, clock = make_hub()
    first, a, _ = await matched(hub)
    c, d = await hello(hub, "player-carol"), await hello(hub, "player-dave")
    await say(hub, c, type="queue", name="Carol", dog="corgi")
    await say(hub, d, type="queue", name="Dave", dog="husky")
    advance = hub.arena.advance
    monkeypatch.setattr(hub.arena, "advance", lambda duel_id, now: 1 / 0 if duel_id == first else advance(duel_id, now))
    clock.t = c.view()["round"]["deadline"] + 0.1
    hub.tick()
    hub.tick()
    assert c.view()["rounds"][0]["you"]["foul"] == "missed"  # the healthy duel moved on
    assert first not in hub.pushed and caplog.text.count("ZeroDivisionError") == 1  # logged once, not every tick


def test_a_full_line_of_http_takes_is_turned_away():
    held = [scoring_worker.http_slot() for _ in range(scoring_worker.MAX_WAITING_HTTP)]
    for slot in held:
        slot.__enter__()
    try:
        with pytest.raises(scoring_worker.Busy):
            with scoring_worker.http_slot():
                pass
    finally:
        for slot in held:
            slot.__exit__(None, None, None)
    with scoring_worker.http_slot():  # free again
        pass


def test_a_non_number_score_fails_loudly_instead_of_breaking_json(monkeypatch):
    monkeypatch.setattr(likeness, "frame_scores", lambda audio, sr: np.zeros((1, 3)))
    monkeypatch.setattr(likeness, "class_names", lambda: ["a", "b", "c"])
    monkeypatch.setattr(scorer, "score", lambda audio, sr, cal: {"score": float("nan"), "loudness": 0.5, "likeness": 0.5})
    with pytest.raises(ValueError, match="score=nan"):
        scoring_worker.score_take(np.zeros(4, "<f4"), 16000, None)


def test_the_server_starts_even_if_the_reference_barks_cannot_download(monkeypatch, caplog):
    monkeypatch.setattr(likeness, "dog_class_indices", lambda: [])
    monkeypatch.setattr(likeness, "frame_length", lambda: 15600)

    def offline():
        raise OSError("no network")

    monkeypatch.setattr(likeness, "reference_embeddings", offline)
    scoring_worker.warm_up()
    assert "first take will try again" in caplog.text


# ---------- the real socket ----------


def test_a_real_socket_plays_a_round_with_a_full_size_take():
    clock = Clock()
    hub = Hub(Arena(rng=random.Random(2)), fixed_score, clock)
    start(hub, "localhost", 0)
    with connect(f"ws://localhost:{hub.port}/ws") as ws:
        ws.send(json.dumps({"type": "hello", "id": A, "secret": secret(A), "resume": None}))
        assert json.loads(ws.recv())["type"] == "welcome"
        ws.send(json.dumps({"type": "bot", "name": "Alice", "dog": "shiba", "level": "easy"}))
        view = json.loads(ws.recv())["view"]
        clock.t = view["round"]["window_ends"]
        # 5 s at 96 kHz: ~1.9 MB, past websockets' 1 MiB default limit.
        ws.send(take(view["id"], 1, 0.8, sr=96000, samples=5 * 96000))
        view = json.loads(ws.recv())["view"]
        assert view["rounds"][0]["you"]["score"] == pytest.approx(0.8)
    # Other threads (the HTTP handlers) read game state through the loop.
    assert hub.call(lambda: hub.arena.players[A].name) == "Alice"
