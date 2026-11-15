"""Recording consent, the same way on every sign-in path.

This exists because the first version of it did not. Consent was written
inline in one branch of one handler — the new-account branch of
/auth/dev — which left two holes that are the same mistake twice:

  * Apple sign-in creates accounts too, and recorded nothing. That is the
    path that survives when DEV_AUTH_ENABLED goes away at OTP, so the only
    covered path was the one scheduled for deletion.
  * Returning users were never asked, because the existing-account branch
    only ever updated `name`. Every account that predates the consent work
    ticks the box and has the answer discarded.

So the rule lives here and both handlers call it. A third sign-in path —
OTP — is coming, and should call it too.

What counts as consent: the sign-up screen presents one checkbox reading
"I am 18 or older and I agree to the Privacy Notice". That single
affirmative action carries both claims, which is why one boolean from the
client sets both fields. If the two are ever split in the UI they must be
split here.

We never infer consent from the absence of a signal. A client that does not
send the flag — an older app build, or a direct API call — records nothing
rather than defaulting to agreed.
"""
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import HTTPException

from core.config import CONSENT_PURPOSES, PRIVACY_NOTICE_VERSION

ADULT_REQUIRED = (
    "Explore91 is for adults. We cannot create an account without a "
    "confirmation that you are 18 or older."
)


def require_adult_for_new_account(is_adult: bool) -> None:
    """Refuse to create an account for someone who has not said they are 18+.

    DPDP s9 requires verifiable parental consent before processing a child's
    data. We cannot obtain it, so the only position we can actually hold is
    not to process it: if the age is unknown, no account is created.

    Before this, `is_adult` was stored and never read, which meant the age
    gate existed only in the UI - `POST /auth/dev` with the field omitted
    created a working account flagged `is_adult_confirmed: false` that
    nothing anywhere treated differently.

    **New accounts only, deliberately.** Existing accounts sign in without
    re-asserting, for two reasons: every account predating the consent work
    would otherwise be locked out of its own data, including the erasure
    endpoint, and locking someone out is not a remedy for not knowing their
    age. The cost is that a client too old to send the field can no longer
    create accounts - which is the correct failure direction.

    A self-declared checkbox is not "verifiable" in the Act's sense. It is
    the floor. It is also the difference between a rule that is applied and
    one that is merely recorded.
    """
    if not is_adult:
        raise HTTPException(status_code=403, detail=ADULT_REQUIRED)


def consent_fields(is_adult: bool, now: datetime) -> Dict[str, Any]:
    """The consent sub-document and age confirmation for a new account."""
    return {
        "consent": {
            "notice_version": PRIVACY_NOTICE_VERSION,
            "granted_at": now,
            "purposes": list(CONSENT_PURPOSES),
        },
        "is_adult_confirmed": bool(is_adult),
    }


def backfill_fields(
    existing: Optional[Dict[str, Any]], is_adult: bool, now: datetime
) -> Dict[str, Any]:
    """Fields to `$set` on a returning user, or `{}` to leave them alone.

    Only fills a genuine gap. An account that already carries consent keeps
    the grant it has: the first affirmative action is the record, and
    silently restamping it on every sign-in would destroy the timestamp that
    makes the record worth keeping.

    Returns `{}` when the client sent no affirmative signal, so a legacy app
    build cannot manufacture consent for a user who was never asked.
    """
    if not existing or existing.get("consent"):
        return {}
    if not is_adult:
        return {}
    return consent_fields(is_adult, now)
