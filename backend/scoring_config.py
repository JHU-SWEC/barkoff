"""All the scoring knobs in one place.

Change numbers here, then rerun the eval to see the effect:
    python scripts/eval/eval_likeness.py --esc50 --clips scripts/eval/clips
"""

# ---------- final score ----------
# Bark score = LOUDNESS_WEIGHT * loudness + LIKENESS_WEIGHT * likeness
LOUDNESS_WEIGHT = 0.7
LIKENESS_WEIGHT = 0.3

# ---------- likeness = mix of two parts ----------
# (a) probability: YAMNet's dog-class probability, smoothed over the bark.
# (b) similarity:  cosine similarity of the clip's YAMNet embedding to a
#                  reference set of real dog barks.
# The two weights are normalised, so only their ratio matters.
PROBABILITY_WEIGHT = 0.5
SIMILARITY_WEIGHT = 0.5

# ---------- framing ----------
# YAMNet looks at 0.975 s windows. We slide that window along the clip every
# HOP_SECONDS, then average over SMOOTH_SECONDS and keep the best stretch.
# (Before Nov 2026: hop 0.24 s, smoothing 0.72 s = 3 windows.)
HOP_SECONDS = 0.1
SMOOTH_SECONDS = 0.5
# Pad half a window of silence at both ends and only average full windows,
# so barks at the very start/end of a take aren't penalised.
EDGE_AWARE = True

# ---------- preprocessing (before YAMNet; doesn't affect loudness) ----------
# Scale the loudest sample to 0.9 so a quiet take scores like a loud one.
PEAK_NORMALIZE = True
# High-pass filter cutoff in Hz to remove rumble and hum; 0 turns it off.
HIGHPASS_HZ = 100

# ---------- strictness ----------
# Each part's raw value is mapped linearly onto [0, 1]:
#   raw <= FLOOR -> 0,  raw >= CEILING -> 1,  linear in between.
# Lower CEILING = more forgiving (more barks reach a full score);
# higher FLOOR  = stricter (weak dog-ness counts for nothing).
# Tuned on ESC-50 real dogs (Nov 2026); retune once we have human bark takes.
#   probability: real barks' best stretch is 0.75-0.99 raw, so 0.9+ counts as full.
#   similarity:  raw cosine is ~0.95-0.97 for real barks, ~0.6 on average
#                for other sounds (90% of them below 0.75).
PROBABILITY_FLOOR = 0.0
PROBABILITY_CEILING = 0.9
SIMILARITY_FLOOR = 0.75
SIMILARITY_CEILING = 0.95

# ---------- reference set for (b) ----------
# Half of the 40 ESC-50 "dog" clips are the reference barks (split by source
# recording, see likeness.reference_filenames); the eval only tests on the
# other half, so it never scores a clip against itself.
# Only frames where YAMNet is at least this sure it hears a dog go into the
# reference (drops the silence around each bark).
REFERENCE_MIN_DOG_PROB = 0.5
# Per frame, similarity = mean of the TOP_K closest reference frames.
SIMILARITY_TOP_K = 5
