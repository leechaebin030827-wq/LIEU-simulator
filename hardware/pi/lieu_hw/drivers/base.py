from ..frames import DeviceFrame


class Driver:
    """Output device. The player only talks to this, so UNO R4 and Raspberry Pi are interchangeable."""

    def open(self) -> None: ...
    def close(self) -> None: ...
    def show(self, dev: DeviceFrame) -> None: raise NotImplementedError
    def blank(self) -> None: ...
    def info(self) -> str: return type(self).__name__

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *exc):
        try:
            self.blank()
        finally:
            self.close()
