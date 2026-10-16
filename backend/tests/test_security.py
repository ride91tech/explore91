"""Security verification tests for Explore91 â€” SEC-001, SEC-002, SEC-003, and input validation."""
import os
import random
import time
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

# Same guard as conftest: never let the mobile app's production URL aim
# these destructive tests at live data.
BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://localhost:8000").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _seed_session(roles=None, email_prefix="TEST_sec"):
    """Seed a user + session directly in Mongo. Returns (token, user_id, email)."""
    async def _s():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        now = datetime.now(timezone.utc)
        email = f"{email_prefix}_{uuid.uuid4().hex[:8]}@explore91.dev"
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": "SEC Tester",
            "picture": None,
            "wallet_points": 500,
            "home_city": "Goa",
            "roles": roles or ["customer"],
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
    return asyncio.get_event_loop().run_until_complete(_s())


def _cleanup(user_id, email):
    async def _c():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.users.delete_many({"email": email})
        await db.reviews.delete_many({"user_id": user_id})
        await db.businesses.delete_many({"owner_id": user_id})
        client.close()
    asyncio.get_event_loop().run_until_complete(_c())


# --- SEC-001: Admin privilege escalation --------------------------------
class TestSEC001AdminAllowlist:
    """Admin role can only be granted to allowlisted emails via /auth/roles."""

    @pytest.fixture(scope="class")
    def sess(self):
        tok, uid, email = _seed_session(roles=["customer"])
        yield tok, uid, email
        _cleanup(uid, email)

    def _hdr(self, tok):
        return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    def test_admin_self_grant_returns_403(self, api_client, sess):
        tok, uid, _ = sess
        r = api_client.post(f"{BASE_URL}/api/auth/roles",
                            json={"role": "admin"}, headers=self._hdr(tok))
        assert r.status_code == 403, r.text
        # Detail must mention allowlist
        assert "allowlist" in r.text.lower()

        # Verify DB was NOT mutated
        async def _check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            u = await db.users.find_one({"user_id": uid}, {"_id": 0})
            client.close()
            return u
        u = asyncio.get_event_loop().run_until_complete(_check())
        assert "admin" not in (u.get("roles") or [])

    def test_owner_self_grant_still_works(self, api_client, sess):
        tok, _, _ = sess
        r = api_client.post(f"{BASE_URL}/api/auth/roles",
                            json={"role": "owner"}, headers=self._hdr(tok))
        assert r.status_code == 200, r.text
        assert "owner" in r.json().get("roles", [])

    def test_invalid_role_returns_422(self, api_client, sess):
        tok, _, _ = sess
        r = api_client.post(f"{BASE_URL}/api/auth/roles",
                            json={"role": "invalid"}, headers=self._hdr(tok))
        assert r.status_code == 422, r.text

    def test_admin_endpoints_still_forbidden_after_self_grant_attempt(self, api_client, sess):
        tok, _, _ = sess
        # Already attempted admin self-grant above and got 403
        for path in ["/api/admin/stats", "/api/admin/users", "/api/admin/businesses"]:
            r = api_client.get(f"{BASE_URL}{path}", headers=self._hdr(tok))
            assert r.status_code == 403, f"{path} expected 403 got {r.status_code}"

    def test_admin_endpoints_work_when_role_set_in_mongo(self, api_client, sess):
        tok, uid, _ = sess

        async def _promote():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            await db.users.update_one(
                {"user_id": uid},
                {"$set": {"roles": ["customer", "owner", "admin"]}},
            )
            client.close()
        asyncio.get_event_loop().run_until_complete(_promote())

        for path in ["/api/admin/stats", "/api/admin/users", "/api/admin/businesses"]:
            r = api_client.get(f"{BASE_URL}{path}", headers=self._hdr(tok))
            assert r.status_code == 200, f"{path} expected 200 got {r.status_code}: {r.text[:200]}"


