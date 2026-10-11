# Deploy target: Hugging Face Spaces (Docker SDK). Free CPU-basic tier gives
# 2 vCPU / 16 GB RAM / 50 GB ephemeral disk - enough headroom for YOLO11 +
# EasyOCR, unlike most other free web-service tiers (e.g. Render's free tier
# is 512 MB RAM, nowhere near enough for torch + easyocr to even load).
FROM python:3.11-slim

# opencv-python needs these even when nothing ever calls cv2.imshow() -
# without them the import itself fails inside a slim/server image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hugging Face Spaces routes traffic to port 7860 by convention.
EXPOSE 7860

# Keep YOLO/EasyOCR model downloads inside the Space's writable area, not the
# read-only image layer.
ENV YOLO_CONFIG_DIR=/app/.cache/ultralytics \
    EASYOCR_MODULE_PATH=/app/.cache/easyocr

CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "7860"]
