"""Explore91 v7 — admin console repairs.

Covers the fixes made to the admin surface:
- Bookings capture a real amount at creation; reports sum it instead of a constant
- Cancelled bookings are excluded from revenue
- GMV series buckets by created_at (not the future reservation date)
- Pagination + X-Total-Count + server-side search on users/businesses/reels
- Limit bounds are enforced
- Every mutating admin action writes an audit entry
"""
import os
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_DIR = os.path.dirname(_BACKEND_DIR)
load_dotenv(os.path.join(_REPO_DIR, "frontend", ".env"))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))

# Same guard as conftest: never let the mobile app's production URL aim
# these destructive tests at live data.
BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _seed_user(email: str, roles):
    db = _mongo()
    now = datetime.now(timezone.utc)
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": user_id, "email": email, "name": "V7 Tester",
        "picture": None, "wallet_points": 500, "home_city": "Goa",
        "roles": list(roles), "created_at": now,
    })
    token = f"test_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": token, "user_id": user_id,
        "created_at": now, "expires_at": now + timedelta(days=7),
    })
    return token, user_id


@pytest.fixture(scope="module")
def admin(request):
    worker = os.environ.get("PYTEST_XDIST_WORKER", "gw0")
    email = f"TEST_v7_admin_{worker}_{uuid.uuid4().hex[:6]}@explore91.dev"
    token, user_id = _run(_seed_user(email, ["customer", "admin"]))
    ctx = {
        "token": token, "user_id": user_id, "email": email,
        "H": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    }
    yield ctx

    async def _clean():
        db = _mongo()
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.users.delete_many({"email": email})
        await db.bookings.delete_many({"user_id": user_id})
        await db.admin_audit.delete_many({"actor_id": user_id})
    _run(_clean())


@pytest.fixture(scope="module")
def priced_business():
    """A business that has at least one priced service."""
    async def _get():
        db = _mongo()
        return await db.businesses.find_one(
            {"services.0": {"$exists": True}},
            {"_id": 0, "business_id": 1, "name": 1, "services": 1, "price_range": 1},
        )
    biz = _run(_get())
    assert biz, "seed data should contain a business with priced services"
    return biz


