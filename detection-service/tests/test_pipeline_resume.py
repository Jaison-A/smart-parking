"""The real DetectionJob loop on a generated video, with a stand-in detector - checks that a
resumed job starts from the saved frame and takes the old parked-vehicle session over."""
import sys
import types

import cv2
import numpy as np
import pytest

sys.modules.setdefault("ultralytics", types.SimpleNamespace(YOLO=object))

import app.pipeline as pipeline
from app.pipeline import DetectionJob
from app.schemas import JobParams, JobRequest, ResumeSession, ResumeState, ZoneIn

FPS, FRAMES, W, H = 10, 100, 320, 240
CAR_BBOX = (100, 100, 160, 140)


class FakeClient:
    def __init__(self):
        self.sent = []

    def send(self, event):
        self.sent.append(event)

    def close(self):
        pass


class FakeDetector:
    """Sees one stationary car in every frame it is given."""
    instances = []

    def __init__(self, *a, **k):
        self.frames_seen = 0
        FakeDetector.instances.append(self)

    def track(self, frame):
        self.frames_seen += 1
        return [{"track_id": 1, "class_name": "car", "confidence": 0.9, "bbox": CAR_BBOX}]


@pytest.fixture
def video(tmp_path):
    path = str(tmp_path / "clip.mp4")
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    if not writer.isOpened():
        pytest.skip("this OpenCV build cannot write mp4 files")
    for i in range(FRAMES):
        writer.write(np.full((H, W, 3), 60 + i % 100, np.uint8))
    writer.release()
    return path


@pytest.fixture(autouse=True)
def stand_ins(monkeypatch):
    FakeDetector.instances = []
    monkeypatch.setattr(pipeline, "VehicleDetector", FakeDetector)
    monkeypatch.setattr(DetectionJob, "_make_plate_reader", staticmethod(lambda: None))


def request(video, resume=None):
    zone = ZoneIn(id="N", name="Gate", type="no_parking", points=[(0.2, 0.3), (0.7, 0.3), (0.7, 0.8), (0.2, 0.8)])
    params = JobParams(frame_stride=2, no_parking_threshold_s=3, min_session_s=1, stationary_window_s=1,
                       heartbeat_s=1, plate_wait_s=0)
    return JobRequest(job_id="j", video_id="v", video_path=video, is_live=False, zones=[zone],
                      params=params, resume=resume)


def run(req):
    client = FakeClient()
    job = DetectionJob(req, client)
    job.run()
    return job, client


def test_a_fresh_job_processes_the_whole_video(video):
    job, client = run(request(video))
    assert job.status == "completed"
    assert 40 <= FakeDetector.instances[0].frames_seen <= 52      # ~half of 100 frames (stride 2)


def test_a_resumed_job_starts_from_the_saved_frame_not_from_zero(video):
    resume = ResumeState(frame_no=60, sessions=[])
    job, client = run(request(video, resume))
    assert job.status == "completed"
    assert FakeDetector.instances[0].frames_seen <= 24            # only the last ~40 frames, not all 100
    progress = [e["progress"] for e in client.sent if e["type"] == "job_progress" and isinstance(e["progress"], (int, float)) and e["progress"] > 0]
    assert progress and min(progress) >= 60                       # progress continues from 60%, not from 0


def test_the_old_session_is_taken_over_so_there_is_no_second_session_or_fine(video):
    old = ResumeSession(session_id="old-session", zone_id="N", started_at=0.5, bbox=CAR_BBOX,
                        violation_emitted=True, violation_kind="no_parking")
    job, client = run(request(video, ResumeState(frame_no=50, sessions=[old])))
    assert job.status == "completed"
    types_ = [e["type"] for e in client.sent]
    assert "session_started" not in types_                        # it did not start a NEW session
    assert "violation" not in types_                              # and it was already fined before the loss
    ids = {e["session"]["sessionId"] for e in client.sent if "session" in e}
    assert ids == {"old-session"}


