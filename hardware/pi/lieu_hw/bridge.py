"""Local bridge: the web editor asks, this process decides. Listens on 127.0.0.1 only, accepts browser requests only from the editor's own origin.
All motor safety (range, slow profile, fault latch, watchdog) lives in motor_control.py / here, not in the web page.

Auto-setup: the bridge looks for the U2D2 itself (any /dev/cu.usbserial-*, /dev/ttyUSB*), tries the usual baud rates, finds motor id 1, and keeps
looking if the cable or the motor power comes and goes. What it does by itself when it finds the motor:
  * torque ON + position mode (the motor was never power-cycled): re-applies the slow speed profile, nothing else  -> ready
  * torque OFF (power was cycled, or released): waits for ONE human confirmation, "the robot faces front now" ('setup'), then arms.
Run:  python3 -m lieu_hw serve            (the web dev server starts it for you)
"""
import glob
import json
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .motor_control import TRACK_ERR_DEG, MotorError, YawControl
from .motor_readonly import ReadOnlyBus
from .yaw_plan import load_yaw_motor

ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
WATCHDOG_S = 0.6
BAUDS = (115200, 57600, 1000000)
MISSES_BEFORE_LOST = 6  # consecutive checks without any reply (~0.6 s) before the motor counts as gone


def find_ports() -> list[str]:
    return sorted(glob.glob("/dev/cu.usbserial-*") + glob.glob("/dev/ttyUSB*"))


