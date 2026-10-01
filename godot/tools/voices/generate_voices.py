#!/usr/bin/env python3
"""Генерирует голоса ботов: 50 разных людей из трёх голосов Piper (русские
мужские: denis, dmitri, ruslan). Каждому голосу - своя высота, темп, манера
(хрип, глухой, гнусавый, дрожащий, басовитый...), и из каждой ситуации в
lines.json он говорит свои случайные варианты.

Нужно: pip install piper-tts soundfile scipy numpy
Модели: ru_RU-{denis,dmitri,ruslan}-medium.onnx (+ .onnx.json) в папке --models
(https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU).

    python3 generate_voices.py --models <папка с .onnx> [--voices 50] [--jobs 4]

Пишет godot/assets/sounds/voices/vNN/*.ogg и voices.json (что кто говорит).
"""
import argparse
import json
import os
import random
import sys
import wave
import io
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "assets", "sounds", "voices"))
BASES = ["denis", "dmitri", "ruslan"]
SR = 22050

# Манеры речи: что делается со звуком после синтеза.
STYLES = {
    "clean": "чистый",
    "hoarse": "хриплый",
    "muffled": "глухой",
    "nasal": "гнусавый",
    "shaky": "дрожащий",
    "gruff": "грубый",
    "smoker": "прокуренный",
    "thin": "тонкий",
}


def make_profiles(n, seed=1234):
    rng = random.Random(seed)
    styles = list(STYLES)
    out = []
    for i in range(n):
        base = BASES[i % len(BASES)]
        style = styles[i % len(styles)] if i < len(styles) * 2 else rng.choice(styles)
        pitch = rng.uniform(0.84, 1.13)
        if style in ("gruff", "smoker"):
            pitch = rng.uniform(0.82, 0.95)
        if style == "thin":
            pitch = rng.uniform(1.06, 1.16)
        speed = rng.uniform(0.86, 1.22)          # length_scale: >1 медленнее
        p = {
            "id": "v%02d" % (i + 1),
            "base": base,
            "pitch": round(pitch, 3),
            "speed": round(speed, 3),
            "noise": round(rng.uniform(0.45, 0.8), 3),
            "noise_w": round(rng.uniform(0.6, 1.0), 3),
            "style": style,
            "seed": rng.randrange(1 << 30),
        }
        low = "низкий" if pitch < 0.93 else ("высокий" if pitch > 1.05 else "средний")
        tempo = "медленный" if speed > 1.1 else ("быстрый" if speed < 0.95 else "обычный")
        p["name"] = "Голос %02d - %s, %s, %s (%s)" % (i + 1, STYLES[style], low, tempo, base)
        out.append(p)
    return out


def _voice(models, base, cache={}):
    if base not in cache:
        from piper import PiperVoice
        cache[base] = PiperVoice.load(os.path.join(models, "ru_RU-%s-medium.onnx" % base))
    return cache[base]


def synth(models, prof, text):
    from piper import SynthesisConfig
    v = _voice(models, prof["base"])
    # Высота - пересэмплированием (вместе с тембром: другой человек), темп
    # поправлен заранее, чтобы речь не ускорилась вместе с высотой.
    cfg = SynthesisConfig(length_scale=prof["speed"] * prof["pitch"], noise_scale=prof["noise"],
                          noise_w_scale=prof["noise_w"])
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        v.synthesize_wav(text, w, syn_config=cfg)
    buf.seek(0)
    with wave.open(buf, "rb") as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        sr = w.getframerate()
    # pitch r: играем быстрее в r раз = resample до sr / r и считать как sr.
    r = prof["pitch"]
    up, down = int(round(1000 / r)), 1000
    x = signal.resample_poly(x, up, down)
    return _style(x, sr, prof), sr


def _bp(x, sr, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype="band", fs=sr, output="sos")
    return signal.sosfilt(sos, x)


def _lp(x, sr, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="low", fs=sr, output="sos"), x)


def _hp(x, sr, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="high", fs=sr, output="sos"), x)


def _env(x, sr):
    return _lp(np.abs(x), sr, 30.0, 1)


