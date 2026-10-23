#!/usr/bin/env python3
"""Synthesises the extra cute sound effects for 04_driving_b (adds to examples/media and public/examples/media; does not touch the older sfx)."""
import wave
from pathlib import Path
import numpy as np

SR = 22050
ROOT = Path(__file__).resolve().parents[1]
def t_(d): return np.arange(int(SR * d)) / SR
def save(name, x):
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.7
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    for d in ('examples/media', 'public/examples/media'):
        with wave.open(str(ROOT / d / name), 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR); f.writeframes(pcm.tobytes())

def tone(f0, f1, d, vib=0.0):
    t = t_(d); f = f0 + (f1 - f0) * (t / d) ** 0.7 + vib * np.sin(2 * np.pi * 14 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.minimum(1, t / 0.01) * np.exp(-3.2 * t / d)
    return (np.sin(ph) + 0.25 * np.sin(2 * ph)) * e

# boing: a springy upward glide with a wobble (reacting to its name)
save('sfx_boing.wav', np.concatenate([tone(300, 900, 0.22, 25), tone(900, 520, 0.18, 18)]))
# giggle: three quick rising chirps
save('sfx_giggle.wav', np.concatenate([np.concatenate([tone(620 + 90 * i, 980 + 90 * i, 0.11), np.zeros(int(SR * 0.05))]) for i in range(4)]))
# sparkle: fast rising arpeggio with a shimmer tail
notes = [988, 1319, 1568, 1976, 2637]
x = np.zeros(int(SR * 1.1))
for i, f in enumerate(notes):
    t = t_(0.5); s = np.sin(2 * np.pi * f * t) * np.exp(-6 * t) * np.minimum(1, t / 0.004)
    a = int(SR * 0.07 * i); x[a:a + len(s)] += s
save('sfx_sparkle.wav', x)
print('wrote sfx_boing, sfx_giggle, sfx_sparkle')
