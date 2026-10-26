from .base import Driver

HT_OSC_ON, HT_DISPLAY_ON, HT_DIM = 0x21, 0x81, 0xE0


class PiDirectDriver(Driver):
    """Raspberry Pi: HT16K33 eyes on I2C (smbus2) and the ring on GPIO18 (rpi_ws281x, Pi 3/4/Zero).
    Raspberry Pi 5 has no PWM/PCM for rpi_ws281x: swap _open_ring/_write_ring for a PIO or SPI NeoPixel driver, the rest stays.
    Needs: pip install smbus2 rpi_ws281x   (run with sudo for rpi_ws281x)."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.bus = None
        self.strip = None
        self.last_dim = {}

    def open(self):
        from smbus2 import SMBus
        self.bus = SMBus(self.cfg["pi"]["i2c_bus"])
        for side in ("left", "right"):
            a = self.cfg["eyes"][side]["address"]
            self.bus.write_byte(a, HT_OSC_ON)
            self.bus.write_byte(a, HT_DISPLAY_ON)
        self._open_ring()

    def _open_ring(self):
        from rpi_ws281x import PixelStrip, ws
        p, r = self.cfg["pi"], self.cfg["ring"]
        types = {"GRBW": ws.SK6812_STRIP_GRBW, "RGBW": ws.SK6812_STRIP_RGBW, "GRB": ws.WS2811_STRIP_GRB, "RGB": ws.WS2811_STRIP_RGB}
        self.strip = PixelStrip(r["count"], p["ring_gpio"], p["ring_freq_hz"], p["ring_dma"], False, 255, 0, types[r["order"]])
        self.strip.begin()

    def _write_ring(self, ring: bytes):
        from rpi_ws281x import Color
        for i in range(self.cfg["ring"]["count"]):
            r, g, b, w = ring[4 * i:4 * i + 4]
            self.strip.setPixelColor(i, Color(r, g, b, w))
        self.strip.show()

    def _write_eye(self, side: str, rows: bytes, dim: int):
        a = self.cfg["eyes"][side]["address"]
        if self.last_dim.get(side) != dim:
            self.bus.write_byte(a, HT_DIM | (dim & 15))
            self.last_dim[side] = dim
        data = [b for row in rows for b in (row, 0)]  # 8x8 backpack: row r at register 2r
        self.bus.write_i2c_block_data(a, 0x00, data)

    def show(self, dev):
        self._write_eye("left", dev.eye_l, dev.bright_l)
        self._write_eye("right", dev.eye_r, dev.bright_r)
        self._write_ring(dev.ring)

    def blank(self):
        if self.bus:
            self._write_eye("left", bytes(8), 0)
            self._write_eye("right", bytes(8), 0)
            self._write_ring(bytes(4 * self.cfg["ring"]["count"]))

    def close(self):
        if self.bus:
            self.bus.close()
            self.bus = None

    def info(self):
        return f"Pi direct: I2C bus {self.cfg['pi']['i2c_bus']}, ring GPIO{self.cfg['pi']['ring_gpio']}"
