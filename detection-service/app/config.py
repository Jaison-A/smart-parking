"""Central configuration. Values come from environment variables / .env."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _flag(name: str, default: bool) -> bool:
    return os.getenv(name, "1" if default else "0").strip().lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class Settings:
    yolo_model: str = os.getenv("YOLO_MODEL", "yolo11s.pt")
    # 640 is the YOLO-standard inference size and roughly 2x faster than 960 on CPU
    # with a small accuracy cost - the right default for CPU-only dev machines.
    # Raise it back to 960+ once you have a GPU, via YOLO_IMGSZ in .env.
    yolo_imgsz: int = int(os.getenv("YOLO_IMGSZ", "640"))
    yolo_conf: float = float(os.getenv("YOLO_CONF", "0.3"))

    plate_ocr_enabled: bool = _flag("PLATE_OCR", True)
    plate_model: str = os.getenv("PLATE_MODEL", "")
    plate_regex: str = os.getenv("PLATE_REGEX", r"^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$")

    video_root: Path = Path(
        os.getenv("VIDEO_ROOT", str(BASE_DIR.parent / "backend" / "uploads" / "videos"))
    ).resolve()

    backend_url: str = os.getenv("BACKEND_URL", "http://localhost:5000")
    api_key: str = os.getenv("DETECTOR_API_KEY", "change-me-detector-key")


settings = Settings()
