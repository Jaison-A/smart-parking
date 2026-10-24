"""Opens a video source: an uploaded file, an RTSP/HTTP camera URL, a webcam index -
or, for TESTING, a single still image that is served over and over like a camera."""
import cv2
import numpy as np

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
# The pretend frame rate of a still image. It only sets how fast "video time"
# passes for the stationary / violation timers; low enough that a CPU can keep up.
IMAGE_FPS = 5.0


def is_image_source(source: str) -> bool:
    return source.split("?")[0].lower().endswith(IMAGE_EXTS)


def is_live_source(source: str) -> bool:
    """True for a source that never "ends" by itself: a camera (RTSP/HTTP URL or
    webcam index) or a test image - as opposed to an uploaded video file."""
    return (source.isdigit() or is_image_source(source)
            or source.startswith(("rtsp://", "rtsps://", "http://", "https://")))


class StillImageCapture:
    """Quacks like cv2.VideoCapture, but every read() returns the same picture, so
    a single photo can be pushed through the full pipeline (detection, tracking,
    plate reading, rules) until someone stops the job. For testing only."""

    def __init__(self, source: str):
        self._frame = self._load(source)

    @staticmethod
    def _load(source: str):
        try:
            if source.startswith(("http://", "https://")):
                import requests
                data = np.frombuffer(requests.get(source, timeout=15).content, np.uint8)
            else:
                # np.fromfile (not cv2.imread) so paths with non-ASCII characters work on Windows.
                data = np.fromfile(source, np.uint8)
            return cv2.imdecode(data, cv2.IMREAD_COLOR)  # None if it isn't a valid image
        except Exception:
            return None

    def isOpened(self) -> bool:
        return self._frame is not None

    def read(self):
        if self._frame is None:
            return False, None
        return True, self._frame.copy()

    def get(self, prop: int) -> float:
        if self._frame is None:
            return 0.0
        h, w = self._frame.shape[:2]
        return {cv2.CAP_PROP_FPS: IMAGE_FPS, cv2.CAP_PROP_FRAME_COUNT: 0.0,
                cv2.CAP_PROP_FRAME_WIDTH: float(w), cv2.CAP_PROP_FRAME_HEIGHT: float(h)}.get(prop, 0.0)

    def release(self) -> None:
        pass


def open_capture(source: str):
    if is_image_source(source):
        return StillImageCapture(source)
    # A bare "0", "1", ... means "the Nth local webcam" and must be an int -
    # cv2.VideoCapture("0") tries (and fails) to open a *file* named "0".
    return cv2.VideoCapture(int(source) if source.isdigit() else source)