# --- SEC-002: ReDoS + q max_length ---------------------------------------
class TestSEC002RegexSafety:
    def test_redos_pattern_fast_and_finite(self, api_client):
        payload = "(a+)+$"
        t0 = time.time()
        r = api_client.get(f"{BASE_URL}/api/businesses", params={"q": payload})
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        assert elapsed < 2.0, f"ReDoS pattern took {elapsed:.2f}s (>2s)"
        # Should be empty/finite result â€” no business name contains this literal string
        assert isinstance(r.json(), list)

    def test_special_chars_escaped_literally(self, api_client):
        # `.` in regex means any-char; if not escaped, `C.sa` would match "Casa"
        r = api_client.get(f"{BASE_URL}/api/businesses", params={"q": "C.sa"})
        assert r.status_code == 200
        names = [b["name"] for b in r.json()]
        # Since `.` is escaped, "C.sa" won't match "Casa Sarita"
        assert not any("Casa Sarita" == n for n in names), \
            f"Special char `.` was NOT escaped â€” matched: {names}"

    def test_max_length_enforced(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/businesses",
                           params={"q": "a" * 100})
        assert r.status_code == 422, r.text

    def test_normal_search_still_works(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/businesses", params={"q": "Casa"})
        assert r.status_code == 200
        names = [b["name"] for b in r.json()]
        assert any("Casa Sarita" in n for n in names), f"Expected Casa Sarita, got {names}"


# --- SEC-003: Rate limits -------------------------------------------------
class TestSessionTokensHashedAtRest:
    """A leak of user_sessions must not hand over working sessions."""

    def test_stored_value_is_a_digest_not_the_token(self, api_client):
        tok, uid, email = _seed_session(roles=["customer"])
        try:
            # Seeded rows start as raw tokens, the way every pre-existing
            # session in production is stored. Using it once migrates it.
            r = api_client.get(
                f"{BASE_URL}/api/auth/me",
                headers={"Authorization": f"Bearer {tok}"}, timeout=20,
            )
            assert r.status_code == 200, "a pre-hash session must keep working"

            import hashlib

            async def _read():
                from motor.motor_asyncio import AsyncIOMotorClient
                client = AsyncIOMotorClient(MONGO_URL)
                db = client[DB_NAME]
                raw = await db.user_sessions.find_one({"session_token": tok})
                digest = await db.user_sessions.find_one(
                    {"session_token": hashlib.sha256(tok.encode()).hexdigest()}
                )
                client.close()
                return raw, digest

            raw, digest = asyncio.get_event_loop().run_until_complete(_read())
            assert raw is None, "the raw token is still stored after use"
            assert digest is not None, "the session was not migrated to its digest"
        finally:
            _cleanup(uid, email)

    def test_migrated_session_keeps_working(self, api_client):
        """The upgrade happens mid-session; it must not sign the user out."""
        tok, uid, email = _seed_session(roles=["customer"])
        try:
            h = {"Authorization": f"Bearer {tok}"}
            first = api_client.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=20)
            second = api_client.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=20)
            assert first.status_code == 200
            assert second.status_code == 200, "second call after migration failed"
            assert first.json()["user_id"] == second.json()["user_id"]
        finally:
            _cleanup(uid, email)

    def test_unknown_token_still_401(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer not_a_real_token"}, timeout=20,
        )
        assert r.status_code == 401


