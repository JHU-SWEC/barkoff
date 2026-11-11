"""Ranked queue: pair waiting players by Elo, widening the search the longer they wait.

Public interface:
    Matchmaker().join(player_id, elo, now)
    Matchmaker().leave(player_id)
    Matchmaker().pair(now) -> [(id_a, id_b), ...]   removes paired players from the queue
    Matchmaker().window(player_id, now) -> current Elo window (+/-)

Rules:
    - A player's window starts at +/-BASE_WINDOW and grows WIDEN_PER_S per second
      waited, up to MAX_WINDOW.
    - Two players can be paired when their gap fits inside BOTH windows, so a
      newcomer isn't thrown at someone far away just because the other has waited.
    - The longest-waiting player is served first, against the closest eligible
      rating (ties to whoever has waited longer).

No clock or threads of its own: the server calls pair() whenever the queue is
polled, which is about once a second per waiting player.
"""

from dataclasses import dataclass

BASE_WINDOW = 50
WIDEN_PER_S = 10
MAX_WINDOW = 400


@dataclass(frozen=True)
class Ticket:
    player_id: str
    elo: int
    joined_at: float


class Matchmaker:
    def __init__(self) -> None:
        self._queue: dict[str, Ticket] = {}

    def __contains__(self, player_id: str) -> bool:
        return player_id in self._queue

    def __len__(self) -> int:
        return len(self._queue)

    def join(self, player_id: str, elo: int, now: float) -> None:
        """Queue a player. Joining again keeps the original place in line."""
        if player_id not in self._queue:
            self._queue[player_id] = Ticket(player_id, elo, now)

    def leave(self, player_id: str) -> None:
        self._queue.pop(player_id, None)

    def waited(self, player_id: str, now: float) -> float:
        return max(0.0, now - self._queue[player_id].joined_at)

    def window(self, player_id: str, now: float) -> float:
        return min(MAX_WINDOW, BASE_WINDOW + WIDEN_PER_S * self.waited(player_id, now))

    def pair(self, now: float) -> list[tuple[str, str]]:
        pairs = []
        waiting = sorted(self._queue.values(), key=lambda t: t.joined_at)
        taken: set[str] = set()
        for a in waiting:
            if a.player_id in taken:
                continue
            best = None
            for b in waiting:
                if b.player_id == a.player_id or b.player_id in taken:
                    continue
                gap = abs(a.elo - b.elo)
                if gap > min(self.window(a.player_id, now), self.window(b.player_id, now)):
                    continue
                # Closest rating wins; on a tie the earlier joiner (sort order) is kept.
                if best is None or gap < abs(a.elo - best.elo):
                    best = b
            if best is not None:
                taken.update((a.player_id, best.player_id))
                pairs.append((a.player_id, best.player_id))
        for player_id in taken:
            del self._queue[player_id]
        return pairs
