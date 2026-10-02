"""Zone geometry: build pixel polygons from normalised points and test vehicles against them."""
from dataclasses import dataclass

import cv2
import numpy as np

from app.schemas import ZoneIn

# BGR colours used when drawing.
COLOR_PARKING = (110, 124, 14)
COLOR_RESTRICTED = (57, 40, 198)


@dataclass(frozen=True, eq=False)
class Zone:
    id: str
    name: str
    type: str  # "parking" | "no_parking"
    polygon: np.ndarray  # int32, pixel coordinates

    @property
    def is_restricted(self) -> bool:
        return self.type == "no_parking"

    @property
    def color(self) -> tuple[int, int, int]:
        return COLOR_RESTRICTED if self.is_restricted else COLOR_PARKING

    def contains(self, point: tuple[float, float]) -> bool:
        return cv2.pointPolygonTest(self.polygon, (float(point[0]), float(point[1])), False) >= 0


def build_zones(zones: list[ZoneIn], width: int, height: int) -> list[Zone]:
    built = []
    for z in zones:
        pts = np.array([[x * width, y * height] for x, y in z.points], dtype=np.int32)
        built.append(Zone(id=z.id, name=z.name, type=z.type, polygon=pts))
    return built


def find_zone(zones: list[Zone], point: tuple[float, float]) -> Zone | None:
    """Zone containing `point`. A no-parking zone wins where zones overlap
    (e.g. a no-parking strip painted next to the legal parking lot)."""
    inside = [z for z in zones if z.contains(point)]
    if not inside:
        return None
    return next((z for z in inside if z.is_restricted), inside[0])


def draw_zones(frame: np.ndarray, zones: list[Zone]) -> None:
    overlay = frame.copy()
    for z in zones:
        cv2.fillPoly(overlay, [z.polygon], z.color)
    cv2.addWeighted(overlay, 0.18, frame, 0.82, 0, frame)
    for z in zones:
        cv2.polylines(frame, [z.polygon], True, z.color, 2)
        x, y = z.polygon[0]
        cv2.putText(frame, z.name, (int(x), max(int(y) - 8, 14)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, z.color, 2, cv2.LINE_AA)
