# Dog-likeness (`likeness.py`)

Scores how much a clip sounds like a dog, using the pretrained
[YAMNet](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet)
classifier (trained on AudioSet) as a TFLite model.

## Interface

```python
from likeness import bark_probability, bark_embedding

bark_probability(audio: np.ndarray, sr: int) -> float   # 0 to 1
bark_embedding(audio: np.ndarray, sr: int) -> np.ndarray  # (1024,), stub for later
```

- `audio`: mono float32 waveform in [-1, 1]. Any sample rate works (it is
  resampled to 16 kHz), but `load_audio` already returns 16 kHz.
- Fits with the rest of `score.py`:

```python
audio, sr = load_audio(path)            # teammate: (mono float32, 16000)
L = loudness(audio, sr)                 # teammate: [0, 1]
D = bark_probability(audio, sr)         # this module: [0, 1]
final = 0.7 * L + 0.3 * D
```

## How it works

1. Resample to 16 kHz if needed.
2. Cut the clip into windows of 15600 samples (0.975 s). That size is read
   from the model's input shape, not hard-coded. Windows start every 0.24 s.
3. Run YAMNet on each window to get 521 class scores.
4. Per window, take the highest score among the dog classes below.
5. Smooth with a 3-frame moving average and return the max, so one noisy
   frame can't spike the score.

Dog classes (looked up by name in `yamnet_class_map.csv`):
`Dog`, `Bark`, `Yip`, `Howl`, `Bow-wow`, `Growling`, `Whimper (dog)`.

The model (~4 MB) and the class map are downloaded on first use to
`~/.cache/barkoff/` and are not committed to the repo.

## Setup

Python 3.10 to 3.14.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-likeness.txt
```

`ai-edge-litert` has wheels for Apple Silicon Macs, Windows x64 and Linux.
It does **not** support Intel Macs; on those, install `tensorflow` instead and
in `likeness.py` replace the `ai_edge_litert` import with
`import tensorflow as tf` and `Interpreter = tf.lite.Interpreter`.

### Installing FFmpeg (needed by `try_likeness.py`)

- **Mac:** `brew install ffmpeg` (install [Homebrew](https://brew.sh) first if needed).
- **Windows:** `winget install Gyan.FFmpeg`, then open a new terminal.
  Or download a build from https://www.gyan.dev/ffmpeg/builds/, unzip it, and
  add its `bin` folder to your PATH.
- Check it works: `ffmpeg -version`.

## Try it

```bash
python try_likeness.py path/to/bark.webm
```

Prints the bark probability and the top 5 YAMNet classes. It uses a
TEMPORARY FFmpeg decoder that will be swapped for the real `load_audio`.

No bark file? Make a test clip:

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -c:a libopus sine.webm
```

Expected results: a sine wave or silence gives about 0.0, a real dog bark
gives about 0.9.
