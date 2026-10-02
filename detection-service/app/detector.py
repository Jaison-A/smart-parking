"""Vehicle detection + multi-object tracking (YOLO11 + ByteTrack)."""
from ultralytics import YOLO

from app.config import settings

VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}


class VehicleDetector:
    """One instance per video: ByteTrack keeps its state inside the model object."""

    def __init__(self, model_path: str | None = None):
        self.model = YOLO(model_path or settings.yolo_model)

    def track(self, frame) -> list[dict]:
        results = self.model.track(
            frame,
            persist=True,
            tracker="bytetrack.yaml",
            classes=list(VEHICLE_CLASSES),
            imgsz=settings.yolo_imgsz,
            conf=settings.yolo_conf,
            iou=0.5,
            verbose=False,
        )
        detections: list[dict] = []
        for result in results:
            boxes = result.boxes
            if boxes is None or boxes.id is None:
                continue  # no confirmed tracks in this frame
            for xyxy, cls, conf, tid in zip(
                boxes.xyxy.tolist(), boxes.cls.tolist(), boxes.conf.tolist(), boxes.id.tolist()
            ):
                detections.append({
                    "track_id": int(tid),
                    "class_name": VEHICLE_CLASSES[int(cls)],
                    "confidence": float(conf),
                    "bbox": tuple(int(v) for v in xyxy),
                })
        return detections
