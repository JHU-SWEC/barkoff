# Your own eval clips

Drop audio files here to include them in the eval:

```
scripts/eval/clips/
  bark/       real dog barks and good human bark impressions
  not_bark/   speech, coughs, claps, room noise, other animals...
```

Any format FFmpeg can read works (.webm and .m4a from the site, .wav, .mp3).
Takes downloaded from the recorder page can go straight in.

Then run, from the repo root:

```bash
python scripts/eval/eval_likeness.py --clips scripts/eval/clips
```

The audio files themselves are gitignored; only this README is committed.
