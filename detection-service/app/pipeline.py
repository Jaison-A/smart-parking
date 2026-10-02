"""One detection job = one video (or, later, one camera stream) from start to finish."""
import base64
import logging
import time
from datetime import datetime, timedelta, timezone

import cv2

from app.config import settings
from app.detector import VehicleDetector
from app.events import EventClient
from app.schemas import JobRequest
from app.sessions import Event, ParkingSession, SessionManager
from app.zones import build_zones, draw_zones

log = logging.getLogger("pipeline")

GRAY, TEAL, AMBER, RED = (170, 170, 170), (110, 124, 14), (11, 158, 245), (57, 40, 198)


class DetectionJob:
    def __init__(self, req: JobRequest, client: EventClient):
        self.req = req
        self.client = client
        self.status = "queued"  # queued | running | completed | failed | stopped
        self.progress = 0.0
        self.error: str | None = None
        self.latest_jpeg: bytes | None = None  # for the live MJPEG stream
        self._stop = False
        self._wall_start = datetime.now(timezone.utc)

    def stop(self) -> None:
        self._stop = True

    # ------------------------------------------------------------------ run
    def run(self, on_frame=None) -> None:
        """Process the whole video. `on_frame(annotated)` may return False to abort (CLI preview)."""
        req, p = self.req, self.req.params
        self.status = "running"
        try:
            cap = cv2.VideoCapture(req.video_path)
            if not cap.isOpened():
                raise RuntimeError(f"Cannot open video: {req.video_path}")
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
            width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            zones = build_zones(req.zones, width, height)
            detector = VehicleDetector()
            manager = SessionManager(zones, p)
            reader = self._make_plate_reader()
            log.info("job %s started: %dx%d @ %.1ffps, %d zones", req.job_id, width, height, fps, len(zones))

            frame_no, t, last_progress = 0, 0.0, 0.0
            while not self._stop:
                ok, frame = cap.read()
                if not ok:
                    break
                frame_no += 1
                if frame_no % p.frame_stride:
                    continue
                t = frame_no / fps

                events = manager.update(t, detector.track(frame))
                if reader:
                    self._read_plates(manager, reader, frame, frame_no)
                    events += manager.update(t, [])  # flush plate updates immediately

                annotated = self._annotate(frame, zones, manager, t)
                for ev in events:
                    self._emit(ev, t, frame)
                self._publish_frame(annotated)

                if total and t - last_progress >= 2:
                    last_progress, self.progress = t, min(99.0, 100.0 * frame_no / total)
                    self.client.send({"type": "job_progress", "jobId": req.job_id,
                                      "videoId": req.video_id, "progress": round(self.progress, 1)})
                if on_frame and on_frame(annotated) is False:
                    self._stop = True

            for ev in manager.finish(t):
                self._emit(ev, t, None)
            cap.release()

            self.status = "stopped" if self._stop else "completed"
            self.progress = 100.0 if self.status == "completed" else self.progress
            self.client.send({"type": "job_finished", "jobId": req.job_id, "videoId": req.video_id,
                              "status": self.status})
        except Exception as exc:  # noqa: BLE001 - report every failure to the backend
            log.exception("job %s failed", req.job_id)
            self.status, self.error = "failed", str(exc)
            self.client.send({"type": "job_failed", "jobId": req.job_id, "videoId": req.video_id,
                              "error": str(exc)})
        finally:
            self.client.close()

    # ------------------------------------------------------------- plate OCR
    @staticmethod
    def _make_plate_reader():
        if not settings.plate_ocr_enabled:
            return None
        from app.plates import PlateReader
        return PlateReader(settings.plate_regex, settings.plate_model)

    def _read_plates(self, manager: SessionManager, reader, frame, frame_no: int) -> None:
        p = self.req.params
        for st in manager.plate_candidates():
            # Stagger tracks so we never OCR every vehicle on the same frame.
            if (frame_no + st.track_id) % p.plate_every_n_frames:
                continue
            st.votes.add(reader.read(frame, st.bbox))
            best = st.votes.best()
            if best:
                manager.set_plate(st, *best)

    # ------------------------------------------------------------- events out
    def _iso(self, video_seconds: float) -> str:
        return (self._wall_start + timedelta(seconds=video_seconds)).isoformat()

    def _session_dict(self, s: ParkingSession, t: float) -> dict:
        return {
            "sessionId": s.id, "trackId": s.track_id,
            "zoneId": s.zone.id, "zoneName": s.zone.name, "zoneType": s.zone.type,
            "vehicleType": s.vehicle_type, "plate": s.plate,
            "plateConfidence": round(s.plate_confidence, 2) if s.plate_confidence else None,
            "startedAt": self._iso(s.started_at),
            "endedAt": self._iso(s.ended_at) if s.ended_at is not None else None,
            "durationSeconds": round(s.duration(t), 1),
        }

    def _emit(self, ev: Event, t: float, frame) -> None:
        payload = {"type": ev.kind, "jobId": self.req.job_id, "videoId": self.req.video_id,
                   "session": self._session_dict(ev.session, t)}
        if ev.reason:
            payload["reason"] = ev.reason
        if ev.kind == "violation" and frame is not None:
            payload["snapshot"] = self._snapshot(frame, ev.session)
        self.client.send(payload)

    @staticmethod
    def _snapshot(frame, s: ParkingSession) -> str:
        img = frame.copy()
        x1, y1, x2, y2 = s.bbox
        cv2.rectangle(img, (x1, y1), (x2, y2), RED, 3)
        if img.shape[1] > 1280:
            scale = 1280 / img.shape[1]
            img = cv2.resize(img, None, fx=scale, fy=scale)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 82])
        return base64.b64encode(buf.tobytes()).decode() if ok else ""

    # ------------------------------------------------------------- drawing
    def _annotate(self, frame, zones, manager: SessionManager, t: float):
        img = frame.copy()
        draw_zones(img, zones)
        for st in manager.tracks.values():
            if st.last_seen != t:
                continue  # not visible in this frame
            x1, y1, x2, y2 = st.bbox
            s = st.session
            if s is None:
                cv2.rectangle(img, (x1, y1), (x2, y2), GRAY, 1)
                continue
            color = TEAL if not s.zone.is_restricted else (RED if s.violation_emitted else AMBER)
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 3)
            secs = int(s.duration(t))
            label = f"{s.plate or 'reading plate'}  {secs // 60:02d}:{secs % 60:02d}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            cv2.rectangle(img, (x1, y1 - th - 10), (x1 + tw + 8, y1), color, -1)
            cv2.putText(img, label, (x1 + 4, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                        (255, 255, 255), 2, cv2.LINE_AA)
        return img

    def _publish_frame(self, img) -> None:
        h, w = img.shape[:2]
        if w > 960:
            img = cv2.resize(img, (960, int(h * 960 / w)))
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if ok:
            self.latest_jpeg = buf.tobytes()
