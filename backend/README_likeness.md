# Dog-likeness (`likeness.py`)

Scores how much a clip sounds like a dog, using the pretrained
[YAMNet](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet)
classifier (trained on AudioSet) as a TFLite model.

## Interface

```python
from likeness import bark_probability, likeness_parts, bark_embedding

bark_probability(audio: np.ndarray, sr: int) -> float   # final likeness, 0 to 1
likeness_parts(audio: np.ndarray, sr: int) -> dict      # each part, for the eval
bark_embedding(audio: np.ndarray, sr: int) -> np.ndarray  # (1024,) mean embedding
```

- `audio`: mono float32 waveform in [-1, 1]. Any sample rate works (it is
  resampled to 16 kHz).
- `bark_probability` keeps its old name and signature so `server.py` and the
  site keep working; it now returns the mixed likeness below.

## How it works

Likeness mixes two parts (planning doc):

- **(a) probability:** how sure YAMNet is that it hears a dog.
- **(b) similarity:** cosine similarity between the clip's YAMNet embedding and
  a reference set of real dog barks.

Steps:

1. Resample to 16 kHz, high-pass at 100 Hz (rumble/hum), peak-normalise
   (so a quiet take scores like a loud one; loudness is scored separately).
2. Slide YAMNet's 0.975 s window along the clip every 0.1 s, with half a
   window of silence padded at both ends so barks at the very start or end
   get windows centred on them.
3. Per window: (a) the highest score among the dog classes below, and
   (b) the mean cosine similarity of the window's embedding to its 5 closest
   reference frames.
4. Average each over 0.5 s (a sliding window / convolution, full windows
   only) and keep the best stretch, so one noisy window can't spike it and
   silence around the bark doesn't dilute it.
5. Map each part onto [0, 1] with a floor and ceiling (strictness), then mix
   them with the weights in `scoring_config.py`.

Every number above is a setting in **`scoring_config.py`**, including on/off
switches for each fix so they can be tested one at a time.

Dog classes (looked up by name in `yamnet_class_map.csv`):
`Dog`, `Bark`, `Yip`, `Howl`, `Bow-wow`, `Growling`, `Whimper (dog)`.

The reference set is half of the 40 ESC-50 dog clips (21 clips, split by
source recording; the eval only tests on the other 19). It is downloaded
from GitHub and turned into embeddings on first use (a few seconds), then
cached. The model (~4 MB), the class map and the reference embeddings all
live in `~/.cache/barkoff/` and are not committed to the repo. ESC-50 is
CC BY-NC, fine for this project but not for commercial use.

Note: this TFLite file runs int8 inside, so the embedding tensor is
dequantised (`(raw - zero_point) * scale`) before use; without that every
clip looks ~0.999 similar to every other.

## Evaluate

```bash
pip install -r scripts/eval/requirements.txt
python scripts/eval/eval_likeness.py --esc50                       # from the repo root
python scripts/eval/eval_likeness.py --esc50 --clips scripts/eval/clips  # + your own takes
```

Prints the spread of barks vs non-barks for probability, similarity and the
final likeness. See `scripts/eval/clips/README.md` for adding your own clips.

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
gives close to 1.0.

## Score takes from the frontend

`server.py` exposes `bark_probability` (the final likeness) over HTTP so the recorder page can
score a take with the **Score likeness** button:

```bash
cd backend
source .venv/bin/activate
python server.py            # http://localhost:8000
```

Then run the frontend with `npm run dev`; Vite proxies `/api` to port 8000.
The browser decodes the take and sends 16 kHz mono float32 samples, so this
path does not need FFmpeg.
