"""Request / parameter models shared by the API and the detection core."""
from typing import Literal

from pydantic import BaseModel, Field


class ZoneIn(BaseModel):
    id: str
    name: str
    type: Literal["parking", "no_parking"]
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
    plate_every_n_frames: int = 6
    plate_max_attempts: int = 25


class JobRequest(BaseModel):
    job_id: str
    video_id: str
    video_path: str
    zones: list[ZoneIn]
    params: JobParams = JobParams()
