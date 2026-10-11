"""Central configuration. Values come from environment variables / .env."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _flag(name: str, default: bool) -> bool:
    return os.getenv(name, "1" if default else "0").strip().lower() in ("1", "true", "yes")


# DETECTION_MODE bundles the choices that decide how many vehicles get found:
# model size, inference resolution, confidence cut-off, and how forgiving the tracker
# is. "max" finds the most vehicles (small / distant / partly hidden ones) but is
# several times slower - realistic on a GPU, painful on a CPU. Any of YOLO_MODEL,
# YOLO_IMGSZ, YOLO_CONF set explicitly in .env still wins over the preset.
_PRESETS = {
    #            model          imgsz  conf  tracker
    "fast":     ("yolo11n.pt",   640, 0.35, "bytetrack.yaml"),
    "balanced": ("yolo11s.pt",   640, 0.30, "bytetrack.yaml"),
    "max":      ("yolo11m.pt",  1280, 0.12, str(BASE_DIR / "config" / "bytetrack_max.yaml")),
}
_MODE = os.getenv("DETECTION_MODE", "balanced").strip().lower()
if _MODE not in _PRESETS:
    _MODE = "balanced"
_P_MODEL, _P_IMGSZ, _P_CONF, _P_TRACKER = _PRESETS[_MODE]


@dataclass(frozen=True)
class Settings:
    detection_mode: str = _MODE
    yolo_model: str = os.getenv("YOLO_MODEL", _P_MODEL)
    yolo_imgsz: int = int(os.getenv("YOLO_IMGSZ", _P_IMGSZ))
    yolo_conf: float = float(os.getenv("YOLO_CONF", _P_CONF))
    tracker: str = _P_TRACKER

    # Spacing / bay rules (see sessions.py). 0 turns the spacing rule off.
    min_gap_ratio: float = float(os.getenv("MIN_GAP_RATIO", "0.25"))
    bay_min_overlap: float = float(os.getenv("BAY_MIN_OVERLAP", "0.5"))
    rule_hold_s: float = float(os.getenv("RULE_HOLD_S", "5"))

    # A plate is only ~1/4 of a car's width, so below this the OCR has nothing to
    # read - skipping saves a lot of CPU. 0 disables the check.
    plate_min_vehicle_px: int = int(os.getenv("PLATE_MIN_VEHICLE_PX", "140"))

    plate_ocr_enabled: bool = _flag("PLATE_OCR", True)
    plate_model: str = os.getenv("PLATE_MODEL", "")
    plate_regex: str = os.getenv("PLATE_REGEX", r"^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$")

    video_root: Path = Path(
        os.getenv("VIDEO_ROOT", str(BASE_DIR.parent / "backend" / "uploads" / "videos"))
    ).resolve()

    backend_url: str = os.getenv("BACKEND_URL", "http://localhost:5000")
    api_key: str = os.getenv("DETECTOR_API_KEY", "change-me-detector-key")


settings = Settings()
