"""Replaces ONLY the ring effects of the saved 04_driving_b scenario with build_scenarios.driving_b_ring().
Keeps everything else untouched (the capped yaw track, eyes, audio, projector, hand edits).   python3 tools/apply_ring_driving_b.py"""
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_scenarios as b  # noqa: E402

ROOT = b.ROOT
src = ROOT / 'examples/04_driving_b.lieu.json'
backup = ROOT / 'examples/_backup_04_driving_b_before_ringshow.lieu.json'
if not backup.exists():
    shutil.copy(src, backup)
seq = json.loads(src.read_text(encoding='utf8'))
seq['tracks']['ring24']['effects'] = b.driving_b_ring()
text = json.dumps(seq, ensure_ascii=False, indent=2)
for d in ('examples', 'public/examples'):
    (ROOT / d / '04_driving_b.lieu.json').write_text(text, encoding='utf8')
print('04_driving_b ring effects:', len(seq['tracks']['ring24']['effects']))
