"""Opens a video source: an uploaded file, an RTSP/HTTP camera URL, or a webcam index."""
import cv2


def is_live_source(source: str) -> bool:
    """True for a camera (RTSP/HTTP URL or webcam index) as opposed to an uploaded file."""
    return source.isdigit() or source.startswith(("rtsp://", "rtsps://", "http://", "https://"))


def open_capture(source: str) -> cv2.VideoCapture:
    # A bare "0", "1", ... means "the Nth local webcam" and must be an int -
    # cv2.VideoCapture("0") tries (and fails) to open a *file* named "0".
    return cv2.VideoCapture(int(source) if source.isdigit() else source)
