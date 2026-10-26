"""Slow, limited yaw motor control (Dynamixel id 1). THE ONLY PLACE THAT WRITES TO A MOTOR. motor_readonly.py stays write-free.

Safety rules enforced here, not left to the caller:
  * only these registers can be written: operating mode, torque enable, profile acceleration, profile velocity, goal position
  * goal position is refused outside +/-limit_deg (config/motor_limits.json 'safe') and never written without a verified, non-zero profile velocity
    (profile velocity 0 means MAXIMUM speed on Dynamixels)
  * torque is only enabled after goal position == present position, so enabling cannot make the motor jump
  * playback stops and holds position on: hardware error, tracking error > TRACK_ERR_DEG, lost replies, Ctrl-C
"""
import struct
import time

from .motor_readonly import ReadOnlyBus, crc16, parse_status
from .yaw_plan import YawMotor, plan_yaw

INST_WRITE = 0x03
ADDR_MODE, ADDR_TORQUE, ADDR_HW_ERROR, ADDR_PROFILE_ACC, ADDR_PROFILE_VEL, ADDR_GOAL, ADDR_PRESENT = 11, 64, 70, 108, 112, 116, 132
WRITABLE = {ADDR_MODE: 1, ADDR_TORQUE: 1, ADDR_PROFILE_ACC: 4, ADDR_PROFILE_VEL: 4, ADDR_GOAL: 4}
MODE_EXTENDED_POSITION = 4   # multi-turn position control: keeps the measured (multi-turn) raw numbers meaningful
RPM_UNIT = 0.229             # profile velocity unit (rev/min) on X330 series  -> verified by read-back, see arm()
ACC_UNIT = 214.577           # profile acceleration unit (rev/min^2)
TRACK_ERR_DEG = 15.0         # robot degrees between goal and present before playback aborts


def stuff(params: bytes) -> bytes:
    out = bytearray()
    for b in params:
        out.append(b)
        if out[-3:] == b"\xff\xff\xfd":
            out.append(0xFD)
    return bytes(out)


def build_write(dxl_id: int, addr: int, value: int) -> bytes:
    if addr not in WRITABLE:
        raise PermissionError(f"register {addr} is not on the write allow-list")
    n = WRITABLE[addr]
    if addr == ADDR_TORQUE and value not in (0, 1):
        raise ValueError("torque value must be 0 or 1")
    if addr == ADDR_MODE and value != MODE_EXTENDED_POSITION:
        raise ValueError("only extended position mode (4) may be set")
    params = stuff(struct.pack("<H", addr) + value.to_bytes(n, "little", signed=(addr == ADDR_GOAL)))
    body = bytes([0xFF, 0xFF, 0xFD, 0x00, dxl_id]) + struct.pack("<H", len(params) + 3) + bytes([INST_WRITE]) + params
    return body + struct.pack("<H", crc16(body))


class MotorError(RuntimeError):
    pass


