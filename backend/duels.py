"""Ranked duels: players, the queue, and best-of-three rounds on a shared clock.

Public interface (all times are server seconds, passed in so tests control the clock):
    arena = Arena()
    arena.register(player_id, name, dog) -> Player
    arena.join_queue(player_id, now) / arena.leave_queue(player_id)
    arena.queue_status(player_id, now) -> {"status": "idle" | "waiting" | "matched", ...}
    arena.duel_view(duel_id, player_id, now) -> what that player's screen shows
    arena.submit(duel_id, player_id, round_index, bark, now) -> duel_view
    arena.forfeit(player_id, now)   leave an unfinished duel: the opponent wins it

A round, from the server's clock:
    starts_at            3-2-1 countdown begins on both screens
    cue_at               BARK! (a random 0.5-2 s after the countdown, so nobody can time it)
    cue_at + WINDOW_S    the 5 s bark window closes; each client uploads its take to be scored
    deadline             a take not in by now scores 0 (left, lost connection, never barked)
    resolved, then RESULT_S of both scores on screen, then the next round starts

First to two round wins takes the duel. A tied round is replayed; after
MAX_ROUNDS the duel is a draw. Elo updates once, when the duel ends.

Practice duels against a bot (arena.start_bot_duel) run the same rounds but
are unranked: no Elo change, no win/loss record, and bots never appear on the
leaderboard. The bot "barks" a score drawn around its level each round.

In memory only, so a server restart forgets players and ratings. Profiles
(accounts) will own Player; this module then only needs their id and Elo.
"""

import random
import secrets
from dataclasses import dataclass, field

import elo
from matchmaking import Matchmaker

# Stage-select roulette (about 3.4 s on the page), then the VS screen.
INTRO_S = 7.5
COUNTDOWN_S = 3.0
CUE_DELAY_S = (0.5, 2.0)
WINDOW_S = 5.0
SUBMIT_GRACE_S = 8.0
RESULT_S = 4.0
WINS_NEEDED = 2
MAX_ROUNDS = 5

# Bot levels: mean and spread of the bot's score each round, its name and its dog.
BOTS = {
    "easy": {"mean": 0.35, "spread": 0.12, "name": "Rookie Rover", "dog": "corgi"},
    "normal": {"mean": 0.55, "spread": 0.12, "name": "Barkley Bot", "dog": "beagle"},
    "hard": {"mean": 0.75, "spread": 0.1, "name": "Cerberus 3000", "dog": "husky"},
}
# The map is picked when the duel is made, so both screens land the roulette on the same one.
STAGES = ["sidewalk", "park", "vet", "petco", "playground"]

BOT_DOGS = ["shiba", "corgi", "husky", "pug", "dalmatian", "golden", "dachshund", "beagle"]

# Camera verdicts from the page (useHeadGuide.judgeTake). Anything but "ok" is a foul and scores 0.
POSITION_OK = "ok"
FOULS = {"close", "gone", "unchecked"}


@dataclass
class Player:
    id: str
    name: str
    dog: str
    elo: int = elo.START_RATING
    wins: int = 0
    losses: int = 0
    draws: int = 0

    def public(self) -> dict:
        return {
            "id": self.id, "name": self.name, "dog": self.dog, "elo": self.elo,
            "wins": self.wins, "losses": self.losses, "draws": self.draws,
        }


@dataclass
class Bark:
    score: float
    loudness: float
    likeness: float
    foul: str | None = None  # "close", "gone", "unchecked" from the camera, "missed" if no take arrived
    # What lies behind the two scores, for the results screen (None for a missed take):
    lufs: float | None = None  # loudest 400 ms
    over_speech_lu: float | None = None  # that, minus the player's speaking voice
    calibrated: bool = False  # whether over_speech_lu used the player's own calibration
    heard: str | None = None  # the top sound class the model heard
    heard_score: float | None = None

    @classmethod
    def missed(cls) -> "Bark":
        return cls(0.0, 0.0, 0.0, "missed")

    def public(self) -> dict:
        return {
            "score": self.score, "loudness": self.loudness, "likeness": self.likeness, "foul": self.foul,
            "lufs": self.lufs, "over_speech_lu": self.over_speech_lu, "calibrated": self.calibrated,
            "heard": self.heard, "heard_score": self.heard_score,
        }


