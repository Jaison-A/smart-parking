---
title: Curbside Detection Service
emoji: 🚗
colorFrom: blue
colorTo: red
sdk: docker
app_port: 7860
pinned: false
---

FastAPI detection service for the Curbside parking-enforcement project
(YOLO11 + ByteTrack + EasyOCR). Called by the Node backend - not meant to be
used directly as a public demo.

Required Space secrets (Settings → Variables and secrets):
- `DETECTOR_API_KEY` - must match the backend's `DETECTOR_API_KEY`
- `BACKEND_URL` - your deployed backend's public URL (e.g. the Render URL)
