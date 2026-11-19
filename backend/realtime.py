"""Realtime duels over WebSocket: one asyncio event loop owns the queue and every duel.

Started by server.py (python server.py) on ws://localhost:8001/ws. In dev, Vite
proxies /ws there, so the page just connects to /ws on its own host.

Threads in the server process:
    game loop  this module. Every socket, the matchmaker and every duel. One thread
               switches between sockets while each waits on the network, so game
               state (duels.Arena) has a single owner and needs no locks.
    scoring    scoring_worker.py. A take is handed over and awaited, so a slow YAMNet
               run never stalls the loop: other sockets are served meanwhile.
    HTTP       server.py, a thread per request. Reaches game state only through
               Hub.call, which runs the call on the game loop.

Every TICK_S the loop applies the clock to live duels (deadlines, the bot's bark).
Every QUEUE_TICK_S it runs the matchmaker over the queue and tells waiting players
how the search is going. A duel's players get a fresh view whenever it changes
(duels.Duel.revision); countdowns and the BARK! cue each screen works out itself
from the round times and a clock synced by ping/pong.

Protocol. Text frames are small JSON objects with a "type".
  Client -> server
    {"type": "hello", "id", "secret", "resume": duel_id | null}  first: who this socket is.
        id is public (opponents and the leaderboard see it); secret never leaves this tab, and
        the first hello for an id binds it, so knowing someone's id isn't enough to be them.
        resume is the unfinished duel the page is showing (it lost its connection). Any other
        unfinished duel is forfeited: the page that was playing it is gone (a reload, a closed tab).
    {"type": "queue", "name", "dog"}             join the ranked queue (registers or renames the guest)
    {"type": "leave_queue"}
    {"type": "bot", "name", "dog", "level"}      unranked practice duel: easy | normal | hard
    {"type": "forfeit"}                          leave the unfinished duel; the opponent wins
    {"type": "ping", "t"}                        clock sync; t comes back in the pong
    binary frame: a round's take                 uint32 LE header length, then a JSON header
        {"duel_id", "round", "sr", "position"[, "noise_lufs", "speech_lufs"]}, then mono float32
        LE samples at sr (the same audio as POST /api/score), at most MAX_TAKE_S long. position
        is the camera verdict.
  Server -> client
    {"type": "welcome", "server_now"}
    {"type": "queue", "status": "waiting", "waited_s", "window", "in_queue"} or {..., "status": "idle"}
    {"type": "duel", "view"}                     duels.Arena.duel_view for this player
    {"type": "duel_gone", "duel_id"}             the duel to resume isn't here (the server restarted)
    {"type": "pong", "t", "server_now"}
    {"type": "error", "message"}                 safe to show the player

A dropped socket leaves the queue at once. In a duel, the player has
RECONNECT_GRACE_S to come back (hello with resume) before the duel is forfeited;
the rounds keep running meanwhile, so a missed bark window still scores 0.
"""

import asyncio
import hmac
import json
import logging
import re
import threading
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

import numpy as np
from websockets.asyncio.server import ServerConnection, broadcast, serve
from websockets.exceptions import ConnectionClosed

from duels import Arena, DuelError, bark_from_score
from loudness import Calibration

TICK_S = 0.2
QUEUE_TICK_S = 1.0
RECONNECT_GRACE_S = 5.0
CALL_TIMEOUT_S = 5.0
SCORE_TIMEOUT_S = 20.0  # a take normally scores in well under a second
MAX_TEXT_CHARS = 4096
MAX_HEADER_BYTES = 4096
MAX_RATE = 192000
MAX_TAKE_S = 10.0  # the bark window is 5 s; the rest is slack for a slow recorder
# The biggest take: 10 s at 192 kHz, about 7.7 MB. Few frames wait per socket while one is handled.
MAX_MESSAGE_BYTES = 4 + MAX_HEADER_BYTES + int(MAX_TAKE_S * MAX_RATE) * 4
MAX_QUEUED_FRAMES = 4
TOKEN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MAX_NAME = 24

log = logging.getLogger("barkoff.realtime")

Scorer = Callable[[np.ndarray, int, Calibration | None], Awaitable[dict]]


