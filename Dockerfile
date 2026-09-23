# ============================================================
#  MindForge production image
#  Portable across any free Docker host:
#    - Render free Web Service   (sets PORT automatically)
#    - ModelScope Studio         (requires 0.0.0.0:7860)
#    - Koyeb / Fly / any VPS
# ============================================================
FROM python:3.12-slim

# Faster builds inside mainland China (optional: uncomment if the
# platform's builder sits in CN and PyPI is slow)
# ENV PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependency layer first, so code edits do not trigger a reinstall.
# NOTE: uses requirements-deploy.txt, which drops faster-whisper
# (lazy-imported in routers/asr.py, and its ~1GB runtime footprint
# would OOM a 512MB free instance).
COPY backend/requirements-deploy.txt /app/backend/requirements-deploy.txt
RUN pip install --no-cache-dir -r /app/backend/requirements-deploy.txt

# Runtime payload only - see .dockerignore for what is excluded.
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/

WORKDIR /app/backend

# Platforms inject PORT (Render: $PORT, ModelScope Studio: 7860).
# Default 8000 keeps `docker run -p 8000:8000` working locally.
ENV PORT=8000
EXPOSE 8000

# Long start-period: free tiers boot slowly on cold start.
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/health',timeout=8)" || exit 1

# Single worker on purpose: free tiers ship ~0.1 vCPU / 512MB,
# a second worker would only double memory use without adding throughput.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
