import sys

from .base import Driver


class MockDriver(Driver):
    """Terminal preview (no hardware): the two eyes as 8x8 blocks plus the ring as one line of brightness cells."""

    def __init__(self, cfg):
        self.n = cfg["ring"]["count"]
        self.first = True

    @staticmethod
    def _row(b):
        return "".join("██" if b & (1 << (7 - c)) else "· " for c in range(8))

    def show(self, dev):
        # rows are shown in raw chip bit order; this is a plumbing check, not a look preview
        ring = "".join(" ░▒▓█"[min(4, max(dev.ring[4 * i:4 * i + 4]) * 5 // 256)] for i in range(self.n))
        lines = [f"{self._row(a)}   {self._row(b)}" for a, b in zip(dev.eye_l, dev.eye_r)]
        lines.append(f"dim L{dev.bright_l:2d} R{dev.bright_r:2d}  ring [{ring}]")
        if not self.first:
            sys.stdout.write(f"\x1b[{len(lines)}A")
        sys.stdout.write("\n".join(l + "\x1b[K" for l in lines) + "\n")
        sys.stdout.flush()
        self.first = False

    def blank(self):
        from ..frames import DeviceFrame
        self.show(DeviceFrame(bytes(8), bytes(8), 0, 0, bytes(4 * self.n)))
