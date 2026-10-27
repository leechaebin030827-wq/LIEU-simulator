"""Slow, limited axis control (Dynamixel yaw id 1 / tilt id 2). THE ONLY PLACE THAT WRITES TO A MOTOR. motor_readonly.py stays write-free.

Safety rules enforced here, not left to the caller:
  * only these registers can be written: operating mode, torque enable, profile acceleration, profile velocity, goal position
  * goal position is refused outside +/-limit_deg (config/motor_limits.json 'safe') and never written without a verified, non-zero profile velocity
    (profile velocity 0 means MAXIMUM speed on Dynamixels)
  * torque is only enabled after goal position == present position, so enabling cannot make the motor jump
  * playback stops and holds position on: hardware error, tracking error > TRACK_ERR_DEG, lost replies, Ctrl-C
"""
import struct
import time

from .axes import AxisCfg
from .motor_readonly import ReadOnlyBus, crc16, parse_status
from .yaw_plan import plan_yaw

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


class MotorBus(ReadOnlyBus):
    """The shared serial line. Reads come from ReadOnlyBus; the (allow-listed) write lives here."""

    def write(self, dxl_id: int, addr: int, value: int) -> None:
        pkt = build_write(dxl_id, addr, value)
        self.ser.reset_input_buffer()
        self.ser.write(pkt)
        self.ser.flush()
        for i, err, _ in parse_status(self._collect(0.03)):
            if i == dxl_id:
                if err:
                    raise MotorError(f"motor {dxl_id} reported error 0x{err:02X} writing register {addr}")
                return
        raise MotorError(f"motor {dxl_id}: no reply writing register {addr}")

    def u32(self, dxl_id: int, addr: int, n: int = 4, signed: bool = False) -> int | None:
        p = self.read(dxl_id, addr, n)
        return None if p is None else int.from_bytes(p, "little", signed=signed)