@dataclass
class Round:
    index: int  # 1-based, counting replays
    starts_at: float
    cue_at: float
    barks: dict[str, Bark] = field(default_factory=dict)
    resolved_at: float | None = None
    winner: str | None = None  # player id, or None for a tie

    @property
    def window_ends(self) -> float:
        return self.cue_at + WINDOW_S

    @property
    def deadline(self) -> float:
        return self.window_ends + SUBMIT_GRACE_S


@dataclass
class Duel:
    id: str
    players: tuple[str, str]
    created_at: float
    rounds: list[Round] = field(default_factory=list)
    ended_at: float | None = None
    winner: str | None = None  # player id; None with ended_at set is a draw
    elo_before: dict[str, int] = field(default_factory=dict)
    elo_after: dict[str, int] = field(default_factory=dict)
    bot: str | None = None  # the bot's player id in a practice duel; practice duels are unranked
    forfeited_by: str | None = None
    stage: str = STAGES[0]

    @property
    def current(self) -> Round:
        return self.rounds[-1]

    def wins(self, player_id: str) -> int:
        return sum(1 for r in self.rounds if r.resolved_at is not None and r.winner == player_id)

    def other(self, player_id: str) -> str:
        a, b = self.players
        return b if player_id == a else a


class DuelError(Exception):
    """A request the duel can't accept; the message is safe to show the player."""


