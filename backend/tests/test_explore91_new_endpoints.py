"""Backend tests for Explore91 new endpoints (owner portal, admin, AI, roles, reviews)."""
import os
import time
import uuid

import pytest
import requests

# Same guard as conftest: never let the mobile app's production URL aim
# these destructive tests at live data.
BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://localhost:8000").rstrip("/")


# --- Regression: previously-passing endpoints -----------------------------
class TestRegression:
    def test_health(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_cities(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/cities")
        assert r.status_code == 200
        cities = r.json()
        assert isinstance(cities, list) and len(cities) >= 3
        assert any(c["slug"] == "goa" for c in cities)

    def test_categories(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/categories")
        assert r.status_code == 200
        assert any(c["slug"] == "cafes" for c in r.json())

    def test_businesses_goa(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/businesses", params={"city": "goa"})
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list) and len(docs) > 0
        for b in docs:
            assert b.get("is_approved", True) is not False
            assert "_id" not in b


# --- Role management ------------------------------------------------------
class TestRoleUpgrade:
    def test_upgrade_owner(self, api_client, auth_headers):
        r1 = api_client.post(f"{BASE_URL}/api/auth/roles",
                             json={"role": "owner"}, headers=auth_headers)
        assert r1.status_code == 200, r1.text
        roles1 = set(r1.json().get("roles", []))
        assert "owner" in roles1
        assert "_id" not in r1.json()

    def test_admin_self_grant_forbidden(self, api_client, auth_headers):
        # SEC-001: admin can no longer be self-granted for non-allowlisted emails
        r2 = api_client.post(f"{BASE_URL}/api/auth/roles",
                             json={"role": "admin"}, headers=auth_headers)
        assert r2.status_code == 403, r2.text
        assert "allowlist" in r2.text.lower()

    def test_invalid_role(self, api_client, auth_headers):
        # SEC-001: Pydantic pattern validation → 422
        r = api_client.post(f"{BASE_URL}/api/auth/roles",
                            json={"role": "hacker"}, headers=auth_headers)
        assert r.status_code == 422


# --- Owner endpoints require role ----------------------------------------
class TestOwnerAuthorization:
    """These run BEFORE role upgrade: use a fresh session with only 'customer'."""

    @pytest.fixture(scope="class")
    def customer_headers(self, customer_session):
        token, _, _ = customer_session
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def test_owner_endpoints_forbidden_without_role(self, api_client, customer_headers):
        for path in ["/api/owner/dashboard", "/api/owner/businesses",
                     "/api/owner/bookings", "/api/owner/staff",
                     "/api/owner/analytics"]:
            r = api_client.get(f"{BASE_URL}{path}", headers=customer_headers)
            assert r.status_code == 403, f"{path} expected 403 got {r.status_code}"

    def test_admin_endpoints_forbidden_without_role(self, api_client, customer_headers):
        for path in ["/api/admin/stats", "/api/admin/users", "/api/admin/businesses"]:
            r = api_client.get(f"{BASE_URL}{path}", headers=customer_headers)
            assert r.status_code == 403, f"{path} expected 403 got {r.status_code}"


# --- Owner portal (after role upgrade in TestRoleUpgrade) ----------------
class TestOwnerPortal:
    def test_upgrade_ensure_owner(self, api_client, auth_headers):
        r = api_client.post(f"{BASE_URL}/api/auth/roles",
                            json={"role": "owner"}, headers=auth_headers)
        assert r.status_code == 200

    def test_dashboard_shape(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/owner/dashboard", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["business_count", "booking_count", "upcoming_count",
                  "revenue_inr", "avg_rating", "businesses", "recent_bookings"]:
            assert k in data, f"missing key {k}"
        assert isinstance(data["businesses"], list)
        assert isinstance(data["recent_bookings"], list)

    def test_create_business_and_not_in_public_list(self, api_client, auth_headers, request):
        payload = {
            "name": "TEST_OwnerBiz_" + os.urandom(3).hex(),
            "category": "cafes",
            "city": "goa",
            "address": "TEST street",
            "description": "TEST created by owner",
            "price_range": "$$",
            "tags": ["test"],
            "booking_type": "instant",
        }
        r = api_client.post(f"{BASE_URL}/api/owner/businesses",
                            json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        biz = r.json()
        assert biz["is_approved"] is False
        assert biz["owner_id"], "owner_id should be set"
        assert "_id" not in biz
        biz_id = biz["business_id"]
        request.config.cache.set("owner_biz_id", biz_id)

        # Should NOT appear in public list
        r2 = api_client.get(f"{BASE_URL}/api/businesses",
                            params={"city": "goa", "limit": 100})
        assert r2.status_code == 200
        ids = [b["business_id"] for b in r2.json()]
        assert biz_id not in ids

    def test_owner_businesses_lists_only_mine(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/owner/businesses", headers=auth_headers)
        assert r.status_code == 200
        docs = r.json()
        assert len(docs) >= 1
        # All must belong to this owner
        owner_ids = {b.get("owner_id") for b in docs}
        assert len(owner_ids) == 1

    def test_add_staff_valid_and_invalid(self, api_client, auth_headers, request):
        biz_id = request.config.cache.get("owner_biz_id", None)
        assert biz_id, "prior test must have set owner_biz_id"

        # Valid
        r = api_client.post(f"{BASE_URL}/api/owner/staff",
                            json={"name": "TEST_Alice", "role": "manager",
                                  "business_id": biz_id},
                            headers=auth_headers)
        assert r.status_code == 200, r.text
        staff = r.json()
        assert staff["staff_id"].startswith("st_")
        request.config.cache.set("owner_staff_id", staff["staff_id"])

        # Invalid: business not owned
        r2 = api_client.post(f"{BASE_URL}/api/owner/staff",
                             json={"name": "TEST_Bob", "role": "chef",
                                   "business_id": "biz_notmine_xyz"},
                             headers=auth_headers)
        assert r2.status_code == 404

    def test_list_and_delete_staff(self, api_client, auth_headers, request):
        r = api_client.get(f"{BASE_URL}/api/owner/staff", headers=auth_headers)
        assert r.status_code == 200
        staff_list = r.json()
        assert any(s["name"] == "TEST_Alice" for s in staff_list)

        sid = request.config.cache.get("owner_staff_id", None)
        r2 = api_client.delete(f"{BASE_URL}/api/owner/staff/{sid}",
                               headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json().get("ok") is True

    def test_analytics_shape(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/owner/analytics", headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ["by_day", "by_business", "total"]:
            assert k in d


# --- Admin panel ---------------------------------------------------------
class TestAdminPanel:
    def test_grant_admin_role(self, api_client, auth_headers, test_session):
        # SEC-001: admin is no longer self-serve — set it directly in Mongo
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        _, user_id, _ = test_session

        async def _promote():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            await db.users.update_one(
                {"user_id": user_id},
                {"$set": {"roles": ["customer", "owner", "admin"]}},
            )
            client.close()
        asyncio.get_event_loop().run_until_complete(_promote())

        r = api_client.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert "admin" in r.json()["roles"]

    def test_stats_shape(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/admin/stats", headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ["users", "businesses", "pending_businesses", "bookings",
                  "reviews", "gross_revenue_inr", "platform_fees_inr", "by_city"]:
            assert k in d
        assert isinstance(d["by_city"], list)

    def test_users_no_id_leak(self, api_client, auth_headers, test_session):
        r = api_client.get(f"{BASE_URL}/api/admin/users", headers=auth_headers)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) >= 1
        for u in users:
            assert "_id" not in u
        _, _, email = test_session
        assert any(u["email"] == email for u in users)

    @pytest.fixture
    def owned_biz(self, api_client, auth_headers):
        """A fresh unapproved business for this one test.

        These tests used to read an id out of `request.config.cache`, written
        by a different test class. That is pytest's *cross-run* cache, so an
        id survived into later runs after the business had been deleted, and
        under `--dist loadscope` the writing and reading classes land on
        different workers anyway. Each test now creates its own.
        """
        payload = {
            "name": f"TEST admin fixture {uuid.uuid4().hex[:6]}",
            "category": "restaurants",
            "city": "goa",
            "address": "TEST address",
            "description": "TEST created by the admin-panel fixture",
            "price_range": "$$",
            "tags": ["test"],
            "booking_type": "instant",
        }
        r = api_client.post(f"{BASE_URL}/api/owner/businesses",
                            json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        biz_id = r.json()["business_id"]
        yield biz_id
        # Best-effort cleanup; a test that deleted it already will 404 here.
        api_client.delete(f"{BASE_URL}/api/admin/businesses/{biz_id}",
                          headers=auth_headers)

    def test_pending_approve_and_public_visibility(self, api_client, auth_headers, owned_biz):
        biz_id = owned_biz

        # pending list should contain our unapproved biz
        r = api_client.get(f"{BASE_URL}/api/admin/businesses",
                           params={"pending": "true"}, headers=auth_headers)
        assert r.status_code == 200
        pending = r.json()
        assert all(b.get("is_approved") is False for b in pending)
        assert any(b["business_id"] == biz_id for b in pending)

        # approve
        r2 = api_client.patch(f"{BASE_URL}/api/admin/businesses/{biz_id}/approve",
                              headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json().get("is_approved") is True

        # now in public list
        r3 = api_client.get(f"{BASE_URL}/api/businesses",
                            params={"city": "goa", "limit": 100})
        assert biz_id in [b["business_id"] for b in r3.json()]

    def test_feature_toggle_idempotent(self, api_client, auth_headers, owned_biz):
        biz_id = owned_biz
        r1 = api_client.patch(f"{BASE_URL}/api/admin/businesses/{biz_id}/feature",
                              headers=auth_headers)
        assert r1.status_code == 200
        v1 = r1.json()["is_featured"]
        r2 = api_client.patch(f"{BASE_URL}/api/admin/businesses/{biz_id}/feature",
                              headers=auth_headers)
        assert r2.status_code == 200
        v2 = r2.json()["is_featured"]
        assert v1 != v2  # toggled

    def test_delete_business(self, api_client, auth_headers, owned_biz):
        biz_id = owned_biz
        r = api_client.delete(f"{BASE_URL}/api/admin/businesses/{biz_id}",
                              headers=auth_headers)
        assert r.status_code == 200
        # 404 on subsequent GET
        r2 = api_client.get(f"{BASE_URL}/api/businesses/{biz_id}")
        assert r2.status_code == 404


# --- Reviews -------------------------------------------------------------
class TestReviews:
    def test_list_and_create_review(self, api_client, auth_headers):
        # pick some approved goa business
        r = api_client.get(f"{BASE_URL}/api/businesses", params={"city": "goa"})
        biz_id = r.json()[0]["business_id"]

        before = api_client.get(f"{BASE_URL}/api/businesses/{biz_id}/reviews")
        assert before.status_code == 200
        before_ids = {rv["review_id"] for rv in before.json()}

        cr = api_client.post(f"{BASE_URL}/api/reviews",
                             json={"business_id": biz_id, "rating": 5,
                                   "comment": "TEST_review"}, headers=auth_headers)
        assert cr.status_code == 200, cr.text
        new_id = cr.json()["review_id"]

        after = api_client.get(f"{BASE_URL}/api/businesses/{biz_id}/reviews")
        assert after.status_code == 200
        assert new_id in {rv["review_id"] for rv in after.json()}
        assert new_id not in before_ids


# --- AI endpoints --------------------------------------------------------
@pytest.mark.skipif(
    not os.environ.get("ANTHROPIC_API_KEY"),
    reason="ANTHROPIC_API_KEY is not set; the AI routes return 503/502 without it",
)
class TestAI:
    def test_recommend_requires_auth(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/ai/recommend",
                            json={"city": "goa", "mood": "romantic",
                                  "budget": "luxury", "party": "couple"})
        assert r.status_code == 401

    def test_recommend_returns_picks(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/ai/recommend",
            json={"city": "goa", "mood": "romantic",
                  "budget": "luxury", "party": "couple"},
            headers=auth_headers, timeout=90,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("city") == "goa"
        picks = d.get("picks", [])
        assert 1 <= len(picks) <= 5

        # Validate ids exist in catalog
        cat = api_client.get(f"{BASE_URL}/api/businesses",
                             params={"city": "goa", "limit": 100}).json()
        valid_ids = {b["business_id"] for b in cat}
        for p in picks:
            assert "_id" not in p["business"]
            assert p["business"]["business_id"] in valid_ids

    def test_itinerary_returns_days_with_business(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/ai/itinerary",
            json={"city": "goa", "days": 2,
                  "interests": ["food", "nightlife"]},
            headers=auth_headers, timeout=120,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "title" in d and "summary" in d
        days = d.get("days", [])
        assert len(days) >= 1
        for day in days:
            assert "day" in day and "stops" in day
            for stop in day["stops"]:
                assert "business" in stop, "stop must include business"
                assert "_id" not in stop["business"]
