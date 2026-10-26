import json
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # hardware/
DEFAULT_CONFIG = ROOT / "config" / "hardware.json"
FRAMES_DIR = ROOT / "frames"

DEFAULTS = {
    "backend": "mock",
    "serial": {"port": "auto", "baud": 115200},
    "pi": {"i2c_bus": 1, "ring_gpio": 18, "ring_dma": 10, "ring_freq_hz": 800000},
    "eyes": {
        "left": {"address": "0x70", "layout": "adafruit", "flip_x": False, "flip_y": False},
        "right": {"address": "0x71", "layout": "adafruit", "flip_x": False, "flip_y": False},
        "swap": False,
    },
    "ring": {"count": 24, "order": "GRBW", "offset": 0, "reverse": False, "max_scale": 0.25, "budget_ma": 400},
}


def _merge(base: dict, over: dict) -> dict:
    for k, v in over.items():
        if k.startswith("_"):
            continue
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def load_config(path: str | Path | None = None) -> dict:
    cfg = deepcopy(DEFAULTS)
    p = Path(path) if path else DEFAULT_CONFIG
    if p.exists():
        _merge(cfg, json.loads(p.read_text(encoding="utf-8")))
    for side in ("left", "right"):
        a = cfg["eyes"][side]["address"]
        cfg["eyes"][side]["address"] = int(a, 0) if isinstance(a, str) else int(a)
    return cfg
