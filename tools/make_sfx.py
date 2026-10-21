#!/usr/bin/env python3
"""Synthesises the preview-only sound effects used by the scenarios (no real recordings).
Writes 22.05 kHz mono WAVs to examples/media and public/examples/media."""
import wave
from pathlib import Path
import numpy as np
from scipy.signal import butter, sosfilt

SR = 22050
ROOT = Path(__file__).resolve().parents[1]
rng = np.random.default_rng(7)


def t_(d): return np.arange(int(SR * d)) / SR
def env(n, a, r):
    e = np.ones(n); na, nr = int(SR * a), int(SR * r)
    if na: e[:na] = np.linspace(0, 1, na) ** 2
    if nr: e[-nr:] = np.linspace(1, 0, nr) ** 2
    return e
def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=SR, output='sos'), x)
def norm(x, peak=0.7): return x / (np.max(np.abs(x)) + 1e-9) * peak
def save(name, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    for d in ('examples/media', 'public/examples/media'):
        with wave.open(str(ROOT / d / name), 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR); f.writeframes(pcm.tobytes())


def sweep_noise(d, f0, f1, q=0.4):
    """band-limited noise whose centre frequency glides f0 -> f1 (whoosh)"""
    t = t_(d); n = rng.standard_normal(len(t)); out = np.zeros(len(t)); seg = 1024
    for i in range(0, len(t), seg):
        f = f0 + (f1 - f0) * (i / len(t)); lo, hi = max(60, f * (1 - q)), min(SR / 2 - 100, f * (1 + q))
        out[i:i + seg] = band(n[max(0, i - 256):i + seg], lo, hi)[-len(out[i:i + seg]):]
    return out


# rail glide: low servo hum with slow wobble + faint air noise (6.8 s, fades in/out)
d = 6.8; t = t_(d)
hum = 0.5 * np.sin(2 * np.pi * (70 + 6 * np.sin(2 * np.pi * 0.3 * t)) * t) + 0.25 * np.sin(2 * np.pi * 140 * t) + 0.12 * np.sin(2 * np.pi * 210 * t)
air = band(rng.standard_normal(len(t)), 400, 1800) * 0.25
save('sfx_glide.wav', norm((hum + air) * env(len(t), 0.7, 0.9), 0.55))

# soft whoosh for head turns/scan (2.4 s) and short turn (1.5 s)
for name, d, f0, f1 in (('sfx_scan.wav', 2.4, 500, 1700), ('sfx_turn.wav', 1.5, 700, 1500)):
    x = sweep_noise(d, f0, f1); e = np.sin(np.linspace(0, np.pi, len(x))) ** 2
    save(name, norm(x * e, 0.5))

# spin whoosh: noise + gliding tone rising then falling over 5.6 s (matches the illusion spin)
d = 5.6; t = t_(d)
f = 220 + 520 * np.sin(np.linspace(0, np.pi, len(t))) ** 2
tone = 0.35 * np.sin(2 * np.pi * np.cumsum(f) / SR)
x = sweep_noise(d, 400, 2200) * 0.9 + tone
save('sfx_spin.wav', norm(x * (np.sin(np.linspace(0, np.pi, len(t))) ** 1.5), 0.55))

# direction cue blip: two quick rising notes (0.45 s)
t = t_(0.45)
x = 0.5 * np.sin(2 * np.pi * 880 * t) * (t < 0.2) * env(len(t), 0.01, 0.0) + 0.5 * np.sin(2 * np.pi * 1320 * t) * (t >= 0.14)
save('sfx_cue.wav', norm(x * np.exp(-6 * t), 0.5))

# nod: soft low "pop" (0.35 s)
t = t_(0.35)
x = np.sin(2 * np.pi * (260 - 140 * t / 0.35) * t) * np.exp(-14 * t)
save('sfx_nod.wav', norm(x, 0.55))
print('sfx written')
