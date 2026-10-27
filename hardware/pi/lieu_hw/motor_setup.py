"""Give a Dynamixel its own ID (and a matching baud rate). The ONLY code that writes the ID / baud registers.

Why it is guarded so hard: a WRITE sent to a shared ID (or the broadcast ID) changes every motor that hears it, and two motors with the same ID answer
over each other. So it only works when EXACTLY ONE motor answers on the bus (connect the motors one at a time), the motor has torque off (needed for
these EEPROM registers, and it means the axis is free), the new ID is 2..20, and the change is verified by reading it back. It never moves a motor.
"""
import struct
import time
from pathlib import Path

from .motor_readonly import BROADCAST, PING, ReadOnlyBus, crc16, parse_status

INST_WRITE = 0x03
ADDR_ID, ADDR_BAUD, ADDR_TORQUE = 7, 8, 64
BAUD_INDEX = {9600: 0, 57600: 1, 115200: 2, 1000000: 3, 2000000: 4, 3000000: 5, 4000000: 6}
SCAN_BAUDS = (115200, 57600, 1000000, 9600, 2000000, 3000000, 4000000)
PAUSE_FILE = Path("/tmp/lieu_bridge.pause")  # the bridge lets go of the serial port while this exists


class SetupError(RuntimeError):
    pass


def _write(bus: ReadOnlyBus, dxl_id: int, addr: int, value: int) -> None:
    if addr not in (ADDR_ID, ADDR_BAUD):
        raise PermissionError("only the ID and baud registers can be written here")
    if dxl_id == BROADCAST:
        raise PermissionError("never write to the broadcast ID")
    body = bytes([0xFF, 0xFF, 0xFD, 0x00, dxl_id]) + struct.pack("<H", 6) + bytes([INST_WRITE]) + struct.pack("<H", addr) + bytes([value])
    pkt = body + struct.pack("<H", crc16(body))
    bus.ser.reset_input_buffer()
    bus.ser.write(pkt)
    bus.ser.flush()
    for i, err, _ in parse_status(bus._collect(0.1)):
        if err:
            raise SetupError(f"motor reported error 0x{err:02X}")
        return
    raise SetupError("no reply to the write")


def find_single(port: str):
    """Find the one motor on the bus: returns (bus, id, model, baud). Refuses if none or more than one answers."""
    for baud in SCAN_BAUDS:
        bus = ReadOnlyBus(port, baud)
        found = bus.scan(0.6)
        if len(found) > 1:
            bus.close()
            raise SetupError(f"{len(found)} motors answer at {baud} baud ({found}): connect ONE motor only")
        if found:
            (i, model), = found.items()
            return bus, i, model, baud
        bus.close()
    raise SetupError("no motor answered at any baud rate (power on? cable?). If two motors with the same ID are connected, unplug one.")


def set_id(port: str, new_id: int, set_baud: int | None = 115200, log=print) -> None:
    if not 2 <= new_id <= 20:
        raise SetupError("new ID must be between 2 and 20")
    PAUSE_FILE.write_text("setup")
    time.sleep(2.0)  # let the bridge release the port
    bus = None
    try:
        bus, old, model, baud = find_single(port)
        log(f"found exactly one motor: id {old}, model {model}, {baud} baud")
        torque = bus.torque_enabled(old)
        if torque:
            raise SetupError("torque is ON for this motor: turn it off first (Torque off in the panel / power-cycle it)")
        if old == new_id and (set_baud is None or baud == set_baud):
            log("already set, nothing to do")
            return
        if set_baud is not None and baud != set_baud:
            _write(bus, old, ADDR_BAUD, BAUD_INDEX[set_baud])
            log(f"baud register set to {set_baud}")
            bus.close()
            time.sleep(0.3)
            bus = ReadOnlyBus(port, set_baud)
            if old not in bus.scan(0.6):
                raise SetupError("motor does not answer at the new baud rate after the change")
        if old != new_id:
            _write(bus, old, ADDR_ID, new_id)
            time.sleep(0.2)
            if new_id not in bus.scan(0.6) or old in bus.scan(0.6):
                raise SetupError("could not verify the new ID: check the motor with a scan")
            log(f"ID changed {old} -> {new_id} (verified)")
    finally:
        if bus:
            bus.close()
        PAUSE_FILE.unlink(missing_ok=True)
