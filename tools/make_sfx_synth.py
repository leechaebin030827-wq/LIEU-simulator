#!/usr/bin/env python3
"""Synthesises every scenario sound effect from scratch (no samples): soft bell / sine / filtered-noise voices with smooth envelopes and a light room reverb.

   python3 tools/make_sfx_synth.py      ->  examples/media/*.wav and public/examples/media/*.wav   (44.1 kHz, mono, 16-bit)

Every sound starts and ends from silence (baked fade in / out) so nothing clicks or cuts off; the clips in the scenarios add their own fades on top
(tools/sfx_mix.py). Peaks match the levels the scenarios were mixed with."""
import wave
from pathlib import Path
import numpy as np
from scipy import signal

SR = 44100
ROOT = Path(__file__).resolve().parents[1]
rng = np.random.default_rng(7)
T = lambda d: np.arange(int(SR * d)) / SR


def hann_env(n, a, r):
    """0 -> 1 over `a` s with a raised-cosine, hold, 1 -> 0 over `r` s"""
    e = np.ones(n)
    na, nr = int(SR * a), int(SR * r)
    if na: e[:na] = 0.5 - 0.5 * np.cos(np.pi * np.arange(na) / na)
    if nr: e[-nr:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(nr) / nr)
    return e


def bell(f, d, decay=5.0, bright=0.35):
    """glockenspiel-ish bell: a few inharmonic partials with their own decays"""
    t = T(d)
    x = np.zeros_like(t)
    for ratio, amp, dk in ((1.0, 1.0, 1.0), (2.76, 0.35 * bright / 0.35, 1.8), (5.4, 0.16 * bright / 0.35, 3.2), (8.9, 0.06 * bright / 0.35, 5.0)):
        x += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-decay * dk * t)
    return x * np.minimum(1, t / 0.004)


def glide_tone(f0, f1, d, power=1.0, vib=0.0, vib_hz=6.0, harm=0.25):
    t = T(d)
    f = f0 + (f1 - f0) * (t / d) ** power + vib * np.sin(2 * np.pi * vib_hz * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) + harm * np.sin(2 * ph) + harm * 0.4 * np.sin(3 * ph)


def lowpass(x, fc, order=2): return signal.sosfilt(signal.butter(order, fc, btype='low', fs=SR, output='sos'), x)


def reverb(x, wet=0.18, tail=0.5):
    """small Schroeder room: 4 combs + 2 allpasses"""
    n = len(x) + int(SR * tail)
    y = np.zeros(n); y[:len(x)] = x
    out = np.zeros(n)
    for ms, g in ((29.7, 0.77), (37.1, 0.75), (41.1, 0.73), (43.7, 0.71)):
        d = int(SR * ms / 1000); c = y.copy()
        for i in range(d, n): c[i] += g * c[i - d]
        out += c / 4
    for ms, g in ((5.0, 0.7), (1.7, 0.7)):
        d = int(SR * ms / 1000); a = out.copy()
        for i in range(d, n): a[i] = -g * out[i] + out[i - d] + g * a[i - d]
        out = a
    return y * (1 - wet) + out * wet * 2.2


def finish(name, x, peak_db, fade_in=0.006, fade_out=0.02):
    x = x.copy()
    n = len(x); fi, fo = int(SR * fade_in), int(SR * fade_out)
    x[:fi] *= np.sin(np.linspace(0, np.pi / 2, fi)) ** 2
    x[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo)) ** 2
    x = x / (np.max(np.abs(x)) + 1e-9) * 10 ** (peak_db / 20)
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    for d in ('examples/media', 'public/examples/media'):
        with wave.open(str(ROOT / d / f'{name}.wav'), 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR); f.writeframes(pcm.tobytes())
    print(f'{name:12s} {len(x) / SR:5.2f}s  peak {peak_db:+.1f} dB')