class Bridge:
    def __init__(self, port: str = "auto", baud: str | int = "auto"):
        self.port_spec, self.baud_spec = port, baud
        self.lock = threading.RLock()
        self.bus: YawControl | None = None
        self.front_ok = False
        self.fault: str | None = None
        self.follow = False
        self.last_goal_deg: float | None = None
        self.last_cmd = time.monotonic()
        self.goals = 0
        self.misses = 0
        self.trail: deque = deque()  # (time, present deg) of the last second, to tell 'lagging' from 'blocked'
        threading.Thread(target=self._connector, daemon=True).start()
        threading.Thread(target=self._watch, daemon=True).start()

    # -- finding the motor ------------------------------------------------------------------------------------------------------
    def _try_connect(self) -> YawControl | None:
        ports = [self.port_spec] if self.port_spec != "auto" else find_ports()
        bauds = BAUDS if self.baud_spec == "auto" else (int(self.baud_spec),)
        for port in ports:
            for baud in bauds:
                try:
                    probe = ReadOnlyBus(port, baud)
                    try:
                        found = probe.scan(0.3)
                    finally:
                        probe.close()
                    if 1 in found:
                        return YawControl(port, baud, load_yaw_motor())
                except Exception:
                    continue
        return None

    def _connector(self):
        while True:
            time.sleep(1.5)
            with self.lock:
                if self.bus is not None:
                    continue
            bus = self._try_connect()
            if bus is None:
                continue
            with self.lock:
                try:
                    ready = bus.torque_enabled(bus.id) and bus.u32(11, 1) == 4
                    if ready:
                        bus.arm()  # already armed: only re-applies the slow speed limits (no mode / goal / torque change)
                    self.front_ok = bool(ready)
                    self.bus, self.fault, self.follow, self.last_goal_deg = bus, None, False, None
                    print(f"motor found on {bus.ser.port} @ {bus.ser.baudrate}: " + ("ready (still armed)" if ready else "needs the front confirmation"), flush=True)
                except Exception as e:
                    print(f"motor found but setup failed: {e}", flush=True)
                    try:
                        bus.close()
                    except Exception:
                        pass

    def _lose(self, why: str):
        """Caller holds the lock. The motor went away (power / cable): forget it, the connector keeps looking."""
        print(f"lost the motor: {why}", flush=True)
        try:
            self.bus.close()
        except Exception:
            pass
        self.bus, self.front_ok, self.follow, self.last_goal_deg, self.fault, self.misses = None, False, False, None, None, 0

    # -- safety watch -----------------------------------------------------------------------------------------------------------
    def _trip(self, why: str):
        """Latch a fault and hold position. Caller holds the lock."""
        self.fault, self.follow = why, False
        try:
            self.bus.hold()
        except Exception:
            pass

    def _watch(self):
        while True:
            time.sleep(0.1)
            with self.lock:
                if self.bus is None or self.fault:
                    continue
                try:
                    torque = self.bus.torque_enabled(self.bus.id)
                    if torque is None:
                        raise MotorError("no reply")
                    self.misses = 0
                    if self.bus.hw_error():
                        self._trip("hardware error status on the motor")
                    elif torque and self.last_goal_deg is not None and self.follow:
                        now, pos = time.monotonic(), self.bus.m.to_deg(self.bus.present())
                        self.trail.append((now, pos))
                        while self.trail and now - self.trail[0][0] > 1.0:
                            self.trail.popleft()
                        err = abs(pos - self.last_goal_deg)
                        moved = max(p for _, p in self.trail) - min(p for _, p in self.trail)
                        full = now - self.trail[0][0] > 0.9
                        if err > 3 * TRACK_ERR_DEG:
                            self._trip(f"axis is {err:.0f} deg behind its target")
                        elif err > TRACK_ERR_DEG and full and moved < 1.0:
                            self._trip("blocked: far from the target and not moving")
                        elif time.monotonic() - self.last_cmd > WATCHDOG_S:
                            self.follow = False
                            self.bus.hold()
                except Exception as e:  # a slow or missing reply is only 'lost' after several misses in a row
                    self.misses += 1
                    if self.misses >= MISSES_BEFORE_LOST:
                        self._lose(f"{e} ({self.misses} checks in a row)")

    # -- API --------------------------------------------------------------------------------------------------------------------
    def status(self) -> dict:
        with self.lock:
            if self.bus is None:
                return {"ok": False, "error": "motor not found (U2D2 plugged in? motor power on?) - looking...", "searching": True, "fault": self.fault}
            try:
                s = self.bus.status()
                raw = s["present_raw"]
                return {"ok": True, "torque": s["torque"], "mode": s["mode"], "profile_ok": s["profile_vel"] == s["want_profile_vel"] and s["profile_acc"] == s["want_profile_acc"],
                        "deg": None if raw is None else round(self.bus.m.to_deg(raw), 2), "hw_error": s["hw_error"], "fault": self.fault, "follow": self.follow,
                        "goals": self.goals, "last_goal": self.last_goal_deg, "needs_front": not self.front_ok,
                        "limit_deg": self.bus.m.limit_deg, "max_vel": self.bus.m.max_vel}
            except Exception as e:  # keep the connection: the watcher decides when the motor is really gone
                return {"ok": False, "error": f"no reply yet ({e})", "fault": self.fault}

    def act(self, name: str, body: dict) -> dict:
        with self.lock:
            if self.bus is None:
                return {"ok": False, "error": "motor not found"}
            try:
                if name in ("arm", "goal") and not self.front_ok:
                    raise MotorError("front is not set yet: put the robot at front and press 'Set front + Arm'")
                if name == "arm":
                    if self.fault:
                        raise MotorError(f"fault latched: {self.fault} (clear it first)")
                    self.bus.arm(); self.last_goal_deg = None; self.trail.clear()
                elif name == "setup":  # the one human step: "the robot faces front right now" -> remember it, then arm
                    if self.follow:
                        raise MotorError("stop following first")
                    if self.fault:
                        raise MotorError(f"fault latched: {self.fault} (clear it first)")
                    self.bus.set_front()
                    self.front_ok = True
                    self.bus.arm(); self.last_goal_deg = None; self.trail.clear()
                elif name == "goal":
                    if self.fault:
                        raise MotorError(f"fault latched: {self.fault}")
                    deg = float(body["deg"])
                    self.bus.goto_raw(self.bus.m.to_raw(deg))
                    self.last_goal_deg, self.last_cmd = deg, time.monotonic()
                    self.goals += 1
                    self.follow = bool(body.get("follow", False))
                elif name == "hold":
                    self.follow = False; self.bus.hold()
                elif name == "release":
                    self.follow = False; self.bus.release()
                elif name == "clear":
                    self.fault = None
                else:
                    return {"ok": False, "error": "unknown action"}
                return {"ok": True}
            except (MotorError, ValueError, KeyError) as e:
                self.follow = False
                try:
                    if self.bus.torque_enabled(self.bus.id):
                        self.bus.hold()
                except Exception:
                    pass
                return {"ok": False, "error": str(e)}

    def shutdown(self):
        with self.lock:
            try:
                if self.bus is not None:
                    self.bus.hold()
            except Exception:
                pass


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
    print(f"motor bridge on http://127.0.0.1:{http_port} (editor origin only), looking for the U2D2... Ctrl-C stops it and holds the motor where it is.", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        br.shutdown()
