"""Run detection on a video from the command line - no backend or dashboard needed.

    python main.py videos/parking.mp4 --zones config/zones.json --show
"""
import argparse
import json
import logging

import cv2

from app.events import EventClient
from app.pipeline import DetectionJob
from app.schemas import JobParams, JobRequest


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(description="Smart illegal parking detection (standalone)")
    ap.add_argument("video")
    ap.add_argument("--zones", default="config/zones.json")
    ap.add_argument("--show", action="store_true", help="preview window (press q to quit)")
    ap.add_argument("--threshold", type=float, default=30.0, help="seconds before a no-parking violation")
    args = ap.parse_args()

    with open(args.zones, encoding="utf-8") as f:
        zones = json.load(f)["zones"]

    req = JobRequest(job_id="cli", video_id="cli", video_path=args.video, zones=zones,
                     params=JobParams(no_parking_threshold_s=args.threshold))
    job = DetectionJob(req, EventClient(None))  # no backend: events are just logged

    def preview(img):
        cv2.imshow("Curbside", img)
        return cv2.waitKey(1) & 0xFF != ord("q")

    job.run(on_frame=preview if args.show else None)
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
