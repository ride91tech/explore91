"""Auth, RBAC and rate-limiting helpers."""
import hashlib
import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, Request
from pymongo import ReturnDocument

from .db import db

logger = logging.getLogger("explore91")

# Simple https://... URL validator used across CMS models (banners, cities, reels).
ALLOWED_URL = re.compile(r"^https://[A-Za-z0-9._~%+/:@?=&#-]+$")

# How many proxies in front of this service we actually control.
#   1  Cloud Run with no load balancer (Google's front end) - the default,
#      and what the container image is configured for.
#   2+ one per additional trusted hop, e.g. a Cloud Armor / GCLB layer.
#   0  nothing trusted in front: ignore X-Forwarded-For entirely and use the
#      socket peer. Correct for local development, where uvicorn is started
#      without --proxy-headers and the header is pure client input.
TRUSTED_PROXY_HOPS = int(os.environ.get("TRUSTED_PROXY_HOPS", "1"))


def _client_ip(request: Request) -> str:
    """The closest address we can actually trust.

    X-Forwarded-For is a client-supplied header that each proxy *appends* to,
    so the first entry is simply whatever the caller chose to send. Reading it
    — as this used to — let anyone defeat IP rate limiting by rotating a fake
    value per request. Only the entries our own infrastructure appended mean
    anything, so count back from the end instead.
    """
    if TRUSTED_PROXY_HOPS > 0:
        fwd = request.headers.get("x-forwarded-for", "")
        parts = [p.strip() for p in fwd.split(",") if p.strip()]
        if parts:
            return parts[max(0, len(parts) - TRUSTED_PROXY_HOPS)]
    return request.client.host if request.client else "anon"


def client_key(request: Request, user: Optional[dict] = None) -> str:
    """Identity to rate-limit against: the user when known, else their IP."""
    if user and user.get("user_id"):
        return f"u:{user['user_id']}"
    return f"ip:{_client_ip(request)}"


async def rate_limit(bucket: str, key: str, limit: int, window_sec: int) -> None:
    """Raise 429 if `key` exceeded `limit` requests in the current window.

    A fixed-window counter held in MongoDB, so the limit is shared by every
    Cloud Run instance. The previous implementation kept buckets in a
    process-local dict, which on an autoscaled service meant the real limit was
    `limit x instance_count` and reset whenever an instance recycled — that is,
    it stopped working precisely under the load that makes limits matter.

    Fixed windows allow a short burst across a boundary. That is an acceptable
    trade for one atomic round-trip per call; these limits exist to stop abuse,
    not to meter billing.
    """
    now = datetime.now(timezone.utc)
    epoch = int(now.timestamp())
    window_start = epoch - (epoch % window_sec)
    expires_at = datetime.fromtimestamp(window_start + window_sec, tz=timezone.utc)

    try:
        doc = await db.rate_limits.find_one_and_update(
            {"_id": f"{bucket}:{key}:{window_start}"},
            {"$inc": {"n": 1}, "$setOnInsert": {"expires_at": expires_at}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except Exception:
        # Fail open. A database blip should slow nobody down; losing abuse
        # protection for the duration beats refusing every request.
        logger.exception("rate_limit: store unavailable for bucket=%s", bucket)
        return

    if doc.get("n", 0) > limit:
        retry = max(1, int(expires_at.timestamp() - epoch))
        raise HTTPException(
            status_code=429,
            detail="Too many requests, please slow down.",
            headers={"Retry-After": str(retry)},
        )



def hash_session_token(token: str) -> str:
    """Digest a session token for storage and lookup.

    `user_sessions.session_token` holds this digest, never the token itself,
    so a read-only leak of that collection yields nothing usable. Tokens carry
    ~244 bits of entropy and are single-use secrets rather than passwords, so a
    plain SHA-256 is appropriate here — a slow KDF would buy nothing and cost a
    hash on every authenticated request.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _find_session(token: str) -> Optional[dict]:
    """Look up a session, upgrading pre-hash rows in passing.

    Rows written before tokens were hashed still hold the raw token. Rather
    than invalidating every live session — which would sign everyone out, and
    sign-in is not yet reliable — those rows are migrated the first time they
    are used. Anything never used again simply expires via the TTL index.
    """
    digest = hash_session_token(token)
    session = await db.user_sessions.find_one({"session_token": digest}, {"_id": 0})
    if session:
        return session

    # Upgrade atomically rather than read-then-write. Concurrent requests
    # carrying the same pre-hash token would otherwise all miss the digest,
    # all find the raw row, and whichever renamed it first would leave the
    # rest finding nothing — handing the caller a spurious 401 mid-session.
    session = await db.user_sessions.find_one_and_update(
        {"session_token": token},
        {"$set": {"session_token": digest}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if session:
        return session

    # Either the token is not ours, or a concurrent request won the upgrade
    # a moment ago; re-check the digest before giving up.
    return await db.user_sessions.find_one({"session_token": digest}, {"_id": 0})


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    session = await _find_session(token)
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
