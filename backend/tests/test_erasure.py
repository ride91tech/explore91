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
    email = f"TEST_erase_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
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
            "date": "2026-11-01", "time": "19:00", "guests": 2,
            "created_at": now,
        })
        await _insert("businesses", {
            "business_id": biz_id, "owner_id": uid, "name": "Erasure Test Co",
            "category": "cafes", "city": "goa", "is_approved": True,
        })

    _run(_seed())
    yield {"uid": uid, "token": token, "email": email, "biz_id": biz_id}

    async def _clean():
        for coll in ("saved", "reel_likes", "place_interest", "journey_visits",
                     "tickets", "reviews", "bookings", "user_sessions"):
            await _drop(coll, {"user_id": uid})
        await _drop("businesses", {"business_id": biz_id})
        await _drop("users", {"user_id": uid})

    _run(_clean())


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

    def test_two_rows_from_one_person_share_a_tombstone(self, subject):
        """Anonymised, not scrambled: a business can still see that one
        person left this review and that booking, without knowing who."""
        _erase(subject["token"])
        rev = _run(_find("reviews", {"business_id": subject["biz_id"]}))
        bkg = _run(_find("bookings", {"business_id": subject["biz_id"]}))
        assert rev["user_id"] == bkg["user_id"]


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
    def test_a_new_account_records_what_it_consented_to(self):
        """DPDP s6 wants consent that is specific and recorded. "They
        agreed" must be answerable with a version and a timestamp."""
        email = f"TEST_consent_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"
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
