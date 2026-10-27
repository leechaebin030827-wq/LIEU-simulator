"""The motion axes (config/motor_limits.json): which Dynamixel id, how robot degrees map to motor raw, and the self-imposed safe limits.
yaw  = id 1: linear map around a taught front (re-taught after a motor power cycle; the axis turns the motor ~6 times).
tilt = id 2: piecewise-linear map through three taught points (up end / level / down end); the motor turns well under one revolution,
       so its raw numbers are repeatable across power cycles and need no re-teaching."""
import json
from dataclasses import dataclass, field
from typing import Callable

from .config import ROOT
from .tilt_map import load_tilt_map
from .yaw_plan import load_yaw_motor

LIMITS_FILE = ROOT / "config" / "motor_limits.json"


@dataclass
class AxisCfg:
    name: str
    id: int
    limit_deg: float
    max_vel: float            # robot deg/s
    max_acc: float            # robot deg/s^2
    gear: float               # motor degrees per robot degree
    to_raw: Callable[[float], int]
    to_deg: Callable[[float], float]
    needs_front: bool         # True: the zero is lost when the motor loses power (yaw)
    set_front: Callable[[int], None] | None = None
    extra: dict = field(default_factory=dict)

    @property
    def raw_bounds(self) -> tuple[int, int]:
        return tuple(sorted((self.to_raw(-self.limit_deg), self.to_raw(self.limit_deg))))  # type: ignore[return-value]


def load_axes() -> dict[str, AxisCfg]:
    motors = json.loads(LIMITS_FILE.read_text(encoding="utf-8"))["motors"]
    ym = load_yaw_motor()
    yaw = AxisCfg("yaw", 1, ym.limit_deg, ym.max_vel, ym.max_acc, ym.raw_per_deg * 360 / 4096, ym.to_raw, ym.to_deg, True)

    def set_front(raw: int) -> None:
        ym.center_raw = raw
        d = json.loads(LIMITS_FILE.read_text(encoding="utf-8"))
        c = d["motors"]["1"]["calibration"]
        shift = raw - c["raw_center_front"]
        c["raw_center_front"] = raw
        c["raw_at_plus90"] += shift
        c["raw_at_minus90"] += shift
        d["motors"]["1"]["limits"]["raw"] = [c["raw_at_minus90"], c["raw_at_plus90"]]
        d["motors"]["1"]["limits"]["raw_center_front"] = raw
        c.setdefault("front_history", []).append({"raw": raw, "note": "set with 'Set front here'"})
        LIMITS_FILE.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")

    yaw.set_front = set_front
    axes = {"yaw": yaw}
    if "2" in motors and "safe" in motors["2"] and "calibration" in motors["2"] and "anchors" in motors["2"]["calibration"]:
        s, tm = motors["2"]["safe"], load_tilt_map()
        axes["tilt"] = AxisCfg("tilt", 2, s["limit_deg"], s["max_vel_deg_s"], s["max_acc_deg_s2"], motors["2"]["calibration"]["motor_deg_per_robot_deg"], tm.to_raw, tm.to_deg, False)
    return axes
