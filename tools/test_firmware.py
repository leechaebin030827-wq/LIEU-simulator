"""Compile and run the actual motor headers against a host-only fake bus."""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
tests = root / "hardware/firmware/tests"
with tempfile.TemporaryDirectory(prefix="lieu-firmware-tests-") as tmp:
    for variant in ("lieu_uno_r4", "LIEU_WIFI_SAFE_LOCKED"):
        header = root / "hardware/firmware" / variant / "motor_shield.h"
        binary = Path(tmp) / variant
        subprocess.run([
            os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra",
            "-I", str(tests / "stubs"), f'-DSHIELD_HEADER="{header}"',
            str(tests / "motor_shield_test.cpp"), "-o", str(binary),
        ], check=True)
        subprocess.run([str(binary)], check=True)
