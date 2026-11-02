"""Number plate reading: locate the plate, run OCR, and vote across many frames.

A single OCR read is unreliable (motion blur, angle, glare). We read the same
vehicle repeatedly and only trust a plate once several reads agree.
"""
import re
from collections import Counter, defaultdict

from app.config import settings

_TO_DIGIT = str.maketrans("OQDIZSBG", "00012586")
_TO_LETTER = str.maketrans("012586", "OIZSBG")


class PlateVote:
    """Collects OCR reads for one vehicle and decides the most likely plate."""

    def __init__(self, min_reads: int = 2, max_attempts: int = 25):
        self.min_reads = min_reads
        self.max_attempts = max_attempts
        self.attempts = 0  # counts toward giving up (give_up() fills it)
        self.reads = 0     # real OCR reads actually made - what the dashboard shows
        self._score: dict[str, float] = defaultdict(float)
        self._count: Counter[str] = Counter()

    def add(self, read: tuple[str, float] | None) -> None:
        self.attempts += 1
        self.reads += 1
        if read:
            text, conf = read
            self._score[text] += conf
            self._count[text] += 1

    @property
    def exhausted(self) -> bool:
        return self.attempts >= self.max_attempts

    def give_up(self) -> None:
        """Stop trying for this vehicle (e.g. it is too small for a plate to be legible)."""
        self.attempts = self.max_attempts

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
    @staticmethod
    def min_vehicle_px() -> int:
        # With a plate-detector model the plate is found directly, so smaller vehicles
        # are worth trying; without one OCR has to guess where the plate is.
        need = settings.plate_min_vehicle_px_with_model if settings.plate_model else settings.plate_min_vehicle_px
        return max(40, need)

    @staticmethod
    def can_read(bbox) -> bool:
        """False when the vehicle is too small in the picture for a plate to be legible."""
        return (bbox[2] - bbox[0]) >= PlateReader.min_vehicle_px()

    def read(self, frame, bbox) -> tuple[str, float] | None:
        import cv2

        x1, y1, x2, y2 = bbox
        h, w = frame.shape[:2]
        crop = frame[max(y1, 0):min(y2, h), max(x1, 0):min(x2, w)]
        # A plate is roughly a quarter of a car's width: on a small, distant vehicle
        # there are only a few pixels of plate and OCR just burns CPU guessing.
        if crop.size == 0 or crop.shape[1] < self.min_vehicle_px():
            return None

        plate = self._locate_plate(crop)
        if plate is None or plate.size == 0:
            return None

        # When there is no trained plate-detector, find bright plate-shaped areas
        # before falling back to the entire bumper.  OCR struggles when a 90-pixel
        # plate is surrounded by a 500-pixel-wide car (and by video watermarks).
        # The fallback keeps this compatible with yellow, dark, and poorly lit plates.
        regions = self._plate_candidates(plate) if self._plate_model is None else [plate]
        regions.append(plate)
        for candidate in regions:
            match = self._read_region(candidate)
            if match:
                return match
        return None

    # ----------------------------------------------------------------- helpers
    @staticmethod
    def _variants(gray):
        import cv2
        import numpy as np

        yield cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(gray)
        blurred = cv2.GaussianBlur(gray, (0, 0), 2)
        sharp = cv2.addWeighted(gray, 1.8, blurred, -0.8, 0)
        _, binary = cv2.threshold(sharp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        # Plates are usually dark-on-light; if the result is mostly dark, flip it.
        yield binary if np.mean(binary) > 127 else cv2.bitwise_not(binary)

    def _read_region(self, plate) -> tuple[str, float] | None:
        """Upscale one proposed plate crop and return its OCR result, if valid."""
        import cv2

        region = cv2.cvtColor(plate, cv2.COLOR_BGR2GRAY)
        scale = max(1.0, 320 / region.shape[1])
        if scale > 1:
            region = cv2.resize(region, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        for image in self._variants(region):
            fragments = self._ocr.readtext(
                image, detail=1, paragraph=False,
                allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
            )
            match = self._best_match(fragments)
            if match:
                return match
        return None

    @staticmethod
    def _plate_candidates(vehicle_crop):
        """Return up to two bright, wide rectangles likely to be number plates.

        This is deliberately a small OpenCV heuristic, not a replacement for a
        trained plate model.  It makes the useful no-model path crop the plate tightly
        without OCRing many unrelated parts of the vehicle.
        """
        import cv2

        h, w = vehicle_crop.shape[:2]
        start_y = int(h * 0.35)
        lower = vehicle_crop[start_y:]
        gray = cv2.cvtColor(lower, cv2.COLOR_BGR2GRAY)
        # Plates in the supplied demo are light rectangles.  Closing joins their
        # individual bright characters/background into one contour.
        bright = cv2.inRange(gray, 155, 255)
        mask = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (11, 5)))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        found = []
        for contour in contours:
            x, y, cw, ch = cv2.boundingRect(contour)
            ratio = cw / max(ch, 1)
            if cw < settings.plate_min_plate_px or ch < 12 or not 1.7 <= ratio <= 7.5 or cw > w * 0.65:
                continue
            # Keep a little border around every character for OCR.
            pad_x, pad_y = max(3, int(cw * 0.08)), max(2, int(ch * 0.25))
            x1, y1 = max(0, x - pad_x), max(0, start_y + y - pad_y)
            x2, y2 = min(w, x + cw + pad_x), min(h, start_y + y + ch + pad_y)
            score = cw * ch * (1.0 - min(abs(ratio - 4.0), 3.0) / 8.0)
            found.append((score, vehicle_crop[y1:y2, x1:x2]))
        return [region for _, region in sorted(found, key=lambda item: item[0], reverse=True)[:2]]

    def _locate_plate(self, vehicle_crop):
        """The plate region to run OCR on, or None if there is nothing worth reading.

        With a plate-detector model: the model finds the plate and OCR gets a tight,
        sharp crop (None if it finds no plate, or the plate is too narrow to read -
        guessing on the bumper would only produce noise). Without one: the lower part
        of the vehicle, where plates usually are.
        """
        if self._plate_model is not None:
            res = self._plate_model.predict(vehicle_crop, verbose=False, conf=0.3, imgsz=640)[0]
            if res.boxes is None or len(res.boxes) == 0:
                return None
            i = int(res.boxes.conf.argmax())
            x1, y1, x2, y2 = (int(v) for v in res.boxes.xyxy[i].tolist())
            h, w = vehicle_crop.shape[:2]
            pad_x, pad_y = int(0.08 * (x2 - x1)), int(0.15 * (y2 - y1))  # margin so no character is clipped
            x1, y1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
            x2, y2 = min(w, x2 + pad_x), min(h, y2 + pad_y)
            plate = vehicle_crop[y1:y2, x1:x2]
            return plate if plate.shape[1] >= settings.plate_min_plate_px else None
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
        # OCR can merge a watermark or bumper badge with the plate, for example
        # "SHUTTERSTOCKAO62KWR".  Search its plausible plate-length portions as
        # well; accepting only the entire OCR fragment throws a readable plate away.
        for length in range(7, min(12, len(text)) + 1):
            for start in range(0, len(text) - length + 1):
                candidate = text[start:start + length]
                if self._regex.match(candidate):
                    return candidate
        # Common OCR confusions, assuming AA-99-AA-9999 style plates.
        if len(text) >= 8:
            fixed = (text[:2].translate(_TO_LETTER) + text[2:4].translate(_TO_DIGIT)
                     + text[4:-4] + text[-4:].translate(_TO_DIGIT))
            if self._regex.match(fixed):
                return fixed
            for length in range(7, min(12, len(fixed)) + 1):
                for start in range(0, len(fixed) - length + 1):
                    candidate = fixed[start:start + length]
                    if self._regex.match(candidate):
                        return candidate
        return None
