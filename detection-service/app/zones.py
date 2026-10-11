"""Zone geometry: build pixel polygons from normalised points and test vehicles against them."""
from dataclasses import dataclass
from functools import cached_property

import cv2
import numpy as np

from app.schemas import ZoneIn

# BGR colours used when drawing.
COLOR_PARKING = (0, 255, 80)      # bright green (BGR) - was a dark olive that vanished into asphalt
COLOR_RESTRICTED = (57, 40, 198)
COLOR_BAY = (255, 170, 0)         # bright blue (BGR) - a single parking slot


@dataclass(frozen=True, eq=False)
class Zone:
    id: str
    name: str
    type: str  # "parking" | "no_parking" | "bay"
    polygon: np.ndarray  # int32, pixel coordinates

    @property
    def is_restricted(self) -> bool:
        return self.type == "no_parking"

    @property
    def is_bay(self) -> bool:
        return self.type == "bay"

    @property
    def color(self) -> tuple[int, int, int]:
        if self.is_bay:
            return COLOR_BAY
        return COLOR_RESTRICTED if self.is_restricted else COLOR_PARKING

    @cached_property
    def _mask(self):
        """(x, y, mask) - the polygon rasterised inside its own bounding box, built once."""
        x, y, w, h = cv2.boundingRect(self.polygon)
        mask = np.zeros((h, w), np.uint8)
        cv2.fillPoly(mask, [self.polygon - np.array([x, y], dtype=np.int32)], 1)
        return x, y, mask

    def overlap_fraction(self, rect: tuple[int, int, int, int]) -> float:
        """Share (0..1) of `rect` = (x1, y1, x2, y2) that lies inside this polygon."""
        x0, y0, mask = self._mask
        rx1, ry1, rx2, ry2 = rect
        area = max(1, (rx2 - rx1) * (ry2 - ry1))
        ix1, iy1 = max(rx1, x0), max(ry1, y0)
        ix2, iy2 = min(rx2, x0 + mask.shape[1]), min(ry2, y0 + mask.shape[0])
        if ix2 <= ix1 or iy2 <= iy1:
            return 0.0
        return float(mask[iy1 - y0:iy2 - y0, ix1 - x0:ix2 - x0].sum()) / area

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
    # Bays are slots to allocate vehicles to, not zones that open sessions.
    inside = [z for z in zones if not z.is_bay and z.contains(point)]
    if not inside:
        return None
    return next((z for z in inside if z.is_restricted), inside[0])


def draw_zones(frame: np.ndarray, zones: list[Zone]) -> None:
    overlay = frame.copy()
    for z in zones:
        if not z.is_bay:  # bays: outline + label only, or a full lot turns solid blue
            cv2.fillPoly(overlay, [z.polygon], z.color)
    # 35% fill (was 18%) so the zone reads clearly on busy car-park footage.
    cv2.addWeighted(overlay, 0.35, frame, 0.65, 0, frame)
    for z in zones:
        # Dark under-stroke first, then the bright coloured line on top: the
        # two-tone edge stays visible on both dark asphalt and bright cars.
        thin = 2 if z.is_bay else 4  # bays are small and numerous - keep them light
        cv2.polylines(frame, [z.polygon], True, (0, 0, 0), thin + 2, cv2.LINE_AA)
        cv2.polylines(frame, [z.polygon], True, z.color, thin, cv2.LINE_AA)
        x, y = z.polygon[0]
        label_pos = (int(x), max(int(y) - 10, 16))
        cv2.putText(frame, z.name, label_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4, cv2.LINE_AA)
        cv2.putText(frame, z.name, label_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.7, z.color, 2, cv2.LINE_AA)
