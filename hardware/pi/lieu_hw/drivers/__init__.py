from .base import Driver


def make_driver(cfg: dict) -> Driver:
    b = cfg["backend"]
    if b == "mock":
        from .mock import MockDriver
        return MockDriver(cfg)
    if b == "serial":
        from .serial_uno import SerialUnoDriver
        return SerialUnoDriver(cfg)
    if b == "pi":
        from .pi_direct import PiDirectDriver
        return PiDirectDriver(cfg)
    raise ValueError(f"unknown backend {b!r} (mock | serial | pi)")
