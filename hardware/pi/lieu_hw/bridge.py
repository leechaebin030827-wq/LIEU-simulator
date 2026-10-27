"""Local bridge: the web editor asks, this process decides. Listens on 127.0.0.1 only, accepts browser requests only from the editor's own origin.
All motor safety (range, slow profile, fault latch, watchdog) lives in motor_control.py / here, not in the web page.

Axes: yaw (Dynamixel id 1) and tilt (id 2) share one serial line. Each is found, armed, watched and faulted on its own; one missing axis never
blocks the other. Auto-setup per axis when it is found:
  * torque ON + position mode (never power-cycled): re-applies the slow speed profile, nothing else  -> ready
  * torque OFF: yaw waits for ONE human confirmation ("the robot faces front now", 'setup'); tilt only needs 'arm' (its taught points are absolute).
Run:  python3 -m lieu_hw serve            (the web dev server starts it for you)
"""
import glob
import json
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .axes import AxisCfg, load_axes
from .motor_control import TRACK_ERR_DEG, AxisControl, MotorBus, MotorError
from .motor_readonly import ReadOnlyBus

ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
WATCHDOG_S = 0.6
BAUDS = (115200, 57600, 1000000)
PAUSE_FILE = Path("/tmp/lieu_bridge.pause")  # while this exists the bridge lets go of the serial port (motor_setup / motors record)
MISSES_BEFORE_LOST = 6  # consecutive checks without any reply (~0.6 s) before an axis counts as gone


def find_ports() -> list[str]:
    return sorted(glob.glob("/dev/cu.usbserial-*") + glob.glob("/dev/ttyUSB*"))


class Axis:
    """Runtime state of one axis."""

    def __init__(self, cfg: AxisCfg):
        self.cfg = cfg
        self.ctl: AxisControl | None = None
        self.front_ok = not cfg.needs_front
        self.fault: str | None = None
        self.follow = False
        self.last_goal_deg: float | None = None
        self.last_cmd = time.monotonic()
        self.goals = 0
        self.misses = 0
        self.trail: deque = deque()  # (time, present deg) of the last second, to tell 'lagging' from 'blocked'

    def reset(self, ctl: AxisControl | None):
        self.ctl, self.follow, self.last_goal_deg, self.misses, self.fault = ctl, False, None, 0, None
        self.trail.clear()
        if ctl is None:
            self.front_ok = not self.cfg.needs_front


