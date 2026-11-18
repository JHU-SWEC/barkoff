"""Hand scores for the human-bark clips: saved per scorer, averaged across the team."""

import csv

import pytest

import bark_scores
from bark_scores import ScoreError


@pytest.fixture(autouse=True)
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(bark_scores, "ROOT", tmp_path)
    (tmp_path / "audio").mkdir()
    with open(tmp_path / "manifest.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "source"])
        for i in range(1, 5):
            w.writerow([f"h00{i}", "test"])
    for i in (1, 2, 3):  # h004's audio isn't built
        (tmp_path / "audio" / f"h00{i}.wav").write_bytes(b"RIFF")
    return tmp_path


def test_clips_lists_built_audio_and_counts_the_rest():
    assert bark_scores.clips() == {"clips": ["h001", "h002", "h003"], "missing_audio": 1}


def test_a_score_is_saved_at_once_and_read_back(root):
    out = bark_scores.save("Leo", {"id": "h001", "likeness": 0.75, "type": "growl", "notes": "  low  rumble "})
    assert out == {"saved": "h001", "scored": 1}
    row = bark_scores.read("leo")["h001"]
    assert row["likeness"] == "0.75" and row["type"] == "growl" and row["notes"] == "low rumble"
    assert (root / "labels" / "leo.csv").exists()


def test_half_a_score_is_kept_but_not_counted():
    out = bark_scores.save("leo", {"id": "h002", "likeness": 0.5})
    assert out["scored"] == 0
    assert bark_scores.save("leo", {"id": "h002", "likeness": 0.5, "type": "playful"})["scored"] == 1


def test_bad_input_is_refused():
    with pytest.raises(ScoreError, match="scorer"):
        bark_scores.save("../../etc", {"id": "h001", "likeness": 1, "type": "growl"})
    with pytest.raises(ScoreError, match="clip"):
        bark_scores.save("leo", {"id": "h999", "likeness": 1, "type": "growl"})
    with pytest.raises(ScoreError, match="Likeness"):
        bark_scores.save("leo", {"id": "h001", "likeness": 0.6, "type": "growl"})
    with pytest.raises(ScoreError, match="Type"):
        bark_scores.save("leo", {"id": "h001", "likeness": 1, "type": "sad"})


def test_clear_removes_a_score():
    bark_scores.save("leo", {"id": "h001", "likeness": 1, "type": "alarm"})
    bark_scores.save("leo", {"id": "h001", "clear": True})
    assert bark_scores.read("leo") == {}


def test_team_average_and_progress():
    bark_scores.save("leo", {"id": "h001", "likeness": 1, "type": "alarm"})
    bark_scores.save("arnav", {"id": "h001", "likeness": 0.5, "type": "alarm"})
    bark_scores.save("aiden", {"id": "h001", "likeness": 0.75, "type": "aggressive"})
    bark_scores.save("aiden", {"id": "h002", "bad_audio": True})
    avg = bark_scores.averages()
    assert avg["h001"]["likeness"] == 0.75 and avg["h001"]["spread"] == 0.5
    assert avg["h001"]["type"] == "alarm" and avg["h001"]["type_votes"] == "2/3"
    # A flag counts as scored, but doesn't feed the average.
    assert avg["h002"]["bad_audio"] == 1 and avg["h002"]["likeness"] == ""
    team = bark_scores.team()
    assert team["scorers"] == {"aiden": 2, "arnav": 1, "leo": 1}
    assert team["clips_by_scorers"] == {"0": 2, "1": 1, "3": 1}
