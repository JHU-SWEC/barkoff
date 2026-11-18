# Human barks

People barking, growling, howling and whimpering like animals, for scoring by hand. Once every
clip is scored, the scores become training and test data for the likeness model.

## What's in it

| Source | What people imitated | License |
|---|---|---|
| [VocalImitationSet](https://zenodo.org/records/1340763) (Kim, Ghei, Pardo, Duan, DCASE 2018) | dog bark, dog growl, dog howl, cat growl | CC BY 4.0 |
| [VocalSketch](https://zenodo.org/records/1251982) (Cartwright, Pardo, CHI 2015) | dog barking, wolf, lion, seal | CC BY 4.0 |
| Freesound (optional, `--freesound`) | searches for human barks, growls, howls, whimpers | CC0 / CC BY / CC BY-NC, per clip |
| Your own recordings (`--add`) | whatever you recorded | team use only |

Both research sets were crowd-sourced, and keep every take: the ones the researchers accepted,
and the ones they rejected or marked as practice or drafts. Bad takes are still useful; scoring
says how bad. `manifest.csv` records each clip's source and license, what the person was
imitating, the dataset's own verdict, the person's id and, where the study surveyed them, their
age and gender. Neither study recorded ethnicity, so variety there has to come from recordings
you add.

## Get the audio

```bash
python scripts/data/human_barks/build.py
```

Writes `audio/h001.wav ...` (16 kHz mono, gitignored). The research archives are 4.6 and 7.6 GB,
but only the needed files are fetched (byte ranges from Zenodo), so it's a few MB. Zenodo is slow:
expect several minutes.

More clips:

```bash
FREESOUND_API_KEY=... python scripts/data/human_barks/build.py --freesound   # free key: freesound.org/apiv2/apply
python scripts/data/human_barks/build.py --add ~/Desktop/barks --add-person sam
```

New clips always get the next ids, so scores never end up on the wrong clip.

## Score them (everyone on the team)

Scoring is a page on the site: **Score barks**, at `/score-barks` (linked from Home).

```bash
python backend/server.py         # the scoring routes live here
cd frontend && npm run dev       # then open http://localhost:5173/score-barks
```

Pick a scorer name (the same one every time) and, for each clip:

- **Likeness**: how much like a real dog, on the same scale as the likeness test set
  (0 not at all, 0.25 a little, 0.5 could pass, 0.75 convincing, 1 unmistakably a dog)
- **Type**: playful, aggressive, whimper, growl, alarm, or none
- **Flags**: not a person (a real animal slipped in), bad audio

Every change saves at once to `labels/<your name>.csv`. Scoring is blind: the page shows clip
ids, never the source or what was imitated, and everyone hears the clips in their own order.
Keys: `Space` play, `1`-`5` likeness, `Q W E R T Y` type, `X` not a person, `B` bad audio,
arrows to move, `N` next unscored.

**Sharing scores:** there's no shared server yet, so each person scores on their own copy and
git combines them. Commit your `labels/<your name>.csv` and push; pull to get everyone else's.
Each person has their own file, so scores never conflict.

**The label is the team's average:**

```bash
python scripts/data/human_barks/average.py
```

writes `average.csv`: each clip's mean likeness, its most-voted type, flag counts, how many people
scored it, and the spread between scorers (clips the team disagrees on are listed to re-listen).

Don't train on these until every clip is scored.
