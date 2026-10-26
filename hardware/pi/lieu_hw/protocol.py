"""Host <-> UNO R4 serial protocol. Packet: AA 55 | type | len | payload | checksum (sum of type, len, payload mod 256).
The firmware answers with ASCII lines (READY / INFO / ERR), so a plain serial monitor stays readable."""
import struct

SYNC = b"\xAA\x55"
T_FRAME, T_CONFIG, T_INFO, T_BLANK = 0x01, 0x02, 0x03, 0x04


def packet(ptype: int, payload: bytes = b"") -> bytes:
    if len(payload) > 255:
        raise ValueError("payload too long")
    body = bytes([ptype, len(payload)]) + payload
    return SYNC + body + bytes([sum(body) & 0xFF])


def frame_packet(dev) -> bytes:
    """DeviceFrame -> FRAME packet: 8 rows L, 8 rows R, bright L, bright R, 24 x RGBW (114 bytes)."""
    return packet(T_FRAME, dev.eye_l + dev.eye_r + bytes([dev.bright_l, dev.bright_r]) + dev.ring)


def config_packet(addr_l: int, addr_r: int, max_scale: float, budget_ma: int) -> bytes:
    return packet(T_CONFIG, struct.pack(">BBBH", addr_l, addr_r, int(max_scale * 255), budget_ma))


def parse(stream: bytes):
    """Yield (type, payload) for every valid packet in stream (used by tests; the firmware does the same incrementally)."""
    i = 0
    while i + 5 <= len(stream):
        if stream[i:i + 2] != SYNC:
            i += 1
            continue
        t, n = stream[i + 2], stream[i + 3]
        if i + 5 + n > len(stream):
            break
        payload = stream[i + 4:i + 4 + n]
        if (t + n + sum(payload)) & 0xFF == stream[i + 4 + n]:
            yield t, payload
            i += 5 + n
        else:
            i += 1