@pytest.mark.skipif(
    os.environ.get("TRUSTED_PROXY_HOPS", "1") == "0",
    reason="with TRUSTED_PROXY_HOPS=0 the limiter ignores X-Forwarded-For, so "
           "every caller shares one bucket and per-client budgets cannot be "
           "distinguished",
)
class TestSEC003RateLimitBypass:
    """The limiter must not be defeatable by a header the caller controls.

    X-Forwarded-For is *appended to* by each proxy, so its first entry is
    simply whatever the client sent. The limiter used to key on that first
    entry, which meant rotating a fake value per request bypassed it outright.
    It now counts back TRUSTED_PROXY_HOPS from the end, so it reads the entry
    our own infrastructure appended.

    These tests send `<spoof>, <constant>` to imitate a proxy appending the
    real address — which is exactly what Cloud Run does — and assert the
    rotating prefix buys nothing.
    """

    LIMIT = 60          # /reels/{id}/view, per minute
    OVERSHOOT = 70

    @pytest.fixture(scope="class")
    def reel_id(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/reels", params={"limit": 1}, timeout=20)
        reels = r.json()
        if not reels:
            pytest.skip("no reels seeded")
        return reels[0]["reel_id"]

    @staticmethod
    def _unique_ip():
        """A fresh 'real' client address per test, so tests don't share a
        bucket with each other or with a previous run in the same window."""
        return "198.51.100." + str(random.randint(2, 250))

    def _view(self, api_client, reel_id, xff):
        return api_client.post(
            f"{BASE_URL}/api/reels/{reel_id}/view",
            headers={"X-Forwarded-For": xff},
            timeout=20,
        )

    def test_rotating_spoofed_prefix_does_not_grant_a_fresh_budget(
        self, api_client, reel_id
    ):
        real = self._unique_ip()
        statuses = [
            self._view(api_client, reel_id, f"203.0.113.{i % 250 + 1}, {real}").status_code
            for i in range(self.OVERSHOOT)
        ]
        assert 429 in statuses, (
            "a rotating X-Forwarded-For prefix bypassed the rate limit - the "
            "limiter is keying on a client-controlled value again"
        )
        assert statuses[-1] == 429, "once tripped it should stay tripped in the window"

    def test_separate_clients_keep_separate_budgets(self, api_client, reel_id):
        """The fix must not over-correct into limiting everyone together."""
        a, b = self._unique_ip(), self._unique_ip()
        for i in range(self.OVERSHOOT):
            self._view(api_client, reel_id, f"203.0.113.1, {a}")
        # `a` is now limited; `b` should be untouched.
        assert self._view(api_client, reel_id, f"203.0.113.1, {a}").status_code == 429
        assert self._view(api_client, reel_id, f"203.0.113.1, {b}").status_code == 200

    def test_429_carries_retry_after(self, api_client, reel_id):
        real = self._unique_ip()
        for i in range(self.OVERSHOOT):
            r = self._view(api_client, reel_id, f"203.0.113.1, {real}")
            if r.status_code == 429:
                assert r.headers.get("Retry-After"), "429 must tell the caller when to retry"
                assert 1 <= int(r.headers["Retry-After"]) <= 60
                return
        pytest.fail("never hit the rate limit")


class TestSEC003RateLimits:
    @pytest.fixture(scope="class")
    def sess(self):
        tok, uid, email = _seed_session(roles=["customer"])
        yield tok, uid, email
        _cleanup(uid, email)

    def _hdr(self, tok):
        return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    def test_reviews_rate_limited_at_11th(self, api_client, sess):
        tok, _, _ = sess
        # Fetch any business_id
        r = api_client.get(f"{BASE_URL}/api/businesses", params={"city": "goa", "limit": 1})
        biz_id = r.json()[0]["business_id"]

        statuses = []
        for i in range(12):
            resp = api_client.post(
                f"{BASE_URL}/api/reviews",
                json={"business_id": biz_id, "rating": 5,
                      "comment": f"TEST_ratelimit_{i}"},
                headers=self._hdr(tok),
            )
            statuses.append(resp.status_code)
            if resp.status_code == 429:
                assert "Retry-After" in resp.headers, "429 must include Retry-After header"
                break
        assert 429 in statuses, f"Expected 429 in first 12 calls, got {statuses}"
        # First 10 should be 200
        assert statuses[:10].count(200) == 10, f"First 10 must be 200, got {statuses[:10]}"

    def test_ai_recommend_rate_limited(self, api_client, sess):
        # Use a FRESH session so the bucket is empty
        tok2, uid2, email2 = _seed_session(roles=["customer"], email_prefix="TEST_secai")
        try:
            hdr = {"Authorization": f"Bearer {tok2}", "Content-Type": "application/json"}
            # AI calls are SLOW (LLM latency ~5-30s). If we call sequentially, requests
            # will age out of the 60s window before we hit the 10-req limit. So we fire
            # 12 concurrently and count 429s in the response set.
            from concurrent.futures import ThreadPoolExecutor
            def _one(i):
                try:
                    r = requests.post(
                        f"{BASE_URL}/api/ai/recommend",
                        json={"city": "goa"}, headers=hdr, timeout=120,
                    )
                    return r.status_code, r.headers.get("Retry-After")
                except Exception as e:
                    return f"err:{e}", None

            with ThreadPoolExecutor(max_workers=12) as pool:
                results = list(pool.map(_one, range(12)))
            statuses = [s for s, _ in results]
            assert 429 in statuses, f"Expected 429 among 12 concurrent, got {statuses}"
            # 429 responses should carry Retry-After
            retry_afters = [ra for s, ra in results if s == 429]
            assert all(ra for ra in retry_afters), f"429 missing Retry-After: {results}"
        finally:
            _cleanup(uid2, email2)

    def test_reel_view_ip_rate_limited(self, api_client):
        # Get any reel id
        r = api_client.get(f"{BASE_URL}/api/reels", params={"limit": 1})
        assert r.status_code == 200
        reels = r.json()
        if not reels:
            pytest.skip("No reels seeded")
        rid = reels[0]["reel_id"]

        # Present as a distinct client. Without this the bucket is keyed on the
        # shared loopback address, so any other test that views a reel at the
        # same moment — on another xdist worker — spends this test's budget.
        hdr = {"X-Forwarded-For": "198.51.100." + str(random.randint(2, 250))}

        # 60/min per IP -> hammer 70 times
        statuses = []
        for i in range(70):
            resp = api_client.post(f"{BASE_URL}/api/reels/{rid}/view", headers=hdr)
            statuses.append(resp.status_code)
            if resp.status_code == 429:
                assert "Retry-After" in resp.headers
                break
        assert 429 in statuses, f"Expected 429 in 70 requests, got last 10: {statuses[-10:]}"


# --- Input validation ----------------------------------------------------
class TestInputValidation:
    @pytest.fixture(scope="class")
    def sess(self):
        tok, uid, email = _seed_session(roles=["customer"])
        yield tok, uid, email
        _cleanup(uid, email)

    def _hdr(self, tok):
        return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    def test_review_rating_bounds(self, api_client, sess):
        tok, _, _ = sess
        r = api_client.get(f"{BASE_URL}/api/businesses", params={"city": "goa", "limit": 1})
        biz_id = r.json()[0]["business_id"]

        # rating=6 â†’ 422
        r1 = api_client.post(f"{BASE_URL}/api/reviews",
                             json={"business_id": biz_id, "rating": 6, "comment": "x"},
                             headers=self._hdr(tok))
        assert r1.status_code == 422, r1.text

        # rating=0 â†’ 422
        r2 = api_client.post(f"{BASE_URL}/api/reviews",
                             json={"business_id": biz_id, "rating": 0, "comment": "x"},
                             headers=self._hdr(tok))
        assert r2.status_code == 422, r2.text

        # comment > 1000 chars â†’ 422
        r3 = api_client.post(f"{BASE_URL}/api/reviews",
                             json={"business_id": biz_id, "rating": 5,
                                   "comment": "a" * 1001},
                             headers=self._hdr(tok))
        assert r3.status_code == 422, r3.text

    def test_booking_guests_bounds(self, api_client, sess):
        tok, _, _ = sess
        r = api_client.get(f"{BASE_URL}/api/businesses", params={"city": "goa", "limit": 1})
        biz_id = r.json()[0]["business_id"]

        # guests=0 â†’ 422
        r1 = api_client.post(
            f"{BASE_URL}/api/bookings",
            json={"business_id": biz_id, "date": "2026-06-01", "time": "19:00", "guests": 0},
            headers=self._hdr(tok),
        )
        assert r1.status_code == 422, r1.text

        # guests=100 â†’ 422
        r2 = api_client.post(
            f"{BASE_URL}/api/bookings",
            json={"business_id": biz_id, "date": "2026-06-01", "time": "19:00", "guests": 100},
            headers=self._hdr(tok),
        )
        assert r2.status_code == 422, r2.text

    def test_owner_reel_video_url_validation(self, api_client, sess):
        tok, uid, _ = sess

        # Seed an owned business + owner role
        async def _seed_biz():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            await db.users.update_one(
                {"user_id": uid},
                {"$set": {"roles": ["customer", "owner"]}},
            )
            biz_id = f"biz_{uuid.uuid4().hex[:10]}"
            await db.businesses.insert_one({
                "business_id": biz_id, "owner_id": uid,
                "name": "TEST_SecOwnerBiz", "category": "cafes",
                "city": "goa", "address": "TEST", "lat": 15.3, "lng": 74.1,
                "cover_image": "https://example.com/x.jpg", "gallery": [],
                "rating": 0.0, "review_count": 0, "price_range": "$$",
                "tags": [], "description": "", "open_hours": "",
                "phone": "", "is_verified": False, "is_featured": False,
                "is_approved": False, "offers": [], "menu": [],
                "services": [], "booking_type": "instant",
            })
            client.close()
            return biz_id
        biz_id = asyncio.get_event_loop().run_until_complete(_seed_biz())

        # javascript: â†’ 422
        r1 = api_client.post(f"{BASE_URL}/api/owner/reels",
                             json={"business_id": biz_id,
                                   "video_url": "javascript:alert(1)",
                                   "caption": "TEST reel js"},
                             headers=self._hdr(tok))
        assert r1.status_code == 422, r1.text

        # ftp:// â†’ 422
        r2 = api_client.post(f"{BASE_URL}/api/owner/reels",
                             json={"business_id": biz_id,
                                   "video_url": "ftp://x.com/vid.mp4",
                                   "caption": "TEST reel ftp"},
                             headers=self._hdr(tok))
        assert r2.status_code == 422, r2.text

        # https:// â†’ 200
        r3 = api_client.post(f"{BASE_URL}/api/owner/reels",
                             json={"business_id": biz_id,
                                   "video_url": "https://example.com/vid.mp4",
                                   "caption": "TEST reel https"},
                             headers=self._hdr(tok))
        assert r3.status_code == 200, r3.text
        assert r3.json()["video_url"].startswith("https://")


# --- P3: AI error handling wording ---------------------------------------
class TestP3AIErrorHandling:
    def test_error_handler_returns_generic_message(self):
        """Verify the error handler literal (per review request P3 â€” no live env swap)."""
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes", "ai.py"), "r") as f:
            src = f.read()
        # Both AI endpoints must use the generic wording, NOT str(e)
        assert src.count('"AI service temporarily unavailable"') >= 2, \
            "Both /ai/recommend and /ai/itinerary must return the generic message"
        # Ensure raw exception text is not surfaced
        assert "detail=str(e)" not in src
        assert "detail=f\"{e" not in src


# --- Regression --------------------------------------------------------
class TestRegression:
    def test_health(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_cities(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/cities")
        assert r.status_code == 200 and len(r.json()) >= 3

    def test_businesses_is_approved_filter(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/businesses", params={"city": "goa"})
        assert r.status_code == 200
        for b in r.json():
            assert b.get("is_approved", True) is not False

    def test_reels_city_filter(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/reels", params={"city": "goa"})
        assert r.status_code == 200
        for reel in r.json():
            assert reel["city"] == "goa"
