"""Scenario audio mix: per-sound fades / lengths on the clips, plus a tiny tick on every eye blink.

   python3 tools/sfx_mix.py     patches examples/ and public/examples/ in place
build_scenarios.py also calls apply() so regenerated scenarios keep the mix."""
import json
import sys
from pathlib import Path

# asset -> (fade in s, fade out s, length mode, file length s). 'full' = play the whole file, 'keep' = keep the clip length already in the scenario.
MIX = {
    'sfx_cue': (0.005, 0.18, 'full', 0.80), 'sfx_nod': (0.005, 0.15, 'full', 0.50), 'sfx_glide': (0.5, 1.1, 'keep', 3.80),
    'sfx_turn': (0.25, 0.5, 'full', 1.85), 'sfx_scan': (0.2, 0.6, 'full', 2.75), 'sfx_spin': (0.7, 1.3, 'keep', 5.80),
    'intro-chime': (0.005, 0.4, 'full', 1.60), 'sfx_boing': (0.005, 0.2, 'full', 0.60), 'sfx_giggle': (0.005, 0.2, 'full', 0.90),
    'sfx_sparkle': (0.005, 0.4, 'full', 1.70),
}
BLINK = 'media/sfx_blink.wav'


def blink_times(seq):
    """Times (s) where the eyes close for a moment: lit-row count dips to 1-2 rows for at most 0.35 s and opens again.
    Eyes switched off (0 rows) and long closed / squinting expressions are not blinks."""
    keys = seq['tracks']['eyes']['left']['keys']
    h = [(k['tSec'], sum(1 for r in k['value'] if r)) for k in keys]
    out, i = [], 0
    while i < len(h):
        t, n = h[i]
        if 1 <= n <= 2 and i > 0 and h[i - 1][1] >= 3:
            j = i
            while j + 1 < len(h) and 1 <= h[j + 1][1] <= 2: j += 1
            closed = (h[j + 1][0] if j + 1 < len(h) else h[j][0]) - t
            if closed <= 0.35 and j + 1 < len(h) and h[j + 1][1] >= 3:
                start = t
                k = i - 1                    # the closing starts at the last full-height frame before it
                while k > 0 and h[k - 1][1] > h[k][1] and h[k][0] > t - 0.25: k -= 1
                start = h[k][0] if h[k][1] >= 3 else t
                if start >= 0.2 and (not out or start - out[-1] >= 0.3): out.append(round(start, 3))
            i = j + 1
        else:
            i += 1
    return out


def apply(seq):
    clips = [c for c in seq['tracks']['audio'] if c['assetId'] != BLINK]
    for c in clips:
        name = Path(c['assetId']).stem
        if name not in MIX: continue
        fi, fo, mode, flen = MIX[name]
        c['fadeInSec'], c['fadeOutSec'] = fi, fo
        c['toSec'] = round(c['fromSec'] + (flen if mode == 'full' else min(c['toSec'] - c['fromSec'], flen)), 3)
    for n, t in enumerate(blink_times(seq)):
        clips.append({'id': f'blink{n}', 'fromSec': t, 'toSec': round(t + 0.09, 3), 'assetId': BLINK, 'mediaOffsetSec': 0, 'gain': 0.7,
                      'fadeInSec': 0.002, 'fadeOutSec': 0.02, 'loop': False})
    clips.sort(key=lambda c: c['fromSec'])
    seq['tracks']['audio'] = clips
    return len([c for c in clips if c['assetId'] == BLINK])


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    for d in ('examples', 'public/examples'):
        for f in sorted((root / d).glob('0?_*.lieu.json')):
            seq = json.loads(f.read_text(encoding='utf8'))
            n = apply(seq)
            f.write_text(json.dumps(seq, ensure_ascii=False, indent=2), encoding='utf8')
            if d == 'examples': print(f.name, n, 'blinks', [c['fromSec'] for c in seq['tracks']['audio'] if c['assetId'] == BLINK][:14])
