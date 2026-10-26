"""Python twin of src/engine/motorPlan.ts (planYaw): turns the requested yaw into a slow, limited trajectory. Constants: config/motor_limits.json."""
import json
import math
from dataclasses import dataclass

from .config import ROOT


@dataclass
class YawMotor:
    center_raw: float
    raw_per_deg: float
    limit_deg: float
    max_vel: float
    max_acc: float

    def to_raw(self, deg: float) -> int:
        return round(self.center_raw + self.raw_per_deg * deg)

    def to_deg(self, raw: float) -> float:
        return (raw - self.center_raw) / self.raw_per_deg


def load_yaw_motor() -> YawMotor:
    m = json.loads((ROOT / "config" / "motor_limits.json").read_text(encoding="utf-8"))["motors"]["1"]
    c, s = m["calibration"], m["safe"]
    return YawMotor(c["raw_center_front"], c["raw_per_robot_deg"], s["limit_deg"], s["max_vel_deg_s"], s["max_acc_deg_s2"])


def plan_yaw(sim: list[float], fps: int, c: YawMotor) -> list[float]:
    """Position clamp + velocity cap + acceleration cap, braking in time to stop on target (same maths as the web dry run)."""
    dt = 1 / fps
    x = max(-c.limit_deg, min(c.limit_deg, sim[0]))
    v = 0.0
    out = []
    for want in sim:
        target = max(-c.limit_deg, min(c.limit_deg, want))
        err = target - x
        vd = math.copysign(min(c.max_vel, math.sqrt(1.6 * c.max_acc * abs(err))), err) if err else 0.0
        v += max(-c.max_acc * dt, min(c.max_acc * dt, vd - v))
        nx = max(-c.limit_deg, min(c.limit_deg, x + v * dt))
        v = (nx - x) / dt
        x = nx
        out.append(x)
    return out
