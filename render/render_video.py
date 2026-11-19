#!/usr/bin/env python3
"""Rendu vidéo programmatique : script JSON (scène par scène) -> MP4 sous-titré.

Chaîne : voix neuronale (edge-tts, gratuit) -> visuels Pillow (gabarit HTML/CSS-like)
-> sous-titres incrustés -> assemblage FFmpeg.

Garde-fous : le script est re-validé ici (<= 130 mots) et la durée audio mesurée doit
tomber entre 45 et 60 s. Si elle en sort, le débit de la voix est ajusté (+/- 25 %).
Au-delà, le rendu échoue explicitement (le statut passera à ERREUR dans la Sheet).

Usage : python render_video.py --payload payload.json --out out/
Aucune clé API n'est nécessaire ici (edge-tts n'en demande pas).
"""
import argparse
import asyncio
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1280, 720, 25
MIN_S, MAX_S, TARGET_S = 45.0, 60.0, 54.0   # fenêtre imposée par le sujet + cible
MAX_WORDS = 130                              # barème : 130 mots max
GAP_S = 0.35                                 # respiration entre deux scènes
DEFAULT_VOICE = "fr-FR-DeniseNeural"


class PipelineError(Exception):
    """Erreur métier : remontée telle quelle dans la Google Sheet (statut ERREUR)."""


# --------------------------------------------------------------------------- utilitaires
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise PipelineError(f"Commande en échec : {' '.join(cmd[:3])}... {r.stderr[-400:]}")
    return r.stdout


def audio_duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "default=nw=1:nk=1", str(path)])
    return float(out.strip())


def count_words(text):
    return len(re.findall(r"[\w'’-]+", text, flags=re.UNICODE))


def validate_script(script):
    """Contrôle structurel + limites de format (défense en profondeur côté rendu)."""
    scenes = script.get("scenes")
    if not isinstance(scenes, list) or not (3 <= len(scenes) <= 8):
        raise PipelineError("JSON invalide : 'scenes' doit contenir de 3 à 8 scènes")
    for i, s in enumerate(scenes, 1):
        for key in ("scene_id", "titre_ecran", "mots_cles_ecran", "texte_voix_off"):
            if key not in s:
                raise PipelineError(f"JSON invalide : scène {i} sans '{key}'")
        if not isinstance(s["mots_cles_ecran"], list):
            raise PipelineError(f"JSON invalide : scène {i}, 'mots_cles_ecran' doit être une liste")
    total = sum(count_words(s["texte_voix_off"]) for s in scenes)
    if total > MAX_WORDS:
        raise PipelineError(f"Script trop long : {total} mots (max {MAX_WORDS})")
    return total


# --------------------------------------------------------------------------- audio / TTS
async def _tts_edge(text, path, voice, rate):
    import edge_tts  # import tardif : absent en test hors-ligne
    await edge_tts.Communicate(text, voice, rate=f"{rate:+d}%").save(str(path))


def synth_scene(text, mp3_path, voice, rate):
    """Génère l'audio d'une scène. En test (ALLOW_TTS_FALLBACK=1) et seulement là,
    un silence calibré remplace la voix si edge-tts est injoignable."""
    try:
        asyncio.run(_tts_edge(text, mp3_path, voice, rate))
        return
    except Exception as exc:  # réseau, module absent...
        if os.environ.get("ALLOW_TTS_FALLBACK") != "1":
            raise PipelineError(f"TTS indisponible : {exc}")
        dur = max(1.0, count_words(text) / 2.5 / (1 + rate / 100))
        run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r=24000:cl=mono",
             "-t", f"{dur:.2f}", "-q:a", "9", str(mp3_path)])
        print("[WARN] TTS de repli (silence) utilisé : TEST UNIQUEMENT", file=sys.stderr)


def to_wav(src, dst):
    run(["ffmpeg", "-y", "-i", str(src), "-ar", "44100", "-ac", "1", str(dst)])


def build_audio(scenes, workdir, voice):
    """Synthétise toutes les scènes ; ajuste le débit pour tenir dans 45-60 s."""
    rate = 0
    for attempt in range(4):
        durations, wavs = [], []
        for i, s in enumerate(scenes, 1):
            mp3 = workdir / f"scene_{i}.mp3"
            wav = workdir / f"scene_{i}.wav"
            synth_scene(s["texte_voix_off"], mp3, voice, rate)
            to_wav(mp3, wav)
            durations.append(audio_duration(wav))
            wavs.append(wav)
        total = sum(durations) + GAP_S * len(scenes)
        print(f"[INFO] essai {attempt + 1} : débit {rate:+d}% -> {total:.1f}s", file=sys.stderr)
        if MIN_S <= total <= MAX_S - 1.0:   # 1 s de marge sous la limite dure
            return wavs, durations, total, rate
        # ajustement proportionnel vers la cible (voix plus rapide si trop long, etc.)
        new_rate = rate + int(round((total / TARGET_S - 1) * 100))
        new_rate = max(-25, min(25, new_rate))
        if new_rate == rate:
            break
        rate = new_rate
    raise PipelineError(f"DUREE_HORS_BORNES : {total:.1f}s (attendu {MIN_S:.0f}-{MAX_S:.0f}s)")


def concat_audio(wavs, workdir):
    gap = workdir / "gap.wav"
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
         "-t", str(GAP_S), str(gap)])
    lst = workdir / "audio.txt"
    lst.write_text("".join(f"file '{w.name}'\nfile '{gap.name}'\n" for w in wavs))
    out = workdir / "audio.m4a"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c:a", "aac", "-b:a", "96k", str(out)])
    return out


# --------------------------------------------------------------------------- visuels
FONT_BOLD = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
             "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"]