class AxisControl:
    def __init__(self, bus: MotorBus, cfg: AxisCfg):
        self.bus, self.cfg, self.id = bus, cfg, cfg.id
        # profile limits derived from the safe limits: robot deg/s -> motor rev/min -> register units
        self.vel_units = max(1, round(cfg.max_vel * cfg.gear / 360 * 60 / RPM_UNIT))
        self.acc_units = max(1, round(cfg.max_acc * cfg.gear / 360 * 3600 / ACC_UNIT))

    @property
    def raw_min(self) -> int:
        return self.cfg.raw_bounds[0]

    @property
    def raw_max(self) -> int:
        return self.cfg.raw_bounds[1]

    @property
    def m(self):  # the attributes plan_yaw() reads (limit_deg, max_vel, max_acc) plus the maps
        return self.cfg

    # -- low level -------------------------------------------------------------------------------------------------------------
    def write(self, addr: int, value: int) -> None:
        self.bus.write(self.id, addr, value)

    def u32(self, addr: int, n: int = 4, signed: bool = False) -> int | None:
        return self.bus.u32(self.id, addr, n, signed)

    def torque_enabled(self, *_):
        return self.bus.torque_enabled(self.id)

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
        return {"torque": self.torque_enabled(), "mode": self.u32(11, 1), "profile_vel": self.u32(ADDR_PROFILE_VEL), "profile_acc": self.u32(ADDR_PROFILE_ACC),
                "present_raw": self.u32(ADDR_PRESENT, 4, True), "present_deg": None, "hw_error": self.u32(ADDR_HW_ERROR, 1),
                "want_profile_vel": self.vel_units, "want_profile_acc": self.acc_units, "safe_raw": (self.raw_min, self.raw_max)}

    def arm(self) -> None:
        """Mode + slow profile + goal=present, THEN torque on. The motor must not move during any of this."""
        if self.torque_enabled():
            # already armed: only refresh the slow profile (RAM registers), never the mode, goal or torque of a live motor
            if self.u32(11, 1) != MODE_EXTENDED_POSITION:
                raise MotorError("torque is on but the mode is not extended position: release torque first")
            self.write(ADDR_PROFILE_ACC, self.acc_units)
            self.write(ADDR_PROFILE_VEL, self.vel_units)
            if not self.profile_ok() or self.u32(ADDR_PROFILE_ACC) != self.acc_units:
                raise MotorError("profile read-back does not match")
            return
        if self.u32(11, 1) != MODE_EXTENDED_POSITION:
            self.write(ADDR_MODE, MODE_EXTENDED_POSITION)
            if self.u32(11, 1) != MODE_EXTENDED_POSITION:
                raise MotorError("operating mode did not change")
        self.write(ADDR_PROFILE_ACC, self.acc_units)
        self.write(ADDR_PROFILE_VEL, self.vel_units)
        if not self.profile_ok() or self.u32(ADDR_PROFILE_ACC) != self.acc_units:
            raise MotorError("profile read-back does not match: NOT enabling torque")
        # read the position only NOW, after the mode change: its meaning can differ between modes, and the goal must be what the motor reports in the final mode
        p = self.present()
        self.write(ADDR_GOAL, p)
        if self.u32(ADDR_GOAL, 4, True) != p:
            raise MotorError("goal read-back does not match: NOT enabling torque")
        if abs(self.present() - p) > 4:
            raise MotorError("the axis is moving while arming: NOT enabling torque")
        if self.hw_error():
            raise MotorError(f"hardware error status 0x{self.hw_error():02X}: NOT enabling torque")
        self.write(ADDR_TORQUE, 1)
        if not self.torque_enabled():
            raise MotorError("torque did not turn on")

    def goto_raw(self, raw: int) -> None:
        if not (self.raw_min <= raw <= self.raw_max):
            raise MotorError(f"{raw} is outside the safe range {self.raw_min}..{self.raw_max}")
        if not self.profile_ok():
            raise MotorError("profile velocity is not set to a slow value: refusing to move")
        if not self.torque_enabled():
            raise MotorError("torque is off: arm first")
        self.write(ADDR_GOAL, raw)

    def set_front(self) -> int:
        """Teach 'here is 0 deg' (yaw only; tilt has its own taught points). Reads only from the motor."""
        if self.cfg.set_front is None:
            raise MotorError(f"{self.cfg.name} has no teachable front")
        raw = self.present()
        self.cfg.set_front(raw)
        return raw

    def hold(self) -> None:
        """Stop where it is: goal = present (torque stays on)."""
        self.write(ADDR_GOAL, self.present())

    def release(self) -> None:
        self.write(ADDR_TORQUE, 0)

    def goto_deg(self, deg: float, timeout: float = 30.0, log=print) -> None:
        self.goto_raw(self.cfg.to_raw(deg))
        goal, t0 = self.cfg.to_raw(deg), time.monotonic()
        tol = max(8.0, abs(self.cfg.to_raw(1.0) - self.cfg.to_raw(0.0)))  # about 1 robot degree: the motor settles a little short (friction)
        try:
            while time.monotonic() - t0 < timeout:
                p = self.present()
                if self.hw_error():
                    raise MotorError("hardware error while moving")
                log(f"\r  {self.cfg.to_deg(p):7.2f} deg  (goal {deg:.2f})", end="", flush=True)
                if abs(p - goal) < tol:
                    log()
                    return
                time.sleep(0.05)
            raise MotorError("did not arrive in time")
        except BaseException:
            self.hold()
            raise

    def play_yaw(self, yaw_deg: list[float], fps: int, speed: float = 1.0, log=print) -> None:
        """Follow the (already slowed and clamped) trajectory. Starts by moving slowly to its first point."""
        traj = plan_yaw(yaw_deg, fps, self.cfg)
        self.goto_deg(traj[0], log=log)
        t0, i = time.monotonic(), 0
        try:
            while i < len(traj):
                i = min(len(traj) - 1, int((time.monotonic() - t0) * fps * speed))
                self.goto_raw(self.cfg.to_raw(traj[i]))
                p = self.present()
                if self.hw_error():
                    raise MotorError("hardware error: holding")
                if abs(self.cfg.to_deg(p) - traj[i]) > TRACK_ERR_DEG:
                    raise MotorError(f"tracking error {abs(self.cfg.to_deg(p) - traj[i]):.1f} deg (blocked?): holding")
                log(f"\r  t={i / fps:5.2f}s  goal {traj[i]:7.2f}  now {self.cfg.to_deg(p):7.2f}", end="", flush=True)
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
