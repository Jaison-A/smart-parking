"""Unit tests for the session/violation state machine - no video or model needed."""
import numpy as np
import pytest

from app.schemas import JobParams, ZoneIn
from app.sessions import SessionManager
from app.zones import build_zones

W, H = 800, 600


def make_zones():
    return build_zones([
        ZoneIn(id="NP", name="No parking", type="no_parking",
               points=[(0.1, 0.5), (0.6, 0.5), (0.6, 0.9), (0.1, 0.9)]),
        ZoneIn(id="P", name="Parking", type="parking",
               points=[(0.65, 0.5), (0.95, 0.5), (0.95, 0.9), (0.65, 0.9)]),
    ], W, H)


def car(track_id, cx, cy, w=60, h=40):
    return {"track_id": track_id, "class_name": "car", "confidence": 0.9,
            "bbox": (cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)}


def params(**over):
    base = dict(no_parking_threshold_s=30, stationary_window_s=2, min_session_s=5,
                moving_grace_s=3, exit_grace_s=2, lost_grace_s=5, plate_wait_s=0,
                heartbeat_s=5, plate_every_n_frames=1, plate_max_attempts=1)
    base.update(over)
    return JobParams(**base)


def run_stationary(mgr, cx, cy, t_start, t_end, step=0.5):
    events = []
    t = t_start
    while t <= t_end:
        events += mgr.update(t, [car(1, cx, cy)])
        t += step
    return events, t


class TestNoParkingViolation:
    def test_violation_fires_after_threshold_and_plate_wait(self):
        mgr = SessionManager(make_zones(), params())
        events, _ = run_stationary(mgr, 300, 350, 0, 45)
        kinds = [e.kind for e in events]
        assert "session_started" in kinds
        assert "violation" in kinds
        # Only one violation per session.
        assert kinds.count("violation") == 1

    def test_no_violation_before_threshold(self):
        mgr = SessionManager(make_zones(), params())
        events, _ = run_stationary(mgr, 300, 350, 0, 20)
        assert "violation" not in [e.kind for e in events]

    def test_violation_waits_for_plate_before_wait_expires(self):
        mgr = SessionManager(make_zones(), params(plate_wait_s=100))
        events, _ = run_stationary(mgr, 300, 350, 0, 35)
        assert "violation" not in [e.kind for e in events]  # plate never set, wait not expired

    def test_plate_arriving_triggers_violation_immediately(self):
        mgr = SessionManager(make_zones(), params(plate_wait_s=100, no_parking_threshold_s=10))
        run_stationary(mgr, 300, 350, 0, 12)
        st = next(iter(mgr.tracks.values()))
        mgr.set_plate(st, "TN75AB1234", 0.9)
        events = mgr.update(12.5, [car(1, 300, 350)])
        assert "violation" in [e.kind for e in events]


class TestLegalParking:
    def test_no_violation_in_parking_zone(self):
        mgr = SessionManager(make_zones(), params())
        events, _ = run_stationary(mgr, 700, 350, 0, 45)
        assert "violation" not in [e.kind for e in events]
        assert "session_started" in [e.kind for e in events]

    def test_session_tracks_duration(self):
        mgr = SessionManager(make_zones(), params())
        _, t_end = run_stationary(mgr, 700, 350, 0, 20)
        st = next(iter(mgr.tracks.values()))
        assert st.session.duration(t_end) >= 14


class TestMovingVehiclesIgnored:
    def test_passing_through_zone_does_not_open_session(self):
        mgr = SessionManager(make_zones(), params())
        events = []
        for i, t in enumerate([0, 0.5, 1.0, 1.5, 2.0]):
            events += mgr.update(t, [car(1, 200 + i * 60, 350)])
        assert events == []

    def test_stopping_then_driving_off_closes_session_without_violation(self):
        mgr = SessionManager(make_zones(), params())
        run_stationary(mgr, 300, 350, 0, 8)  # session opens (>= min_session_s)
        events = []
        for i, t in enumerate(np.arange(8.5, 14, 0.5)):
            events += mgr.update(t, [car(1, 300 + i * 40, 350)])  # drives away
        assert "session_ended" in [e.kind for e in events]
        assert "violation" not in [e.kind for e in events]


class TestGraceHandling:
    def test_brief_flicker_does_not_reset_stationary_timer(self):
        mgr = SessionManager(make_zones(), params())
        run_stationary(mgr, 300, 350, 0, 10)
        mgr.update(10.5, [])  # one frame missed (lost detection)
        events, _ = run_stationary(mgr, 300, 350, 11, 32)
        assert "violation" in [e.kind for e in events]

    def test_lost_track_closes_session_after_grace(self):
        mgr = SessionManager(make_zones(), params(lost_grace_s=3))
        run_stationary(mgr, 300, 350, 0, 8)
        events = []
        for t in [9, 10, 11, 12]:
            events += mgr.update(t, [])
        assert "session_ended" in [e.kind for e in events]


class TestOneVehiclePerZoneOverlap:
    def test_no_parking_zone_wins_on_overlap(self):
        zones = build_zones([
            ZoneIn(id="P", name="Lot", type="parking",
                   points=[(0.1, 0.5), (0.9, 0.5), (0.9, 0.9), (0.1, 0.9)]),
            ZoneIn(id="NP", name="Kerb strip", type="no_parking",
                   points=[(0.1, 0.5), (0.4, 0.5), (0.4, 0.9), (0.1, 0.9)]),
        ], W, H)
        mgr = SessionManager(zones, params())
        events, _ = run_stationary(mgr, 220, 400, 0, 45)  # inside both polygons
        violations = [e for e in events if e.kind == "violation"]
        assert len(violations) == 1
        assert violations[0].session.zone.id == "NP"


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
