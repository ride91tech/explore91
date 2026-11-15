"""Deleting an account actually deletes it.

The right to erasure is the one feature where "it returned 200" proves
nothing. These tests create a user, give them a row in every collection
that can hold one, delete the account, and then go and look in the
database.

The classification being tested is the judgement in core/erasure.py:

  deleted     rows that exist only because the user does
  anonymised  rows with standing value to a business, identity stripped
  released    business listings, which are not the user's personal data

A test that only checked "the user row is gone" would pass against an
implementation that left every review, booking and session behind.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from booking_dates import future_date

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_DIR = os.path.dirname(_BACKEND_DIR)
load_dotenv(os.path.join(_REPO_DIR, "frontend", ".env"))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))

BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "gw0")


def _unique_ip() -> str:
    """A caller IP nobody else in the suite is using.

    /auth/dev is unauthenticated, so its limiter keys on the client IP, and
    every test in the suite arrives from 127.0.0.1. Sharing one bucket makes
    any test that signs in fail whenever the suite is busy - which is how
    these tests passed alone and failed in the full run. Authenticated calls
    key on user_id and need no such help.
    """
    return "10.%d.%d.%d" % (
        uuid.uuid4().int % 256, uuid.uuid4().int % 256, uuid.uuid4().int % 254 + 1
    )


# Seeded addresses are lowercase on purpose: dev sign-in lowercases the
# address before looking it up, so a mixed-case seed is never matched and the
# handler quietly creates a SECOND account - which made a backfill test fail
# while inspecting the untouched original.
def _signin(email: str, name: str):
    return requests.post(
        f"{BASE_URL}/api/auth/dev",
        json={"email": email, "name": name, "is_adult": True},
        headers={"X-Forwarded-For": _unique_ip()},
        timeout=20,
    )


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    import asyncio

    return asyncio.new_event_loop().run_until_complete(coro)


async def _count(collection: str, query: dict) -> int:
    """Build the client inside the coroutine.

    _run spins a fresh loop per call and a Motor client binds to whichever
    loop was current when it was created, so building one outside and
    awaiting inside raises "the future belongs to a different loop".
    """
    return await _mongo()[collection].count_documents(query)


async def _find(collection: str, query: dict):
    return await _mongo()[collection].find_one(query, {"_id": 0})


async def _insert(collection: str, doc: dict) -> None:
    await _mongo()[collection].insert_one(doc)


async def _drop(collection: str, query: dict) -> None:
    await _mongo()[collection].delete_many(query)


@pytest.fixture
def subject():
    """A user with a row in every collection erasure touches.

    Rows are written directly rather than through the API because several
    of these endpoints need a real business, and the point here is the
    erasure cascade, not the happy path of six other features.
    """
    email = f"test_erase_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
    uid = f"user_{uuid.uuid4().hex[:12]}"
    token = f"test_{uuid.uuid4().hex}"
    biz_id = f"TEST_erase_biz_{uuid.uuid4().hex[:8]}"

    async def _seed():
        now = datetime.now(timezone.utc)
        await _insert("users", {
            "user_id": uid, "email": email, "name": "Erasure Subject",
            "picture": None, "wallet_points": 0, "home_city": "Goa",
            "roles": ["customer"], "created_at": now,
        })
        await _insert("user_sessions", {
            "session_token": token, "user_id": uid, "created_at": now,
            "expires_at": now + timedelta(days=7),
        })
        for coll in ("saved", "reel_likes", "place_interest", "journey_visits"):
            await _insert(coll, {"user_id": uid, "created_at": now})
        await _insert("tickets", {
            "ticket_id": f"tk_{uuid.uuid4().hex[:8]}", "user_id": uid,
            "subject": "s", "message": "private words", "created_at": now,
        })
        await _insert("reviews", {
            "review_id": f"rv_{uuid.uuid4().hex[:8]}", "user_id": uid,
            "user_name": "Erasure Subject", "business_id": biz_id,
            "rating": 5, "comment": "Lovely", "created_at": now,
        })
        await _insert("bookings", {
            "booking_id": f"bk_{uuid.uuid4().hex[:8]}", "user_id": uid,
            "business_id": biz_id, "notes": "allergic to peanuts",
            "date": future_date(1), "time": "19:00", "guests": 2,
            "created_at": now,
        })
        await _insert("businesses", {
            "business_id": biz_id, "owner_id": uid, "name": "Erasure Test Co",
            "category": "cafes", "city": "goa", "is_approved": True,
        })
        # The two collections the first cascade missed, because neither keys
        # on user_id.
        await _insert("admin_audit", {
            "audit_id": f"au_{uuid.uuid4().hex[:8]}", "actor_id": uid,
            "actor_email": "erasure-subject@explore91.dev",
            "actor_name": "Erasure Subject", "action": "business.approve",
            "entity_type": "business", "entity_id": biz_id, "at": now,
        })
        await _insert("fraud_flags", {
            "flag_id": f"fl_{uuid.uuid4().hex[:8]}", "entity_type": "user",
            "entity_id": uid, "reason": "smoke test flag", "created_at": now,
        })

    _run(_seed())
    yield {"uid": uid, "token": token, "email": email, "biz_id": biz_id}

    async def _clean():
        for coll in ("saved", "reel_likes", "place_interest", "journey_visits",
                     "tickets", "reviews", "bookings", "user_sessions"):
            await _drop(coll, {"user_id": uid})
        await _drop("admin_audit", {"entity_id": biz_id})
        await _drop("fraud_flags", {"reason": "smoke test flag"})
        await _drop("businesses", {"business_id": biz_id})
        await _drop("users", {"user_id": uid})

    _run(_clean())


async def _run_erase(user_id: str):
    """Call the cascade directly, for cases with no account behind them."""
    import sys, os
    sys.path.insert(0, _BACKEND_DIR)
    from core.erasure import erase_user
    return await erase_user(user_id)


def _erase(token):
    return requests.delete(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {token}"}, timeout=30,
    )


class TestErasure:
    def test_the_account_is_gone(self, subject):
        assert _erase(subject["token"]).status_code == 200
        assert _run(_count("users", {"user_id": subject["uid"]})) == 0

    def test_the_session_stops_working(self, subject):
        _erase(subject["token"])
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {subject['token']}"}, timeout=20,
        )
        assert r.status_code == 401, "an erased user could still authenticate"

    def test_rows_that_exist_only_for_this_user_are_deleted(self, subject):
        _erase(subject["token"])
        for coll in ("saved", "reel_likes", "place_interest",
                     "journey_visits", "tickets", "user_sessions"):
            n = _run(_count(coll, {"user_id": subject["uid"]}))
            assert n == 0, f"{coll} still holds {n} row(s) for an erased user"

    def test_the_email_cannot_be_found_again(self, subject):
        """The whole point. A row keyed to anything but user_id would be
        missed by a cascade that only follows user_id."""
        _erase(subject["token"])
        assert _run(_count("users", {"email": subject["email"]})) == 0

    def test_signing_in_again_creates_a_new_person(self, subject):
        """Erasure is not deactivation: the same address must come back as a
        fresh account with none of the old data attached."""
        old_uid = subject["uid"]
        _erase(subject["token"])
        r = _signin(subject["email"], "Returned")
        assert r.status_code == 200, r.text
        new_uid = r.json()["user"]["user_id"]
        assert new_uid != old_uid, "the old account was resurrected, not erased"
        _run(_drop("users", {"user_id": new_uid}))
        _run(_drop("user_sessions", {"user_id": new_uid}))


class TestWhatSurvives:
    """Erasure must not be a weapon against the businesses a user reviewed."""

    def test_the_review_survives_without_its_author(self, subject):
        _erase(subject["token"])
        row = _run(_find("reviews", {"business_id": subject["biz_id"]}))
        assert row is not None, "the review was destroyed with the account"
        assert row["comment"] == "Lovely", "the business lost the review body"
        assert row["user_name"] == "", "the author's name survived erasure"
        assert row["user_id"] != subject["uid"]
        assert row["user_id"].startswith("deleted_")

    def test_the_booking_survives_without_the_free_text(self, subject):
        _erase(subject["token"])
        row = _run(_find("bookings", {"business_id": subject["biz_id"]}))
        assert row is not None, "the business lost its booking record"
        assert row["notes"] == "", "free text the user typed survived erasure"
        assert row["user_id"].startswith("deleted_")

    def test_the_business_listing_is_released_not_deleted(self, subject):
        """A listing is not the owner's personal data. It becomes unclaimed,
        exactly as an admin-created listing is."""
        _erase(subject["token"])
        row = _run(_find("businesses", {"business_id": subject["biz_id"]}))
        assert row is not None, "a public listing was deleted with its owner"
        assert row["owner_id"] == ""
        assert row["name"] == "Erasure Test Co"

    def test_the_audit_row_keeps_the_action_and_loses_the_person(self, subject):
        """An audit trail with holes is not an audit trail, so the row stays.
        But it carried `actor_email` - directly identifying data, not just an
        id - and outlived erasure completely."""
        _erase(subject["token"])
        row = _run(_find("admin_audit", {"entity_id": subject["biz_id"]}))
        assert row is not None, "the audit trail lost an entry"
        assert row["action"] == "business.approve", "the action was destroyed"
        assert row["actor_email"] == "", "an erased user's EMAIL survived"
        assert row["actor_name"] == "", "an erased user's name survived"
        assert row["actor_id"].startswith("deleted_")

    def test_a_fraud_flag_stops_pointing_at_a_person(self, subject):
        """Abuse records have a retention argument, so the flag stays and
        stops naming anyone."""
        _erase(subject["token"])
        row = _run(_find("fraud_flags", {"reason": "smoke test flag"}))
        assert row is not None, "the abuse record was destroyed"
        assert row["entity_id"] != subject["uid"]
        assert row["entity_id"].startswith("deleted_")

    def test_flags_on_other_entity_types_are_untouched(self):
        """fraud_flags is matched on entity_type too. A flag on a BUSINESS
        whose entity_id happens to equal some user's id must not be caught."""
        collide = f"user_{uuid.uuid4().hex[:12]}"
        fid = f"fl_{uuid.uuid4().hex[:8]}"
        _run(_insert("fraud_flags", {
            "flag_id": fid, "entity_type": "business", "entity_id": collide,
            "reason": "collision guard", "created_at": datetime.now(timezone.utc),
        }))
        try:
            _run(_run_erase(collide))
            row = _run(_find("fraud_flags", {"flag_id": fid}))
            assert row["entity_id"] == collide,                 "erasing a user rewrote a flag about a business"
        finally:
            _run(_drop("fraud_flags", {"flag_id": fid}))

    def test_two_rows_from_one_person_share_a_tombstone(self, subject):
        """Anonymised, not scrambled: a business can still see that one
        person left this review and that booking, without knowing who."""
        _erase(subject["token"])
        rev = _run(_find("reviews", {"business_id": subject["biz_id"]}))
        bkg = _run(_find("bookings", {"business_id": subject["biz_id"]}))
        assert rev["user_id"] == bkg["user_id"]