class Bridge:
    def __init__(self, port: str = "auto", baud: str | int = "auto"):
        self.port_spec, self.baud_spec = port, baud
        self.lock = threading.RLock()
        self.bus: MotorBus | None = None
        self.axes = {n: Axis(c) for n, c in load_axes().items()}
        self.snapshot: dict = {"ok": False, "error": "starting", "searching": True}
        self.snapshot_at = 0.0
        self.last_snap_build = 0.0
        threading.Thread(target=self._connector, daemon=True).start()
        threading.Thread(target=self._watch, daemon=True).start()

    # -- finding the motors -----------------------------------------------------------------------------------------------------
    def _open_bus(self) -> MotorBus | None:
        ports = [self.port_spec] if self.port_spec != "auto" else find_ports()
        bauds = BAUDS if self.baud_spec == "auto" else (int(self.baud_spec),)
        want = {a.cfg.id for a in self.axes.values()}
        for port in ports:
            for baud in bauds:
                try:
                    probe = ReadOnlyBus(port, baud)
                    try:
                        found = probe.scan(0.4)
                    finally:
                        probe.close()
                    if want & set(found):
                        return MotorBus(port, baud)
                except Exception:
                    continue
        return None

    def _attach(self, ax: Axis):
        """Caller holds the lock. Bring a freshly found axis to its starting state."""
        ctl = AxisControl(self.bus, ax.cfg)
        ready = bool(ctl.torque_enabled()) and ctl.u32(11, 1) == 4
        if ready:
            ctl.arm()  # already armed: only re-applies the slow speed limits (no mode / goal / torque change)
        ax.reset(ctl)
        ax.front_ok = ready or not ax.cfg.needs_front
        print(f"{ax.cfg.name} (id {ax.cfg.id}) found on {self.bus.ser.port} @ {self.bus.ser.baudrate}: " + ("ready (still armed)" if ready else ("needs the front confirmation" if ax.cfg.needs_front else "found, not armed")), flush=True)

    def _connector(self):
        while True:
            time.sleep(1.5)
            with self.lock:
                if PAUSE_FILE.exists():
                    if self.bus is not None:
                        self._drop_bus("paused for motor setup")
                    continue
                missing = [a for a in self.axes.values() if a.ctl is None]
            if not missing:
                continue
            if self.bus is None:
                bus = self._open_bus()
                if bus is None:
                    continue
                with self.lock:
                    self.bus = bus
            with self.lock:
                for ax in self.axes.values():
                    if ax.ctl is not None:
                        continue
                    try:
                        if ax.cfg.id in self.bus.scan(0.3):
                            self._attach(ax)
                    except Exception as e:
                        print(f"{ax.cfg.name}: setup failed: {e}", flush=True)
                if all(a.ctl is None for a in self.axes.values()):
                    self._drop_bus("no axis answered")

    def _drop_bus(self, why: str):
        print(f"released the motor bus: {why}", flush=True)
        try:
            self.bus.close()
        except Exception:
            pass
        self.bus = None
        for a in self.axes.values():
            a.reset(None)

    def _lose(self, ax: Axis, why: str):
        """Caller holds the lock. This axis went away (power / cable): forget it, the connector keeps looking."""
        print(f"lost {ax.cfg.name}: {why}", flush=True)
        ax.reset(None)

    # -- safety watch -----------------------------------------------------------------------------------------------------------
    def _trip(self, ax: Axis, why: str):
        """Latch a fault and hold position. Caller holds the lock."""
        ax.fault, ax.follow = why, False
        try:
            ax.ctl.hold()
        except Exception:
            pass

    def _watch(self):
        while True:
            time.sleep(0.1)
            with self.lock:
                for ax in self.axes.values():
                    if ax.ctl is None or ax.fault or self.bus is None:
                        continue
                    try:
                        torque = ax.ctl.torque_enabled()
                        if torque is None:
                            raise MotorError("no reply")
                        ax.misses = 0
                        if ax.ctl.hw_error():
                            self._trip(ax, "hardware error status on the motor")
                        elif torque and ax.last_goal_deg is not None and ax.follow:
                            now, pos = time.monotonic(), ax.cfg.to_deg(ax.ctl.present())
                            ax.trail.append((now, pos))
                            while ax.trail and now - ax.trail[0][0] > 1.0:
                                ax.trail.popleft()
                            err = abs(pos - ax.last_goal_deg)
                            moved = max(p for _, p in ax.trail) - min(p for _, p in ax.trail)
                            full = now - ax.trail[0][0] > 0.9
                            lim = max(TRACK_ERR_DEG, ax.cfg.limit_deg * 0.5) if ax.cfg.name == "yaw" else 6.0  # tilt travels only +-13 deg
                            if err > 3 * lim:
                                self._trip(ax, f"axis is {err:.0f} deg behind its target")
                            elif err > lim and full and moved < max(1.0, 0.04 * lim):
                                self._trip(ax, "blocked: far from the target and not moving")
                            elif time.monotonic() - ax.last_cmd > WATCHDOG_S:
                                ax.follow = False
                                ax.ctl.hold()
                    except Exception as e:  # a slow or missing reply is only 'lost' after several misses in a row
                        ax.misses += 1
                        if ax.misses >= MISSES_BEFORE_LOST:
                            self._lose(ax, f"{e} ({ax.misses} checks in a row)")
                if time.monotonic() - self.last_snap_build >= 0.25:  # what /status serves: built here, so a slow or silent motor can never block the HTTP side
                    self.snapshot, self.snapshot_at, self.last_snap_build = self._build_status(), time.time(), time.monotonic()

    # -- API --------------------------------------------------------------------------------------------------------------------
    def _axis_status(self, ax: Axis) -> dict:
        if ax.ctl is None:
            return {"ok": False, "error": f"{ax.cfg.name} motor (id {ax.cfg.id}) not found - looking...", "searching": True, "fault": ax.fault}
        try:
            s = ax.ctl.status()
            raw = s["present_raw"]
            return {"ok": True, "torque": s["torque"], "mode": s["mode"], "profile_ok": s["profile_vel"] == s["want_profile_vel"] and s["profile_acc"] == s["want_profile_acc"],
                    "deg": None if raw is None else round(ax.cfg.to_deg(raw), 2), "hw_error": s["hw_error"], "fault": ax.fault, "follow": ax.follow,
                    "goals": ax.goals, "last_goal": ax.last_goal_deg, "needs_front": not ax.front_ok,
                    "limit_deg": ax.cfg.limit_deg, "max_vel": ax.cfg.max_vel}
        except Exception as e:  # keep the connection: the watcher decides when the motor is really gone
            return {"ok": False, "error": f"no reply yet ({e})", "fault": ax.fault}

    def status(self) -> dict:
        snap = dict(self.snapshot)  # no lock, no serial I/O: always answers at once
        snap["age_s"] = round(time.time() - self.snapshot_at, 2) if self.snapshot_at else None
        return snap

    def _build_status(self) -> dict:
        """Caller holds the lock (the watcher builds it)."""
        yaw = self._axis_status(self.axes["yaw"])
        out = dict(yaw)  # the yaw fields stay at the top level (older pages read them there)
        out["axes"] = {n: (yaw if n == "yaw" else self._axis_status(a)) for n, a in self.axes.items()}
        if "tilt" in self.axes:
            out["tilt"] = out["axes"]["tilt"]
        return out

    def act(self, name: str, body: dict) -> dict:
        axis = body.get("axis", "yaw")
        if not self.lock.acquire(timeout=1.5):
            return {"ok": False, "error": "motor line is busy, try again"}
        try:
            ax = self.axes.get(axis)
            if ax is None or ax.ctl is None:
                return {"ok": False, "error": f"{axis} motor not found"}
            try:
                if name in ("arm", "goal") and not ax.front_ok:
                    raise MotorError("front is not set yet: put the robot at front and press 'Set front + Arm'")
                if name == "arm":
                    if ax.fault:
                        raise MotorError(f"fault latched: {ax.fault} (clear it first)")
                    ax.ctl.arm(); ax.last_goal_deg = None; ax.trail.clear()
                elif name == "setup":  # yaw: the one human step "the robot faces front right now" -> remember it, then arm
                    if ax.follow:
                        raise MotorError("stop following first")
                    if ax.fault:
                        raise MotorError(f"fault latched: {ax.fault} (clear it first)")
                    if ax.cfg.needs_front:
                        ax.ctl.set_front()
                    ax.front_ok = True
                    ax.ctl.arm(); ax.last_goal_deg = None; ax.trail.clear()
                elif name == "refront":  # "the robot is at front RIGHT NOW": move the zero here, without moving the motor, and make the page reconnect
                    if not ax.cfg.needs_front:
                        raise MotorError(f"{axis} has no teachable front")
                    ax.follow = False
                    ax.ctl.set_front()
                    ax.front_ok = True
                    if ax.ctl.torque_enabled():
                        ax.ctl.hold()
                    ax.last_goal_deg = None; ax.trail.clear()
                    ax.fault = "정면을 다시 잡았어요. 슬라이더를 0으로 맞추고 '오류 해제' → 다시 연결하세요"  # blocks goals until the person has done that
                elif name == "goal":
                    if ax.fault:
                        raise MotorError(f"fault latched: {ax.fault}")
                    deg = float(body["deg"])
                    ax.ctl.goto_raw(ax.cfg.to_raw(deg))
                    ax.last_goal_deg, ax.last_cmd = deg, time.monotonic()
                    ax.goals += 1
                    ax.follow = bool(body.get("follow", False))
                elif name == "hold":
                    ax.follow = False; ax.ctl.hold()
                elif name == "release":
                    ax.follow = False; ax.ctl.release()
                elif name == "clear":
                    ax.fault = None
                else:
                    return {"ok": False, "error": "unknown action"}
                return {"ok": True}
            except (MotorError, ValueError, KeyError) as e:
                ax.follow = False
                try:
                    if ax.ctl.torque_enabled():
                        ax.ctl.hold()
                except Exception:
                    pass
                return {"ok": False, "error": str(e)}
        finally:
            self.lock.release()

    def shutdown(self):
        got = self.lock.acquire(timeout=2.0)  # never hang on exit: if the line is stuck, still try to hold the axes
        try:
            for ax in self.axes.values():
                try:
                    if ax.ctl is not None:
                        ax.ctl.hold()
                except Exception:
                    pass
        finally:
            if got:
                self.lock.release()