def place(parts, total):
    x = np.zeros(int(SR * total))
    for at, s in parts:
        a = int(SR * at); x[a:a + len(s)] += s[:len(x) - a]
    return x


# cue: a soft two-note rising chime that says "I am about to move"
finish('sfx_cue', reverb(place([(0.0, bell(659.3, 0.5, 6.0) * 0.8), (0.1, bell(987.8, 0.5, 6.5))], 0.55), 0.22, 0.25), -6.0)

# nod: a round "bup" (pitch dips like a head nodding), no sharp attack
t = T(0.3); f = 420 - 190 * (1 - np.exp(-t * 12))
nod = np.sin(2 * np.pi * np.cumsum(f) / SR) * (1 - np.exp(-t / 0.012)) * np.exp(-9 * t) + 0.3 * np.sin(2 * np.pi * np.cumsum(f * 0.5) / SR) * np.exp(-8 * t)
finish('sfx_nod', reverb(nod, 0.15, 0.2), -5.2)

# glide: the rail move, in the same cute voice as the other reactions: a soft singing "wheee" glide with a little vibrato,
# and a trail of marimba-like pentatonic pings that climb and fall with the move (it should feel like a happy donut rolling along)
d = 3.4; t = T(d); u = t / d
contour = 330 + 190 * np.sin(np.pi * np.minimum(1, u * 1.15)) ** 1.2 - 40 * u
vib = (4 + 9 * np.sin(np.pi * u)) * np.sin(2 * np.pi * 5.5 * t)
ph = 2 * np.pi * np.cumsum(contour + vib) / SR
voice = (np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)) * (0.18 + 0.82 * np.sin(np.pi * u) ** 1.4)
notes = [523.3, 587.3, 659.3, 784.0, 880.0, 784.0, 659.3, 587.3]   # C D E G A G E D
dots = place([(0.12 + 0.38 * k, bell(f, 0.55, 7.0, 0.3) * (0.55 + 0.25 * np.sin(np.pi * (0.12 + 0.38 * k) / d))) for k, f in enumerate(notes)], d)
finish('sfx_glide', reverb((voice * 0.8 + dots * 0.55) * hann_env(len(t), 0.45, 1.1), 0.22, 0.4), -5.2, 0.01, 0.05)

# No noise-based sounds on purpose: filtered noise reads as a hair dryer / fan. Every move sound is tonal (soft glides + bell pings) in the same cute voice.
PENTA = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5, 1174.7, 1318.5]   # C D E G A C D E


def singing_glide(d, f_lo, f_hi, shape, vib_hz=5.5, vib_depth=7.0):
    t = T(d); u = t / d
    f = f_lo + (f_hi - f_lo) * shape(u)
    ph = 2 * np.pi * np.cumsum(f + vib_depth * np.sin(2 * np.pi * vib_hz * t)) / SR
    return np.sin(ph) + 0.2 * np.sin(2 * ph) + 0.07 * np.sin(3 * ph)


# turn: a short two-note "woo-hoo" glide with two soft pings, like the head swinging round with a smile
d = 1.5; t = T(d); u = t / d
v = singing_glide(d, 380, 560, lambda u: np.sin(np.pi * u) ** 1.2) * (np.sin(np.pi * u) ** 1.3)
pings = place([(0.18, bell(784.0, 0.5, 7.0, 0.3) * 0.7), (0.62, bell(880.0, 0.5, 7.0, 0.3) * 0.6), (1.0, bell(659.3, 0.5, 7.0, 0.3) * 0.5)], d)
finish('sfx_turn', reverb((v * 0.65 + pings * 0.6) * hann_env(len(t), 0.2, 0.5), 0.2, 0.35), -6.0, 0.01, 0.05)

