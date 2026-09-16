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

# Ensure /app/backend is importable when the test loads server.py via importlib
# (needed for the modular package layout: core/, routes/, seed/).
sys.path.insert(0, "/app/backend")

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


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
