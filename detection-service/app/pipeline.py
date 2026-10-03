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
from app.source import is_live_source, open_capture
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
        is_live = is_live_source(req.video_path)
        # Tell the backend "I'm alive and starting" straight away - opening the video
        # and loading the model can take anywhere from one to thirty seconds (first
        # run downloads weights), and without this the dashboard sees nothing at all
        # until the first real progress tick, which looks identical to "broken".
        self.client.send({"type": "job_progress", "jobId": req.job_id, "videoId": req.video_id,
                          "progress": 0.0})
        try:
            cap = open_capture(req.video_path)
            if not cap.isOpened():
                raise RuntimeError(f"Cannot open video source: {req.video_path}")
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total = 0 if is_live else int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
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
                    if is_live and self._reconnect(cap, req.video_path):
                        cap = self._last_cap
                        continue
                    break  # end of an uploaded file, or a camera that would not reconnect
                frame_no += 1
                if frame_no % p.frame_stride:
                    continue
                t = frame_no / fps

                detections = detector.track(frame)
                if reader:
                    # Read plates against last frame's boxes *before* updating state, so a
                    # freshly-matched plate is already attached when this frame's session
                    # events (session_updated / violation) are built below - no extra pass needed.
                    self._read_plates(manager, reader, frame, frame_no)
                events = manager.update(t, detections)

                annotated = self._annotate(frame, zones, manager, t)
                for ev in events:
                    self._emit(ev, t, frame)
                self._publish_frame(annotated)

                # First real frame: confirms processing has actually begun (not just
                # "alive"), so the UI can move from "starting" to a real progress state.
                # After that, a tick every 2 video-seconds - for a live camera there's
                # no `total`, so this is the only progress signal it ever gets.
                if frame_no == 1 or t - last_progress >= 2:
                    last_progress = t
                    self.progress = min(99.0, 100.0 * frame_no / total) if total else 0.0
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

    def _reconnect(self, cap, source: str, attempts: int = 10, delay_s: float = 2.0) -> bool:
        """A live camera can drop out (network blip, camera reboot) without the job
        itself ending - unlike an uploaded file, where a failed read just means the
        video is over. Retries a few times before giving up and failing the job."""
        cap.release()
        for attempt in range(1, attempts + 1):
            if self._stop:
                return False
            log.warning("camera feed lost, reconnect attempt %d/%d", attempt, attempts)
            time.sleep(delay_s)
            new_cap = open_capture(source)
            if new_cap.isOpened():
                log.info("camera feed reconnected")
                self._last_cap = new_cap
                return True
        return False

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
        # Evidence captured at each stage of a session, requested for BOTH legal
        # parking and no-parking: an entry photo (session_started), a close-up at
        # the moment a violation is confirmed (violation), and an exit photo
        # (session_ended) - so every record has "parked at / left at" proof, not
        # just a timestamp.
        if frame is not None:
            color = RED if ev.kind == "violation" else (TEAL if not ev.session.zone.is_restricted else AMBER)
            snap = self._crop_snapshot(frame, ev.session.bbox, color)
            if ev.kind == "session_started":
                payload["entrySnapshot"] = snap
            elif ev.kind == "violation":
                payload["violationSnapshot"] = snap
            elif ev.kind == "session_ended":
                payload["exitSnapshot"] = snap
        self.client.send(payload)

    @staticmethod
    def _crop_snapshot(frame, bbox, color) -> str:
        img = frame.copy()
        x1, y1, x2, y2 = bbox
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 3)
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