# Curbside — Smart Illegal Parking Detection System

Detects vehicles in video, tracks how long each one is parked, reads its
number plate, and — for restricted zones — notifies a live controller
dashboard and issues a fine automatically. Built for a college mini project;
runs on uploaded video today, and switches to a live camera later by
changing one setting.

## Architecture

```
React dashboard  ──HTTP/Socket.IO──►  Node/Express API  ──HTTP──►  Python FastAPI
(upload, draw zones,                  (auth, uploads,              (YOLO11 + ByteTrack
 live feed, violations,                jobs, fines, DB)             + EasyOCR — your
 fines)                                     │                       original detection
                                             ▼                       code, refactored)
                                          MongoDB
```

The Python service pushes events (`session_started`, `violation`, …) to a
single webhook on the Node backend. The backend stores them, issues fines,
and pushes them to the browser over Socket.IO — no polling needed for live
updates.

## What it does

- **Detects and tracks vehicles** (car / motorcycle / bus / truck) with
  YOLO11 and ByteTrack, so each vehicle keeps one ID across frames.
- **Two zone types**, drawn on a video frame in the browser:
  - `parking` — legal spaces. Every vehicle's plate and parking duration
    is logged, no fine.
  - `no_parking` — restricted areas (including a strip marked no-parking
    right next to a legal lot). Logs plate + duration, pushes an
    **immediate** notification to the dashboard, and **automatically**
    creates a fine.
  - Zones use normalised (0–1) coordinates, so they work at any video
    resolution.
- **Reads number plates** with EasyOCR, voting across several frames
  because a single OCR read is unreliable.
- **Filters out driving-through traffic**: a vehicle only counts as
  "parked" once it barely moves for a few seconds, and short tracking
  flicker doesn't reset its timer.
- **Fine amount** = base + a surcharge per extra 10 minutes over the
  threshold (`backend/src/services/fineService.js`), fully configurable.
- **Uploaded video today, a camera tomorrow**: `VideoCapture` in
  `detection-service/app/pipeline.py` takes a file path now; swapping the
  source for an RTSP URL or webcam index is a one-line change.

## Project layout

```
detection-service/   Python — detection, tracking, plate OCR, FastAPI
backend/              Node — REST API, MongoDB, Socket.IO, fines
frontend/             React — upload, zone drawing, live feed, dashboards
docker-compose.yml    MongoDB only
```

## Requirements

- Python 3.10+, Node.js 18+, MongoDB 6+ (or `docker compose up -d mongo`)
- A GPU is *not* required — everything runs on CPU, just slower.

## Setup

### 1. MongoDB
```bash
docker compose up -d mongo
```

### 2. Detection service (Python)
```bash
cd detection-service
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.server:app --port 8001 --reload
```
The first run downloads the YOLO11 weights automatically.

### 3. Backend (Node)
```bash
cd backend
npm install
cp .env.example .env        # make DETECTOR_API_KEY match the Python .env
npm run dev
# create your first (admin) account from the frontend, or:
npm run seed:admin you@college.edu "Your Name" a-strong-password
```

### 4. Frontend (React)
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```
Open http://localhost:5173, register (or log in), upload a video, draw at
least one zone, and click **Start detection**.

## A test video that actually shows the plate feature

`no_parking_threshold_s` defaults to 30 seconds, and OCR needs the plate
clearly visible — close enough, facing the camera, not too blurry. Most
"traffic camera" clips online are filmed from too high or too far away for
that. Good sources for a demo clip:
- Record 20–30 seconds yourself on a phone, angled at a parked car's plate.
- Search royalty-free clip sites ("parking lot", "car park CCTV") and check
  a still frame before committing to one.
- For the demo itself, `no_parking_threshold_s` can be lowered (pass
  `params` when starting a job, or edit `JobParams` defaults) so you don't
  have to wait 30 real seconds per violation while presenting.

If no plate is ever read, the system still logs the violation, notifies the
dashboard and issues the fine after `plate_wait_s` — it just says
"plate not read" instead of a number, which is worth mentioning as a known
limitation in your report.

## Using a cloud MongoDB (e.g. Atlas) instead of local Mongo

Nothing to change in code. In `backend/.env`, set:
```
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/smart_parking
```
(whitelist your IP / allow access from anywhere in Atlas's network settings, and
URL-encode any special characters in the password). You can skip
`docker compose up -d mongo` entirely in that case.

## Connecting a live camera instead of uploading a file

On the Videos page, click **Connect camera** and give it an RTSP URL
(`rtsp://user:pass@192.168.1.50:554/stream1`, whatever your camera/DVR provides)
or a plain webcam index (`0` for the first camera attached to the machine running
`detection-service`). Everything else — drawing zones, Start detection, the live
feed, violations, fines — works exactly the same as with an uploaded video; the
only difference is the detector reads frames from the camera instead of a file,
and it automatically retries for about 20 seconds if the camera drops out instead
of ending the job.

