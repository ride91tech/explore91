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
#   msg91   real delivery via MSG91's email API. The default choice: the
#           account already exists, and MSG91 is also the route to SMS once
#           DLT registration is approved.
#   resend  real delivery via the Resend HTTP API
#   log     writes the code to the server log. Local development only - it
#           puts a live credential in a log, so it refuses to run when
#           K_SERVICE is set (Cloud Run sets it on every revision).
# Unset means OTP is off and the endpoints answer 503, the same way Apple
# sign-in does when APPLE_AUDIENCES is unset.
_BACKENDS = {"msg91", "resend", "log"}


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
    if backend == "msg91" and not all(os.environ.get(k) for k in _MSG91_REQUIRED):
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


_MSG91_REQUIRED = (
    "MSG91_AUTHKEY", "MSG91_EMAIL_DOMAIN", "MSG91_EMAIL_TEMPLATE_ID", "OTP_FROM_EMAIL",
)
_MSG91_EMAIL_URL = "https://control.msg91.com/api/v5/email/send"


def _http_client() -> httpx.AsyncClient:
    """Module-level so tests can substitute a mock transport."""
    return httpx.AsyncClient(timeout=10)


def _split_from(value: str) -> tuple:
    """'Explore91 <login@explore91.com>' -> ('Explore91', 'login@explore91.com').

    MSG91 wants the sender as an object; Resend takes the combined string.
    One variable serves both.
    """
    value = value.strip()
    if "<" in value and value.endswith(">"):
        name, _, addr = value[:-1].partition("<")
        return name.strip().strip('"'), addr.strip()
    return "Explore91", value


def _msg91_accepted(status_code: int, body) -> bool:
    """Whether MSG91 actually queued the email.

    The HTTP status is not enough. MSG91 answers some failures - a wrong or
    missing authkey among them - with a 200 and the failure in the body, so
    checking the status alone would report a code as sent when nothing will
    ever arrive. Success is a 2xx AND status "success" AND hasError false,
    which is the shape its OpenAPI spec documents for a queued message.
    Anything else is a failure, including a body that will not parse.
    """
    if not (200 <= status_code < 300) or not isinstance(body, dict):
        return False
    return body.get("status") == "success" and body.get("hasError") is False


# ---------------------------------------------------------------- WhatsApp --
#
# Delivered through Kapso, which fronts Meta's WhatsApp Cloud API. WhatsApp is
# not SMS, so India's DLT registration does not apply - that is the reason for
# this channel. Meta's own gate still does: messaging real users needs a
# registered number, an approved display name and an approved AUTHENTICATION
# template, with business verification for higher volume. Kapso's sandbox
# number lets the integration be proven before any of that is approved.
#
# Authentication templates are fixed-format: Meta writes the text, we supply
# only the code. Meta requires the code TWICE - as the body parameter and as
# the copy-code button's parameter - and a send missing either is rejected.

_KAPSO_REQUIRED = ("KAPSO_API_KEY", "KAPSO_PHONE_NUMBER_ID", "KAPSO_OTP_TEMPLATE")
_KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0"


def whatsapp_configured() -> bool:
    if not all(os.environ.get(k) for k in _KAPSO_REQUIRED):
        return False
    try:
        _pepper()
    except OtpNotConfigured:
        return False
    return True


def normalise_in_mobile(raw: str) -> Optional[str]:
    """An Indian mobile number in E.164 ('+919876543210'), or None.

    Accepts the forms people actually type: 10 digits, with a leading 0, or
    with +91 / 91, and any spaces, dashes or brackets. Indian mobile numbers
    start 6-9; anything else is refused rather than guessed at, since a
    wrong normalisation sends someone's code to a stranger.
    """
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] not in "6789":
        return None
    return "+91" + digits


def _kapso_accepted(status_code: int, body) -> bool:
    """A send counts only if Meta returned a message id.

    Meta reports most failures with a 4xx and an `error` object, but the one
    thing that proves the message was accepted is a wamid in `messages`.
    Requiring it means an unexpected 200 body cannot pass as success.
    """
    if not (200 <= status_code < 300) or not isinstance(body, dict):
        return False
    msgs = body.get("messages")
    return bool(isinstance(msgs, list) and msgs and isinstance(msgs[0], dict) and msgs[0].get("id"))


async def send_code_whatsapp(phone_e164: str, code: str) -> None:
    """Deliver a code by WhatsApp. Module-level so tests can replace it."""
    if not whatsapp_configured():
        raise OtpNotConfigured("WhatsApp delivery is not configured")
    to = phone_e164.lstrip("+")
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "template",
        "template": {
            "name": os.environ["KAPSO_OTP_TEMPLATE"],
            "language": {"code": os.environ.get("KAPSO_OTP_TEMPLATE_LANG") or "en"},
            "components": [
                {"type": "body", "parameters": [{"type": "text", "text": code}]},
                {"type": "button", "sub_type": "url", "index": "0",
                 "parameters": [{"type": "text", "text": code}]},
            ],
        },
    }
    url = f"{_KAPSO_BASE}/{os.environ['KAPSO_PHONE_NUMBER_ID']}/messages"
    async with _http_client() as client:
        r = await client.post(
            url,
            headers={"X-API-Key": os.environ["KAPSO_API_KEY"],
                     "Content-Type": "application/json"},
            json=payload,
        )
    try:
        body = r.json()
    except ValueError:
        body = None
    if not _kapso_accepted(r.status_code, body):
        # Meta's error code and type are safe to log; the body can echo the
        # recipient and the request carried the API key.
        err = (body or {}).get("error") if isinstance(body, dict) else None
        logger.error(
            "WhatsApp OTP not accepted: HTTP %s, meta_code=%r, type=%r",
            r.status_code,
            (err or {}).get("code") if isinstance(err, dict) else None,
            (err or {}).get("type") if isinstance(err, dict) else None,
        )
        raise RuntimeError("whatsapp delivery failed")


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
        async with _http_client() as client:
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
    if backend == "msg91":
        name, addr = _split_from(os.environ["OTP_FROM_EMAIL"])
        payload = {
            "recipients": [{"to": [{"email": to}], "variables": {"otp": code}}],
            "from": {"name": name, "email": addr},
            "domain": os.environ["MSG91_EMAIL_DOMAIN"],
            "template_id": os.environ["MSG91_EMAIL_TEMPLATE_ID"],
        }
        async with _http_client() as client:
            r = await client.post(
                _MSG91_EMAIL_URL,
                headers={
                    "authkey": os.environ["MSG91_AUTHKEY"],
                    "accept": "application/json",
                    "content-type": "application/json",
                },
                json=payload,
            )
        try:
            body = r.json()
        except ValueError:
            body = None
        if not _msg91_accepted(r.status_code, body):
            # Status and MSG91's own status word only: the body can echo the
            # recipient, and the authkey must never reach a log.
            logger.error(
                "MSG91 did not accept an OTP email: HTTP %s, status=%r",
                r.status_code, (body or {}).get("status") if isinstance(body, dict) else None,
            )
            raise RuntimeError("email delivery failed")
        return
    raise OtpNotConfigured("OTP_EMAIL_BACKEND is unset")
