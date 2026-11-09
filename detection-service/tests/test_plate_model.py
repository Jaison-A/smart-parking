"""PlateReader with a dedicated plate-detector model (stand-in model and OCR, no weights needed)."""
import re

import numpy as np

import app.plates as plates
from app.plates import PlateReader

REGEX = r"^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$"
FRAME = np.full((600, 800, 3), 120, np.uint8)


class FakeBoxes:
    def __init__(self, boxes, confs):
        self.xyxy, self.conf = np.array(boxes, float), np.array(confs, float)

    def __len__(self):
        return len(self.conf)


class FakeModel:
    def __init__(self, boxes=(), confs=()):
        self.result = type("R", (), {"boxes": FakeBoxes(boxes, confs) if len(confs) else None})()
        self.calls = 0

    def predict(self, image, **kw):
        self.calls += 1
        return [self.result]


class FakeOCR:
    def __init__(self, text="TN09AB1234"):
        self.text, self.calls, self.last_shape = text, 0, None

    def readtext(self, image, **kw):
        self.calls += 1
        self.last_shape = image.shape
        return [([[0, 0], [1, 0], [1, 1], [0, 1]], self.text, 0.9)]


def reader(model, ocr):
    r = object.__new__(PlateReader)
    r._regex, r._ocr, r._plate_model = re.compile(REGEX), ocr, model
    return r


def with_model(monkeypatch):
    monkeypatch.setattr(PlateReader, "model_active", True)   # as if a plate detector had loaded


VEHICLE = (100, 100, 300, 260)   # 200 px wide


def test_smaller_vehicles_are_tried_once_a_plate_model_is_configured(monkeypatch):
    small = (0, 0, 90, 60)       # 90 px wide: under the 140 px needed WITHOUT a model
    assert not PlateReader.can_read(small)
    with_model(monkeypatch)
    assert PlateReader.can_read(small)                    # over the 70 px needed WITH one
    assert not PlateReader.can_read((0, 0, 60, 40))       # still too small for anything


def test_the_plate_found_by_the_model_is_what_ocr_reads(monkeypatch):
    with_model(monkeypatch)
    # Plate box inside the vehicle crop (200x160): 80 px wide, 24 px tall
    model, ocr = FakeModel([[60, 110, 140, 134]], [0.9]), FakeOCR("TN09AB1234")
    plate, conf = reader(model, ocr).read(FRAME, VEHICLE)
    assert plate == "TN09AB1234" and model.calls == 1 and ocr.calls == 1
    # OCR got a crop of the plate (plus a small margin), not the whole vehicle
    assert ocr.last_shape[1] < 200 * 2 and ocr.last_shape[0] < 160 * 2


def test_the_most_confident_plate_wins(monkeypatch):
    with_model(monkeypatch)
    model = FakeModel([[0, 0, 60, 20], [60, 110, 150, 140]], [0.4, 0.95])
    ocr = FakeOCR()
    reader(model, ocr).read(FRAME, VEHICLE)
    # The 90 px wide box (the confident one) was used, upscaled for OCR, not the 60 px one
    assert ocr.calls == 1


def test_no_plate_found_means_no_ocr_at_all(monkeypatch):
    with_model(monkeypatch)
    model, ocr = FakeModel(), FakeOCR()
    assert reader(model, ocr).read(FRAME, VEHICLE) is None
    assert model.calls == 1 and ocr.calls == 0      # nothing to read, nothing wasted


def test_a_plate_too_narrow_to_read_is_skipped(monkeypatch):
    with_model(monkeypatch)
    model, ocr = FakeModel([[60, 110, 90, 125]], [0.9]), FakeOCR()   # 30 px plate (+margin still < 45)
    assert reader(model, ocr).read(FRAME, VEHICLE) is None
    assert ocr.calls == 0


def test_without_a_model_the_lower_part_of_the_vehicle_is_still_read():
    ocr = FakeOCR()
    assert reader(None, ocr).read(FRAME, (100, 100, 400, 300)) is not None
    assert ocr.calls >= 1


def test_a_missing_model_file_is_not_fatal_and_leaves_the_plain_reader_in_charge(tmp_path, caplog):
    assert PlateReader._load_plate_model("") is None
    with caplog.at_level("WARNING"):
        assert PlateReader._load_plate_model(str(tmp_path / "nope.pt")) is None
    assert "was not found" in caplog.text
    assert PlateReader.model_active is False        # so small vehicles are NOT tried on the strength of a model that isn't there
    assert not PlateReader.can_read((0, 0, 90, 60))


def test_a_model_file_that_cannot_be_loaded_is_not_fatal_either(tmp_path, monkeypatch, caplog):
    import sys, types
    bad = tmp_path / "broken.pt"; bad.write_bytes(b"not a model")
    def boom(_path): raise RuntimeError("corrupt weights")
    monkeypatch.setitem(sys.modules, "ultralytics", types.SimpleNamespace(YOLO=boom))
    with caplog.at_level("WARNING"):
        assert PlateReader._load_plate_model(str(bad)) is None
    assert "could not load" in caplog.text
