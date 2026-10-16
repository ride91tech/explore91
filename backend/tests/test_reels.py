"""Explore91 backend — Reels endpoints (iteration 3).

Covers:
- Regression spot-check (root, businesses?city=goa, auth/roles requires auth)
- GET /api/reels list + filters (city, category, limit)
- GET /api/reels/{id} single + 404
- POST /api/reels/{id}/view increments views (delta = 1)
- POST /api/reels/like — 401 without auth, toggles liked state + likes counter
- GET /api/reels/my/likes returns array of reel_ids user has liked
- POST /api/owner/reels — needs owner role, needs to own the business, and
  the created reel then appears in GET /api/reels
- No `_id` leaks anywhere in reel documents
"""
import os
import time
import uuid
import asyncio
from datetime import datetime, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient


# ---------- Regression spot-check ---------------------------------------
class TestRegressionSpotCheck:
    def test_root(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        data = r.json()
        assert data.get("service") == "Explore91"
        assert data.get("status") == "ok"

    def test_businesses_goa(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/businesses", params={"city": "goa"})
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list) and len(docs) > 0
        assert all(d["city"] == "goa" for d in docs)
        assert all("_id" not in d for d in docs)

    def test_auth_roles_requires_auth(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/auth/roles", json={"role": "owner"})
        assert r.status_code == 401


# ---------- GET /api/reels (public) -------------------------------------
REEL_REQUIRED_FIELDS = {
    "reel_id", "business_id", "business_name", "business_category",
    "city", "video_url", "cover_image", "caption", "author",
    "likes", "views", "created_at",
}


class TestReelsList:
    def test_list_reels_shape(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/reels")
        assert r.status_code == 200
        reels = r.json()
        assert isinstance(reels, list)
        assert len(reels) >= 24, f"expected at least 24 seeded reels, got {len(reels)}"
        # No _id leak, all required fields present, types sane
        for reel in reels:
            assert "_id" not in reel
            missing = REEL_REQUIRED_FIELDS - set(reel.keys())
            assert not missing, f"reel missing fields: {missing}"
            assert isinstance(reel["likes"], int)
            assert isinstance(reel["views"], int)
            assert reel["video_url"].startswith("http")
            assert reel["cover_image"].startswith("http")

    def test_filter_by_city_goa(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/reels", params={"city": "goa"})
        assert r.status_code == 200
        reels = r.json()
        assert len(reels) > 0
        assert all(x["city"] == "goa" for x in reels)

    def test_filter_by_category_restaurants(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/reels", params={"category": "restaurants"})
        assert r.status_code == 200
        reels = r.json()
        # Not asserting > 0 in case seed randomness excluded restaurants,
        # but with 24 reels biased to visual cats we expect some.
        assert len(reels) > 0, "expected some restaurant reels from seed"
        assert all(x["business_category"] == "restaurants" for x in reels)

    def test_limit_respected(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/reels", params={"limit": 5})
        assert r.status_code == 200
        reels = r.json()
        assert len(reels) <= 5
        assert len(reels) == 5, "with 24 seeded reels, limit=5 should return exactly 5"


class TestReelTopics:
    """Topic rails for the feed, built from what a city actually has."""

    def test_topics_is_not_parsed_as_a_reel_id(self, base_url, api_client):
        """/reels/topics must be declared before /reels/{reel_id}.

        FastAPI matches in declaration order, so getting this wrong turns the
        rails into a 404 for a reel called "topics".
        """
        r = api_client.get(f"{base_url}/api/reels/topics")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_shape_and_ordering(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/reels/topics",
                         params={"city": "goa"})
        assert r.status_code == 200
        topics = r.json()
        assert topics, "Goa has reels, so it should have topics"
        for t in topics:
            assert t["slug"] and t["name"]
            assert isinstance(t["count"], int) and t["count"] > 0
        counts = [t["count"] for t in topics]
        assert counts == sorted(counts, reverse=True), "busiest rail first"

    def test_counts_match_the_filtered_feed(self, base_url, api_client):
        """A rail must never open onto an empty or short feed."""
        topics = api_client.get(f"{base_url}/api/reels/topics",
                              params={"city": "goa"}).json()
        top = topics[0]
        feed = api_client.get(f"{base_url}/api/reels",
                            params={"city": "goa", "category": top["slug"],
                                    "limit": 100})
        assert feed.status_code == 200
        assert len(feed.json()) == top["count"]

    def test_scoped_to_the_city(self, base_url, api_client):
        goa = api_client.get(f"{base_url}/api/reels/topics",
                           params={"city": "goa"}).json()
        nowhere = api_client.get(f"{base_url}/api/reels/topics",
                               params={"city": "atlantis"}).json()
        assert goa
        assert nowhere == [], "a city with no reels has no rails"


class TestReelDetail:
    def test_get_single_reel(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/reels", params={"limit": 1})
        reel_id = r.json()[0]["reel_id"]
        r2 = api_client.get(f"{base_url}/api/reels/{reel_id}")
        assert r2.status_code == 200
        doc = r2.json()
        assert doc["reel_id"] == reel_id
        assert "_id" not in doc

    def test_get_unknown_reel_404(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/reels/rl_does_not_exist_xyz")
        assert r.status_code == 404


# ---------- POST /api/reels/{id}/view (public, rate-limited 60/IP/min) --
class TestReelView:
    def _post_view_with_retry(self, api_client, url):
        # /reels/{id}/view is rate-limited 60/IP/min. If we hit 429 (because
        # another parallel test filled the IP bucket), sleep past the window
        # and retry once.
        r = api_client.post(url)
        if r.status_code == 429:
            retry = int(r.headers.get("Retry-After", "60"))
            time.sleep(retry + 2)
            r = api_client.post(url)
        return r

    def test_view_increments_counter(self, base_url, api_client):
        # Pick a stable seeded reel (avoid TEST-prefixed reels which other
        # parallel workers may clean up mid-run).
        reels = api_client.get(f"{base_url}/api/reels", params={"limit": 30}).json()
        stable = [r for r in reels if not r.get("caption", "").startswith("TEST")]
        assert stable, "no seeded reels available"
        reel_id = stable[-1]["reel_id"]
        before = api_client.get(f"{base_url}/api/reels/{reel_id}").json()["views"]
        r = self._post_view_with_retry(api_client, f"{base_url}/api/reels/{reel_id}/view")
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        after = api_client.get(f"{base_url}/api/reels/{reel_id}").json()["views"]
        assert after == before + 1, f"expected views to increment by 1: before={before}, after={after}"

    def test_view_unknown_reel_404(self, base_url, api_client):
        r = self._post_view_with_retry(api_client, f"{base_url}/api/reels/rl_missing_xyz/view")
        assert r.status_code == 404


# ---------- POST /api/reels/like (auth, toggle) -------------------------
class TestReelLikeToggle:
    def test_like_requires_auth(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/reels/like", json={"reel_id": "any"})
        assert r.status_code == 401

    def test_like_toggle_flow(self, base_url, api_client, auth_headers):
        # Pick a reel
        reels = api_client.get(f"{base_url}/api/reels", params={"limit": 1}).json()
        reel_id = reels[0]["reel_id"]
        likes_before = api_client.get(f"{base_url}/api/reels/{reel_id}").json()["likes"]

        # First call → liked=true, likes+1
        r1 = api_client.post(f"{base_url}/api/reels/like",
                             json={"reel_id": reel_id}, headers=auth_headers)
        assert r1.status_code == 200
        body1 = r1.json()
        assert body1["liked"] is True
        assert body1["likes"] == likes_before + 1

        # Second call → liked=false, likes back to baseline
        r2 = api_client.post(f"{base_url}/api/reels/like",
                             json={"reel_id": reel_id}, headers=auth_headers)
        assert r2.status_code == 200
        body2 = r2.json()
        assert body2["liked"] is False
        assert body2["likes"] == likes_before

    def test_like_unknown_reel_404(self, base_url, api_client, auth_headers):
        r = api_client.post(f"{base_url}/api/reels/like",
                            json={"reel_id": "rl_nope_xyz"}, headers=auth_headers)
        assert r.status_code == 404


# ---------- GET /api/reels/my/likes ------------------------------------
class TestMyLikes:
    def test_requires_auth(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/reels/my/likes")
        assert r.status_code == 401

    def test_my_likes_reflects_toggle(self, base_url, api_client, customer_session):
        # Use the customer_session (isolated from owner-toggle tests)
        token, _, _ = customer_session
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Use a DIFFERENT reel than limit=1 (which other classes race on)
        # to avoid cross-worker contention on the newest reel.
        reels = api_client.get(f"{base_url}/api/reels", params={"limit": 30}).json()
        assert len(reels) >= 3
        reel_id = reels[-1]["reel_id"]  # oldest, unlikely to be touched elsewhere

        # Initial: reel_id not liked by fresh customer_session user
        r0 = api_client.get(f"{base_url}/api/reels/my/likes", headers=headers)
        assert r0.status_code == 200
        assert reel_id not in r0.json()

        # Like it
        lr = api_client.post(f"{base_url}/api/reels/like",
                             json={"reel_id": reel_id}, headers=headers)
        assert lr.status_code == 200 and lr.json()["liked"] is True
        r1 = api_client.get(f"{base_url}/api/reels/my/likes", headers=headers)
        assert r1.status_code == 200
        assert reel_id in r1.json()

        # Unlike -> gone
        ur = api_client.post(f"{base_url}/api/reels/like",
                             json={"reel_id": reel_id}, headers=headers)
        assert ur.status_code == 200 and ur.json()["liked"] is False
        r2 = api_client.get(f"{base_url}/api/reels/my/likes", headers=headers)
        assert reel_id not in r2.json()


# ---------- POST /api/owner/reels --------------------------------------
def _seed_owner_business(user_id: str) -> str:
    """Insert a business owned by user_id directly in Mongo; return business_id."""
    async def _run():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        biz_id = f"biz_{uuid.uuid4().hex[:10]}"
        await db.businesses.insert_one({
            "business_id": biz_id,
            "owner_id": user_id,
            "name": f"TEST_OwnerBiz_{uuid.uuid4().hex[:6]}",
            "category": "cafes",
            "city": "goa",
            "address": "TEST addr",
            "lat": 15.3, "lng": 74.1,
            "cover_image": "https://example.com/cover.jpg",
            "gallery": [], "rating": 0.0, "review_count": 0,
            "price_range": "$$", "tags": [], "description": "",
            "open_hours": "10-11", "phone": "",
            "is_verified": False, "is_featured": False, "is_approved": True,
            "offers": [], "menu": [], "services": [],
            "booking_type": "reservation",
        })
        client.close()
        return biz_id
    return asyncio.get_event_loop().run_until_complete(_run())


class TestOwnerCreateReel:
    def test_requires_owner_role(self, base_url, api_client, customer_session):
        token, _, _ = customer_session
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        r = api_client.post(f"{base_url}/api/owner/reels", headers=headers, json={
            "business_id": "biz_any",
            "video_url": "https://example.com/v.mp4",
            "caption": "hello",
        })
        assert r.status_code == 403

    def test_business_not_owned_returns_404(self, base_url, api_client, auth_headers):
        # Ensure the test session user has 'owner' role
        r = api_client.post(f"{base_url}/api/auth/roles",
                            json={"role": "owner"}, headers=auth_headers)
        assert r.status_code == 200

        # Grab a seeded business (owner_id = None, so NOT owned by us)
        seeded = api_client.get(f"{base_url}/api/businesses",
                                params={"city": "goa", "limit": 1}).json()
        biz_id = seeded[0]["business_id"]

        r2 = api_client.post(f"{base_url}/api/owner/reels", headers=auth_headers, json={
            "business_id": biz_id,
            "video_url": "https://example.com/v.mp4",
            "caption": "not mine",
        })
        assert r2.status_code == 404

    def test_create_reel_appears_in_list(self, base_url, api_client, auth_headers, test_session):
        # test_session user should already be 'owner' from previous test — ensure idempotent
        api_client.post(f"{base_url}/api/auth/roles",
                        json={"role": "owner"}, headers=auth_headers)
        _, user_id, _ = test_session
        biz_id = _seed_owner_business(user_id)

        payload = {
            "business_id": biz_id,
            "video_url": "https://example.com/mytest.mp4",
            "caption": f"TEST reel {uuid.uuid4().hex[:6]}",
            "cover_image": "https://example.com/cover2.jpg",
        }
        r = api_client.post(f"{base_url}/api/owner/reels",
                            headers=auth_headers, json=payload)
        assert r.status_code == 200, r.text
        reel = r.json()
        assert "_id" not in reel
        assert reel["business_id"] == biz_id
        assert reel["video_url"] == payload["video_url"]
        assert reel["caption"] == payload["caption"]
        assert reel["cover_image"] == payload["cover_image"]
        assert reel["likes"] == 0 and reel["views"] == 0
        reel_id = reel["reel_id"]

        # Verify it appears in GET /api/reels
        listed = api_client.get(f"{base_url}/api/reels", params={"limit": 60}).json()
        assert any(x["reel_id"] == reel_id for x in listed), "created reel not in /api/reels"

        # And in GET /api/reels/{id}
        got = api_client.get(f"{base_url}/api/reels/{reel_id}")
        assert got.status_code == 200
        assert got.json()["reel_id"] == reel_id
