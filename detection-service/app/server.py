"""FastAPI wrapper: the Node backend starts jobs here and the dashboard watches the live stream."""
import logging
import threading
import time
from pathlib import Path

import cv2
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from app.config import settings
from app.events import EventClient
from app.pipeline import DetectionJob
from app.schemas import JobRequest

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = FastAPI(title="Curbside detection service")
jobs: dict[str, DetectionJob] = {}


def require_key(x_detector_key: str = Header(default="")) -> None:
    if x_detector_key != settings.api_key:
        raise HTTPException(401, "Invalid detector key")


def safe_video_path(raw: str) -> Path:
    """Only files inside VIDEO_ROOT may be opened - never trust a path from a request."""
    path = Path(raw).resolve()
    if settings.video_root not in path.parents or not path.is_file():
        raise HTTPException(400, "Video not found inside the allowed video folder")
    return path


@app.get("/health")
def health():
    return {"ok": True, "jobs": {k: j.status for k, j in jobs.items()}}


@app.post("/jobs", status_code=202, dependencies=[Depends(require_key)])
def start_job(req: JobRequest):
    if any(j.status in ("queued", "running") for j in jobs.values()):
        raise HTTPException(409, "A detection job is already running")
    req.video_path = str(safe_video_path(req.video_path))
    job = DetectionJob(req, EventClient(settings.backend_url, settings.api_key))
    jobs[req.job_id] = job
    threading.Thread(target=job.run, daemon=True, name=f"job-{req.job_id}").start()
    return {"jobId": req.job_id, "status": job.status}


@app.get("/jobs/{job_id}", dependencies=[Depends(require_key)])
def job_status(job_id: str):
    job = jobs.get(job_id) or _404()
    return {"jobId": job_id, "status": job.status, "progress": job.progress, "error": job.error}


@app.post("/jobs/{job_id}/stop", dependencies=[Depends(require_key)])
def stop_job(job_id: str):
    (jobs.get(job_id) or _404()).stop()
    return {"jobId": job_id, "stopping": True}


@app.get("/jobs/{job_id}/stream")
def stream(job_id: str):
    """Live annotated video as MJPEG - drop it straight into an <img src>."""
    job = jobs.get(job_id) or _404()

    def frames():
        last = None
        while True:
            jpeg = job.latest_jpeg
            if jpeg is not None and jpeg is not last:
                last = jpeg
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
            elif job.status not in ("queued", "running"):
                return
            else:
                time.sleep(0.03)

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/frame", dependencies=[Depends(require_key)])
def first_frame(path: str = Query(...)):
    """A still frame used by the dashboard's zone-drawing tool."""
    cap = cv2.VideoCapture(str(safe_video_path(path)))
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise HTTPException(422, "Could not read a frame from this video")
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return Response(buf.tobytes(), media_type="image/jpeg")


def _404():
    raise HTTPException(404, "Unknown job")