class BadMessage(Exception):
    """A message the server can't use; the text is safe to show the player."""


class Peer(Protocol):
    """One connected socket, as the hub sees it. Tests use a stand-in."""

    player_id: str | None

    def send(self, message: dict) -> None: ...

    def close(self, code: int, reason: str) -> None: ...


class SocketPeer:
    def __init__(self, ws: ServerConnection) -> None:
        self.ws = ws
        self.player_id: str | None = None
        self._closing: asyncio.Task | None = None

    def send(self, message: dict) -> None:
        # broadcast() writes without waiting, so one slow client can't hold up pushes to the rest.
        broadcast([self.ws], json.dumps(message))

    def close(self, code: int, reason: str) -> None:
        self._closing = asyncio.ensure_future(self.ws.close(code, reason))


class Hub:
    def __init__(self, arena: Arena, score: Scorer, clock: Callable[[], float] = time.time) -> None:
        self.arena = arena
        self.score = score
        self.clock = clock
        self.peers: dict[str, Peer] = {}  # player id -> their socket
        self.owners: dict[str, str] = {}  # player id -> the secret that first said hello as it
        self.dropped: dict[str, float] = {}  # player id -> when their unfinished duel is forfeited
        self.pushed: dict[str, tuple | None] = {}  # live duel id -> the revision its screens last got
        self.next_queue_tick = 0.0
        self.loop: asyncio.AbstractEventLoop | None = None
        self.port: int | None = None
        self.startup_error: OSError | None = None

    # ---------- running ----------

    async def run(self, host: str, port: int, ready: threading.Event | None = None) -> None:
        """Serve sockets and tick the clock until cancelled. ready is set once listening (or failed)."""
        self.loop = asyncio.get_running_loop()
        try:
            # Floats barely compress, and inflating a take would run on this thread.
            server = await serve(
                self.handle, host, port, max_size=MAX_MESSAGE_BYTES, max_queue=MAX_QUEUED_FRAMES, compression=None
            )
        except OSError as err:  # usually the port is taken; start() re-raises it on the caller's thread
            self.startup_error = err
            if ready is not None:
                ready.set()
            return
        self.port = server.sockets[0].getsockname()[1]
        if ready is not None:
            ready.set()
        async with server:
            while True:
                await asyncio.sleep(TICK_S)
                try:
                    self.tick()
                except Exception:
                    log.exception("Game tick failed")

    def call(self, fn: Callable[..., Any], *args: Any) -> Any:
        """Run fn(*args) on the game loop and return its result: how other threads touch game state."""

        async def on_loop() -> Any:
            return fn(*args)

        return asyncio.run_coroutine_threadsafe(on_loop(), self.loop).result(timeout=CALL_TIMEOUT_S)

    async def handle(self, ws: ServerConnection) -> None:
        """One socket, for as long as it stays open."""
        peer = SocketPeer(ws)
        try:
            async for message in ws:
                await self.receive(peer, message)
        except ConnectionClosed:
            pass
        finally:
            self.disconnect(peer)

    # ---------- events ----------

    async def receive(self, peer: Peer, message: str | bytes) -> None:
        if peer.player_id is not None and self.peers.get(peer.player_id) is not peer:
            return  # a newer socket took over this player; this one is closing
        now = self.clock()
        try:
            if peer.player_id is None:
                self._hello(peer, message, now)
            elif isinstance(message, bytes):
                await self._take(peer.player_id, message, now)
            else:
                self._command(peer, parse_text(message), now)
        except (BadMessage, DuelError) as err:
            peer.send({"type": "error", "message": str(err)})
        except Exception as err:  # e.g. the model failed: tell the page, as the HTTP API does, and stay up
            log.exception("Message from %s failed", peer.player_id)
            peer.send({"type": "error", "message": str(err)})
        self._push(self.clock())

    def disconnect(self, peer: Peer) -> None:
        pid = peer.player_id
        if pid is None or self.peers.get(pid) is not peer:
            return  # never said hello, or a newer socket took over
        del self.peers[pid]
        self.arena.leave_queue(pid)
        if pid in self.arena.active:
            self.dropped[pid] = self.clock() + RECONNECT_GRACE_S

    def tick(self) -> None:
        now = self.clock()
        for pid, forfeit_at in list(self.dropped.items()):
            if now >= forfeit_at:
                del self.dropped[pid]
                self.arena.forfeit(pid, now)
        if now >= self.next_queue_tick:
            self.next_queue_tick = now + QUEUE_TICK_S
            self._match(now)
            for pid in self.arena.queue.waiting():
                if (peer := self.peers.get(pid)) is not None:
                    peer.send({"type": "queue", **self.arena.queue_status(pid, now)})
        self._push(now)

    # ---------- messages ----------

    def _hello(self, peer: Peer, message: str | bytes, now: float) -> None:
        msg = parse_text(message) if isinstance(message, str) else {}
        if msg.get("type") != "hello":
            raise BadMessage("Say hello first.")
        pid = token(msg.get("id"), "id")
        secret = token(msg.get("secret"), "secret")
        if not hmac.compare_digest(self.owners.setdefault(pid, secret), secret):
            raise BadMessage("That player id belongs to someone else.")
        old = self.peers.get(pid)
        if old is not None and old is not peer:
            old.close(4000, "This player connected again somewhere else.")
        peer.player_id = pid
        self.peers[pid] = peer
        self.dropped.pop(pid, None)
        resume = msg.get("resume")
        active = self.arena.active.get(pid)
        if active is not None and active != resume:
            self.arena.forfeit(pid, now)
        peer.send({"type": "welcome", "server_now": now})
        if isinstance(resume, str):
            duel = self.arena.duels.get(resume)
            if duel is not None and pid in duel.players:
                peer.send(self._view(duel.id, pid, now))
            else:
                peer.send({"type": "duel_gone", "duel_id": resume})

    def _command(self, peer: Peer, msg: dict, now: float) -> None:
        pid = peer.player_id
        kind = msg.get("type")
        if kind == "ping":
            t = msg.get("t")
            peer.send({"type": "pong", "t": t if isinstance(t, (int, float)) else None, "server_now": now})
        elif kind == "queue":
            self._register(pid, msg)
            self.arena.join_queue(pid, now)
            self._match(now)  # someone may already be waiting for exactly this player
            status = self.arena.queue_status(pid, now)
            if status["status"] == "waiting":
                peer.send({"type": "queue", **status})
        elif kind == "leave_queue":
            self.arena.leave_queue(pid)
            peer.send({"type": "queue", "status": "idle"})
        elif kind == "bot":
            self._register(pid, msg)
            started = self.arena.start_bot_duel(pid, str(msg.get("level")), now)
            self.pushed[started["duel_id"]] = None
        elif kind == "forfeit":
            self.arena.forfeit(pid, now)
        else:
            raise BadMessage(f"Unknown message type {kind!r}.")

    async def _take(self, pid: str, data: bytes, now: float) -> None:
        take = parse_take(data)
        duel_id, index = take["duel_id"], take["round"]
        # Judge the deadline by when the take arrived: scoring it takes a moment.
        self.arena.take_arrived(duel_id, pid, index, now)
        try:
            # Bounded, so a stuck scorer can't hold the round open forever.
            result = await asyncio.wait_for(self.score(take["audio"], take["sr"], take["calibration"]), SCORE_TIMEOUT_S)
        except asyncio.TimeoutError as err:
            self.arena.take_failed(duel_id, pid, index)
            raise BadMessage("Scoring your bark took too long, so this round counts it as missed.") from err
        except BaseException:
            self.arena.take_failed(duel_id, pid, index)
            raise
        self.arena.submit(duel_id, pid, index, bark_from_score(result, take["position"]), self.clock())

    # ---------- internals ----------

    def _register(self, pid: str, msg: dict) -> None:
        self.arena.register(pid, player_name(msg.get("name")), str(msg.get("dog") or "shiba")[:24])

    def _match(self, now: float) -> None:
        for duel in self.arena.match(now):
            self.pushed[duel.id] = None

    def _push(self, now: float) -> None:
        """Send each duel that changed to its players; let it go once they've seen the end."""
        for duel_id, seen in list(self.pushed.items()):
            try:
                self._push_duel(duel_id, seen, now)
            except Exception:  # one broken duel mustn't stop the others, or log five times a second
                log.exception("Duel %s failed; its players get no more news", duel_id)
                del self.pushed[duel_id]

    def _push_duel(self, duel_id: str, seen: tuple | None, now: float) -> None:
        revision = self.arena.advance(duel_id, now)
        if revision == seen:
            return
        duel = self.arena.duels[duel_id]
        for pid in duel.players:
            if (peer := self.peers.get(pid)) is not None:  # bots have no socket
                peer.send(self._view(duel_id, pid, now))
        if duel.ended_at is None:
            self.pushed[duel_id] = revision
        else:
            del self.pushed[duel_id]

    def _view(self, duel_id: str, pid: str, now: float) -> dict:
        return {"type": "duel", "view": self.arena.duel_view(duel_id, pid, now)}