class YawControl(ReadOnlyBus):
    def __init__(self, port: str, baud: int, motor: YawMotor, dxl_id: int = 1):
        super().__init__(port, baud)
        self.m, self.id = motor, dxl_id
        self.raw_min, self.raw_max = sorted((motor.to_raw(-motor.limit_deg), motor.to_raw(motor.limit_deg)))
        # profile limits derived from the safe limits: robot deg/s -> motor rev/min -> register units
        gear = motor.raw_per_deg * 360 / 4096                              # motor deg per robot deg
        self.vel_units = max(1, round(motor.max_vel * gear / 360 * 60 / RPM_UNIT))
        self.acc_units = max(1, round(motor.max_acc * gear / 360 * 3600 / ACC_UNIT))

    # -- low level -------------------------------------------------------------------------------------------------------------
    def write(self, addr: int, value: int) -> None:
        pkt = build_write(self.id, addr, value)
        self.ser.reset_input_buffer()
        self.ser.write(pkt)
        self.ser.flush()
        for i, err, _ in parse_status(self._collect(0.03)):
            if i == self.id:
                if err:
                    raise MotorError(f"motor reported error 0x{err:02X} writing register {addr}")
                return
        raise MotorError(f"no reply writing register {addr}")

    def u32(self, addr: int, n: int = 4, signed: bool = False) -> int | None:
        p = self.read(self.id, addr, n)
        return None if p is None else int.from_bytes(p, "little", signed=signed)

    def present(self) -> int:
        v = self.u32(ADDR_PRESENT, 4, True)
        if v is None:
            raise MotorError("no position reply")
        return v

    def hw_error(self) -> int:
        v = self.u32(ADDR_HW_ERROR, 1)
        if v is None:
            raise MotorError("no hardware-status reply")
        return v

    def profile_ok(self) -> bool:
        """Profile velocity must be read back non-zero and not above our cap; 0 would mean full speed."""
        v = self.u32(ADDR_PROFILE_VEL)
        return v is not None and 0 < v <= self.vel_units

    # -- staged actions ---------------------------------------------------------------------------------------------------------
    def status(self) -> dict:
        return {"torque": self.torque_enabled(self.id), "mode": self.u32(11, 1), "profile_vel": self.u32(ADDR_PROFILE_VEL), "profile_acc": self.u32(ADDR_PROFILE_ACC),
                "present_raw": self.u32(ADDR_PRESENT, 4, True), "present_deg": None, "hw_error": self.u32(ADDR_HW_ERROR, 1),
                "want_profile_vel": self.vel_units, "want_profile_acc": self.acc_units, "safe_raw": (self.raw_min, self.raw_max)}

    def arm(self) -> None:
        """Mode + slow profile + goal=present, THEN torque on. The motor must not move during any of this."""
        if self.torque_enabled(self.id):
            # already armed: only refresh the slow profile (RAM registers), never the mode, goal or torque of a live motor
            if self.u32(11, 1) != MODE_EXTENDED_POSITION:
                raise MotorError("torque is on but the mode is not extended position: release torque first")
            self.write(ADDR_PROFILE_ACC, self.acc_units)
            self.write(ADDR_PROFILE_VEL, self.vel_units)
            if not self.profile_ok() or self.u32(ADDR_PROFILE_ACC) != self.acc_units:
                raise MotorError("profile read-back does not match")
            return
        p = self.present()
        if self.u32(11, 1) != MODE_EXTENDED_POSITION:
            self.write(ADDR_MODE, MODE_EXTENDED_POSITION)
            if self.u32(11, 1) != MODE_EXTENDED_POSITION:
                raise MotorError("operating mode did not change")
        self.write(ADDR_PROFILE_ACC, self.acc_units)
        self.write(ADDR_PROFILE_VEL, self.vel_units)
        if not self.profile_ok() or self.u32(ADDR_PROFILE_ACC) != self.acc_units:
            raise MotorError("profile read-back does not match: NOT enabling torque")
        self.write(ADDR_GOAL, p)
        if self.u32(ADDR_GOAL, 4, True) != p:
            raise MotorError("goal read-back does not match: NOT enabling torque")
        if self.hw_error():
            raise MotorError(f"hardware error status 0x{self.hw_error():02X}: NOT enabling torque")
        self.write(ADDR_TORQUE, 1)
        if not self.torque_enabled(self.id):
            raise MotorError("torque did not turn on")

    def goto_raw(self, raw: int) -> None:
        if not (self.raw_min <= raw <= self.raw_max):
            raise MotorError(f"{raw} is outside the safe range {self.raw_min}..{self.raw_max}")
        if not self.profile_ok():
            raise MotorError("profile velocity is not set to a slow value: refusing to move")
        if not self.torque_enabled(self.id):
            raise MotorError("torque is off: arm first")
        self.write(ADDR_GOAL, raw)

    def set_front(self) -> int:
        """Teach 'here is front (0 deg)': remembers the present raw as the centre (in memory and in config/motor_limits.json). Reads only from the motor."""
        import json
        from .config import ROOT
        raw = self.present()
        self.m.center_raw = raw
        self.raw_min, self.raw_max = sorted((self.m.to_raw(-self.m.limit_deg), self.m.to_raw(self.m.limit_deg)))
        path = ROOT / "config" / "motor_limits.json"
        d = json.loads(path.read_text(encoding="utf-8"))
        c = d["motors"]["1"]["calibration"]
        shift = raw - c["raw_center_front"]
        c["raw_center_front"] = raw
        c["raw_at_plus90"] += shift
        c["raw_at_minus90"] += shift
        d["motors"]["1"]["limits"]["raw"] = [c["raw_at_minus90"], c["raw_at_plus90"]]
        d["motors"]["1"]["limits"]["raw_center_front"] = raw
        c.setdefault("front_history", []).append({"raw": raw, "note": "set with 'Set front here'"})
        path.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")
        return raw

    def hold(self) -> None:
        """Stop where it is: goal = present (torque stays on)."""
        self.write(ADDR_GOAL, self.present())

    def release(self) -> None:
        self.write(ADDR_TORQUE, 0)

    def goto_deg(self, deg: float, timeout: float = 30.0, log=print) -> None:
        self.goto_raw(self.m.to_raw(deg))
        goal, t0 = self.m.to_raw(deg), time.monotonic()
        try:
            while time.monotonic() - t0 < timeout:
                p = self.present()
                if self.hw_error():
                    raise MotorError("hardware error while moving")
                log(f"\r  {self.m.to_deg(p):7.2f} deg  (goal {deg:.2f})", end="", flush=True)
                if abs(p - goal) < self.m.raw_per_deg * 1.0:  # the motor settles a fraction of a degree short (friction), so 1 deg counts as arrived
                    log()
                    return
                time.sleep(0.05)
            raise MotorError("did not arrive in time")
        except BaseException:
            self.hold()
            raise

    def play_yaw(self, yaw_deg: list[float], fps: int, speed: float = 1.0, log=print) -> None:
        """Follow the (already slowed and clamped) yaw trajectory. Starts by moving slowly to its first point."""
        traj = plan_yaw(yaw_deg, fps, self.m)
        self.goto_deg(traj[0], log=log)
        t0, i = time.monotonic(), 0
        try:
            while i < len(traj):
                i = min(len(traj) - 1, int((time.monotonic() - t0) * fps * speed))
                self.goto_raw(self.m.to_raw(traj[i]))
                p = self.present()
                if self.hw_error():
                    raise MotorError("hardware error: holding")
                if abs(self.m.to_deg(p) - traj[i]) > TRACK_ERR_DEG:
                    raise MotorError(f"tracking error {abs(self.m.to_deg(p) - traj[i]):.1f} deg (blocked?): holding")
                log(f"\r  t={i / fps:5.2f}s  goal {traj[i]:7.2f}  now {self.m.to_deg(p):7.2f}", end="", flush=True)
                if i >= len(traj) - 1:
                    break
                time.sleep(1 / (fps * 2))
            log()
        except BaseException:
            try:
                self.hold()
            finally:
                log("\nstopped: holding position (torque still on; `motors release` turns it off)")
            raise