FONT_REG = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf"]


def font(size, bold=False):
    for p in (FONT_BOLD if bold else FONT_REG):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def wrap(draw, text, fnt, max_w):
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=fnt) <= max_w:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def background():
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / H
        c = (int(14 + 18 * t), int(27 + 40 * t), int(64 + 70 * t))
        for x in range(W):
            px[x, y] = c
    return img


def draw_frame(script, scene, idx, total_scenes, subtitle, path, bg):
    img = bg.copy()
    d = ImageDraw.Draw(img, "RGBA")
    # bandeau latéral + en-tête
    d.rectangle([0, 0, 14, H], fill=(255, 193, 7, 255))
    d.text((60, 36), script.get("candidat", "Candidature"), font=font(26, True), fill=(255, 255, 255, 255))
    sub = " · ".join(x for x in (script.get("poste"), script.get("entreprise")) if x)
    d.text((60, 72), sub, font=font(20), fill=(190, 205, 235, 255))
    # titre de scène
    f_title = font(58, True)
    y = 190
    for line in wrap(d, scene["titre_ecran"], f_title, W - 160)[:3]:
        d.text((60, y), line, font=f_title, fill=(255, 255, 255, 255))
        y += 74
    # mots-clés sous forme de pastilles
    x, y = 60, y + 24
    f_kw = font(26, True)
    for kw in scene["mots_cles_ecran"][:5]:
        kw = str(kw)
        w = d.textlength(kw, font=f_kw) + 40
        if x + w > W - 60:
            x, y = 60, y + 64
        d.rounded_rectangle([x, y, x + w, y + 46], radius=23, fill=(255, 193, 7, 235))
        d.text((x + 20, y + 7), kw, font=f_kw, fill=(20, 30, 60, 255))
        x += w + 16
    # barre de progression
    d.rectangle([0, H - 10, W, H], fill=(255, 255, 255, 40))
    d.rectangle([0, H - 10, int(W * idx / total_scenes), H], fill=(255, 193, 7, 255))
    # sous-titres (bandeau lisible)
    f_sub = font(32, True)
    lines = wrap(d, subtitle, f_sub, W - 220)[:2]
    box_h = 20 + 44 * len(lines)
    top = H - 60 - box_h
    d.rounded_rectangle([90, top, W - 90, top + box_h], radius=18, fill=(0, 0, 0, 175))
    for i, line in enumerate(lines):
        tw = d.textlength(line, font=f_sub)
        d.text(((W - tw) / 2, top + 10 + 44 * i), line, font=f_sub, fill=(255, 255, 255, 255))
    img.save(path)


def split_subtitles(text, max_words=8):
    """Découpe le texte en sous-titres courts, de préférence à la ponctuation."""
    parts = [p.strip() for p in re.split(r"(?<=[.!?;:,])\s+", text) if p.strip()]
    chunks = []
    for p in parts:
        words = p.split()
        n = max(1, math.ceil(len(words) / max_words))   # découpe équilibrée (évite « de la » orphelin)
        size = math.ceil(len(words) / n)
        for i in range(0, len(words), size):
            chunks.append(" ".join(words[i:i + size]))
    return chunks or [text]


def format_srt_time(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def build_video(script, durations, audio, workdir, out_mp4, out_srt):
    scenes = script["scenes"]
    bg = background()
    entries, srt, t = [], [], 0.0
    n = 0
    for i, (s, dur) in enumerate(zip(scenes, durations), 1):
        chunks = split_subtitles(s["texte_voix_off"])
        weights = [max(1, len(c)) for c in chunks]
        for j, (c, wgt) in enumerate(zip(chunks, weights)):
            d_chunk = dur * wgt / sum(weights)
            if j == len(chunks) - 1:
                d_chunk += GAP_S           # la pause rejoint le dernier sous-titre
            png = workdir / f"frame_{n:03d}.png"
            draw_frame(script, s, i, len(scenes), c, png, bg)
            entries.append((png, d_chunk))
            srt.append((t, t + d_chunk - (GAP_S if j == len(chunks) - 1 else 0), c))
            t += d_chunk
            n += 1
    lst = workdir / "frames.txt"
    with lst.open("w") as f:
        for png, d_chunk in entries:
            f.write(f"file '{png.name}'\nduration {d_chunk:.3f}\n")
        f.write(f"file '{entries[-1][0].name}'\n")      # quirk du concat demuxer
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-i", str(audio),
         "-vf", f"fps={FPS},format=yuv420p", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "27", "-c:a", "copy", "-shortest", "-movflags", "+faststart", str(out_mp4)])
    out_srt.write_text("".join(
        f"{k}\n{format_srt_time(a)} --> {format_srt_time(b)}\n{txt}\n\n"
        for k, (a, b, txt) in enumerate(srt, 1)), encoding="utf-8")


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--payload", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    script = payload["script"]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    work = out / "work"
    work.mkdir(exist_ok=True)

    nb_mots = validate_script(script)
    wavs, durations, total, rate = build_audio(script["scenes"], work,
                                                payload.get("voice", DEFAULT_VOICE))
    audio = concat_audio(wavs, work)
    build_video(script, durations, audio, work, out / "video.mp4", out / "video.srt")

    size_mb = (out / "video.mp4").stat().st_size / 1e6
    if size_mb > 25:
        raise PipelineError(f"Vidéo trop lourde pour le webhook : {size_mb:.1f} Mo")
    meta = {"run_id": payload.get("run_id"), "duree_audio_sec": round(total, 1),
            "nb_mots": nb_mots, "debit_voix_pct": rate, "taille_mo": round(size_mb, 2)}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except PipelineError as e:
        print(f"[ERREUR] {e}", file=sys.stderr)
        sys.exit(2)
