"""Auth, RBAC and rate-limiting helpers."""
import logging
import re
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Deque, Dict, Optional

from fastapi import HTTPException, Request

from .db import db

logger = logging.getLogger("explore91")

# Simple https://... URL validator used across CMS models (banners, cities, reels).
ALLOWED_URL = re.compile(r"^https://[A-Za-z0-9._~%+/:@?=&#-]+$")

# Simple in-memory sliding-window rate limiter.
# For a single-worker preview this is enough; production should use Redis.
_RATE_BUCKETS: Dict[str, Deque[float]] = defaultdict(deque)


def rate_limit(bucket: str, key: str, limit: int, window_sec: int) -> None:
    """Raise 429 if `key` has exceeded `limit` requests in the last `window_sec`."""
    now = time.monotonic()
    q = _RATE_BUCKETS[f"{bucket}:{key}"]
    cutoff = now - window_sec
    while q and q[0] < cutoff:
        q.popleft()
    if len(q) >= limit:
        retry = max(1, int(window_sec - (now - q[0])))
        raise HTTPException(
            status_code=429,
            detail="Too many requests, please slow down.",
            headers={"Retry-After": str(retry)},
        )
    q.append(now)


def client_key(request: Request, user: Optional[dict] = None) -> str:
    if user and user.get("user_id"):
        return f"u:{user['user_id']}"
    fwd = request.headers.get("x-forwarded-for", "")
    ip = (
        (fwd.split(",")[0].strip() if fwd else "")
        or (request.client.host if request.client else "anon")
    )
    return f"ip:{ip}"


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("is_blocked"):
        raise HTTPException(
            status_code=403, detail="Account has been blocked by an administrator"
        )
    return user


def require_role(user: dict, role: str) -> None:
    if role not in (user.get("roles") or []):
        raise HTTPException(status_code=403, detail=f"Requires '{role}' role")
