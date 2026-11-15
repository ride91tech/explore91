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

from core.config import CONSENT_PURPOSES, PRIVACY_NOTICE_VERSION


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
