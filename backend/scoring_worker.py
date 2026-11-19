"""The scoring thread: every take, solo or duel, is scored here, one at a time.

Public interface:
    with http_slot(): score(audio, sr, calibration) -> dict   from an HTTP thread; blocks only that thread
    await score_async(audio, sr, calibration) -> dict  from the game loop; other sockets keep going
    warm_up()                                          load YAMNet before the first take

http_slot() raises Busy when MAX_WAITING_HTTP requests are already waiting, so a
flood of solo takes can't pile up request threads or push duel takes (which
queue on the same thread) past their timeout.

Why one thread of its own: YAMNet's TFLite interpreter is shared and not safe to
call from two threads at once, and a slow run must not stall the duel game loop
(realtime.py) or other HTTP requests. Takes queue here and run in order.

Returns score.py's numbers plus the weights and the top YAMNet classes:
    {"score", "loudness", "likeness", "loudness_lufs", "over_speech_lu",
     "duration_s", "calibrated", "weights": {"loudness", "likeness"},
     "top": [{"name", "score"}, ...]}
"""

import asyncio
import logging
import math
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

import numpy as np

import likeness
import score as scorer
from loudness import Calibration

TOP_K = 5
MAX_WAITING_HTTP = 8  # a take scores in ~0.2 s, so that's under 2 s of backlog

log = logging.getLogger("barkoff.scoring")
_thread = ThreadPoolExecutor(max_workers=1, thread_name_prefix="scoring")
_http_slots = threading.BoundedSemaphore(MAX_WAITING_HTTP)


class Busy(Exception):
    """Too many takes are already waiting; the text is safe to show the player."""


def score_take(audio: np.ndarray, sr: int, calibration: Calibration | None) -> dict:
    """score.py's result for the take, plus the top YAMNet classes. Runs on the scoring thread."""
    mean_scores = likeness.frame_scores(audio, sr).mean(axis=0)
    names = likeness.class_names()
    top = [
        {"name": names[i], "score": float(mean_scores[i])}
        for i in np.argsort(mean_scores)[::-1][:TOP_K]
    ]
    weights = {"loudness": scorer.LOUDNESS_WEIGHT, "likeness": scorer.LIKENESS_WEIGHT}
    result = {**scorer.score(audio, sr, calibration), "weights": weights, "top": top}
    # JSON has no NaN: one would break the page's parser, and in a duel both players' screens.
    for key in ("score", "loudness", "likeness"):
        if not math.isfinite(result[key]):
            raise ValueError(f"The scorer returned {key}={result[key]} for this take.")
    return result


@contextmanager
def http_slot() -> Iterator[None]:
    """A place in line for one HTTP request; Busy if the line is full."""
    if not _http_slots.acquire(blocking=False):
        raise Busy("The scorer is busy. Try again in a moment.")
    try:
        yield
    finally:
        _http_slots.release()


def score(audio: np.ndarray, sr: int, calibration: Calibration | None) -> dict:
    return _thread.submit(score_take, audio, sr, calibration).result()


async def score_async(audio: np.ndarray, sr: int, calibration: Calibration | None) -> dict:
    return await asyncio.get_running_loop().run_in_executor(_thread, score_take, audio, sr, calibration)


def warm_up() -> None:
    """Load the model and the reference barks on the scoring thread, so the first take is quick.
    The first run ever downloads the reference clips (ESC-50) and caches their embeddings."""
    _thread.submit(lambda: (likeness.dog_class_indices(), likeness.frame_length())).result()
    try:
        _thread.submit(likeness.reference_embeddings).result()
    except Exception as err:  # e.g. offline on a first run: start anyway, the first take tries again
        log.warning("Reference barks aren't ready (%s); the first take will try again.", err)
