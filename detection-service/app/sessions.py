"""Parking-session logic. Pure Python (no video, no network) so it is easy to test.

Lifecycle of one vehicle:
  1. ByteTrack gives the vehicle a stable track id.
  2. When it stops (barely moves) inside a zone for `min_session_s`, a session opens.
     The session start is back-dated to the moment it actually stopped.
  3. Inside a no-parking zone, once the session passes `no_parking_threshold_s`
     a violation is raised (once per session).
  4. The session closes when the vehicle drives off, leaves the zone, or its track is lost.

Two further rules apply to vehicles parked in a (legal) parking zone; a session
raises at most ONE violation in total, whichever rule trips first:
  * spacing - a vehicle that parks side by side with an already-parked vehicle,
    closer than `min_gap_ratio` of its width, is flagged (the later arrival is the
    one at fault). Only vehicles in the same row are compared, so a car merely
    hidden behind another in the camera view is not mistaken for a neighbour.
  * bays    - if bays are drawn, a parked vehicle is allocated the bay its ground
    footprint sits in. It is flagged if it straddles the bay lines, or if another
    vehicle already holds that bay.
"""
import uuid
from collections import deque
from dataclasses import dataclass, field

from app.plates import PlateVote
from app.schemas import JobParams
from app.zones import Zone, find_zone

# Bottom share of a vehicle's box treated as its ground "footprint" for bay checks.
FOOTPRINT_FRACTION = 0.4
# Below this overlap a vehicle isn't considered to be in a bay at all.
BAY_ASSIGN_MIN = 0.15


@dataclass(eq=False)
class ParkingSession:
    id: str
    track_id: int
    zone: Zone
    vehicle_type: str
    started_at: float  # video seconds
    ended_at: float | None = None
    plate: str | None = None
    plate_confidence: float | None = None
    bbox: tuple = (0, 0, 0, 0)
    violation_emitted: bool = False
    violation_kind: str = "no_parking"  # no_parking | spacing | bay_straddle | bay_occupied
    violation_detail: str | None = None
    bay_name: str | None = None
    rule_kind: str | None = None  # rule currently being tripped, and since when
    rule_since: float | None = None
    plate_dirty: bool = False
    info_dirty: bool = False  # something other than the plate changed (e.g. its bay)
    last_heartbeat: float = 0.0

    def duration(self, now: float) -> float:
        return max(0.0, (self.ended_at if self.ended_at is not None else now) - self.started_at)


@dataclass
class Event:
    kind: str  # session_started | session_updated | session_ended | violation
    session: ParkingSession
    reason: str | None = None


@dataclass(eq=False)
class TrackState:
    track_id: int
    first_seen: float
    last_seen: float
    vehicle_type: str = "car"
    bbox: tuple = (0, 0, 0, 0)
    history: deque = field(default_factory=deque)  # (t, x, y)
    zone: Zone | None = None
    zone_since: float | None = None
    outside_since: float | None = None
    stationary_since: float | None = None
    moving_since: float | None = None
    session: ParkingSession | None = None
    votes: PlateVote | None = None
    bay: Zone | None = None  # bay this vehicle currently sits in
    bay_overlap: float = 0.0


