"""Virtual (simulator) -> physical (wiring) mapping. Everything that is still UNKNOWN about the wiring is a config value here,
so calibrating never touches the firmware or the baked frames."""
from .frames import DeviceFrame, Frame


def _bits(row: int) -> list[int]:
    return [(row >> (7 - c)) & 1 for c in range(8)]  # column 0 first


def map_row(row: int, layout: str, flip_x: bool) -> int:
    cols = _bits(row)
    if flip_x:
        cols.reverse()
    out = 0
    for c, on in enumerate(cols):
        if not on:
            continue
        if layout == "msb_left":
            bit = 7 - c
        elif layout == "lsb_left":
            bit = c
        elif layout == "adafruit":  # Adafruit 8x8 backpack: column c lives on bit (c + 7) % 8
            bit = (c + 7) % 8
        else:
            raise ValueError(f"unknown eye layout {layout!r}")
        out |= 1 << bit
    return out


def map_eye(rows: bytes, side_cfg: dict) -> bytes:
    mapped = [map_row(r, side_cfg["layout"], side_cfg["flip_x"]) for r in rows]
    if side_cfg["flip_y"]:
        mapped.reverse()
    return bytes(mapped)


class Mapper:
    def __init__(self, cfg: dict):
        self.eyes = cfg["eyes"]
        self.ring = cfg["ring"]
        n = self.ring["count"]
        step = -1 if self.ring["reverse"] else 1
        # physical index p carries virtual LED v: p = (step * v + offset) mod n
        self.v_of_p = [0] * n
        for v in range(n):
            self.v_of_p[(step * v + self.ring["offset"]) % n] = v

    def ring_limit(self, ring: bytes) -> bytes:
        """Scale the whole ring so the estimated draw (20 mA per channel at 255) stays within budget and max_scale."""
        total = sum(ring)
        scale = self.ring["max_scale"]
        if total:
            scale = min(scale, self.ring["budget_ma"] / (total * 20 / 255))
        return bytes(int(b * scale) for b in ring)

    def to_device(self, f: Frame) -> DeviceFrame:
        n = self.ring["count"]
        phys = bytearray(4 * n)
        for p, v in enumerate(self.v_of_p):
            phys[4 * p:4 * p + 4] = f.ring[4 * v:4 * v + 4]
        l, r, bl, br = f.eye_l, f.eye_r, f.bright_l, f.bright_r
        if self.eyes["swap"]:
            l, r, bl, br = r, l, br, bl
        return DeviceFrame(map_eye(l, self.eyes["left"]), map_eye(r, self.eyes["right"]), bl, br, self.ring_limit(bytes(phys)))