class Arena:
    def __init__(self, rng: random.Random | None = None) -> None:
        self.players: dict[str, Player] = {}
        self.queue = Matchmaker()
        self.duels: dict[str, Duel] = {}
        self.active: dict[str, str] = {}  # player id -> duel id until that duel ends
        self.bots: dict[str, Player] = {}  # kept apart so they never reach the leaderboard
        self._rng = rng or random.Random()

    # ---------- players and queue ----------

    def register(self, player_id: str, name: str, dog: str) -> Player:
        """Create a guest player or update the name and dog of a known one."""
        player = self.players.get(player_id)
        if player is None:
            player = self.players[player_id] = Player(player_id, name, dog)
        else:
            player.name, player.dog = name, dog
        return player

    def join_queue(self, player_id: str, now: float) -> dict:
        player = self._player(player_id)
        # Asking for a new match means giving up any duel left unfinished (a reload, a closed tab).
        self.forfeit(player_id, now)
        self.queue.join(player_id, player.elo, now)
        return self.queue_status(player_id, now)

    def leave_queue(self, player_id: str) -> None:
        self.queue.leave(player_id)

    def queue_status(self, player_id: str, now: float) -> dict:
        for a, b in self.queue.pair(now):
            self._start_duel(a, b, now)
        if player_id in self.active:
            return {"status": "matched", "duel_id": self.active[player_id]}
        if player_id in self.queue:
            return {
                "status": "waiting",
                "waited_s": round(self.queue.waited(player_id, now), 1),
                "window": round(self.queue.window(player_id, now)),
                "in_queue": len(self.queue),
            }
        return {"status": "idle"}

    def start_bot_duel(self, player_id: str, level: str, now: float) -> dict:
        """A practice duel against a bot, starting now. Leaves the ranked queue."""
        self._player(player_id)
        if level not in BOTS:
            raise DuelError(f"Bot level must be one of {', '.join(BOTS)}.")
        self.forfeit(player_id, now)
        self.queue.leave(player_id)
        spec = BOTS[level]
        bot_id = f"bot-{level}-{secrets.token_hex(3)}"
        # Never the player's own dog, so the two fighters can be told apart.
        mine = self.players[player_id].dog
        dog = spec["dog"] if spec["dog"] != mine and self._rng.random() < 0.5 else self._rng.choice(
            [d for d in BOT_DOGS if d != mine]
        )
        self.bots[bot_id] = Player(bot_id, spec["name"], dog, elo=self.players[player_id].elo)
        duel = self._start_duel(player_id, bot_id, now)
        duel.bot = bot_id
        self.active.pop(bot_id, None)
        return {"status": "matched", "duel_id": duel.id}

    def forfeit(self, player_id: str, now: float) -> None:
        """Walk away from an unfinished duel. The opponent wins; in a ranked duel Elo moves as for a loss."""
        duel_id = self.active.get(player_id)
        if duel_id is None:
            return
        duel = self.duels[duel_id]
        self._advance(duel, now)
        if duel.ended_at is not None:
            return
        duel.forfeited_by = player_id
        self._finish(duel, duel.other(player_id), now)

    def leaderboard(self, limit: int = 50) -> list[dict]:
        ranked = sorted(self.players.values(), key=lambda p: (-p.elo, -p.wins, p.name))
        return [p.public() for p in ranked[:limit]]

    # ---------- duels ----------

    def duel_view(self, duel_id: str, player_id: str, now: float) -> dict:
        duel = self._duel(duel_id, player_id)
        self._advance(duel, now)
        them = duel.other(player_id)
        side = lambda pid: "you" if pid == player_id else "opponent"  # noqa: E731

        resolved = [r for r in duel.rounds if r.resolved_at is not None]
        view = {
            "id": duel.id,
            "server_now": now,
            "phase": self._phase(duel, now),
            "you": self._any_player(player_id).public(),
            "opponent": self._any_player(them).public(),
            "ranked": duel.bot is None,
            "stage": duel.stage,
            "intro_at": duel.created_at,
            "wins": {"you": duel.wins(player_id), "opponent": duel.wins(them)},
            "wins_needed": WINS_NEEDED,
            "window_s": WINDOW_S,
            "rounds": [
                {
                    "index": r.index,
                    "you": r.barks[player_id].public(),
                    "opponent": r.barks[them].public(),
                    "winner": side(r.winner) if r.winner else "tie",
                }
                for r in resolved
            ],
            "round": None,
            "result": None,
        }
        if duel.ended_at is None:
            r = duel.current
            view["round"] = {
                "index": r.index,
                "starts_at": r.starts_at,
                "cue_at": r.cue_at,
                "window_ends": r.window_ends,
                "deadline": r.deadline,
                "submitted": {"you": player_id in r.barks, "opponent": them in r.barks},
            }
            # Between rounds, say when the next one starts so both screens count down together.
            last = resolved[-1] if resolved else None
            if last is not None and r.starts_at > now:
                view["next_at"] = r.starts_at
        else:
            view["result"] = {
                "winner": "draw" if duel.winner is None else side(duel.winner),
                "elo_before": duel.elo_before[player_id],
                "elo_after": duel.elo_after[player_id],
                "elo_change": duel.elo_after[player_id] - duel.elo_before[player_id],
                "forfeit": None if duel.forfeited_by is None else side(duel.forfeited_by),
            }
        return view

    def submit(self, duel_id: str, player_id: str, round_index: int, bark: Bark, now: float) -> dict:
        duel = self._duel(duel_id, player_id)
        self._advance(duel, now)
        if duel.ended_at is not None:
            raise DuelError("This duel is over.")
        r = duel.current
        if r.index != round_index:
            raise DuelError(f"Round {round_index} isn't open; this is round {r.index}.")
        if now < r.cue_at:
            raise DuelError("Too early: the bark cue hasn't happened yet.")
        if now > r.deadline:
            raise DuelError("Too late: this round has closed.")
        if player_id in r.barks:
            raise DuelError("You've already barked this round.")
        r.barks[player_id] = bark
        self._advance(duel, now)
        return self.duel_view(duel_id, player_id, now)

    # ---------- internals ----------

    def _any_player(self, player_id: str) -> Player:
        return self.players.get(player_id) or self.bots[player_id]

    def _player(self, player_id: str) -> Player:
        if player_id not in self.players:
            raise DuelError("Unknown player. Register first.")
        return self.players[player_id]

    def _duel(self, duel_id: str, player_id: str) -> Duel:
        duel = self.duels.get(duel_id)
        if duel is None or player_id not in duel.players:
            raise DuelError("No such duel for this player.")
        return duel

    def _start_duel(self, a: str, b: str, now: float) -> Duel:
        duel = Duel(secrets.token_urlsafe(8), (a, b), now, stage=self._rng.choice(STAGES))
        duel.rounds.append(self._new_round(1, now + INTRO_S))
        self.duels[duel.id] = duel
        self.active[a] = self.active[b] = duel.id
        return duel

    def _new_round(self, index: int, starts_at: float) -> Round:
        cue_at = starts_at + COUNTDOWN_S + self._rng.uniform(*CUE_DELAY_S)
        return Round(index, starts_at, cue_at)

    def _phase(self, duel: Duel, now: float) -> str:
        if duel.ended_at is not None:
            return "over"
        r = duel.current
        if now < r.starts_at:
            return "intro" if r.index == 1 else "result"
        if now < r.cue_at:
            return "countdown"
        if now < r.window_ends:
            return "bark"
        return "scoring"

    def _advance(self, duel: Duel, now: float) -> None:
        """Resolve rounds until the current one is still open (both players may have gone quiet)."""
        while self._resolve_round(duel, now):
            pass

    def _resolve_round(self, duel: Duel, now: float) -> bool:
        """Resolve the current round once both barks are in or the deadline passes."""
        if duel.ended_at is not None:
            return False
        r = duel.current
        if duel.bot and now >= r.window_ends and duel.bot not in r.barks:
            r.barks[duel.bot] = self._bot_bark(duel.bot)
        if now < r.window_ends or (len(r.barks) < 2 and now <= r.deadline):
            return False
        for pid in duel.players:
            r.barks.setdefault(pid, Bark.missed())
        # Both in: resolve when the second arrives. Deadline: resolve as of the deadline.
        resolved_at = r.deadline if now > r.deadline else max(now, r.window_ends)
        a, b = duel.players
        sa, sb = r.barks[a].score, r.barks[b].score
        r.winner = a if sa > sb else b if sb > sa else None
        r.resolved_at = resolved_at

        if max(duel.wins(a), duel.wins(b)) >= WINS_NEEDED:
            self._finish(duel, a if duel.wins(a) > duel.wins(b) else b, resolved_at)
            return False
        if r.index >= MAX_ROUNDS:
            self._finish(duel, None, resolved_at)
            return False
        duel.rounds.append(self._new_round(r.index + 1, resolved_at + RESULT_S))
        return True

    def _bot_bark(self, bot_id: str) -> Bark:
        spec = BOTS[bot_id.split("-")[1]]
        score = min(1.0, max(0.02, self._rng.gauss(spec["mean"], spec["spread"])))
        loudness = min(1.0, max(0.0, score + self._rng.uniform(-0.1, 0.25)))
        # Back out a likeness that makes the weighted total come to `score`.
        likeness = min(1.0, max(0.0, (score - 0.2 * loudness) / 0.8))
        # The loudness mapping run backwards (loudness.py: 0 at -10 LU, 1 at +15 LU, typical voice -30 LUFS).
        over = round(-10 + 25 * loudness, 1)
        heard = "Bark" if likeness > 0.6 else "Dog" if likeness > 0.35 else "Animal"
        return Bark(
            round(score, 4), round(loudness, 4), round(likeness, 4),
            lufs=round(-30 + over, 1), over_speech_lu=over, calibrated=False,
            heard=heard, heard_score=round(min(0.99, likeness * 0.9), 3),
        )

    def _finish(self, duel: Duel, winner: str | None, when: float) -> None:
        a, b = duel.players
        pa, pb = self._any_player(a), self._any_player(b)
        duel.elo_before = {a: pa.elo, b: pb.elo}
        duel.winner = winner
        duel.ended_at = when
        for pid in duel.players:
            self.active.pop(pid, None)
        if duel.bot:
            duel.elo_after = dict(duel.elo_before)
            return
        score_a = 0.5 if winner is None else 1.0 if winner == a else 0.0
        pa.elo, pb.elo = elo.update(pa.elo, pb.elo, score_a)
        duel.elo_after = {a: pa.elo, b: pb.elo}
        if winner is None:
            pa.draws += 1
            pb.draws += 1
        else:
            w, l = (pa, pb) if winner == a else (pb, pa)
            w.wins += 1
            l.losses += 1


def bark_from_score(result: dict, position: str) -> Bark:
    """A scored take (score.py's dict, plus the server's "top" classes) as a duel bark, zeroed if
    the camera saw a foul. The measurements stay either way, so the results can show what happened."""
    top = (result.get("top") or [{}])[0]
    details = {
        "lufs": result.get("loudness_lufs"),
        "over_speech_lu": result.get("over_speech_lu"),
        "calibrated": bool(result.get("calibrated", False)),
        "heard": top.get("name"),
        "heard_score": top.get("score"),
    }
    loudness, likeness = float(result["loudness"]), float(result["likeness"])
    if position != POSITION_OK:
        foul = position if position in FOULS else "unchecked"
        return Bark(0.0, loudness, likeness, foul, **details)
    return Bark(float(result["score"]), loudness, likeness, **details)