def start(hub: Hub, host: str, port: int) -> threading.Thread:
    """Run the hub's game loop on a thread of its own. Returns once it's listening."""
    ready = threading.Event()
    thread = threading.Thread(
        target=lambda: asyncio.run(hub.run(host, port, ready)), name="game-loop", daemon=True
    )
    thread.start()
    ready.wait()
    if hub.startup_error is not None:
        raise hub.startup_error
    return thread


def parse_text(message: str) -> dict:
    if len(message) > MAX_TEXT_CHARS:
        raise BadMessage("Text messages are small JSON objects; takes go as binary.")
    try:
        msg = json.loads(message)
    except json.JSONDecodeError as err:
        raise BadMessage("Messages must be JSON.") from err
    if not isinstance(msg, dict):
        raise BadMessage("Messages must be JSON objects.")
    return msg


def parse_take(data: bytes) -> dict:
    """A binary take -> {"duel_id", "round", "sr", "position", "calibration", "audio"}."""
    size = int.from_bytes(data[:4], "little") if len(data) >= 4 else 0
    if not 0 < size <= MAX_HEADER_BYTES or len(data) < 4 + size:
        raise BadMessage("A take starts with the length of its JSON header.")
    try:
        header = json.loads(data[4 : 4 + size])
        duel_id, index, sr = str(header["duel_id"]), int(header["round"]), int(header["sr"])
    except (ValueError, KeyError, TypeError) as err:  # JSONDecodeError and UnicodeDecodeError are ValueErrors
        raise BadMessage("A take's header needs duel_id, round and sr.") from err
    samples = data[4 + size :]
    if not samples or len(samples) % 4:
        raise BadMessage("A take is float32 samples after its header.")
    if not 8000 <= sr <= MAX_RATE:
        raise BadMessage(f"Unsupported sample rate {sr}")
    if len(samples) // 4 > MAX_TAKE_S * sr:
        raise BadMessage(f"A take is at most {MAX_TAKE_S:g} s.")
    return {
        "duel_id": duel_id,
        "round": index,
        "sr": sr,
        "position": str(header.get("position", "unchecked")),
        "calibration": parse_calibration(header),
        "audio": np.frombuffer(samples, dtype="<f4"),
    }


def parse_calibration(header: dict) -> Calibration | None:
    """Both levels or neither; a half calibration is a client bug, not a default."""
    noise, speech = header.get("noise_lufs"), header.get("speech_lufs")
    if noise is None and speech is None:
        return None
    if not isinstance(noise, (int, float)) or not isinstance(speech, (int, float)):
        raise BadMessage("Send both noise_lufs and speech_lufs as numbers, or neither")
    return Calibration(float(noise), float(speech))


def token(value: object, what: str) -> str:
    """A player id or secret: 8-64 letters, digits, - or _."""
    if not isinstance(value, str) or not TOKEN.match(value):
        raise BadMessage(f"{what} must be 8-64 letters, digits, - or _")
    return value


def player_name(value: object) -> str:
    name = " ".join(str(value or "").split())[:MAX_NAME]
    if not name:
        raise BadMessage("Pick a name")
    return name
