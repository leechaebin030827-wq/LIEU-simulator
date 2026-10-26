"""Pure-python checks (no hardware): python -m lieu_hw.tests"""
from . import protocol
from .config import load_config
from .frames import Frame, list_scenarios, load_scenario
from .mapping import Mapper, map_row


def main():
    assert map_row(0b10000000, "msb_left", False) == 0b10000000
    assert map_row(0b10000000, "lsb_left", False) == 0b00000001
    assert map_row(0b10000000, "adafruit", False) == 0b10000000  # col0 -> bit7
    assert map_row(0b01000000, "adafruit", False) == 0b00000001  # col1 -> bit0
    assert map_row(0b10000000, "msb_left", True) == 0b00000001   # flip_x

    cfg = load_config()
    m = Mapper(cfg)
    ring = bytes(i % 256 for i in range(96))
    cfg["ring"].update(offset=3, reverse=True, max_scale=1.0, budget_ma=10**6)
    m = Mapper(cfg)
    d = m.to_device(Frame(ring=ring))
    n = 24
    for v in range(n):  # virtual v lands on physical (-v + 3) mod 24
        p = (-v + 3) % n
        assert d.ring[4 * p:4 * p + 4] == ring[4 * v:4 * v + 4], v

    cfg["ring"].update(max_scale=1.0, budget_ma=400)
    d = Mapper(cfg).to_device(Frame(ring=bytes([255]) * 96))
    assert sum(d.ring) * 20 / 255 <= 400 + 1, "budget limiter"

    dev = Mapper(load_config()).to_device(Frame())
    pk = protocol.frame_packet(dev) + protocol.config_packet(0x70, 0x71, 0.25, 400)
    out = list(protocol.parse(b"\x00\x13" + pk))
    assert [t for t, _ in out] == [protocol.T_FRAME, protocol.T_CONFIG] and len(out[0][1]) == 114

    from .motor_control import build_write, stuff, ADDR_GOAL, ADDR_TORQUE, YawControl
    from .motor_readonly import PING, build as ro_build
    from .yaw_plan import load_yaw_motor, plan_yaw
    for bad in (0, 8, 44, 98, 100, 126, 132):
        try:
            build_write(1, bad, 1); raise SystemExit(f"write to {bad} was NOT refused")
        except PermissionError:
            pass
    for bad_t in (2, -1):
        try:
            build_write(1, ADDR_TORQUE, bad_t); raise SystemExit("bad torque value accepted")
        except ValueError:
            pass
    assert stuff(b"\xff\xff\xfd\x01") == b"\xff\xff\xfd\xfd\x01"
    assert build_write(1, ADDR_GOAL, -7591)[7] == 0x03
    try:
        ro_build(1, 0x03); raise SystemExit("read-only builder accepted WRITE")
    except PermissionError:
        pass
    mt = load_yaw_motor()
    assert (mt.limit_deg, mt.max_vel, mt.max_acc) == (80, 40, 80) and mt.to_raw(0) == round(mt.center_raw)
    traj = plan_yaw([0.0] * 10 + [90.0] * 90 + [-90.0] * 90, 30, mt)
    assert max(abs(x) for x in traj) <= 80 + 1e-9
    assert max(abs(b - a) * 30 for a, b in zip(traj, traj[1:])) <= 40 + 1e-6
    ids = list_scenarios()
    assert ids, "no baked frames: npx vite-node tools/export_hw_frames.ts"
    for i in ids:
        s = load_scenario(i)
        assert s.frame_at(0) and s.frame_at(s.duration + 1) and len(s.frames[0].ring) == 96
    print("ok:", ", ".join(ids))


if __name__ == "__main__":
    main()