def _style(x, sr, prof):
    rng = np.random.default_rng(prof["seed"] & 0xFFFFFFFF)
    s = prof["style"]
    if s == "hoarse" or s == "smoker":
        # Шум дыхания, идущий за громкостью, и лёгкий перегруз.
        n = _bp(rng.standard_normal(len(x)).astype(np.float32), sr, 1500, 6000) * _env(x, sr)
        x = x + n * (2.2 if s == "hoarse" else 1.4)
        x = np.tanh(x * 2.0) / 2.0
        if s == "smoker":
            x = _lp(x, sr, 5200)
    elif s == "muffled":
        x = _lp(x, sr, 2300, 3) * 1.4
    elif s == "nasal":
        x = x + _bp(x, sr, 900, 1700, 2) * 1.6
        x = _hp(x, sr, 300)
    elif s == "shaky":
        t = np.arange(len(x)) / sr
        x = x * (1.0 + 0.22 * np.sin(2 * np.pi * 5.5 * t + rng.uniform(0, 6)))
    elif s == "gruff":
        x = np.tanh(x * 3.0) / 2.2
        x = x + _lp(x, sr, 250) * 0.8
    elif s == "thin":
        x = _hp(x, sr, 260, 2)
    # Тишину по краям прочь, громкость к одному уровню.
    a = np.abs(x)
    nz = np.where(a > 0.02 * a.max())[0]
    if len(nz):
        x = x[max(nz[0] - int(0.03 * sr), 0): nz[-1] + int(0.08 * sr)]
    rms = np.sqrt(np.mean(x ** 2)) + 1e-9
    x = x * (0.11 / rms)
    peak = np.abs(x).max()
    if peak > 0.95:
        x = x * (0.95 / peak)
    fade = min(int(0.01 * sr), len(x) // 4)
    if fade > 0:
        x[:fade] *= np.linspace(0, 1, fade)
        x[-fade:] *= np.linspace(1, 0, fade)
    return x.astype(np.float32)


def _work(args):
    models, prof, jobs = args
    done = []
    for cat, idx, text in jobs:
        path = os.path.join(OUT, prof["id"], "%s_%02d.ogg" % (cat, idx))
        if not os.path.exists(path):
            x, sr = synth(models, prof, text)
            sf.write(path, x, sr, format="OGG", subtype="VORBIS", compression_level=0.9)
        done.append((cat, idx, text, os.path.relpath(path, OUT).replace(os.sep, "/")))
    return prof["id"], done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--voices", type=int, default=50)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--only", default="", help="только эти голоса, через запятую (v01,v02)")
    a = ap.parse_args()
    bank = json.load(open(os.path.join(HERE, "lines.json"), encoding="utf-8"))["categories"]
    profiles = make_profiles(a.voices)
    tasks = []
    for p in profiles:
        if a.only and p["id"] not in a.only.split(","):
            continue
        os.makedirs(os.path.join(OUT, p["id"]), exist_ok=True)
        rng = random.Random(p["seed"])
        jobs = []
        for cat, c in bank.items():
            idx = list(range(len(c["lines"])))
            rng.shuffle(idx)
            for i in sorted(idx[: c.get("per_voice", 4)]):
                jobs.append((cat, i, c["lines"][i]))
        tasks.append((a.models, p, jobs))
    clips = {}
    with ProcessPoolExecutor(a.jobs) as ex:
        for vid, done in ex.map(_work, tasks):
            clips[vid] = done
            print(vid, len(done), flush=True)
    manifest = {"categories": {k: v["name"] for k, v in bank.items()}, "voices": []}
    for p in profiles:
        if p["id"] not in clips:
            continue
        by = {}
        for cat, idx, text, rel in clips[p["id"]]:
            by.setdefault(cat, []).append({"file": rel, "text": text})
        manifest["voices"].append({"id": p["id"], "name": p["name"], "clips": by})
    with open(os.path.join(OUT, "voices.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print("voices:", len(manifest["voices"]))


if __name__ == "__main__":
    main()
