"""Spacing and bay-parking rules - pure logic, no video or model needed."""
from app.schemas import JobParams, ZoneIn
from app.sessions import SessionManager
from app.zones import build_zones

W, H = 800, 600


def zones(with_bays=False):
    z = [ZoneIn(id="P", name="Parking", type="parking",
                points=[(0.65, 0.5), (0.95, 0.5), (0.95, 0.9), (0.65, 0.9)])]
    if with_bays:
        # Two side-by-side bays: x 520-600 and x 610-690, y 380-450 (pixels).
        for i, (x0, x1) in enumerate([(520, 600), (610, 690)], start=1):
            z.append(ZoneIn(id=f"B{i}", name=f"Bay {i}", type="bay",
                            points=[(x0 / W, 380 / H), (x1 / W, 380 / H), (x1 / W, 450 / H), (x0 / W, 450 / H)]))
    return build_zones(z, W, H)


def car(tid, cx, cy=420, w=60, h=40):
    return {"track_id": tid, "class_name": "car", "confidence": 0.9,
            "bbox": (cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)}


def params(**over):
    base = dict(no_parking_threshold_s=30, stationary_window_s=2, min_session_s=5,
                moving_grace_s=3, exit_grace_s=2, lost_grace_s=5, plate_wait_s=0,
                heartbeat_s=5, plate_every_n_frames=1, plate_max_attempts=1,
                min_gap_ratio=0.25, bay_min_overlap=0.5, rule_hold_s=5)
    base.update(over)
    return JobParams(**base)


def run(mgr, cars_at, until=45, step=0.5):
    """cars_at: {track_id: (cx, cy, arrives_at)}. Returns every event."""
    events, t = [], 0.0
    while t <= until:
        dets = [car(tid, cx, cy) for tid, (cx, cy, arrive) in cars_at.items() if t >= arrive]
        events += mgr.update(t, dets)
        t += step
    return events


def violations(events):
    return [e for e in events if e.kind == "violation"]


class TestSpacing:
    def test_later_arrival_parked_too_close_is_flagged(self):
        mgr = SessionManager(zones(), params())
        # Car 1 box 530-590; car 2 box 596-656 -> 6px gap, limit is 0.25*60 = 15px.
        ev = violations(run(mgr, {1: (560, 420, 0), 2: (626, 420, 10)}))
        assert len(ev) == 1
        assert ev[0].session.track_id == 2          # the later arrival, not car 1
        assert ev[0].session.violation_kind == "spacing"

    def test_enough_gap_is_fine(self):
        mgr = SessionManager(zones(), params())
        # 40px gap, well over the 15px limit.
        assert not violations(run(mgr, {1: (560, 420, 0), 2: (660, 420, 10)}))

    def test_vehicle_behind_another_is_not_a_neighbour(self):
        mgr = SessionManager(zones(), params())
        # Same x-range, different rows (one further up the lot): not side by side.
        assert not violations(run(mgr, {1: (560, 480, 0), 2: (566, 330, 10)}))

    def test_spacing_rule_can_be_switched_off(self):
        mgr = SessionManager(zones(), params(min_gap_ratio=0))
        assert not violations(run(mgr, {1: (560, 420, 0), 2: (626, 420, 10)}))

    def test_brief_closeness_is_ignored(self):
        mgr = SessionManager(zones(), params(rule_hold_s=60))
        assert not violations(run(mgr, {1: (560, 420, 0), 2: (626, 420, 10)}, until=40))


class TestBays:
    def test_vehicle_inside_bay_is_allocated_it_and_not_flagged(self):
        mgr = SessionManager(zones(with_bays=True), params())
        ev = run(mgr, {1: (560, 420, 0)})
        assert not violations(ev)
        assert mgr.tracks[1].session.bay_name == "Bay 1"

    def test_vehicle_straddling_the_bay_line_is_flagged(self):
        mgr = SessionManager(zones(with_bays=True), params())
        # Box 575-635 sits across the line between Bay 1 (520-600) and Bay 2 (610-690):
        # ~42% inside either one, under the 50% needed.
        ev = violations(run(mgr, {1: (605, 420, 0)}))
        assert len(ev) == 1 and ev[0].session.violation_kind == "bay_straddle"

    def test_second_vehicle_in_a_taken_bay_is_flagged(self):
        mgr = SessionManager(zones(with_bays=True), params())
        ev = violations(run(mgr, {1: (560, 420, 0), 2: (550, 420, 10)}))
        assert len(ev) == 1
        assert ev[0].session.track_id == 2
        assert ev[0].session.violation_kind == "bay_occupied"

    def test_neighbours_in_their_own_bays_are_not_flagged_for_spacing(self):
        mgr = SessionManager(zones(with_bays=True), params())
        # Bay 1 box 530-590, Bay 2 box 625-685: each sits inside its own bay.
        assert not violations(run(mgr, {1: (560, 420, 0), 2: (655, 420, 10)}))

    def test_bay_is_not_treated_as_a_parking_zone(self):
        mgr = SessionManager(zones(with_bays=True), params())
        run(mgr, {1: (560, 420, 0)})
        assert mgr.tracks[1].session.zone.id == "P"   # session belongs to the parking zone