class SessionManager:
    def __init__(self, zones: list[Zone], params: JobParams):
        self.zones = [z for z in zones if not z.is_bay]
        self.bays = [z for z in zones if z.is_bay]
        self.p = params
        self.tracks: dict[int, TrackState] = {}

    # ------------------------------------------------------------------ public
    def update(self, t: float, detections: list[dict]) -> list[Event]:
        events: list[Event] = []
        seen: set[int] = set()
        for det in detections:
            tid = det["track_id"]
            seen.add(tid)
            st = self.tracks.get(tid)
            if st is None:
                st = self.tracks[tid] = TrackState(
                    tid, first_seen=t, last_seen=t,
                    votes=PlateVote(max_attempts=self.p.plate_max_attempts),
                )
            events += self._step(st, det, t)
        events += self._check_rules(t)
        events += self._sweep(t, seen)
        return events

    def finish(self, t: float) -> list[Event]:
        """Call when the video ends: close every open session."""
        events: list[Event] = []
        for st in list(self.tracks.values()):
            events += self._close(st, t, "video_end")
        self.tracks.clear()
        return events

    def plate_candidates(self) -> list[TrackState]:
        """Parked vehicles whose plate we are still trying to read."""
        return [s for s in self.tracks.values() if s.session and not s.votes.locked]

    def set_plate(self, st: TrackState, plate: str, confidence: float) -> None:
        s = st.session
        if s and s.plate != plate:
            s.plate, s.plate_confidence, s.plate_dirty = plate, confidence, True

    # ---------------------------------------------------------------- internals
    def _step(self, st: TrackState, det: dict, t: float) -> list[Event]:
        p = self.p
        events: list[Event] = []
        x1, y1, x2, y2 = det["bbox"]
        foot = ((x1 + x2) / 2, float(y2))  # where the vehicle touches the ground

        st.last_seen, st.bbox, st.vehicle_type = t, det["bbox"], det["class_name"]
        st.history.append((t, foot[0], foot[1]))
        while st.history and st.history[0][0] < t - 2 * p.stationary_window_s:
            st.history.popleft()

        # ---- which zone is the vehicle in? (with a grace period at the border)
        zone = find_zone(self.zones, foot)
        if zone is not None:
            st.outside_since = None
            if st.zone is None or st.zone.id != zone.id:
                events += self._close(st, t, "changed_zone")
                st.zone, st.zone_since = zone, t
        elif st.zone is not None:
            if st.outside_since is None:
                st.outside_since = t
            if t - st.outside_since >= p.exit_grace_s:
                events += self._close(st, st.outside_since, "left_zone")
                st.zone = st.zone_since = st.stationary_since = None

        # ---- is the vehicle parked (stationary)?
        if self._is_stationary(st, x2 - x1, t):
            st.moving_since = None
            if st.stationary_since is None:
                st.stationary_since = max(t - p.stationary_window_s, st.first_seen)
        else:
            if st.moving_since is None:
                st.moving_since = t
            if st.stationary_since is not None and t - st.moving_since >= p.moving_grace_s:
                events += self._close(st, st.moving_since, "moved_away")
                st.stationary_since = None

        # ---- open a session once it has been parked long enough
        if (st.session is None and st.zone is not None and st.stationary_since is not None
                and t - st.stationary_since >= p.min_session_s):
            started = max(st.stationary_since, st.zone_since)
            st.session = ParkingSession(
                id=uuid.uuid4().hex, track_id=st.track_id, zone=st.zone,
                vehicle_type=st.vehicle_type, started_at=started,
                last_heartbeat=t, bbox=st.bbox,
            )
            events.append(Event("session_started", st.session))

        # ---- running session: violation check + periodic updates
        s = st.session
        if s is not None:
            s.bbox = st.bbox
            duration = s.duration(t)
            if self._violation_due(s, duration):
                s.violation_emitted = True
                s.last_heartbeat, s.plate_dirty = t, False
                events.append(Event("violation", s))
            elif s.plate_dirty or s.info_dirty or t - s.last_heartbeat >= p.heartbeat_s:
                s.last_heartbeat, s.plate_dirty, s.info_dirty = t, False, False
                events.append(Event("session_updated", s))
        return events

    # ------------------------------------------------- spacing and bay rules
    def _check_rules(self, t: float) -> list[Event]:
        p = self.p
        parked = [st for st in self.tracks.values()
                  if st.session is not None and st.last_seen == t
                  and not st.session.zone.is_restricted]
        if not parked:
            return []

        # 1. Allocate each parked vehicle to the bay its footprint overlaps most.
        occupants: dict[str, list[TrackState]] = {}
        for st in parked:
            st.bay, st.bay_overlap = self._allocate_bay(st.bbox)
            name = st.bay.name if st.bay else None
            if st.session.bay_name != name:
                st.session.bay_name, st.session.info_dirty = name, True
            if st.bay is not None and st.bay_overlap >= p.bay_min_overlap:
                occupants.setdefault(st.bay.id, []).append(st)

        # 2. What, if anything, is each vehicle doing wrong right now?
        problems: dict[int, tuple[str, str]] = {}
        for st in parked:
            if st.bay is not None:
                if st.bay_overlap < p.bay_min_overlap:
                    problems[st.track_id] = ("bay_straddle", f"Not parked inside a single bay ({st.bay.name})")
            elif p.min_gap_ratio > 0 and self._too_close(st, parked):
                problems[st.track_id] = ("spacing", "Parked too close to another vehicle")
        for group in occupants.values():
            group.sort(key=lambda s_: (s_.session.started_at, s_.track_id))
            for later in group[1:]:  # first to arrive keeps the bay
                problems[later.track_id] = ("bay_occupied", f"{later.bay.name} is already occupied by another vehicle")

        # 3. A problem must persist for rule_hold_s before it becomes a violation.
        events: list[Event] = []
        for st in parked:
            s = st.session
            problem = problems.get(st.track_id)
            if problem is None:
                s.rule_kind = s.rule_since = None
                continue
            kind, detail = problem
            if s.rule_kind != kind:
                s.rule_kind, s.rule_since = kind, t
            if not s.violation_emitted and t - s.rule_since >= p.rule_hold_s:
                s.violation_emitted, s.violation_kind, s.violation_detail = True, kind, detail
                s.last_heartbeat, s.plate_dirty = t, False
                events.append(Event("violation", s))
        return events

    def _allocate_bay(self, bbox: tuple) -> tuple[Zone | None, float]:
        if not self.bays:
            return None, 0.0
        x1, y1, x2, y2 = bbox
        footprint = (x1, int(y2 - (y2 - y1) * FOOTPRINT_FRACTION), x2, y2)
        best, best_f = None, 0.0
        for bay in self.bays:
            f = bay.overlap_fraction(footprint)
            if f > best_f:
                best, best_f = bay, f
        return (best, best_f) if best_f >= BAY_ASSIGN_MIN else (None, 0.0)

    def _too_close(self, st: TrackState, parked: list[TrackState]) -> bool:
        """True if `st` sits side by side with an EARLIER-parked vehicle in the same
        zone, with a gap narrower than min_gap_ratio of the narrower vehicle."""
        a, s = st.bbox, st.session
        for other in parked:
            o = other.session
            if other is st or o.zone.id != s.zone.id:
                continue
            if (o.started_at, other.track_id) >= (s.started_at, st.track_id):
                continue  # the later arrival is the one at fault, not the first
            b = other.bbox
            same_row = min(a[3], b[3]) - max(a[1], b[1]) >= 0.5 * min(a[3] - a[1], b[3] - b[1])
            if not same_row:
                continue
            gap = max(a[0], b[0]) - min(a[2], b[2])  # negative when the boxes overlap
            if gap < self.p.min_gap_ratio * min(a[2] - a[0], b[2] - b[0]):
                return True
        return False

    def _violation_due(self, s: ParkingSession, duration: float) -> bool:
        if not s.zone.is_restricted or s.violation_emitted:
            return False
        if duration < self.p.no_parking_threshold_s:
            return False
        # Give OCR a few extra seconds to find the plate before fining without one.
        return s.plate is not None or duration >= self.p.no_parking_threshold_s + self.p.plate_wait_s

    def _is_stationary(self, st: TrackState, width: float, t: float) -> bool:
        p = self.p
        if t - st.history[0][0] < p.stationary_window_s:
            return False  # not enough history yet
        pts = [(x, y) for (ht, x, y) in st.history if ht >= t - p.stationary_window_s]
        xs, ys = [q[0] for q in pts], [q[1] for q in pts]
        return max(max(xs) - min(xs), max(ys) - min(ys)) <= p.stationary_ratio * max(width, 1)

    def _close(self, st: TrackState, ended_at: float, reason: str) -> list[Event]:
        s = st.session
        if s is None:
            return []
        events: list[Event] = []
        s.ended_at = max(ended_at, s.started_at)
        # A vehicle that left just after the threshold must still be fined.
        if s.zone.is_restricted and not s.violation_emitted \
                and s.duration(s.ended_at) >= self.p.no_parking_threshold_s:
            s.violation_emitted = True
            events.append(Event("violation", s))
        events.append(Event("session_ended", s, reason))
        st.session = None
        return events

    def _sweep(self, t: float, seen: set[int]) -> list[Event]:
        """Drop tracks that disappeared; close their sessions after a grace period."""
        events: list[Event] = []
        for tid, st in list(self.tracks.items()):
            if tid not in seen and t - st.last_seen >= self.p.lost_grace_s:
                events += self._close(st, st.last_seen, "track_lost")
                del self.tracks[tid]
        return events
