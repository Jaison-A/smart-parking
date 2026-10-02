"""Number plate reading: locate the plate, run OCR, and vote across many frames.

A single OCR read is unreliable (motion blur, angle, glare). We read the same
vehicle repeatedly and only trust a plate once several reads agree.
"""
import re
from collections import Counter, defaultdict

_TO_DIGIT = str.maketrans("OQDIZSBG", "00012586")
_TO_LETTER = str.maketrans("012586", "OIZSBG")


class PlateVote:
    """Collects OCR reads for one vehicle and decides the most likely plate."""

    def __init__(self, min_reads: int = 2, max_attempts: int = 25):
        self.min_reads = min_reads
        self.max_attempts = max_attempts
        self.attempts = 0
        self._score: dict[str, float] = defaultdict(float)
        self._count: Counter[str] = Counter()

    def add(self, read: tuple[str, float] | None) -> None:
        self.attempts += 1
        if read:
            text, conf = read
            self._score[text] += conf
            self._count[text] += 1

    @property
    def exhausted(self) -> bool:
        return self.attempts >= self.max_attempts

    def best(self) -> tuple[str, float] | None:
        if not self._score:
            return None
        text = max(self._score, key=self._score.get)
        return text, self._score[text] / self._count[text]

    @property
    def locked(self) -> bool:
        """True once we are confident enough to stop reading this vehicle."""
        best = self.best()
        if best is None:
            return self.exhausted
        return self._count[best[0]] >= self.min_reads or self.exhausted


class PlateReader:
    """Finds and reads a plate inside a vehicle crop. Heavy imports are lazy."""

    def __init__(self, plate_regex: str, plate_model: str = ""):
        import easyocr
        import torch

        self._regex = re.compile(plate_regex)
        self._ocr = easyocr.Reader(["en"], gpu=torch.cuda.is_available(), verbose=False)
        self._plate_model = None
        if plate_model:
            from ultralytics import YOLO
            self._plate_model = YOLO(plate_model)

    # ------------------------------------------------------------------ public
    def read(self, frame, bbox) -> tuple[str, float] | None:
        import cv2

        x1, y1, x2, y2 = bbox
        h, w = frame.shape[:2]
        crop = frame[max(y1, 0):min(y2, h), max(x1, 0):min(x2, w)]
        if crop.size == 0 or crop.shape[1] < 40:
            return None

        crop = self._locate_plate(crop)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        scale = max(1.0, 320 / gray.shape[1])
        if scale > 1:
            gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(gray)

        fragments = self._ocr.readtext(
            gray, detail=1, paragraph=False,
            allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        )
        return self._best_match(fragments)

    # ----------------------------------------------------------------- helpers
    def _locate_plate(self, vehicle_crop):
        """Tight plate crop if a plate model is configured, else the lower part of the vehicle."""
        if self._plate_model is not None:
            res = self._plate_model.predict(vehicle_crop, verbose=False, conf=0.3)[0]
            if res.boxes is not None and len(res.boxes):
                i = int(res.boxes.conf.argmax())
                x1, y1, x2, y2 = (int(v) for v in res.boxes.xyxy[i].tolist())
                return vehicle_crop[y1:y2, x1:x2]
        h = vehicle_crop.shape[0]
        return vehicle_crop[int(h * 0.45):, :]

    def _best_match(self, fragments) -> tuple[str, float] | None:
        if not fragments:
            return None
        # Read top-to-bottom, then left-to-right (two-line bike plates).
        ordered = sorted(fragments, key=lambda f: (round(f[0][0][1] / 25), f[0][0][0]))
        candidates = [
            ("".join(f[1] for f in ordered), sum(f[2] for f in ordered) / len(ordered)),
            *[(f[1], f[2]) for f in ordered],
        ]
        best = None
        for text, conf in candidates:
            plate = self._normalise(text)
            if plate and (best is None or conf > best[1]):
                best = (plate, float(conf))
        return best

    def _normalise(self, text: str) -> str | None:
        text = re.sub(r"[^A-Z0-9]", "", text.upper())
        if self._regex.match(text):
            return text
        # Common OCR confusions, assuming AA-99-AA-9999 style plates.
        if len(text) >= 8:
            fixed = (text[:2].translate(_TO_LETTER) + text[2:4].translate(_TO_DIGIT)
                     + text[4:-4] + text[-4:].translate(_TO_DIGIT))
            if self._regex.match(fixed):
                return fixed
        return None
