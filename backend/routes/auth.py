"""Auth: development sign-in, Apple Sign-In, me, roles.

Google Sign-In was removed. /auth/dev stands in for it until OTP sign-in is
built: it takes an email and issues a session, verifying nothing, and is
inert unless DEV_AUTH_ENABLED is set. See core.config.dev_auth_enabled for
why that gate exists and why the route 404s instead of refusing.

Apple is still verified here against Apple's own JWKS, so no third party sits
in that login path.
"""
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError

from core.config import (
    ADMIN_EMAILS,
    APPLE_AUDIENCES,
    APPLE_ISSUER,
    APPLE_JWKS_URL,
    SESSION_TTL_DAYS,
    dev_auth_enabled,
)
from core.db import db
from core.security import (
    client_key,
    get_current_user,
    hash_session_token,
    logger,
    rate_limit,
)
from models import (
    AppleSignInRequest,
    AuthResponse,
    DevSignIn,
    RoleUpgrade,
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
        # 503, matching the Google path above. A missing audience list is a
        # deployment that has not been finished, not a fault in the request or
        # a crash in the server — and a 500 here both pages whoever watches
        # the error rate and tells the caller nothing it can act on. The
        # detail names the variable so the fix is obvious from the response.
        raise HTTPException(
            status_code=503,
            detail="Apple Sign-In isn't configured. Set APPLE_AUDIENCES.",
        )
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


async def _require_dev_auth() -> None:
    """404 unless the dev gate is open.

    A dependency rather than the first line of the handler because FastAPI
    validates the request body before the handler runs: as an inline check,
    a malformed body answered 422 on a disabled instance, confirming both
    that the route exists and what it expects. Dependencies are resolved
    first, so raising here makes a disabled endpoint indistinguishable from
    one that was never registered, whatever is posted to it.
    """
    if not dev_auth_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.post(
    "/auth/dev",
    response_model=AuthResponse,
    dependencies=[Depends(_require_dev_auth)],
)
async def dev_sign_in(request: Request):
    """Issue a session for whatever email is in the body. Development only.

    This replaces Google Sign-In until OTP sign-in exists. Nothing is
    verified -- there is no credential to verify -- so anything that can
    reach this route can sign in as anybody, including an ADMIN_EMAILS
    address that can then self-grant admin via /auth/roles.

    Hence the 404 when DEV_AUTH_ENABLED is unset: not a 403, so a production
    deployment does not confirm the route is there.

    The body is taken as a raw Request and parsed below rather than declared
    as a `payload: DevSignIn` parameter, which is the only way the 404 holds
    for every request. FastAPI reads and parses the body BEFORE it resolves
    dependencies, so with a declared body model an unparseable body answered
    422 while a route that genuinely did not exist answered 404 -- which told
    an unauthenticated caller the route was there. With no body field on the
    dependant, FastAPI skips that read entirely and the gate is reached first
    whatever is posted.

    Returning users keep their account: this matches on email and reuses the
    existing record, so user_id, wallet_points, roles and home_city survive.
    That is the same rule Google used, which means accounts created under
    Google still resolve here, and will still resolve when OTP replaces this.
    """
    await rate_limit("dev_auth", client_key(request), limit=20, window_sec=60)

    try:
        raw = await request.json()
    except Exception:
        raise HTTPException(status_code=422, detail="Body must be a JSON object")
    try:
        payload = DevSignIn.model_validate(raw)
    except ValidationError as exc:
        # Shaped like FastAPI's own 422 so the client sees nothing unusual.
        raise HTTPException(
            status_code=422,
            detail=[
                {"loc": list(e.get("loc", ())), "msg": e.get("msg", "invalid")}
                for e in exc.errors()
            ],
        )

    email = payload.email.strip().lower()
    name = (payload.name or "").strip() or email.split("@")[0]

    # Audit trail. If this ever appears in a production log, the gate was set
    # on a service where it should not have been.
    logger.warning("DEV SIGN-IN: issuing a session for %s, no credential checked", email)

    # The prefix makes these identifiable in user_sessions, so they can be
    # found and purged when real sign-in lands.
    session_token = f"dev_{uuid.uuid4().hex}{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        # Only fill a blank name; never overwrite one the user has set.
        if payload.name and not existing.get("name"):
            await db.users.update_one({"user_id": user_id}, {"$set": {"name": name}})
            user_doc = {**existing, "name": name}
        else:
            user_doc = existing
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": None,
            "wallet_points": 500,
            "home_city": "Goa",
            "roles": ["customer"],
            "created_at": now,
        }
        await db.users.insert_one(dict(user_doc))
        user_doc.pop("_id", None)

    await db.user_sessions.insert_one({
        # The digest, never the token — see core.security.hash_session_token.
        "session_token": hash_session_token(session_token),
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
    await rate_limit("apple_signin", client_key(request), limit=20, window_sec=60)
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
        # The digest, never the token — see core.security.hash_session_token.
        "session_token": hash_session_token(session_token),
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
    # Delete by digest; fall back to the raw value for sessions issued before
    # hashing, so logging out of an old session still works.
    deleted = await db.user_sessions.delete_one(
        {"session_token": hash_session_token(token)}
    )
    if deleted.deleted_count == 0:
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
