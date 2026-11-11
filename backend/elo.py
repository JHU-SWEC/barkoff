"""Elo ratings for ranked duels.

Public interface:
    expected(rating, opponent) -> float      chance of winning, 0..1
    update(a, b, score_a, k=K) -> (a2, b2)   new ratings; score_a is 1 win, 0.5 draw, 0 loss

Standard logistic Elo: a 400-point gap means the stronger player is expected
to score about 0.91. Ratings are whole numbers so they read cleanly on screen.
"""

START_RATING = 1200
K = 32


def expected(rating: float, opponent: float) -> float:
    return 1 / (1 + 10 ** ((opponent - rating) / 400))


def update(a: int, b: int, score_a: float, k: int = K) -> tuple[int, int]:
    """Zero-sum: whatever A gains, B loses (before rounding)."""
    change = k * (score_a - expected(a, b))
    return round(a + change), round(b - change)
