"""The test-image source: one picture served forever like a camera."""
import cv2
import numpy as np

from app.source import StillImageCapture, is_image_source, is_live_source, open_capture


def make_image(tmp_path, name="car.png", w=320, h=200):
    path = tmp_path / name
    cv2.imwrite(str(path), np.full((h, w, 3), 90, np.uint8))
    return str(path)


def test_image_sources_are_recognised_by_extension():
    assert is_image_source("a/b/car.JPG") and is_image_source("https://x/y.png?v=1")
    assert not is_image_source("clip.mp4") and not is_image_source("0")


def test_an_image_counts_as_a_never_ending_source():
    assert is_live_source("car.jpg") and is_live_source("0")
    assert not is_live_source("clip.mp4")


def test_open_capture_returns_the_still_image_capture(tmp_path):
    cap = open_capture(make_image(tmp_path))
    assert isinstance(cap, StillImageCapture) and cap.isOpened()


def test_it_reports_the_picture_size_and_no_frame_count(tmp_path):
    cap = open_capture(make_image(tmp_path, w=320, h=200))
    assert int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) == 320
    assert int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) == 200
    assert cap.get(cv2.CAP_PROP_FPS) > 0
    assert cap.get(cv2.CAP_PROP_FRAME_COUNT) == 0   # no length: it never ends


def test_every_read_succeeds_and_returns_an_independent_copy(tmp_path):
    cap = open_capture(make_image(tmp_path))
    ok1, f1 = cap.read()
    f1[:] = 0                      # the pipeline draws on frames; must not damage the source
    ok2, f2 = cap.read()
    assert ok1 and ok2 and f2.mean() == 90
    for _ in range(500):
        assert cap.read()[0]       # still going - nothing ends it but Stop


def test_a_missing_or_invalid_file_is_not_opened(tmp_path):
    assert not open_capture(str(tmp_path / "nope.png")).isOpened()
    bad = tmp_path / "bad.png"
    bad.write_bytes(b"not an image")
    assert not open_capture(str(bad)).isOpened()
