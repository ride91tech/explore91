"""The owner dashboard's revenue is what the bookings are worth.

It used to be a hard-coded "demo" ₹50 per booking, cancelled ones included,
under a label saying "Estimated revenue". The admin reports already summed
each booking's real amount_inr and skipped cancellations; the owner figure
now uses the same rule (core/revenue.py).

revenue_inr is sent in hundredths of a rupee, because the app divides it by
100 and installed builds would show a figure 100x too small if that changed.
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _db():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture
def owner_with_bookings():
    tag = uuid.uuid4().hex[:8]
    uid, token = f"user_TESTrev_{tag}", f"tok_TESTrev_{uuid.uuid4().hex}"
    bids = [f"biz_TESTrev_{tag}_{i}" for i in (1, 2)]
    now = datetime.now(timezone.utc)

    def booking(bid, amount, source, status="confirmed"):
        return {"booking_id": f"bk_TESTrev_{uuid.uuid4().hex[:10]}", "user_id": "someone_else",
                "business_id": bid, "business_name": "TESTrev", "business_image": "",
                "date": "2031-01-01", "time": "19:00", "guests": 2, "status": status,
                "amount_inr": amount, "amount_source": source, "created_at": now}

    async def _setup():
        db = _db()
        await db.users.insert_one({"user_id": uid, "email": f"TESTrev_{tag}@explore91.test",
                                   "name": "TESTrev Owner", "roles": ["customer", "owner"],
                                   "wallet_points": 0, "created_at": now})
        await db.user_sessions.insert_one({"user_id": uid, "session_token": token,
                                           "expires_at": now + timedelta(days=1), "created_at": now})
        await db.businesses.insert_many([
            {"business_id": b, "owner_id": uid, "name": "TESTrev Place", "category": "cafes", "city": "goa",
             "address": "x", "lat": 15.5, "lng": 73.8, "cover_image": "", "rating": 0.0, "review_count": 0,
             "is_approved": True} for b in bids])
        await db.bookings.insert_many([
            booking(bids[0], 1500, "service"),                    # real price
            booking(bids[1], 2400, "estimate"),                   # price-band estimate
            booking(bids[1], 9999, "service", status="cancelled"),  # must not count
            booking("biz_someone_elses", 7777, "service"),        # another owner's place
        ])
    _run(_setup())
    yield {"Authorization": f"Bearer {token}"}

    async def _clean():
        db = _db()
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_many({"user_id": uid})
        await db.businesses.delete_many({"business_id": {"$in": bids}})
        await db.bookings.delete_many({"business_name": "TESTrev"})
    _run(_clean())


def test_owner_revenue_sums_real_amounts_and_skips_cancelled(owner_with_bookings):
    r = requests.get(f"{BASE_URL}/api/owner/dashboard", headers=owner_with_bookings, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["revenue_inr"] == (1500 + 2400) * 100, d["revenue_inr"]
    assert (d["confirmed_revenue_inr"], d["estimated_revenue_inr"]) == (1500, 2400)
