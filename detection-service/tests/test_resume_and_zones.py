"""Resuming a lost job, per-zone spacing, and the bay switch - pure logic, no video or model."""
from app.schemas import JobParams, ResumeSession, ZoneIn
from app.sessions import SessionManager
from app.zones import build_zones

W, H = 800, 600


def zone(id_, type_="parking", **extra):
    return ZoneIn(id=id_, name=id_, type=type_,
                  points=[(0.65, 0.5), (0.95, 0.5), (0.95, 0.9), (0.65, 0.9)], **extra)


def car(tid, cx, cy=420, w=60, h=40):
    return {"track_id": tid, "class_name": "car", "confidence": 0.9,
            "bbox": (cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)}


def params(**over):
    base = dict(no_parking_threshold_s=30, stationary_window_s=2, min_session_s=5,
                moving_grace_s=3, exit_grace_s=2, lost_grace_s=5, plate_wait_s=0,
                heartbeat_s=5, plate_every_n_frames=1, plate_max_attempts=1,
                min_gap_ratio=0.25, bay_min_overlap=0.5, rule_hold_s=5, restore_grace_s=10)
    base.update(over)
    return JobParams(**base)


def run(mgr, cars_at, start=0.0, until=45.0, step=0.5):
    events, t = [], start
    while t <= until:
        dets = [car(tid, cx) for tid, (cx, arrive) in cars_at.items() if t >= arrive]
        events += mgr.update(t, dets)
        t += step
    return events


def kinds(events, kind):
    return [e for e in events if e.kind == kind]


# ------------------------------------------------------------------ resume
def resume_session(**over):
    base = dict(session_id="old-1", zone_id="N", vehicle_type="car", started_at=100.0,
                bbox=(530, 400, 590, 440), plate="TN09AB1234", plate_confidence=0.9)
    base.update(over)
    return ResumeSession(**base)


def test_a_vehicle_that_reappears_takes_its_old_session_over():
    mgr = SessionManager(build_zones([zone("N", "no_parking")], W, H), params())
    mgr.restore([resume_session(violation_emitted=True)], t=200.0)
    ev = run(mgr, {1: (560, 0)}, start=200.0, until=215.0)
    assert not kinds(ev, "session_started")            # no NEW session
    assert not kinds(ev, "violation")                  # already fined before the restart
    taken = kinds(ev, "session_updated")
    assert taken and taken[0].session.id == "old-1"
    assert mgr.tracks[1].session.started_at == 100.0   # parked time carries on
    assert mgr.tracks[1].session.plate == "TN09AB1234"


def test_a_session_whose_vehicle_never_returns_is_closed_after_the_grace_time():
    mgr = SessionManager(build_zones([zone("N", "no_parking")], W, H), params(restore_grace_s=10))
    mgr.restore([resume_session()], t=200.0)
    early = run(mgr, {}, start=200.0, until=205.0)
    assert not kinds(early, "session_ended")           # still waiting for it
    late = run(mgr, {}, start=205.5, until=215.0)
    ended = kinds(late, "session_ended")
    assert len(ended) == 1 and ended[0].session.id == "old-1"


def test_a_vehicle_in_a_different_place_does_not_steal_the_old_session():
    mgr = SessionManager(build_zones([zone("N", "no_parking")], W, H), params())
    mgr.restore([resume_session(bbox=(530, 400, 590, 440))], t=200.0)
    ev = run(mgr, {1: (700, 0)}, start=200.0, until=215.0)   # far from the old spot
    started = kinds(ev, "session_started")
    assert started and started[0].session.id != "old-1"


def test_sessions_in_a_deleted_zone_are_dropped_not_crashed_on():
    mgr = SessionManager(build_zones([zone("N", "no_parking")], W, H), params())
    mgr.restore([resume_session(zone_id="gone")], t=200.0)
    assert mgr.snapshot() == []


def test_a_snapshot_can_be_restored_into_a_fresh_manager():
    zones = build_zones([zone("P")], W, H)
    first = SessionManager(zones, params())
    run(first, {1: (560, 0)}, until=20.0)
    snap = first.snapshot()
    assert len(snap) == 1 and snap[0]["zone_id"] == "P"

    second = SessionManager(build_zones([zone("P")], W, H), params())
    second.restore([ResumeSession(**d) for d in snap], t=21.0)
    ev = run(second, {1: (560, 0)}, start=21.0, until=30.0)
    assert not kinds(ev, "session_started")
    assert second.tracks[1].session.id == snap[0]["session_id"]


def test_unmatched_sessions_survive_in_the_next_snapshot():
    mgr = SessionManager(build_zones([zone("P")], W, H), params())
    mgr.restore([resume_session(zone_id="P")], t=200.0)
    assert [s["session_id"] for s in mgr.snapshot()] == ["old-1"]   # a second restart must not lose it


# ------------------------------------------------------------------ per-zone spacing
def test_a_zone_can_switch_spacing_off():
    mgr = SessionManager(build_zones([zone("P", ignore_spacing=True)], W, H), params())
    # 6 px gap would normally be flagged (limit 15 px)
    assert not kinds(run(mgr, {1: (560, 0), 2: (626, 10)}), "violation")


def test_a_zone_can_use_its_own_gap_ratio():
    # 20 px gap: fine under the default 25% (15 px) but too close under this zone's 50% (30 px)
    strict = SessionManager(build_zones([zone("P", min_gap_ratio=0.5)], W, H), params())
    assert len(kinds(run(strict, {1: (560, 0), 2: (640, 10)}), "violation")) == 1
    default = SessionManager(build_zones([zone("P")], W, H), params())
    assert not kinds(run(default, {1: (560, 0), 2: (640, 10)}), "violation")


def test_a_zone_ratio_of_zero_means_no_spacing_rule_there():
    mgr = SessionManager(build_zones([zone("P", min_gap_ratio=0)], W, H), params())
    assert not kinds(run(mgr, {1: (560, 0), 2: (626, 10)}), "violation")


# ------------------------------------------------------------------ bay switch
def bay_zones():
    bay = ZoneIn(id="B1", name="Bay 1", type="bay",
                 points=[(520 / W, 380 / H), (600 / W, 380 / H), (600 / W, 450 / H), (520 / W, 450 / H)])
    return build_zones([zone("P"), bay], W, H)


def test_bay_rules_on_flag_a_vehicle_straddling_the_bay():
    mgr = SessionManager(bay_zones(), params(bay_rules_enabled=True))
    ev = run(mgr, {1: (610, 0)})        # box 580-640: only a third of it is inside the bay (520-600)
    assert any(e.session.violation_kind == "bay_straddle" for e in kinds(ev, "violation"))


def test_bay_rules_off_ignore_bays_completely():
    mgr = SessionManager(bay_zones(), params(bay_rules_enabled=False))
    ev = run(mgr, {1: (610, 0)})
    assert not kinds(ev, "violation")
    assert mgr.tracks[1].session.bay_name is None