class TestAdultGate:
    """is_adult used to be stored and never read: the age gate existed only
    in the UI, and a direct POST created a working account regardless."""

    def test_a_new_account_without_the_confirmation_is_refused(self):
        email = f"test_minor_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
        r = requests.post(
            f"{BASE_URL}/api/auth/dev",
            json={"email": email, "name": "Nope"},          # no is_adult
            headers={"X-Forwarded-For": _unique_ip()}, timeout=20,
        )
        assert r.status_code == 403, r.text
        assert not _run(_find("users", {"email": email})),             "a refused sign-up still created an account"

    def test_explicit_false_is_refused_too(self):
        email = f"test_minor2_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
        r = requests.post(
            f"{BASE_URL}/api/auth/dev",
            json={"email": email, "name": "Nope", "is_adult": False},
            headers={"X-Forwarded-For": _unique_ip()}, timeout=20,
        )
        assert r.status_code == 403, r.text
        assert not _run(_find("users", {"email": email}))

    def test_the_confirmation_lets_a_new_account_through(self):
        email = f"test_adult_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
        r = _signin(email, "Fine")
        assert r.status_code == 200, r.text
        uid = r.json()["user"]["user_id"]
        _run(_drop("users", {"user_id": uid}))
        _run(_drop("user_sessions", {"user_id": uid}))

    def test_an_existing_account_is_not_locked_out(self):
        """The gate is on account CREATION. Locking an existing user out of
        their own data - including the erasure endpoint - is not a remedy for
        not knowing their age."""
        email = f"test_existing_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
        uid = f"user_{uuid.uuid4().hex[:12]}"
        _run(_insert("users", {
            "user_id": uid, "email": email, "name": "Established",
            "picture": None, "wallet_points": 0, "home_city": "Goa",
            "roles": ["customer"], "created_at": datetime.now(timezone.utc),
        }))
        try:
            r = requests.post(
                f"{BASE_URL}/api/auth/dev",
                json={"email": email, "name": "Established"},   # no is_adult
                headers={"X-Forwarded-For": _unique_ip()}, timeout=20,
            )
            assert r.status_code == 200, "an existing user was locked out"
            assert r.json()["user"]["user_id"] == uid
        finally:
            _run(_drop("users", {"user_id": uid}))
            _run(_drop("user_sessions", {"user_id": uid}))


