"""Dog-likeness scoring for Bark Off.

Uses the pretrained YAMNet audio classifier (AudioSet, 521 classes) as a
TFLite model to estimate how much a clip sounds like a dog.

Public interface:
    bark_probability(audio, sr) -> float in [0, 1]
    bark_embedding(audio, sr)   -> np.ndarray of shape (1024,)   (stub for later)

`audio` is a mono float32 waveform in [-1, 1], e.g. from load_audio(path).
"""

import csv
import urllib.request
from functools import lru_cache
from math import gcd
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter
from scipy.signal import resample_poly

# YAMNet expects 16 kHz audio.
YAMNET_SR = 16000

# Model + class map are downloaded once and cached here (kept out of the repo).
CACHE_DIR = Path.home() / ".cache" / "barkoff"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "audio_classifier/yamnet/float32/1/yamnet.tflite"
)
CLASS_MAP_URL = (
    "https://raw.githubusercontent.com/tensorflow/models/master/"
    "research/audioset/yamnet/yamnet_class_map.csv"
)

# AudioSet classes we count as "dog". Looked up by name, not index.
# Left out on purpose:
#   "Animal", "Domestic animals, pets" -> too broad (cats, birds, ...)
#   "Canidae, dogs, wolves"            -> wild-animal category, includes wolves
#   "Whimper" (no "(dog)")             -> that one is a human sound
DOG_CLASSES = [
    "Dog",
    "Bark",
    "Yip",
    "Howl",
    "Bow-wow",
    "Growling",
    "Whimper (dog)",
]

# Frame hop in seconds. YAMNet's own hop is 0.48 s; we use half that so a
# short bark lands in several overlapping frames before we smooth.
HOP_SECONDS = 0.24

# Moving-average width in frames (3 frames * 0.24 s hop ~= 0.5 s of hops).
SMOOTH_FRAMES = 3

# Name of the internal 1024-d embedding tensor in this TFLite file. It is not
# a model output, so we read it as an intermediate tensor (see bark_embedding).
EMBEDDING_TENSOR = "tower0/network/layer28/reduce_mean"


def _download(url: str, dest: Path) -> Path:
    """Download url to dest unless it is already there."""
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {url} -> {dest}")
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(dest)
    return dest


@lru_cache(maxsize=None)
def _interpreter(preserve_all_tensors: bool = False) -> Interpreter:
    """Load YAMNet once and reuse it (lru_cache = load-once cache)."""
    model_path = _download(MODEL_URL, CACHE_DIR / "yamnet.tflite")
    interp = Interpreter(
        model_path=str(model_path),
        experimental_preserve_all_tensors=preserve_all_tensors,
    )
    interp.allocate_tensors()
    return interp


@lru_cache(maxsize=None)
def class_names() -> list[str]:
    """All 521 YAMNet class names, in model output order."""
    csv_path = _download(CLASS_MAP_URL, CACHE_DIR / "yamnet_class_map.csv")
    with open(csv_path, newline="") as f:
        return [row["display_name"] for row in csv.DictReader(f)]


@lru_cache(maxsize=None)
def dog_class_indices() -> list[int]:
    """Indices of DOG_CLASSES in the model output. Fails loudly if a name is missing."""
    names = class_names()
    missing = [c for c in DOG_CLASSES if c not in names]
    if missing:
        raise ValueError(f"Dog classes not found in YAMNet class map: {missing}")
    return [names.index(c) for c in DOG_CLASSES]


def frame_length() -> int:
    """Samples per YAMNet call, read from the model (15600 = 0.975 s at 16 kHz)."""
    return int(_interpreter().get_input_details()[0]["shape"][-1])


def _to_16k(audio: np.ndarray, sr: int) -> np.ndarray:
    """Make sure the waveform is mono float32 at 16 kHz."""
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim != 1:
        raise ValueError(f"Expected mono 1-D audio, got shape {audio.shape}")
    if sr != YAMNET_SR:
        g = gcd(sr, YAMNET_SR)
        audio = resample_poly(audio, YAMNET_SR // g, sr // g).astype(np.float32)
    return np.clip(audio, -1.0, 1.0)


def _frames(audio: np.ndarray) -> list[np.ndarray]:
    """Cut audio into overlapping model-sized windows (zero-padding the last one)."""
    n = frame_length()
    hop = int(HOP_SECONDS * YAMNET_SR)
    if len(audio) < n:
        audio = np.pad(audio, (0, n - len(audio)))
    starts = range(0, len(audio) - n + 1, hop)
    frames = [audio[s : s + n] for s in starts]
    # Make sure the tail of the clip is covered too.
    if (len(audio) - n) % hop:
        frames.append(audio[-n:])
    return frames


def _run(interp: Interpreter, frame: np.ndarray) -> np.ndarray:
    """Run one frame through YAMNet and return its 521 class scores."""
    interp.set_tensor(interp.get_input_details()[0]["index"], frame)
    interp.invoke()
    return interp.get_tensor(interp.get_output_details()[0]["index"])[0]


def frame_scores(audio: np.ndarray, sr: int) -> np.ndarray:
    """YAMNet scores for every frame, shape (num_frames, 521)."""
    interp = _interpreter()
    return np.stack([_run(interp, f) for f in _frames(_to_16k(audio, sr))])


def bark_probability(audio: np.ndarray, sr: int) -> float:
    """How dog-like the clip sounds, from 0 to 1."""
    scores = frame_scores(audio, sr)

    # Per frame: take the highest dog-class score. YAMNet scores are
    # independent sigmoids and a real bark fires "Dog" and "Bark" together,
    # so summing them saturated at 1.0 for every real bark. The max stays in
    # [0, 1] and still tells a strong bark from a weak one.
    dog = scores[:, dog_class_indices()].max(axis=1)

    # Smooth with a short moving average, then take the max.
    # - Max (not mean over the whole clip): the player only barks for part of
    #   the recording, so silence before/after shouldn't drag the score down.
    # - Smoothing first: a bark should score high in several neighbouring
    #   frames, so averaging keeps real barks but stops one noisy frame
    #   (a click, a cough) from spiking the score on its own.
    # mode="same" + zero padding means edge frames are averaged with zeros,
    # so a lone spike at the start/end of the clip is damped as well.
    k = min(SMOOTH_FRAMES, len(dog))
    smoothed = np.convolve(dog, np.ones(k) / k, mode="same")
    return float(smoothed.max())


def bark_embedding(audio: np.ndarray, sr: int) -> np.ndarray:
    """STUB: mean 1024-d YAMNet embedding over the clip.

    For a future cosine-similarity term against reference dog barks.
    The reference set is not built yet.

    Note: the embedding is an internal tensor of this TFLite file, so we need
    a second interpreter with experimental_preserve_all_tensors=True. That
    uses more memory, which is why bark_probability doesn't use it.
    """
    interp = _interpreter(preserve_all_tensors=True)
    idx = next(
        t["index"] for t in interp.get_tensor_details() if t["name"] == EMBEDDING_TENSOR
    )
    embeddings = []
    for frame in _frames(_to_16k(audio, sr)):
        _run(interp, frame)
        embeddings.append(interp.get_tensor(idx).reshape(-1))
    return np.mean(embeddings, axis=0)
