"""Frame data: what the simulator evaluated (virtual) and what the devices receive (physical)."""
import json
from dataclasses import dataclass, field
from pathlib import Path

from .config import FRAMES_DIR


@dataclass
class Frame:
    """One device state in virtual (simulator) terms."""
    eye_l: bytes = bytes(8)          # 8 rows, bit7 = virtual screen column 0
    eye_r: bytes = bytes(8)
    bright_l: int = 15               # HT16K33 dimming 0..15
    bright_r: int = 15
    ring: bytes = bytes(96)          # 24 x (R, G, B, W), virtual LED order


@dataclass
class DeviceFrame:
    """Already mapped to the wiring: raw chip rows and physical-order ring bytes."""
    eye_l: bytes
    eye_r: bytes
    bright_l: int
    bright_r: int
    ring: bytes                      # 24 x (R, G, B, W), physical DIN order

    def key(self) -> tuple:
        return (self.eye_l, self.eye_r, self.bright_l, self.bright_r, self.ring)


@dataclass
class Scenario:
    id: str
    fps: int
    duration: float
    loop: bool
    times: list[float] = field(default_factory=list)
    frames: list[Frame] = field(default_factory=list)
    motion: list[tuple[float, float, float]] = field(default_factory=list)  # per frame at fps

    def frame_at(self, t: float) -> Frame:
        """Latest key at or before t (frames are sample-and-hold)."""
        lo, hi = 0, len(self.times) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if self.times[mid] <= t:
                lo = mid
            else:
                hi = mid - 1
        return self.frames[lo]

    def motion_at(self, t: float) -> tuple[float, float, float]:
        if not self.motion:
            return (0.0, 0.0, 0.0)
        return self.motion[min(len(self.motion) - 1, max(0, int(t * self.fps + 0.5)))]


def load_scenario(name_or_path: str) -> Scenario:
    p = Path(name_or_path)
    if not p.exists():
        p = FRAMES_DIR / (name_or_path if name_or_path.endswith(".json") else f"{name_or_path}.hw.json")
    d = json.loads(p.read_text(encoding="utf-8"))
    if d.get("schema") != "lieu.hwframes/v1":
        raise ValueError(f"{p}: not a lieu.hwframes/v1 file")
    s = Scenario(d["id"], d["fps"], d["durationSec"], bool(d["loop"]))
    for k in d["keys"]:
        s.times.append(k["t"])
        s.frames.append(Frame(bytes.fromhex(k["l"]), bytes.fromhex(k["r"]), k["bl"], k["br"], bytes.fromhex(k["ring"])))
    s.motion = [tuple(m) for m in d["motion"]]
    return s


def list_scenarios() -> list[str]:
    return sorted(p.name[:-8] for p in FRAMES_DIR.glob("*.hw.json"))
