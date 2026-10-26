"""Motion output. Motors are NOT driven yet: the baked frames already carry railX / yawY / tiltZ per frame, so this is the one place
to plug in the Dynamixel (U2D2) driver later. Keep the sequence limits in mind: the simulator ranges are PREVIEW ONLY, not motor-safe."""


class NullMotion:
    def start(self) -> None: ...
    def update(self, t: float, rail_m: float, yaw_deg: float, tilt_deg: float) -> None: ...
    def stop(self) -> None: ...


class DynamixelMotion(NullMotion):
    """TODO (after calibration): U2D2 over USB, 4 axes, own motor supply. Needs motor IDs, gear ratio, travel limits, E-stop."""

    def __init__(self, *a, **k):
        raise NotImplementedError("motor control is intentionally not implemented yet")
