"""READ-ONLY Dynamixel (Protocol 2.0) access for learning the motion range by hand-moving the axes.

SAFETY CONTRACT: this module can only send PING and READ instructions. Every other instruction byte (WRITE, REG_WRITE, ACTION, REBOOT,
FACTORY_RESET, SYNC/BULK WRITE, ...) is refused in `_send`, so nothing in here can enable torque, change a setting or move a motor.
Do not add write support here. Motor *control* is a separate, deliberately unimplemented thing (motion.py).
"""
import json
import struct
import time
from pathlib import Path

PING, READ = 0x01, 0x02
_ALLOWED = {PING, READ}
BROADCAST = 0xFE
ADDR_TORQUE_ENABLE, ADDR_PRESENT_POSITION, ADDR_PRESENT_TEMP = 64, 132, 146  # X-series (XL330 / XC330 / XM / XH430) control table


def crc16(data: bytes) -> int:
    crc = 0
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x8005) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def build(dxl_id: int, inst: int, params: bytes = b"") -> bytes:
    if inst not in _ALLOWED:
        raise PermissionError(f"instruction 0x{inst:02X} refused: this tool is read-only")
    body = bytes([0xFF, 0xFF, 0xFD, 0x00, dxl_id]) + struct.pack("<H", len(params) + 3) + bytes([inst]) + params
    return body + struct.pack("<H", crc16(body))


def parse_status(buf: bytes):
    """Yield (id, error, params) for each valid status packet in buf."""
    i = 0
    while i + 11 <= len(buf):
        if buf[i:i + 4] != b"\xff\xff\xfd\x00":
            i += 1
            continue
        n = struct.unpack_from("<H", buf, i + 5)[0]
        end = i + 7 + n
        if end > len(buf):
            break
        if crc16(buf[i:end - 2]) == struct.unpack_from("<H", buf, end - 2)[0] and buf[i + 7] == 0x55:
            yield buf[i + 4], buf[i + 8], buf[i + 9:end - 2]
            i = end
        else:
            i += 1


class ReadOnlyBus:
    def __init__(self, port: str, baud: int = 57600):
        import serial
        self.ser = serial.Serial(port, baud, timeout=0.02)

    def close(self):
        self.ser.close()

    def _send(self, dxl_id: int, inst: int, params: bytes = b"") -> None:
        pkt = build(dxl_id, inst, params)  # raises for anything but PING / READ
        self.ser.reset_input_buffer()
        self.ser.write(pkt)
        self.ser.flush()

    def _collect(self, wait: float) -> bytes:
        end, buf = time.monotonic() + wait, b""
        while time.monotonic() < end:
            buf += self.ser.read(256)
        return buf

    def scan(self, wait: float = 0.6) -> dict[int, int]:
        """Broadcast PING: {id: model_number}. Only replies; commands nothing."""
        self._send(BROADCAST, PING)
        return {i: struct.unpack("<H", p[:2])[0] for i, e, p in parse_status(self._collect(wait)) if len(p) >= 3}

    def read(self, dxl_id: int, addr: int, length: int, wait: float = 0.05, tries: int = 3) -> bytes | None:
        """READ with a couple of retries: a USB-serial adapter now and then answers late, which is not the same as the motor being gone."""
        for _ in range(tries):
            self._send(dxl_id, READ, struct.pack("<HH", addr, length))
            for i, err, p in parse_status(self._collect(wait)):
                if i == dxl_id and err == 0 and len(p) == length:
                    return p
        return None

    def position(self, dxl_id: int) -> int | None:
        p = self.read(dxl_id, ADDR_PRESENT_POSITION, 4)
        return struct.unpack("<i", p)[0] if p else None

    def torque_enabled(self, dxl_id: int) -> bool | None:
        p = self.read(dxl_id, ADDR_TORQUE_ENABLE, 1)
        return None if p is None else bool(p[0])


def record(bus: ReadOnlyBus, ids: list[int], out: Path, seconds: float | None = None, hz: float = 20.0, axis: dict[int, str] | None = None,
           auto: bool = False, still_s: float = 4.0, max_s: float = 180.0, motion_raw: int = 45):
    """Sample present positions while a person moves the axes by hand; keep min / max / start per motor.
    auto=True: wait for the first movement, then record until every motor has been still for `still_s` seconds (or `max_s`).
    Saved by MERGING into the existing file under motors[id]['record'] -- calibration and safe limits already stored there are never touched."""
    stats = {i: {"start": None, "min": None, "max": None, "last": None} for i in ids}
    t0 = time.monotonic()
    moved_at = last_motion = None
    try:
        while True:
            now = time.monotonic()
            if auto:
                if moved_at is None and now - t0 > max_s:
                    break
                if moved_at is not None and (now - (last_motion or moved_at) > still_s or now - moved_at > max_s):
                    break
            elif seconds is not None and now - t0 >= seconds:
                break
            for i in ids:
                v = bus.position(i)
                if v is None:
                    continue
                s = stats[i]
                prev, s["last"] = s["last"], v
                s["start"] = v if s["start"] is None else s["start"]
                s["min"] = v if s["min"] is None else min(s["min"], v)
                s["max"] = v if s["max"] is None else max(s["max"], v)
                if prev is not None and abs(v - prev) > 3:   # still moving (noise is +-1)
                    last_motion = now
                if auto and moved_at is None and abs(v - s["start"]) > motion_raw:
                    moved_at, last_motion = now, now
            print("\r" + "  ".join(f"id{i}: {s['last']} [{s['min']}..{s['max']}]" for i, s in stats.items()) + ("  (waiting for movement)" if auto and moved_at is None else ""), end="", flush=True)
            time.sleep(1 / hz)
    except KeyboardInterrupt:
        pass
    print()
    data = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {"schema": "lieu.motor_limits/v1", "motors": {}}
    if out.exists():
        out.with_name(out.stem + ".prev.json").write_text(out.read_text(encoding="utf-8"), encoding="utf-8")
    result = {}
    for i, s in stats.items():
        rec = {**s, "units": "raw (4096 = 360 deg on X-series / XM430)", "range_deg_at_motor": None if s["min"] is None else round((s["max"] - s["min"]) * 360 / 4096, 2),
               "how": "learned by hand-moving the axis; read-only, no motor was commanded"}
        m = data.setdefault("motors", {}).setdefault(str(i), {})
        m["record"] = rec
        if axis and i in axis:
            m["axis"] = axis[i]
        result[i] = rec
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return result
