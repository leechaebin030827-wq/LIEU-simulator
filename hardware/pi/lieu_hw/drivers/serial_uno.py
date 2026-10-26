import glob
import time

from .. import protocol
from .base import Driver


def find_port() -> str:
    cands = sorted(glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
    if not cands:
        raise RuntimeError("no Arduino serial port found; set serial.port in hardware.json")
    return cands[0]


class SerialUnoDriver(Driver):
    """Arduino UNO R4 over USB serial (firmware: hardware/firmware/lieu_uno_r4)."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.ser = None
        self.log: list[str] = []

    def open(self):
        import serial  # pyserial
        c = self.cfg["serial"]
        port = find_port() if c["port"] == "auto" else c["port"]
        self.ser = serial.Serial(port, c["baud"], timeout=0.05)
        time.sleep(2.0)  # R4 resets on connect
        self.ser.reset_input_buffer()
        e, r = self.cfg["eyes"], self.cfg["ring"]
        # the host already applies max_scale/budget (mapping.py); the firmware keeps the same budget (+10 %) only as a backstop
        self.ser.write(protocol.config_packet(e["left"]["address"], e["right"]["address"], 1.0, int(r["budget_ma"] * 1.1)))

    def _drain(self) -> list[str]:
        out = []
        while (line := self.ser.readline()):
            out.append(line.decode(errors="replace").strip())
        self.log += out
        return out

    def info(self) -> str:
        self._drain()
        self.ser.write(protocol.packet(protocol.T_INFO))
        time.sleep(0.2)
        lines = self._drain()
        return "\n".join(lines) or "(no reply: is the LIEU firmware flashed?)"

    def show(self, dev):
        self.ser.write(protocol.frame_packet(dev))
        self._drain()  # also keeps the OS buffer from filling with firmware messages

    def blank(self):
        if self.ser:
            self.ser.write(protocol.packet(protocol.T_BLANK))

    def close(self):
        if self.ser:
            self.ser.close()
            self.ser = None
