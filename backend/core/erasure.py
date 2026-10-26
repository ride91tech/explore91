"""Erasing a user, everywhere they exist.

DPDP s12(3) gives a data principal the right to have their personal data
erased, and Google Play requires in-app account deletion for any app that
lets you create an account. Both want the same thing, so there is one
implementation.

The hard part is not deleting rows. It is deciding which rows are *the
user's personal data* and which are records that happen to mention them and
have independent value to someone else. Deleting everything destroys a
business's review history and its booking ledger; deleting nothing is not
erasure. So each collection is classified, and the classification is the
interesting part of this file:

  DELETE     the row exists only because this user exists. Removing it
             removes nothing anyone else is entitled to.

  ANONYMISE  the row has standing value to a business or to the platform,
             but carries identity. The identity goes; the row stays, keyed
             to a tombstone id that cannot be linked back.

  RELEASE    the row is not the user's personal data at all - it is a
             business listing they happened to administer. It stays, and
             becomes unclaimed, exactly as an admin-created listing is.

A deleted user's id is replaced with `deleted_<random>` rather than blanked,
so anonymised rows stay distinguishable from each other. Two reviews by the
same deleted user remain visibly the same author without saying who.

This is deliberately not a soft delete. A flag on the row is not erasure,
and "deleted" accounts that can be restored are the thing the right exists
to prevent.
"""
import uuid
from typing import Dict

from core.db import db

# Rows that exist only because the user does.
_DELETE = (
    "user_sessions",
    "saved",
    "reel_likes",
    "place_interest",
    "journey_visits",
    "tickets",
)

# Rows worth keeping, with the identity stripped out. The second element is
# the fields to clear outright - display names and anything else that
# identifies a person rather than linking a row.
_ANONYMISE = (
    # `user_name` is the author's display name, shown on the business page.
    ("reviews", ("user_name",)),
    # A booking carries no name or phone - the business identifies the
    # customer by the booking id - but `notes` is free text the user typed
    # and can hold anything, so it goes.
    ("bookings", ("notes",)),
)

# Business listings administered by this user. Not their personal data.
_RELEASE = (("businesses", "owner_id"),)


async def erase_user(user_id: str) -> Dict[str, int]:
    """Erase a user and everything keyed to them. Returns what it touched.

    The counts are returned rather than logged because the caller is the
    only party entitled to know, and because a test that cannot see what
    happened cannot prove erasure happened.
    """
    tombstone = f"deleted_{uuid.uuid4().hex[:16]}"
    report: Dict[str, int] = {}

    for name in _DELETE:
        r = await db[name].delete_many({"user_id": user_id})
        report[name] = r.deleted_count

    for name, pii_fields in _ANONYMISE:
        r = await db[name].update_many(
            {"user_id": user_id},
            {"$set": {"user_id": tombstone, **{f: "" for f in pii_fields}}},
        )
        report[name] = r.modified_count

    for name, field in _RELEASE:
        r = await db[name].update_many({field: user_id}, {"$set": {field: ""}})
        report[name] = r.modified_count

    # Last, so a failure part-way through leaves an account that can still
    # sign in and retry rather than an orphaned pile of rows with no owner.
    r = await db.users.delete_many({"user_id": user_id})
    report["users"] = r.deleted_count

    return report
