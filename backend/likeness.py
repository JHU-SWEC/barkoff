"""Dog-likeness scoring for Bark Off.

Uses the pretrained YAMNet audio classifier (AudioSet, 521 classes) as a
TFLite model. Likeness mixes two parts (weights in scoring_config.py):
    (a) probability: how sure YAMNet is that it hears a dog
    (b) similarity:  how close the clip's YAMNet embedding is to real dog barks

Public interface:
    bark_probability(audio, sr) -> float in [0, 1]   final likeness, (a) and (b) mixed
    likeness_parts(audio, sr)   -> dict with each part, for the eval and debugging
    bark_embedding(audio, sr)   -> np.ndarray of shape (1024,)

`audio` is a mono float32 waveform in [-1, 1], e.g. from load_audio(path).
"""

import csv
import urllib.request
import warnings
from functools import lru_cache
from math import gcd
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter
from scipy.io import wavfile
from scipy.signal import butter, resample_poly, sosfilt

import scoring_config as cfg

# YAMNet expects 16 kHz audio.
YAMNET_SR = 16000

# Model, class map and reference embeddings are downloaded/built once and
# cached here (kept out of the repo).
CACHE_DIR = Path.home() / ".cache" / "barkoff"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "audio_classifier/yamnet/float32/1/yamnet.tflite"
)
CLASS_MAP_URL = (
    "https://raw.githubusercontent.com/tensorflow/models/master/"
    "research/audioset/yamnet/yamnet_class_map.csv"
)
ESC50_RAW = "https://raw.githubusercontent.com/karolpiczak/ESC-50/master"

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

# Name of the internal 1024-d embedding tensor in this TFLite file. It is not
# a model output, so we read it as an intermediate tensor.
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
def _interpreter() -> Interpreter:
    """Load YAMNet once and reuse it (lru_cache = load-once cache).

    experimental_preserve_all_tensors keeps the internal embedding tensor
    readable after each run. LiteRT warns that this is meant for debugging;
    for this small model the extra memory is a few MB, so we silence it.
    """
    model_path = _download(MODEL_URL, CACHE_DIR / "yamnet.tflite")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        interp = Interpreter(model_path=str(model_path), experimental_preserve_all_tensors=True)
    interp.allocate_tensors()
    return interp


@lru_cache(maxsize=None)
def _embedding_tensor() -> tuple[int, float, int]:
    """(index, scale, zero_point) of the embedding tensor.

    The layers inside this model run in int8, so the raw embedding values are
    offset by zero_point (-128). Without converting back to real numbers
    every embedding looks almost the same (cosine ~0.999 for anything).
    """
    t = next(t for t in _interpreter().get_tensor_details() if t["name"] == EMBEDDING_TENSOR)
    scale, zero_point = t["quantization"]
    return t["index"], scale, zero_point


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


def _preprocess(audio: np.ndarray) -> np.ndarray:
    """Clean up the 16 kHz waveform before YAMNet (switches in scoring_config.py)."""
    if cfg.HIGHPASS_HZ:
        # Removes mic rumble, handling noise and mains hum below the bark.
        sos = butter(2, cfg.HIGHPASS_HZ, btype="highpass", fs=YAMNET_SR, output="sos")
        audio = sosfilt(sos, audio).astype(np.float32)
    if cfg.PEAK_NORMALIZE:
        # Likeness should not depend on how loud the take is (loudness is
        # scored separately), so scale the loudest sample to 0.9.
        peak = float(np.abs(audio).max()) if len(audio) else 0.0
        if peak > 1e-4:  # leave near-silence alone instead of amplifying hiss
            audio = audio * (0.9 / peak)
    return audio


