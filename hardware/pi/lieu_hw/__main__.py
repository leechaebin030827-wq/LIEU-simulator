import argparse
import sys
import time

from .config import load_config
from .drivers import make_driver
from .frames import DeviceFrame, Frame, list_scenarios, load_scenario
from .mapping import Mapper
from .player import play


def _hold(drv, mapper, f: Frame, seconds: float):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        drv.show(mapper.to_device(f))
        time.sleep(0.1)


def test_eyes(drv, mapper):
    """One lit pixel walks the 8x8 of the LEFT then the RIGHT board (virtual order, row by row). Note where it lands on the real board."""
    for side in ("L", "R"):
        for r in range(8):
            for c in range(8):
                rows = bytearray(8)
                rows[r] = 1 << (7 - c)
                f = Frame(eye_l=bytes(rows) if side == "L" else bytes(8), eye_r=bytes(rows) if side == "R" else bytes(8), ring=bytes(96))
                print(f"\r{side} row {r} col {c} ", end="", flush=True)
                _hold(drv, mapper, f, 0.25)
    print()


def test_ring(drv, mapper):
    """LED 0 red, then a single white dot walking 0..23. LED 0 should be where config 'offset' says; fix offset/reverse otherwise."""
    for i in range(24):
        ring = bytearray(96)
        ring[4 * i:4 * i + 4] = bytes([255, 0, 0, 0]) if i == 0 else bytes([0, 0, 0, 255])
        print(f"\rvirtual LED {i} ", end="", flush=True)
        _hold(drv, mapper, Frame(ring=bytes(ring), bright_l=0, bright_r=0), 0.3)
    print()
    print("colour order check: R, G, B, W (each should light the matching colour)")
    for name, px in (("R", (255, 0, 0, 0)), ("G", (0, 255, 0, 0)), ("B", (0, 0, 255, 0)), ("W", (0, 0, 0, 255))):
        print(name, end=" ", flush=True)
        _hold(drv, mapper, Frame(ring=bytes(px) * 24, bright_l=0, bright_r=0), 1.0)
    print()


def motors_control(a) -> int:
    from .motor_control import MotorError, YawControl
    from .yaw_plan import load_yaw_motor
    bus = YawControl(a.port, a.baud, load_yaw_motor())
    try:
        if a.what in ("arm", "goto", "play") and a.confirm != "MOVE":
            print("this WRITES to the motor and can move it. Re-run with --confirm MOVE when the area is clear and your hand is on the motor power switch.")
            return 2
        try:
            if a.what == "status":
                s = bus.status()
                s["present_deg"] = None if s["present_raw"] is None else round(bus.m.to_deg(s["present_raw"]), 2)
                print(s)
            elif a.what == "arm":
                bus.arm()
                print("armed: extended position mode, slow profile, torque ON, holding the current position")
            elif a.what == "goto":
                if a.deg is None:
                    print("goto needs --deg")
                    return 2
                bus.goto_deg(a.deg)
            elif a.what == "hold":
                bus.hold()
                print("holding")
            elif a.what == "release":
                bus.release()
                print("torque OFF")
            elif a.what == "play":
                scn = load_scenario(a.scenario or "")
                bus.play_yaw([m[1] for m in scn.motion], scn.fps)
        except KeyboardInterrupt:
            print("\nCtrl-C")
        except MotorError as e:
            print(f"STOPPED: {e}")
            return 1
    finally:
        bus.close()
    return 0


