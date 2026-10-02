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

## Known limitations (worth stating in your report)

- OCR accuracy depends heavily on camera angle, distance and video quality.
- One detection job runs at a time per detection-service instance — fine
  for a mini project; for multiple simultaneous cameras you'd run one
  worker per stream.
- No HTTPS/production hardening (rate limiting, refresh tokens) — this is
  a functional prototype, not a deployment-ready system.
