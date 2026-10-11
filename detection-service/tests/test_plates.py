"""PlateReader logic with a stand-in OCR engine (the real EasyOCR isn't needed to test this)."""
import re

import numpy as np

from app.plates import PlateReader

REGEX = r"^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$"


class FakeOCR:
    """Returns the queued results one call at a time and records how often it was used."""
    def __init__(self, *results):
        self.results, self.calls = list(results), 0

    def readtext(self, image, **kw):
        self.calls += 1
        return self.results.pop(0) if self.results else []


def fragment(text, conf=0.9):
    return ([[0, 0], [100, 0], [100, 30], [0, 30]], text, conf)


def reader(ocr):
    r = object.__new__(PlateReader)        # skip __init__: it imports easyocr/torch
    r._regex, r._ocr, r._plate_model = re.compile(REGEX), ocr, None
    return r


FRAME = np.full((600, 800, 3), 120, np.uint8)
BIG = (100, 100, 400, 300)    # 300px-wide vehicle: big enough to read
SMALL = (100, 100, 160, 140)  # 60px-wide vehicle: too small


def test_tiny_vehicle_is_skipped_without_running_ocr():
    ocr = FakeOCR([fragment("TN75AB1234")])
    assert reader(ocr).read(FRAME, SMALL) is None
    assert ocr.calls == 0


def test_reads_and_normalises_a_plate():
    ocr = FakeOCR([fragment("TN 75 AB 1234")])
    plate, conf = reader(ocr).read(FRAME, BIG)
    assert plate == "TN75AB1234" and conf > 0.8
    assert ocr.calls == 1                    # first rendering was enough


def test_falls_back_to_the_second_rendering():
    ocr = FakeOCR([], [fragment("TN75AB1234")])  # first rendering finds nothing
    assert reader(ocr).read(FRAME, BIG)[0] == "TN75AB1234"
    assert ocr.calls == 2


def test_gives_up_if_neither_rendering_matches_the_format():
    ocr = FakeOCR([fragment("HELLO")], [fragment("12")])
    assert reader(ocr).read(FRAME, BIG) is None


def test_fixes_common_letter_digit_confusions():
    ocr = FakeOCR([fragment("TNZ5AB1Z34")])      # Z for 7... and Z for 2 in the digit blocks
    plate = reader(ocr).read(FRAME, BIG)
    assert plate is not None and plate[0].startswith("TN") and plate[0][-4:].isdigit()