def test_a_session_not_yet_fined_becomes_a_violation_after_resuming(video):
    old = ResumeSession(session_id="old-session", zone_id="N", started_at=0.0, bbox=CAR_BBOX)
    job, client = run(request(video, ResumeState(frame_no=50, sessions=[old])))
    violations = [e for e in client.sent if e["type"] == "violation"]
    assert len(violations) == 1 and violations[0]["session"]["sessionId"] == "old-session"


def test_progress_events_carry_a_checkpoint_the_backend_can_save(video):
    job, client = run(request(video))
    checkpoints = [e["checkpoint"] for e in client.sent if e.get("checkpoint")]
    assert checkpoints, "no checkpoint was ever sent"
    last = checkpoints[-1]
    assert last["frame_no"] > 0 and last["wall_start"]
    # It must be valid input for a resume
    ResumeState(**last)


# ------------------------------------------------------------------ pausing
class PausingDetector(FakeDetector):
    """Asks the job to pause after a few frames - like a user clicking Pause mid-run."""
    job = None
    pause_after = 12

    def track(self, frame):
        out = super().track(frame)
        if self.frames_seen == PausingDetector.pause_after:
            PausingDetector.job.pause()
        return out


def run_with_pause(video, pause_after=12, resume=None):
    PausingDetector.pause_after = pause_after
    pipeline.VehicleDetector = PausingDetector
    client = FakeClient()
    job = DetectionJob(request(video, resume), client)
    PausingDetector.job = job
    job.run()
    return job, client


@pytest.fixture
def pausing(monkeypatch):
    monkeypatch.setattr(pipeline, "VehicleDetector", PausingDetector)
    FakeDetector.instances = []


def test_pausing_keeps_the_parked_vehicles_open_and_leaves_a_checkpoint(video, pausing):
    job, client = run_with_pause(video, pause_after=20)
    assert job.status == "paused"
    kinds = [e["type"] for e in client.sent]
    assert "job_finished" not in kinds, "a paused job is not a finished one"
    assert "session_ended" not in kinds, "pausing must not close any session"
    cp = job.checkpoint
    assert cp and cp["frame_no"] > 0 and cp["wall_start"]
    assert len(cp["sessions"]) == 1 and cp["sessions"][0]["zone_id"] == "N"   # the parked car is carried along
    ResumeState(**cp)                                                           # and it is valid resume input


def test_pausing_stops_early_and_does_not_run_to_the_end(video, pausing):
    job, client = run_with_pause(video, pause_after=10)
    assert FakeDetector.instances[0].frames_seen <= 12          # stopped promptly, not after all ~50 frames


def test_a_paused_job_resumes_where_it_left_off_and_does_not_start_a_second_session(video, pausing):
    first, c1 = run_with_pause(video, pause_after=20)
    saved = ResumeState(**first.checkpoint)
    started_first = [e for e in c1.sent if e["type"] == "session_started"]
    assert len(started_first) == 1
    original_id = started_first[0]["session"]["sessionId"]

    PausingDetector.pause_after = 10**9                              # never pause again
    FakeDetector.instances = []
    client2 = FakeClient()
    second = DetectionJob(request(video, saved), client2)
    PausingDetector.job = second
    second.run()
    assert second.status == "completed"
    assert "session_started" not in [e["type"] for e in client2.sent], "the parked car must not get a second session"
    ids = {e["session"]["sessionId"] for e in client2.sent if "session" in e}
    assert ids == {original_id}                                       # same session carried on
    assert FakeDetector.instances[0].frames_seen < 40               # it did not start over from frame 0


def test_a_job_paused_before_it_does_any_work_still_has_a_usable_checkpoint(video, pausing):
    job = DetectionJob(request(video), FakeClient())
    job.pause()                                                       # pause requested before the loop starts
    job.run()
    assert job.status == "paused" and job.checkpoint["frame_no"] == 0
