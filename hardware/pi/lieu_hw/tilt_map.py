"""Tilt (Dynamixel id 2): robot tilt degrees <-> motor raw, piecewise linear through the three taught points (up end, level, down end).
+deg = look up = raw decreasing. Numbers live in config/motor_limits.json (motors['2'].calibration.anchors). Nothing here talks to a motor."""
import json

from .config import ROOT


class TiltMap:
    def __init__(self, anchors: list[tuple[float, float]]):
        self.pts = sorted(anchors)  # by robot_deg ascending

    def to_raw(self, deg: float) -> int:
        lo, hi = self.pts[0], self.pts[-1]
        deg = max(lo[0], min(hi[0], deg))  # never extrapolate beyond the taught ends
        for (d0, r0), (d1, r1) in zip(self.pts, self.pts[1:]):
            if d0 <= deg <= d1:
                return round(r0 + (r1 - r0) * (deg - d0) / (d1 - d0))
        raise ValueError(deg)

    def to_deg(self, raw: float) -> float:
        rs = [r for _, r in self.pts]
        raw = max(min(rs), min(max(rs), raw))
        for (d0, r0), (d1, r1) in zip(self.pts, self.pts[1:]):
            if min(r0, r1) <= raw <= max(r0, r1):
                return d0 + (d1 - d0) * (raw - r0) / (r1 - r0)
        raise ValueError(raw)


def load_tilt_map() -> TiltMap:
    c = json.loads((ROOT / "config" / "motor_limits.json").read_text(encoding="utf-8"))["motors"]["2"]["calibration"]
    return TiltMap([(a["robot_deg"], a["raw"]) for a in c["anchors"]])
