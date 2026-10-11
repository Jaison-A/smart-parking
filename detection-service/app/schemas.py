"""Request / parameter models shared by the API and the detection core."""
from typing import Literal

from pydantic import BaseModel, Field

from app.config import settings


class ZoneIn(BaseModel):
    id: str
    name: str
    # "bay" = one numbered parking slot inside (or beside) a parking zone.
    type: Literal["parking", "no_parking", "bay"]
    # Normalised coordinates (0..1) so a zone works at any video resolution.
    points: list[tuple[float, float]] = Field(min_length=3)


class JobParams(BaseModel):
    # A vehicle stopped this long inside a no-parking zone is a violation.
    no_parking_threshold_s: float = 30.0
    # How long a vehicle must barely move to count as "stationary".
    stationary_window_s: float = 2.0
    # "Barely move" = position range below this fraction of the vehicle's width.
    stationary_ratio: float = 0.15
    # Stationary for this long before a parking session is opened (filters red lights).
    min_session_s: float = 5.0
    # Keep the session alive through short movements / detection flicker.
    moving_grace_s: float = 3.0
    exit_grace_s: float = 2.0
    lost_grace_s: float = 5.0
    # After the threshold, wait this long for a readable plate before fining anyway.
    plate_wait_s: float = 10.0
    heartbeat_s: float = 5.0
    # Process every Nth frame (2 = twice as fast, negligible accuracy loss).
    frame_stride: int = 2
    # Spacing: a vehicle that parks side by side with another closer than this
    # (as a fraction of the narrower vehicle's width) breaks the rule. 0 = off.
    min_gap_ratio: float = settings.min_gap_ratio
    # Bays: share of the vehicle's footprint that must sit inside its bay.
    bay_min_overlap: float = settings.bay_min_overlap
    # A spacing / bay problem must persist this long before it counts (filters
    # a car still straightening up, or a neighbour's track flickering).
    rule_hold_s: float = settings.rule_hold_s
    plate_every_n_frames: int = 6
    plate_max_attempts: int = 25


class JobRequest(BaseModel):
    job_id: str
    video_id: str
    video_path: str
    # Explicit, not sniffed from the URL: an uploaded file can itself be served
    # over http(s) when deployed (backend and detector on separate hosts, no
    # shared disk), which looks identical to a live camera URL otherwise. The
    # caller (Node) knows which one it actually is - let it say so, rather than
    # the detector guessing from the scheme and treating a finished upload as a
    # dropped camera feed that needs reconnecting forever.
    is_live: bool | None = None
    zones: list[ZoneIn]
    params: JobParams = JobParams()
