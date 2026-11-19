"""Tests du rendu : `ALLOW_TTS_FALLBACK=1 python -m pytest tests/` (voix de repli = silence, TEST UNIQUEMENT)."""
import json, os, sys, tempfile
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).parent.parent / "render"))
os.environ.setdefault("ALLOW_TTS_FALLBACK", "1")
import render_video as r

SCRIPT = json.loads((Path(__file__).parent.parent / "samples/script_exemple.json").read_text())


def test_validate_ok():
    assert r.validate_script(SCRIPT) <= r.MAX_WORDS


def test_validate_too_long():
    s = json.loads(json.dumps(SCRIPT)); s["scenes"][0]["texte_voix_off"] += " mot" * 40
    with pytest.raises(r.PipelineError):
        r.validate_script(s)


def test_rate_adjusts_into_window():
    scenes = [{"texte_voix_off": "mot " * 38}] * 4
    _, _, total, rate = r.build_audio(scenes, Path(tempfile.mkdtemp()), "x")
    assert r.MIN_S <= total <= r.MAX_S and rate > 0


def test_duration_out_of_bounds_raises():
    with pytest.raises(r.PipelineError):
        r.build_audio([{"texte_voix_off": "mot " * 300}] * 2, Path(tempfile.mkdtemp()), "x")