# ============================================================================
# Booking amounts
# ============================================================================
class TestBookingAmounts:
    def test_service_booking_uses_real_price(self, admin, priced_business):
        svc = priced_business["services"][0]
        r = requests.post(f"{BASE_URL}/api/bookings", headers=admin["H"], json={
            "business_id": priced_business["business_id"],
            "date": "2026-11-01", "time": "18:00", "guests": 2,
            "service_name": svc["name"], "notes": "TESTv7_service",
        }, timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["amount_inr"] == svc["price"] * 2, b
        assert b["amount_source"] == "service", b

    def test_reservation_without_service_is_flagged_estimate(self, admin, priced_business):
        r = requests.post(f"{BASE_URL}/api/bookings", headers=admin["H"], json={
            "business_id": priced_business["business_id"],
            "date": "2026-11-02", "time": "20:00", "guests": 3,
            "notes": "TESTv7_estimate",
        }, timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["amount_source"] == "estimate", b
        assert b["amount_inr"] > 0, b

    def test_unknown_service_name_falls_back_to_estimate(self, admin, priced_business):
        r = requests.post(f"{BASE_URL}/api/bookings", headers=admin["H"], json={
            "business_id": priced_business["business_id"],
            "date": "2026-11-03", "time": "12:00", "guests": 1,
            "service_name": "No Such Service On The Menu",
            "notes": "TESTv7_unknown",
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["amount_source"] == "estimate", r.text


# ============================================================================
# Revenue reporting
# ============================================================================
class TestRevenueReporting:
    def test_gmv_sums_real_amounts_and_splits_confirmed(self, admin, priced_business):
        async def _clear():
            await _mongo().bookings.delete_many({"user_id": admin["user_id"]})
        _run(_clear())

        svc = priced_business["services"][0]
        r1 = requests.post(f"{BASE_URL}/api/bookings", headers=admin["H"], json={
            "business_id": priced_business["business_id"], "date": "2026-11-05",
            "time": "18:00", "guests": 2, "service_name": svc["name"],
            "notes": "TESTv7_gmv_service",
        }, timeout=15).json()
        r2 = requests.post(f"{BASE_URL}/api/bookings", headers=admin["H"], json={
            "business_id": priced_business["business_id"], "date": "2026-11-06",
            "time": "19:00", "guests": 2, "notes": "TESTv7_gmv_estimate",
        }, timeout=15).json()

        rep = requests.get(f"{BASE_URL}/api/admin/reports/gmv?days=30",
                           headers=admin["H"], timeout=15).json()
        assert rep["total_gmv"] >= r1["amount_inr"] + r2["amount_inr"]
        assert rep["confirmed_gmv"] >= r1["amount_inr"]
        assert rep["total_gmv"] == rep["confirmed_gmv"] + rep["estimated_gmv"]
        # Fees must track the real gross, not a per-booking constant.
        assert rep["total_fees"] == int(rep["total_gmv"] * 0.05)

    def test_cancelled_booking_leaves_revenue(self, admin, priced_business):
        before = requests.get(f"{BASE_URL}/api/admin/reports/gmv?days=30",
                              headers=admin["H"], timeout=15).json()
        b = requests.post(f"{BASE_URL}/api/bookings", headers=admin["H"], json={
            "business_id": priced_business["business_id"], "date": "2026-11-07",
            "time": "21:00", "guests": 2, "notes": "TESTv7_cancelme",
        }, timeout=15).json()

        mid = requests.get(f"{BASE_URL}/api/admin/reports/gmv?days=30",
                           headers=admin["H"], timeout=15).json()
        assert mid["total_gmv"] == before["total_gmv"] + b["amount_inr"]

        d = requests.delete(f"{BASE_URL}/api/bookings/{b['booking_id']}",
                            headers=admin["H"], timeout=15)
        assert d.status_code == 200

        after = requests.get(f"{BASE_URL}/api/admin/reports/gmv?days=30",
                             headers=admin["H"], timeout=15).json()
        assert after["total_gmv"] == before["total_gmv"], "cancelled booking still counted"
        assert after["total_bookings"] == before["total_bookings"]

    def test_series_buckets_by_created_at_not_reservation_date(self, admin, priced_business):
        """A booking made today for a 2027 date must land on today's bucket."""
        requests.post(f"{BASE_URL}/api/bookings", headers=admin["H"], json={
            "business_id": priced_business["business_id"], "date": "2027-06-15",
            "time": "18:00", "guests": 1, "notes": "TESTv7_future",
        }, timeout=15)
        rep = requests.get(f"{BASE_URL}/api/admin/reports/gmv?days=7",
                           headers=admin["H"], timeout=15).json()
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        dates = [s["date"] for s in rep["series"]]
        assert today in dates, dates
        assert not any(d.startswith("2027") for d in dates), dates

    def test_stats_excludes_cancelled_and_reports_split(self, admin):
        s = requests.get(f"{BASE_URL}/api/admin/stats", headers=admin["H"], timeout=15).json()
        for key in ("cancelled_bookings", "confirmed_revenue_inr",
                    "estimated_revenue_inr", "gross_revenue_inr", "platform_fees_inr"):
            assert key in s, s
        assert s["gross_revenue_inr"] == s["confirmed_revenue_inr"] + s["estimated_revenue_inr"]
        assert s["platform_fees_inr"] == int(s["gross_revenue_inr"] * 0.05)


# ============================================================================
# Pagination & search
# ============================================================================
class TestPaginationAndSearch:
    def test_users_returns_total_count_header(self, admin):
        r = requests.get(f"{BASE_URL}/api/admin/users?limit=1", headers=admin["H"], timeout=15)
        assert r.status_code == 200
        assert "X-Total-Count" in r.headers, dict(r.headers)
        total = int(r.headers["X-Total-Count"])
        assert total >= 1
        assert len(r.json()) <= 1
        # The body stays a plain list for existing consumers.
        assert isinstance(r.json(), list)

    def test_user_search_finds_beyond_first_page(self, admin):
        """Search must hit the database, not just filter the loaded page."""
        r = requests.get(f"{BASE_URL}/api/admin/users",
                         params={"q": admin["email"], "limit": 5},
                         headers=admin["H"], timeout=15)
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert admin["email"] in emails, emails

    def test_business_search_is_server_side(self, admin):
        r = requests.get(f"{BASE_URL}/api/admin/businesses",
                         params={"q": "casa", "limit": 50},
                         headers=admin["H"], timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 1
        assert all("casa" in (b["name"] + b["city"] + b["address"]).lower() for b in rows)

    def test_offset_pages_do_not_repeat(self, admin):
        p1 = requests.get(f"{BASE_URL}/api/admin/businesses?limit=5&offset=0",
                          headers=admin["H"], timeout=15).json()
        p2 = requests.get(f"{BASE_URL}/api/admin/businesses?limit=5&offset=5",
                          headers=admin["H"], timeout=15).json()
        ids1 = {b["business_id"] for b in p1}
        ids2 = {b["business_id"] for b in p2}
        assert ids1 and ids2
        assert not (ids1 & ids2), "pages overlap"

    def test_regex_metacharacters_in_search_are_escaped(self, admin):
        """A ReDoS-style query must be treated as a literal, not a pattern."""
        r = requests.get(f"{BASE_URL}/api/admin/businesses",
                         params={"q": "(a+)+$", "limit": 5},
                         headers=admin["H"], timeout=15)
        assert r.status_code == 200
        assert r.json() == []

    @pytest.mark.parametrize("path", ["users", "businesses", "reels"])
    def test_limit_bounds_enforced(self, admin, path):
        too_big = requests.get(f"{BASE_URL}/api/admin/{path}?limit=100000",
                               headers=admin["H"], timeout=15)
        assert too_big.status_code == 422, too_big.text
        zero = requests.get(f"{BASE_URL}/api/admin/{path}?limit=0",
                            headers=admin["H"], timeout=15)
        assert zero.status_code == 422
        negative_offset = requests.get(f"{BASE_URL}/api/admin/{path}?offset=-1",
                                       headers=admin["H"], timeout=15)
        assert negative_offset.status_code == 422


# ============================================================================
# Audit trail
# ============================================================================
class TestAuditTrail:
    def test_feature_toggle_is_recorded_with_actor_and_change(self, admin):
        biz = requests.get(f"{BASE_URL}/api/admin/businesses?q=casa&limit=1",
                           headers=admin["H"], timeout=15).json()[0]
        bid = biz["business_id"]

        r = requests.patch(f"{BASE_URL}/api/admin/businesses/{bid}/feature",
                           headers=admin["H"], timeout=15)
        assert r.status_code == 200
        new_val = r.json()["is_featured"]

        entries = requests.get(f"{BASE_URL}/api/admin/audit",
                               params={"entity_id": bid, "limit": 5},
                               headers=admin["H"], timeout=15).json()
        assert entries, "no audit entry written"
        top = entries[0]
        assert top["action"] == "business.feature"
        assert top["actor_email"] == admin["email"]
        assert top["after"]["is_featured"] is new_val
        assert top["before"]["is_featured"] is (not new_val)

        # restore
        requests.patch(f"{BASE_URL}/api/admin/businesses/{bid}/feature",
                       headers=admin["H"], timeout=15)

    def test_delete_keeps_a_snapshot_of_what_was_removed(self, admin):
        async def _mk():
            db = _mongo()
            bid = f"biz_TESTv7_{uuid.uuid4().hex[:6]}"
            await db.businesses.insert_one({
                "business_id": bid, "name": "TEST_OwnerBiz v7 audit",
                "city": "goa", "category": "cafes", "is_approved": True,
                "created_at": datetime.now(timezone.utc),
            })
            return bid
        bid = _run(_mk())

        d = requests.delete(f"{BASE_URL}/api/admin/businesses/{bid}",
                            headers=admin["H"], timeout=15)
        assert d.status_code == 200

        entries = requests.get(f"{BASE_URL}/api/admin/audit",
                               params={"entity_id": bid}, headers=admin["H"], timeout=15).json()
        assert entries, "delete left no audit trail"
        assert entries[0]["action"] == "business.delete"
        # The snapshot is the only remaining record of the deleted row.
        assert entries[0]["before"]["name"] == "TEST_OwnerBiz v7 audit"

    def test_block_records_actor_and_session_revocation(self, admin):
        worker = os.environ.get("PYTEST_XDIST_WORKER", "gw0")
        email = f"TEST_v7_victim_{worker}_{uuid.uuid4().hex[:6]}@explore91.dev"
        _, vuid = _run(_seed_user(email, ["customer"]))

        r = requests.patch(f"{BASE_URL}/api/admin/users/{vuid}/block",
                           headers=admin["H"], timeout=15)
        assert r.status_code == 200

        entries = requests.get(f"{BASE_URL}/api/admin/audit",
                               params={"entity_id": vuid}, headers=admin["H"], timeout=15).json()
        assert entries[0]["action"] == "user.block"
        assert entries[0]["actor_email"] == admin["email"]
        assert "revoked" in entries[0]["note"]

        async def _clean():
            db = _mongo()
            await db.users.delete_many({"email": email})
            await db.user_sessions.delete_many({"user_id": vuid})
            await db.admin_audit.delete_many({"entity_id": vuid})
        _run(_clean())

    def test_audit_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/audit", timeout=15)
        assert r.status_code == 401