def serve(port: str = "auto", baud: str | int = "auto", http_port: int = 8787):
    br = Bridge(port, baud)

    class H(BaseHTTPRequestHandler):
        def _allowed(self) -> bool:
            """Checked FIRST on every request, before anything is read or done."""
            if self.headers.get("Origin") in ORIGINS:
                return True
            print(f"refused {self.command} {self.path} from origin {self.headers.get('Origin')!r}", flush=True)
            self.send_response(403); self.send_header("content-length", "0"); self.end_headers()
            return False

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin"))
            self.send_header("Access-Control-Allow-Headers", "content-type, x-lieu")
            self.send_header("Access-Control-Allow-Private-Network", "true")

        def _json(self, code: int, obj: dict):
            data = json.dumps(obj).encode()
            self.send_response(code)
            self._cors()
            self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(data)))
            self.end_headers(); self.wfile.write(data)

        def do_OPTIONS(self):
            if not self._allowed():
                return
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if not self._allowed():
                return
            if self.path == "/status":
                self._json(200, br.status())
            else:
                self._json(404, {"ok": False})

        def do_POST(self):
            if not self._allowed():
                return
            if self.headers.get("x-lieu") != "1":
                self._json(403, {"ok": False, "error": "missing header"}); return
            n = int(self.headers.get("content-length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                self._json(400, {"ok": False}); return
            res = br.act(self.path.strip("/"), body)
            if self.path != "/goal" or not res.get("ok"):  # goals stream at 30 Hz: log only refusals
                print(f"{self.path} {body} -> {res}", flush=True)
            self._json(200, res)

        def log_message(self, fmt, *a):
            pass

    class Server(ThreadingHTTPServer):
        def handle_error(self, request, client_address):  # a browser that gave up on a request is not an error
            import sys
            if not isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
                super().handle_error(request, client_address)

    srv = Server(("127.0.0.1", http_port), H)
    print(f"motor bridge on http://127.0.0.1:{http_port} (editor origin only), looking for the U2D2... Ctrl-C stops it and holds the motors where they are.", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        br.shutdown()