# scan: a gentle sweep of soft pings climbing and falling across the seats
d = 2.4; t = T(d)
order = [0, 1, 2, 3, 4, 3, 2, 1, 0]
scan = place([(0.08 + 0.24 * k, bell(PENTA[n] * 0.75, 0.45, 8.0, 0.25) * (0.5 + 0.35 * np.sin(np.pi * k / (len(order) - 1)))) for k, n in enumerate(order)], d)
finish('sfx_scan', reverb(scan * hann_env(len(t), 0.1, 0.5), 0.22, 0.35), -6.0, 0.01, 0.05)

# spin: a happy whirl: a rising and falling "wheee" glide with a spinning pentatonic ping pattern that speeds up then slows down
d = 5.4; t = T(d); u = t / d
v = singing_glide(d, 300, 760, lambda u: np.sin(np.pi * u) ** 1.4, 6.0, 12.0) * (0.15 + 0.85 * np.sin(np.pi * u) ** 1.3)
parts, at, k = [], 0.1, 0
while at < d - 0.8:
    prog = at / d; n = int(round((len(PENTA) - 1) * np.sin(np.pi * prog) ** 0.9))
    parts.append((at, bell(PENTA[n], 0.5, 7.5, 0.3) * (0.45 + 0.4 * np.sin(np.pi * prog))))
    at += 0.34 - 0.16 * np.sin(np.pi * prog); k += 1
finish('sfx_spin', reverb((v * 0.6 + place(parts, d) * 0.6) * hann_env(len(t), 0.7, 1.4), 0.22, 0.4), -5.2, 0.01, 0.05)

# intro-chime: a bright, friendly four-note bell arpeggio (C5 E5 G5 C6) with a gentle room
arp = place([(0.0, bell(523.3, 1.1, 4.0)), (0.11, bell(659.3, 1.0, 4.2)), (0.22, bell(784.0, 0.95, 4.4)), (0.34, bell(1046.5, 0.9, 4.8) * 0.9)], 1.2)
finish('intro-chime', reverb(arp, 0.25, 0.4), -8.0, 0.004, 0.25)

# boing: a soft springy glide with a little wobble
b = np.concatenate([glide_tone(300, 880, 0.2, 0.8, 22, 14) * hann_env(int(SR * 0.2), 0.012, 0.0), glide_tone(880, 480, 0.2, 0.9, 16, 14) * hann_env(int(SR * 0.2), 0.0, 0.12)])
finish('sfx_boing', reverb(b * np.exp(-1.2 * np.linspace(0, 1, len(b))), 0.15, 0.2), -3.1)

# giggle: four quick rising "hi-hi-hi-hi" chirps, rounded at both ends
parts = []
for i in range(4):
    c = glide_tone(640 + 80 * i, 1020 + 90 * i, 0.11, 0.8, 0, 6, 0.3) * hann_env(int(SR * 0.11), 0.02, 0.05)
    parts.append((0.15 * i, c))
finish('sfx_giggle', reverb(place(parts, 0.7), 0.15, 0.2), -3.1)

# sparkle: a quick cascade of high bell pings with a shimmering tail
pings = [(0.06 * i, bell(f, 0.7, 5.5, 0.5) * (0.9 - 0.08 * i)) for i, f in enumerate([1318.5, 1568.0, 1975.5, 2349.3, 2637.0, 3136.0, 3951.1])]
finish('sfx_sparkle', reverb(place(pings, 1.3), 0.25, 0.4), -3.1, 0.004, 0.2)

# blink: a tiny soft "tick" — a short high blip with a whisper of click (kept very quiet; the clips add more attenuation)
t = T(0.09)
tick = np.sin(2 * np.pi * 2300 * t) * np.exp(-90 * t) * (1 - np.exp(-t / 0.0015)) + 0.5 * np.sin(2 * np.pi * 3400 * t) * np.exp(-140 * t) * (1 - np.exp(-t / 0.001))
click = signal.sosfilt(signal.butter(2, 3500, 'high', fs=SR, output='sos'), rng.standard_normal(len(t))) * np.exp(-400 * t) * 0.25
finish('sfx_blink', lowpass(tick + click, 7000), -13.0, 0.0008, 0.015)