class TestGuards:
    def test_anonymous_cannot_erase(self):
        assert requests.delete(f"{BASE_URL}/api/auth/me", timeout=20).status_code == 401

    def test_a_bad_token_cannot_erase(self):
        r = requests.delete(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer not_a_real_token"}, timeout=20,
        )
        assert r.status_code == 401


class TestConsentRecord:
    def _legacy_user(self, email: str) -> str:
        """An account as it exists today: created before consent was recorded."""
        uid = f"user_{uuid.uuid4().hex[:12]}"
        _run(_insert("users", {
            "user_id": uid, "email": email, "name": "Legacy",
            "picture": None, "wallet_points": 0, "home_city": "Goa",
            "roles": ["customer"], "created_at": datetime.now(timezone.utc),
        }))
        return uid

    def test_a_returning_account_without_consent_is_backfilled(self):
        """Every account that predates this work signs in with the box ticked.
        Recording consent only for new accounts leaves exactly the existing
        population permanently unanswerable."""
        email = f"test_legacy_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
        uid = self._legacy_user(email)
        try:
            assert _signin(email, "Legacy").status_code == 200
            row = _run(_find("users", {"user_id": uid}))
            assert (row.get("consent") or {}).get("notice_version"),                 "a returning user ticked the box and nothing was recorded"
            assert row.get("is_adult_confirmed") is True
        finally:
            _run(_drop("users", {"user_id": uid}))
            _run(_drop("user_sessions", {"user_id": uid}))

    def test_an_existing_consent_is_not_restamped(self):
        """The first affirmative action is the record. Rewriting granted_at on
        every sign-in would destroy the only thing that makes it useful."""
        email = f"test_restamp_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
        uid = self._legacy_user(email)
        try:
            assert _signin(email, "Legacy").status_code == 200
            first = _run(_find("users", {"user_id": uid}))["consent"]["granted_at"]
            assert _signin(email, "Legacy").status_code == 200
            second = _run(_find("users", {"user_id": uid}))["consent"]["granted_at"]
            assert first == second, "signing in again rewrote the consent timestamp"
        finally:
            _run(_drop("users", {"user_id": uid}))
            _run(_drop("user_sessions", {"user_id": uid}))

    def test_a_client_that_sends_no_signal_records_no_consent(self):
        """An older app build must not manufacture agreement for a user who
        was never shown the box."""
        email = f"test_nosignal_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
        uid = self._legacy_user(email)
        try:
            r = requests.post(
                f"{BASE_URL}/api/auth/dev",
                json={"email": email, "name": "Legacy"},   # no is_adult
                headers={"X-Forwarded-For": _unique_ip()},
                timeout=20,
            )
            assert r.status_code == 200, r.text
            row = _run(_find("users", {"user_id": uid}))
            assert not row.get("consent"), "consent was invented from silence"
            assert not row.get("is_adult_confirmed")
        finally:
            _run(_drop("users", {"user_id": uid}))
            _run(_drop("user_sessions", {"user_id": uid}))

    def test_a_new_account_records_what_it_consented_to(self):
        """DPDP s6 wants consent that is specific and recorded. "They
        agreed" must be answerable with a version and a timestamp."""
        email = f"test_consent_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
        r = _signin(email, "Consenter")
        assert r.status_code == 200, r.text
        uid = r.json()["user"]["user_id"]
        try:
            row = _run(_find("users", {"user_id": uid}))
            consent = row.get("consent") or {}
            assert consent.get("notice_version"), "no notice version recorded"
            assert consent.get("granted_at"), "no consent timestamp recorded"
            assert consent.get("purposes"), "consent recorded against no purpose"
            assert row.get("is_adult_confirmed") is True
        finally:
            _run(_drop("users", {"user_id": uid}))
            _run(_drop("user_sessions", {"user_id": uid}))