def motors(a) -> int:
    from pathlib import Path
    from .motor_readonly import ReadOnlyBus, record
    if a.what in ("status", "arm", "goto", "hold", "release", "play"):
        return motors_control(a)
    bus = ReadOnlyBus(a.port, a.baud)
    try:
        found = bus.scan()
        print("found:", {i: f"model {m}" for i, m in found.items()} or "nothing (check baud / wiring / motor power)")
        ids = a.ids or sorted(found)
        if a.what == "torque":
            for i in ids:
                print(f"id{i}: torque {'ON (motor will resist; do not force it)' if bus.torque_enabled(i) else 'off (free to move by hand)'}")
        elif a.what == "record":
            on = [i for i in ids if bus.torque_enabled(i)]
            if on:
                print(f"torque is ON for ids {on}: they will resist your hand. Nothing was changed; turn torque off yourself (Dynamixel Wizard) first.")
                return 1
            print("Move each axis by hand through its full range. Ctrl-C to save.")
            record(bus, ids, Path(__file__).resolve().parents[2] / "config" / "motor_limits.json", a.seconds)
            print("saved hardware/config/motor_limits.json")
    finally:
        bus.close()
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="lieu_hw", description="LIEU hardware player (UNO R4 test rig / Raspberry Pi)")
    ap.add_argument("--config", help="hardware.json (default: hardware/config/hardware.json)")
    ap.add_argument("--backend", choices=["mock", "serial", "pi"], help="override config backend")
    sub = ap.add_subparsers(dest="cmd", required=True)
    pl = sub.add_parser("play", help="play a baked scenario")
    pl.add_argument("scenario", nargs="?", help=f"id or path ({', '.join(list_scenarios())})")
    pl.add_argument("--loop", action="store_true")
    pl.add_argument("--speed", type=float, default=1.0)
    sub.add_parser("list")
    sub.add_parser("info", help="ask the device what it sees (I2C eye boards, ring)")
    sub.add_parser("blank")
    ms = sub.add_parser("motors", help="READ-ONLY motor tools (never commands a motor)")
    sv = sub.add_parser("serve", help="local bridge for the web editor's motor panel")
    sv.add_argument("--port", default="auto", help="U2D2 serial port (default: find it)")
    sv.add_argument("--baud", default="auto", help="115200 | 57600 | 1000000 (default: try them)")
    sv.add_argument("--http", type=int, default=8787)
    ms.add_argument("what", choices=["scan", "torque", "record", "status", "arm", "goto", "hold", "release", "play"])
    ms.add_argument("--deg", type=float, help="goto: robot yaw in degrees (safe range only)")
    ms.add_argument("--scenario", help="play: baked scenario id")
    ms.add_argument("--confirm", help="arm/goto/play write to the motor and need --confirm MOVE")
    ms.add_argument("--port", required=True, help="U2D2 serial port, e.g. /dev/cu.usbserial-XXXX")
    ms.add_argument("--baud", type=int, default=57600)
    ms.add_argument("--ids", type=int, nargs="*", help="motor IDs (default: all found by scan)")
    ms.add_argument("--seconds", type=float, help="stop recording after this long (default: Ctrl-C)")
    t = sub.add_parser("test", help="bring-up patterns")
    t.add_argument("what", choices=["eyes", "ring"])
    a = ap.parse_args(argv)

    cfg = load_config(a.config)
    if a.backend:
        cfg["backend"] = a.backend
    if a.cmd == "list":
        print("\n".join(list_scenarios()))
        return 0
    if a.cmd == "motors":
        return motors(a)
    if a.cmd == "serve":
        from .bridge import serve
        serve(a.port, a.baud, a.http)
        return 0
    mapper = Mapper(cfg)
    with make_driver(cfg) as drv:
        try:
            if a.cmd == "info":
                print(drv.info())
            elif a.cmd == "blank":
                drv.blank()
            elif a.cmd == "test":
                {"eyes": test_eyes, "ring": test_ring}[a.what](drv, mapper)
            elif a.cmd == "play":
                scn = load_scenario(a.scenario or list_scenarios()[0])
                print(f"{scn.id}: {scn.duration:.1f} s, {len(scn.frames)} keys  [{cfg['backend']}]  Ctrl-C to stop")
                play(scn, drv, cfg, loop=a.loop or None, speed=a.speed)
        except KeyboardInterrupt:
            print("\nstopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
