# Explore91 API — FastAPI + Motor
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# curl is for the healthcheck below. The compiler toolchain is deliberately
# absent: every remaining dependency ships a manylinux wheel for CPython 3.12.
# If a future dependency needs compiling, prefer a wheel over reinstating
# build-essential - it was adding ~300MB to every build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# Requirements first so edits to app code don't invalidate the dependency layer.
# requirements-dev.txt is intentionally NOT installed: tests, linters and type
# checkers have no business in a production image.
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

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
