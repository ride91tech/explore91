"""Shared fixtures for Explore91 backend tests."""
import os
import sys
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Resolve the repo layout from this file so the suite runs anywhere, not just
# inside the container where it happened to live at /app.
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_DIR = os.path.dirname(BACKEND_DIR)
SERVER_PY = os.path.join(BACKEND_DIR, "server.py")

# Make the modular package layout (core/, routes/, seed/) importable.
sys.path.insert(0, BACKEND_DIR)

load_dotenv(os.path.join(REPO_DIR, "frontend", ".env"))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

# The suite drives the API over HTTP while seeding fixtures straight into Mongo,
# so both must address the same deployment. frontend/.env is the mobile app's
# backend URL and legitimately points at production, so taking BASE_URL from it
# would aim destructive admin tests at live data. TEST_BASE_URL overrides it.
#
# The default is the literal 127.0.0.1 rather than "localhost" deliberately.
# On Windows "localhost" resolves to ::1 first and each new connection pays a
# ~2s fallback before reaching the IPv4 listener. requests opens a fresh
# connection per call, so a test that fires 25 of them took 60s instead of 4 —
# long enough for the rate limiter's 60s window to roll over mid-loop, which
# made the limiter tests fail for a reason that had nothing to do with the
# limiter. CI sets TEST_BASE_URL and never saw it; only developer machines did.
BASE_URL = (
    os.environ.get("TEST_BASE_URL")
    or "http://127.0.0.1:8000"
).rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

# Refuse to run against anything but a local deployment unless explicitly
# allowed. These tests create admin sessions and delete businesses, reels and
# users; pointed at production they would destroy real data.
if not (
    BASE_URL.startswith("http://localhost")
    or BASE_URL.startswith("http://127.0.0.1")
    or os.environ.get("ALLOW_REMOTE_TESTS") == "1"
):
    raise RuntimeError(
        f"Refusing to run the test suite against {BASE_URL}.\n"
        "These tests delete data. Run them against a local server, or set "
        "ALLOW_REMOTE_TESTS=1 if you genuinely mean to target a remote one."
    )


@pytest.fixture(scope="session")
def base_url():
    assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def test_session():
    """Seed a user + session directly in MongoDB and return (token, user_id)."""
    async def _seed():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        now = datetime.now(timezone.utc)
        worker = os.environ.get("PYTEST_XDIST_WORKER", "gw0")
        email = f"TEST_explore91_{worker}_{uuid.uuid4().hex[:6]}@explore91.dev"
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": "Explore Tester",
            "picture": None,
            "wallet_points": 500,
            "home_city": "Goa",
            "created_at": now,
        })
        token = f"test_{uuid.uuid4().hex}"
        await db.user_sessions.insert_one({
            "session_token": token,
            "user_id": user_id,
            "created_at": now,
            "expires_at": now + timedelta(days=7),
        })
        client.close()
        return token, user_id, email

    return asyncio.get_event_loop().run_until_complete(_seed())


@pytest.fixture(scope="session")
def auth_headers(test_session):
    token, _, _ = test_session
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def customer_session():
    """Fresh session with only 'customer' role — for RBAC 403 tests."""
    async def _seed():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        now = datetime.now(timezone.utc)
        worker = os.environ.get("PYTEST_XDIST_WORKER", "gw0")
        email = f"TEST_explore91_cust_{worker}_{uuid.uuid4().hex[:6]}@explore91.dev"
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": "Customer Tester",
            "picture": None,
            "wallet_points": 500,
            "home_city": "Goa",
            "roles": ["customer"],
            "created_at": now,
        })
        token = f"test_{uuid.uuid4().hex}"
        await db.user_sessions.insert_one({
            "session_token": token,
            "user_id": user_id,
            "created_at": now,
            "expires_at": now + timedelta(days=7),
        })
        client.close()
        return token, user_id, email
    return asyncio.get_event_loop().run_until_complete(_seed())


@pytest.fixture(scope="session", autouse=True)
def cleanup(request, test_session, customer_session):
    yield
    async def _clean():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        for token, user_id, email in (test_session, customer_session):
            await db.user_sessions.delete_many({"user_id": user_id})
            await db.users.delete_many({"email": email})
            await db.bookings.delete_many({"user_id": user_id})
            await db.saved.delete_many({"user_id": user_id})
            await db.reviews.delete_many({"user_id": user_id})
            await db.businesses.delete_many({"owner_id": user_id})
            await db.staff.delete_many({"business_id": {"$regex": "^biz_"}})
            await db.reel_likes.delete_many({"user_id": user_id})
        # Clean any TEST_ businesses + owner-created reels left from prior runs
        await db.businesses.delete_many({"name": {"$regex": "^TEST_OwnerBiz"}})
        await db.reels.delete_many({"caption": {"$regex": "^TEST reel"}})
        client.close()
    asyncio.get_event_loop().run_until_complete(_clean())
