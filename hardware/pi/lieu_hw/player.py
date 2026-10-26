import time

from .frames import Scenario
from .mapping import Mapper
from .motion import NullMotion

KEEPALIVE_S = 0.25  # firmware blanks after ~2 s of silence, so repeat the last frame while the picture is static


def play(scn: Scenario, driver, cfg: dict, loop: bool | None = None, speed: float = 1.0, motion=None, on_tick=None):
    """Real-time playback on a monotonic clock (frames are looked up by time, so a slow tick never drifts the sequence)."""
    mapper = Mapper(cfg)
    motion = motion or NullMotion()
    loop = scn.loop if loop is None else loop
    motion.start()
    t0 = time.monotonic()
    last_key, last_sent = None, 0.0
    try:
        while True:
            now = time.monotonic()
            t = (now - t0) * speed
            if t >= scn.duration:
                if not loop:
                    break
                t0 = now
                t = 0.0
            dev = mapper.to_device(scn.frame_at(t))
            key = dev.key()
            if key != last_key or now - last_sent >= KEEPALIVE_S:
                driver.show(dev)
                last_key, last_sent = key, now
            motion.update(t, *scn.motion_at(t))
            if on_tick:
                on_tick(t)
            time.sleep(max(0.0, 1 / (scn.fps * 2) - (time.monotonic() - now)))
    finally:
        motion.stop()