**Important:** the camera only needs to be reachable from wherever
`detection-service` runs — your laptop does not need to be able to reach it, and
the browser never touches the camera feed directly.

## Does detection keep working if nobody has the dashboard open?

Yes. Clicking **Start detection** just tells the Python service to start
processing — from then on it runs as an independent background job, posting
events straight to the Node backend regardless of whether any browser is
connected. Violations are still recorded and fines are still issued; you only
need the dashboard open to *see* the live toast notification and video feed
the moment it happens. If you want a camera to start processing automatically
on boot rather than waiting for someone to click Start, call
`POST /api/videos/:id/start` from a small script instead of the UI.

## Evidence captured per vehicle

Every parking session — legal or not — stores:
- entry photo + time (first seen parked)
- exit photo + time (when it left)
- total duration
- vehicle type and plate (if read)

A **violation** additionally stores a close-up photo at the exact moment the
30-second threshold was crossed, and is linked to a fine. The fine is created
immediately (so the notification and amount aren't delayed), using the
duration at that moment; once the vehicle actually leaves, the violation's
duration and the fine amount are both corrected to the real total time
parked — shown on the Violations page as "still parked (estimate)" until that
happens, then marked finalized.

## Testing

```bash
cd detection-service && pytest tests/ -v         # session / violation logic, no video needed
```

## What was reused vs. rebuilt from your upload

- **Reused as-is**: the overall idea (YOLO + zones + duration timer),
  `config/zones.json` shape, the vehicle classes tracked.
- **Rebuilt**: `duration_manager.py` had three conflicting `__init__`s (the
  crash bug) and no stationary/grace-period logic — replaced with
  `app/sessions.py`, a single tested state machine. Zones went from
  hardcoded pixels to normalised coordinates so they survive any video
  resolution. Everything else (plate reading, the Node backend, fines,
  Socket.IO notifications, the React dashboard) is new, to meet the
  requirements you described.

## Troubleshooting "Start detection" does nothing / no violations appear

Check these in order:

1. **All three services actually running?** The frontend only *asks* the backend
   to start a job; the backend asks `detection-service`. If `detection-service`
   isn't running, the backend's `/start` call fails — check the backend's
   terminal for a connection-refused error.
2. **`DETECTOR_API_KEY` identical in both `.env` files?** A mismatch returns a
   401 from the detector, surfaced back to the frontend as an error message —
   read it.
3. **Same machine / shared filesystem?** `detection-service` opens the uploaded
   video by *file path*, not by downloading it — it must be able to see the
   exact file the backend saved. Running both on the same machine (the normal
   setup for this project) always satisfies this automatically; running them
   in separate Docker containers or on separate machines needs a shared volume.
4. **Zones drawn before clicking Start?** The button is disabled until at least
   one zone exists — if nothing happens when you click it, check the browser
   console for the actual error response.
5. **Watch `detection-service`'s terminal.** It logs `job <id> started: WxH @
   FPSfps, N zones` the moment a job begins, and every event it sends — if you
   see that line but nothing shows up in the dashboard, the problem is between
   the detector and the backend (check `DETECTOR_API_KEY` again); if you never
   see that line, the problem is between the frontend/backend and the detector.
6. **No vehicles in the zone, or threshold not reached yet.** The default is 30
   seconds stationary before a violation fires — for legal parking there's no
   threshold, a session just needs ~5 seconds stationary to appear in "Active
   vehicles" on the video page.

## Known limitations (worth stating in your report)

- OCR accuracy depends heavily on camera angle, distance and video quality.
- One detection job runs at a time per detection-service instance — fine
  for a mini project; for multiple simultaneous cameras you'd run one
  worker per stream.
- No HTTPS/production hardening (rate limiting, refresh tokens) — this is
  a functional prototype, not a deployment-ready system.
