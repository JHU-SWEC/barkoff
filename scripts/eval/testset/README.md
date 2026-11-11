# Likeness test set

A fixed, hand-labelled set of clips for checking how well `backend/likeness.py`
matches what people actually hear as a bark.

## What's in it

183 clips that YAMNet never trained on. YAMNet learned from AudioSet, which is
cut from YouTube videos; every clip here comes from somewhere else:

| Source | Clips | What | License |
|---|---|---|---|
| [ESC-50](https://github.com/karolpiczak/ESC-50) (Freesound) | 19 | real dog barks | CC BY-NC 3.0 |
| ESC-50 | 50 | could be mistaken for a bark: cat, pig, cow, sheep, rooster, hen, crow, frog, coughing, sneezing, laughing, crying baby, snoring, breathing, door knock, clapping, glass breaking, footsteps | CC BY-NC 3.0 |
| ESC-50 | 24 | nothing like a bark: rain, waves, wind, engine, vacuum, clock, typing, bells, birdsong, water drops, washing machine, airplane | CC BY-NC 3.0 |
| [Speech Commands v0.02](https://arxiv.org/abs/1804.03209) | 14 | people saying "wow" and "dog", the closest public stand-in for a human woof (one clip per speaker) | CC BY 4.0 |
| Speech Commands | 6 | people saying "house", "seven", "happy" | CC BY 4.0 |
| [UrbanSound8K](https://urbansounddataset.weebly.com/urbansound8k.html) (Freesound) | 50 | real dog barks recorded in the street: distant, noisy, overlapping, so not all clean | CC BY-NC 4.0 |
| UrbanSound8K | 10 | gunshots, children playing | CC BY-NC 4.0 |
| UrbanSound8K | 10 | car horns, jackhammers, sirens | CC BY-NC 4.0 |

The 21 ESC-50 dog clips that `likeness.py` uses as its similarity reference
are left out, so the model is never tested on its own reference. ESC-50 and
UrbanSound8K both come from Freesound, so any UrbanSound8K clip cut from the
same Freesound recording as an ESC-50 clip is skipped too, and UrbanSound8K
contributes at most one clip per recording.

`manifest.csv` lists every clip: its id, where it came from, its category and
a `tier_prior` (bark / close / far). The tier is only a rough guess from the
category to make sure the set covers the whole range; **the hand labels are
the real scores.**

**Missing: human bark impressions.** No public source we can reach has them.
Record some on the site (good ones, bad ones, half-hearted ones) and add them
with `--add` below. They're the clips that matter most for the game.

## Build it

From the repo root (needs FFmpeg). The first build downloads the ESC-50 clips
and streams two big archives once, keeping only the files it needs: Speech
Commands (2.3 GB) and UrbanSound8K (6 GB). Expect it to take a while.

```bash
python scripts/eval/testset/build_testset.py
```

This writes `audio/c001.wav ...` (16 kHz mono, ~25 MB, gitignored). The clip
choice comes from the committed `manifest.csv`, so everyone gets the same set.

Add your own recordings (copied into `own/`, appended to the manifest):

```bash
python scripts/eval/testset/build_testset.py --add path/to/my_takes --add-tier unknown
```

## Label it

Open `scripts/eval/testset/label.html` in a browser (straight from disk, no
server needed). Enter your name, play each clip and score it:

| Score | Meaning |
|---|---|
| 1.0 | unmistakably a dog barking |
| 0.75 | a convincing bark (a great impression, or a bark through noise) |
| 0.5 | could pass for a bark if you weren't paying attention |
| 0.25 | short or punchy, a little bark-ish, but clearly something else |
| 0 | nothing like a bark |

Labelling is blind: the page only shows clip ids, never the source or
category, and plays them in a different random order for each person, so you
score what you hear. Keys: `Space` play, `0`-`4` score and
move on, arrows to move. Progress autosaves in the browser; when done, click
**Download CSV** and save it as `labels/<your name>.csv`. More than one rater
is better: the eval averages them and reports how much you agree.

## Evaluate

```bash
python scripts/eval/eval_likeness.py --testset
```

Reports the model's likeness for each tier and, once labels exist:
- Spearman correlation and mean error between the model and the human scores
  (for probability, similarity and the final likeness)
- the model's scores for clips people rated as barks, half-barks and non-barks
- the clips where the model and people disagree most
- agreement between raters, if there's more than one
