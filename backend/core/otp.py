"""One-time sign-in codes, delivered by email.

Email rather than SMS for launch, deliberately. Sending transactional SMS in
India needs DLT registration with the telecom operators - entity, header and
template, each approved separately, one to two weeks - and that clock had not
started three weeks before the target launch. Email needs no registration,
and the app already identifies people by email: the login screen asks for
one. Phone can be added later behind the same two endpoints.

How the pieces fit:

  send    a six-digit code is generated, its keyed digest is stored against
          the address with a ten-minute expiry, and the code is emailed.
          Only one code is live per address; asking again replaces it.

  verify  every attempt is counted atomically BEFORE the comparison, so the
          attempt limit holds under concurrent requests. A match is claimed
          with find_one_and_delete, so a code signs in exactly once even if
          two requests carrying it arrive together.

Why the code is stored as an HMAC and not a plain hash: there are only a
million six-digit codes. Anyone who could read this collection could hash all
of them in milliseconds and recover a live code - which would sign them in as
that person within the ten-minute window. Keying the digest with OTP_PEPPER,
a secret that lives in the environment and never in the database, means a
database read alone recovers nothing.

Configuration is read from the environment on each call rather than at
import, like dev_auth_enabled(), so tests can switch it without reloading.
"""
import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from pymongo import ReturnDocument

from core.db import db

logger = logging.getLogger("explore91.otp")

CODE_DIGITS = 6
CODE_TTL = timedelta(minutes=10)
# Five wrong guesses burns the code. With sends capped per address (see
# routes/auth.py), that bounds an attacker to a few dozen guesses an hour
# against a space of a million.
MAX_ATTEMPTS = 5

# Sending backends:
#   resend  real delivery via the Resend HTTP API
#   log     writes the code to the server log. Local development only - it
#           puts a live credential in a log, so it refuses to run when
#           K_SERVICE is set (Cloud Run sets it on every revision).
# Unset means OTP is off and the endpoints answer 503, the same way Apple
# sign-in does when APPLE_AUDIENCES is unset.
_BACKENDS = {"resend", "log"}


class OtpNotConfigured(RuntimeError):
    """Raised when sign-in by code is asked for but cannot work."""


def _backend() -> Optional[str]:
    b = (os.environ.get("OTP_EMAIL_BACKEND") or "").strip().lower()
    return b if b in _BACKENDS else None


def _pepper() -> bytes:
    p = os.environ.get("OTP_PEPPER") or ""
    if len(p) < 32:
        # Short is as bad as absent: the whole point is that it cannot be
        # guessed. 32 characters of urandom is the floor.
        raise OtpNotConfigured("OTP_PEPPER is unset or shorter than 32 characters")
    return p.encode()


def otp_configured() -> bool:
    """Whether sign-in by code can work right now, without raising."""
    backend = _backend()
    if backend is None:
        return False
    if backend == "log" and os.environ.get("K_SERVICE"):
        return False
    if backend == "resend" and not (
        os.environ.get("RESEND_API_KEY") and os.environ.get("OTP_FROM_EMAIL")
    ):
        return False
    try:
        _pepper()
    except OtpNotConfigured:
        return False
    return True


def generate_code() -> str:
    """Six digits from the OS CSPRNG. `random` would be predictable."""
    return f"{secrets.randbelow(10 ** CODE_DIGITS):0{CODE_DIGITS}d}"


def code_digest(email: str, code: str) -> str:
    """Keyed digest of an address and its code.

    The address is mixed in so a digest is only ever valid for the inbox it
    was sent to: knowing one person's code tells you nothing about another's.
    """
    msg = f"{email.strip().lower()}:{code}".encode()
    return hmac.new(_pepper(), msg, hashlib.sha256).hexdigest()


async def issue_code(email: str) -> str:
    """Store a fresh code for this address, replacing any live one."""
    now = datetime.now(timezone.utc)
    code = generate_code()
    await db.otp_codes.update_one(
        {"email": email},
        {"$set": {
            "email": email,
            "code_digest": code_digest(email, code),
            "attempts": 0,
            "created_at": now,
            "expires_at": now + CODE_TTL,
        }},
        upsert=True,
    )
    return code


async def claim_code(email: str, code: str) -> bool:
    """True exactly once for a correct, live code. Never raises on a bad one.

    Every failure mode returns the same False - wrong code, expired code, no
    code, too many attempts - so a caller learns nothing about which it was.
    """
    if not (code.isdigit() and len(code) == CODE_DIGITS):
        return False
    now = datetime.now(timezone.utc)

    # Count the attempt first, atomically and conditionally. Comparing first
    # and counting after would let a burst of concurrent wrong guesses all
    # read attempts=0 and all get through.
    doc = await db.otp_codes.find_one_and_update(
        {"email": email, "expires_at": {"$gt": now}, "attempts": {"$lt": MAX_ATTEMPTS}},
        {"$inc": {"attempts": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        return False
    if not hmac.compare_digest(doc["code_digest"], code_digest(email, code)):
        return False

    # Claim it. If two requests carried the right code at once, only one
    # deletes the row; the other gets None and is refused.
    claimed = await db.otp_codes.find_one_and_delete({"_id": doc["_id"]})
    return claimed is not None


def _render(code: str) -> tuple:
    subject = f"{code} is your Explore91 sign-in code"
    text = (
        f"Your Explore91 sign-in code is {code}\n\n"
        "It expires in 10 minutes and works once.\n\n"
        "If you did not ask for this, you can ignore this email - nobody can "
        "sign in without the code.\n"
    )
    return subject, text


async def send_code_email(to: str, code: str) -> None:
    """Deliver a code. Module-level so tests can replace it."""
    backend = _backend()
    if backend == "log":
        if os.environ.get("K_SERVICE"):
            raise OtpNotConfigured("the log backend is refused on Cloud Run")
        logger.warning("OTP for local development: %s -> %s", to, code)
        return
    if backend == "resend":
        subject, text = _render(code)
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}"},
                json={
                    "from": os.environ["OTP_FROM_EMAIL"],
                    "to": [to],
                    "subject": subject,
                    "text": text,
                },
            )
        if r.status_code >= 300:
            # The body can echo the recipient; log the status only.
            logger.error("Resend rejected an OTP email: HTTP %s", r.status_code)
            raise RuntimeError("email delivery failed")
        return
    raise OtpNotConfigured("OTP_EMAIL_BACKEND is unset")