def _frames(audio: np.ndarray) -> list[np.ndarray]:
    """Slide a model-sized window along the clip every HOP_SECONDS.

    With EDGE_AWARE, half a window of silence is added at both ends, so a
    bark right at the start or end of the clip still gets windows centred on
    it instead of only showing up at the edge of one window.
    """
    n = frame_length()
    hop = max(1, int(cfg.HOP_SECONDS * YAMNET_SR))
    if cfg.EDGE_AWARE:
        audio = np.pad(audio, (n // 2, n // 2))
    elif len(audio) < n:
        audio = np.pad(audio, (0, n - len(audio)))
    frames = [audio[s : s + n] for s in range(0, len(audio) - n + 1, hop)]
    if not cfg.EDGE_AWARE and (len(audio) - n) % hop:
        frames.append(audio[-n:])  # old behaviour: cover the tail with one extra window
    return frames


def frame_outputs(audio: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """Run YAMNet on every window.

    Returns (scores, embeddings) with shapes (num_frames, 521) and (num_frames, 1024).
    """
    interp = _interpreter()
    inp = interp.get_input_details()[0]["index"]
    out = interp.get_output_details()[0]["index"]
    emb_idx, scale, zero_point = _embedding_tensor()
    scores, embeddings = [], []
    for frame in _frames(_preprocess(_to_16k(audio, sr))):
        interp.set_tensor(inp, frame)
        interp.invoke()
        scores.append(interp.get_tensor(out)[0].copy())
        raw = interp.get_tensor(emb_idx).reshape(-1).astype(np.float32)
        embeddings.append((raw - zero_point) * scale)  # int8 -> real values
    return np.stack(scores), np.stack(embeddings)


def frame_scores(audio: np.ndarray, sr: int) -> np.ndarray:
    """YAMNet scores for every frame, shape (num_frames, 521)."""
    return frame_outputs(audio, sr)[0]


# ---------- the two parts ----------

def _best_stretch(per_frame: np.ndarray) -> float:
    """Average over SMOOTH_SECONDS with a sliding window, return the best stretch.

    - Sliding average (a convolution): a real bark stays high for several
      neighbouring windows, so one noisy window (a click, a cough) can't
      spike the score on its own.
    - Max over positions: this shifts the window to wherever the bark is, so
      silence before or after it doesn't dilute the score.
    - With EDGE_AWARE, mode="valid": only full windows count, so the clip
      edges aren't averaged with made-up zeros (mode="same" did that, which
      dragged down barks at the start or end of a take).
    """
    k = max(1, min(round(cfg.SMOOTH_SECONDS / cfg.HOP_SECONDS), len(per_frame)))
    mode = "valid" if cfg.EDGE_AWARE else "same"
    return float(np.convolve(per_frame, np.ones(k) / k, mode=mode).max())


def _dog_prob(scores: np.ndarray) -> np.ndarray:
    """Per frame: the highest dog-class score.

    YAMNet scores are independent sigmoids and a real bark fires "Dog" and
    "Bark" together, so summing them saturated at 1.0 for every real bark.
    The max stays in [0, 1] and still tells a strong bark from a weak one.
    """
    return scores[:, dog_class_indices()].max(axis=1)


def _unit(x: np.ndarray) -> np.ndarray:
    """Scale each row to length 1, so a dot product is a cosine similarity."""
    return x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-9)


def _rescale(raw: float, floor: float, ceiling: float) -> float:
    """Strictness: raw <= floor -> 0, raw >= ceiling -> 1, linear in between."""
    return float(np.clip((raw - floor) / max(ceiling - floor, 1e-9), 0.0, 1.0))


def reference_filenames(esc50_rows: list[dict]) -> set[str]:
    """Which ESC-50 dog clips form the reference set (the eval skips these).

    ESC-50 cuts some recordings into several clips, so we split by source
    recording: sort the recordings, every other one goes to the reference.
    That keeps pieces of one recording from landing on both sides, and gives
    21 reference / 19 eval clips.
    """
    dogs = [r for r in esc50_rows if r["category"] == "dog"]
    sources = sorted({r["src_file"] for r in dogs})
    ref_sources = set(sources[::2])
    return {r["filename"] for r in dogs if r["src_file"] in ref_sources}


def _reference_clips() -> list[Path]:
    """The reference ESC-50 dog clips (downloaded once)."""
    root = CACHE_DIR / "esc50"
    meta = _download(f"{ESC50_RAW}/meta/esc50.csv", root / "esc50.csv")
    with open(meta, newline="") as f:
        names = reference_filenames(list(csv.DictReader(f)))
    return [
        _download(f"{ESC50_RAW}/audio/{name}", root / "audio" / name) for name in sorted(names)
    ]


@lru_cache(maxsize=None)
def reference_embeddings() -> np.ndarray:
    """Unit-length YAMNet embeddings of the dog frames in the reference barks.

    Built from ESC-50 on first use (a few seconds) and cached to disk. The
    cache file name includes the settings, so changing them rebuilds it.
    """
    settings = (
        f"hop{cfg.HOP_SECONDS}_edge{int(cfg.EDGE_AWARE)}_hp{cfg.HIGHPASS_HZ}"
        f"_norm{int(cfg.PEAK_NORMALIZE)}_min{cfg.REFERENCE_MIN_DOG_PROB}"
    )
    cache = CACHE_DIR / f"ref_esc50_half_{settings}.npy"
    if cache.exists():
        return np.load(cache)

    kept = []
    for path in _reference_clips():
        sr, audio = wavfile.read(path)
        audio = audio.astype(np.float32) / np.iinfo(audio.dtype).max
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        scores, emb = frame_outputs(audio, sr)
        kept.append(emb[_dog_prob(scores) >= cfg.REFERENCE_MIN_DOG_PROB])
    ref = _unit(np.concatenate(kept))
    np.save(cache, ref)
    return ref


def _similarity_per_frame(embeddings: np.ndarray) -> np.ndarray:
    """Per frame: mean cosine similarity to its TOP_K closest reference frames."""
    sims = _unit(embeddings) @ reference_embeddings().T  # (frames, ref_frames)
    k = min(cfg.SIMILARITY_TOP_K, sims.shape[1])
    return np.sort(sims, axis=1)[:, -k:].mean(axis=1)


def likeness_parts(audio: np.ndarray, sr: int) -> dict:
    """Both parts of likeness, before and after strictness, plus the mix."""
    scores, embeddings = frame_outputs(audio, sr)
    raw_p = _best_stretch(_dog_prob(scores))
    raw_s = _best_stretch(_similarity_per_frame(embeddings))
    p = _rescale(raw_p, cfg.PROBABILITY_FLOOR, cfg.PROBABILITY_CEILING)
    s = _rescale(raw_s, cfg.SIMILARITY_FLOOR, cfg.SIMILARITY_CEILING)
    total = cfg.PROBABILITY_WEIGHT + cfg.SIMILARITY_WEIGHT
    return {
        "raw_probability": raw_p,
        "raw_similarity": raw_s,
        "probability": p,
        "similarity": s,
        "likeness": (cfg.PROBABILITY_WEIGHT * p + cfg.SIMILARITY_WEIGHT * s) / total,
    }


def bark_probability(audio: np.ndarray, sr: int) -> float:
    """Final likeness from 0 to 1 (name kept so server.py and the site keep working)."""
    return likeness_parts(audio, sr)["likeness"]


def bark_embedding(audio: np.ndarray, sr: int) -> np.ndarray:
    """Mean 1024-d YAMNet embedding over the clip."""
    return frame_outputs(audio, sr)[1].mean(axis=0)
