"""Auth: session (Google via Emergent), Apple Sign-In, me, roles."""
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from core.config import (
    ADMIN_EMAILS,
    APPLE_AUDIENCES,
    APPLE_ISSUER,
    APPLE_JWKS_URL,
    EMERGENT_AUTH_URL,
    SESSION_TTL_DAYS,
)
from core.db import db
from core.security import (
    client_key,
    get_current_user,
    logger,
    rate_limit,
)
from models import (
    AppleSignInRequest,
    AuthResponse,
    RoleUpgrade,
    SessionRequest,
    User,
)

router = APIRouter()

# Cached Apple JWKS (rotated by Apple; we refresh on kid miss).
_APPLE_JWKS: Dict[str, object] = {}
_APPLE_JWKS_FETCHED_AT: float = 0.0
_APPLE_JWKS_TTL = 3600  # 1 hour


async def _load_apple_jwks(force: bool = False) -> None:
    global _APPLE_JWKS, _APPLE_JWKS_FETCHED_AT
    import jwt as _jwt

    now = time.monotonic()
    if not force and _APPLE_JWKS and (now - _APPLE_JWKS_FETCHED_AT) < _APPLE_JWKS_TTL:
        return
    async with httpx.AsyncClient(timeout=10.0) as hc:
        r = await hc.get(APPLE_JWKS_URL)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not reach Apple JWKS")
    keys = r.json().get("keys", [])
    _APPLE_JWKS = {}
    for k in keys:
        kid = k.get("kid")
        if not kid:
            continue
        try:
            _APPLE_JWKS[kid] = _jwt.PyJWK(k)
        except Exception:
            continue
    _APPLE_JWKS_FETCHED_AT = now


async def _verify_apple_identity_token(identity_token: str) -> dict:
    import jwt as _jwt

    if not APPLE_AUDIENCES:
        raise HTTPException(status_code=500, detail="APPLE_AUDIENCES not configured on server")
    try:
        header = _jwt.get_unverified_header(identity_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Malformed Apple identity token")
    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Missing kid in Apple token")
    await _load_apple_jwks()
    key = _APPLE_JWKS.get(kid)
    if key is None:
        await _load_apple_jwks(force=True)
        key = _APPLE_JWKS.get(kid)
        if key is None:
            raise HTTPException(status_code=401, detail="Unknown signing key")
    try:
        claims = _jwt.decode(
            identity_token,
            key=key.key,
            algorithms=["RS256"],
            audience=list(APPLE_AUDIENCES),
            issuer=APPLE_ISSUER,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except _jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Invalid audience")
    except _jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Apple token expired")
    except Exception:
        logger.exception("Apple token verification failed")
        raise HTTPException(status_code=401, detail="Invalid Apple identity token")
    return claims


@router.get("/")
async def root():
    return {"service": "Explore91", "status": "ok"}


@router.post("/auth/session", response_model=AuthResponse)
async def create_session(payload: SessionRequest):
    async with httpx.AsyncClient(timeout=15.0) as hc:
        r = await hc.get(
            EMERGENT_AUTH_URL, headers={"X-Session-ID": payload.session_id}
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data.get("email")
    name = data.get("name") or (email.split("@")[0] if email else "Guest")
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Malformed auth response")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    now = datetime.now(timezone.utc)
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id}, {"$set": {"name": name, "picture": picture}}
        )
        user_doc = {**existing, "name": name, "picture": picture}
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "wallet_points": 500,
            "home_city": "Goa",
            "roles": ["customer"],
            "created_at": now,
        }
        await db.users.insert_one(dict(user_doc))
        user_doc.pop("_id", None)

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": now,
        "expires_at": now + timedelta(days=SESSION_TTL_DAYS),
    })

    return AuthResponse(session_token=session_token, user=User(**user_doc))


@router.get("/auth/me", response_model=User)
async def me(current=Depends(get_current_user)):
    return User(**current)


@router.post("/auth/apple", response_model=AuthResponse)
async def apple_sign_in(payload: AppleSignInRequest, request: Request):
    rate_limit("apple_signin", client_key(request), limit=20, window_sec=60)
    claims = await _verify_apple_identity_token(payload.identity_token)
    apple_sub = claims.get("sub")
    if not apple_sub:
        raise HTTPException(status_code=401, detail="Missing sub claim")

    token_email = (claims.get("email") or "").lower() or None
    email = (payload.email or token_email or "").lower() or None
    name = payload.full_name or (email.split("@")[0] if email else "Apple User")
    now = datetime.now(timezone.utc)

    existing = await db.users.find_one({"apple_sub": apple_sub}, {"_id": 0})
    if not existing and email:
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if existing:
            await db.users.update_one(
                {"user_id": existing["user_id"]}, {"$set": {"apple_sub": apple_sub}}
            )
            existing = {**existing, "apple_sub": apple_sub}

    if existing:
        user_id = existing["user_id"]
        set_fields: dict = {}
        if not existing.get("name") or existing["name"] == "Apple User":
            if payload.full_name:
                set_fields["name"] = payload.full_name
        if set_fields:
            await db.users.update_one({"user_id": user_id}, {"$set": set_fields})
        user_doc = {**existing, **set_fields}
    else:
        if not email:
            raise HTTPException(
                status_code=400, detail="Email is required on first Apple sign-in"
            )
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": None,
            "wallet_points": 500,
            "home_city": "Goa",
            "roles": ["customer"],
            "apple_sub": apple_sub,
            "created_at": now,
        }
        try:
            await db.users.insert_one(dict(user_doc))
        except Exception:
            fetched = await db.users.find_one({"apple_sub": apple_sub}, {"_id": 0})
            if not fetched:
                raise HTTPException(status_code=500, detail="Could not create user")
            user_doc = fetched
            user_id = fetched["user_id"]

    session_token = f"apple_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": now,
        "expires_at": now + timedelta(days=SESSION_TTL_DAYS),
    })
    user_doc.pop("_id", None)
    return AuthResponse(session_token=session_token, user=User(**user_doc))


@router.post("/auth/logout")
async def logout(request: Request, current=Depends(get_current_user)):
    auth = request.headers.get("authorization", "")
    token = auth.split(" ", 1)[1].strip() if " " in auth else ""
    await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


@router.patch("/auth/me")
async def update_me(body: dict, current=Depends(get_current_user)):
    allowed = {"home_city"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if updates:
        await db.users.update_one({"user_id": current["user_id"]}, {"$set": updates})
    user = await db.users.find_one({"user_id": current["user_id"]}, {"_id": 0})
    return User(**user)


@router.post("/auth/roles")
async def upgrade_role(payload: RoleUpgrade, current=Depends(get_current_user)):
    role = payload.role
    if role == "admin":
        email = (current.get("email") or "").lower()
        if email not in ADMIN_EMAILS:
            raise HTTPException(
                status_code=403,
                detail="Admin role can only be granted to allowlisted accounts.",
            )
    roles = set(current.get("roles") or ["customer"])
    roles.add(role)
    await db.users.update_one(
        {"user_id": current["user_id"]}, {"$set": {"roles": list(roles)}}
    )
    user = await db.users.find_one({"user_id": current["user_id"]}, {"_id": 0})
    return User(**user)
