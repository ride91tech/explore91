# Explore91 API — FastAPI + Motor
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# Build deps for the few wheels that need compiling (jq, cryptography fallbacks).
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

# Requirements first so edits to app code don't invalidate the dependency layer.
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt \
 && apt-get purge -y build-essential && apt-get autoremove -y

COPY . .

# Don't run as root.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:${PORT}/api/ || exit 1

# Single worker on purpose: the rate limiter in core/security.py keeps its
# buckets in process memory, so N workers would divide every limit by N.
# Move to Redis before scaling this past one worker.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
