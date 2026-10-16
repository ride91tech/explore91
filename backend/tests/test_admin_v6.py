"""Explore91 v6 — Admin console backend tests.

Covers the new admin CMS + moderation + reports endpoints introduced in iteration 5/6:
- CMS Categories, Cities, Banners
- Reels moderation (visibility toggle, delete cascade)
- Support tickets (customer + admin) + 5/min rate limit
- Fraud flags + user block/unblock (session revoke + 403 on blocked)
- Cascade: delete business also removes its reels
- Financial reports: /admin/reports/gmv + CSV export
- SECURITY: /api/admin/* returns 403 for non-admin (401 without token)
"""
import os
import time
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
BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://localhost:8000").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


# --- helpers ----------------------------------------------------------------
def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


async def _seed_user(email: str, roles):
    db = _mongo()
    now = datetime.now(timezone.utc)
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "Admin V6 Tester",
        "picture": None,
        "wallet_points": 500,
        "home_city": "Goa",
        "roles": list(roles),
        "created_at": now,
    })
    token = f"test_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": now,
        "expires_at": now + timedelta(days=7),
    })
    return token, user_id


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def admin_ctx():
    worker = os.environ.get("PYTEST_XDIST_WORKER", "gw0")
    email = f"TEST_v6_admin_{worker}_{uuid.uuid4().hex[:6]}@explore91.dev"
    token, user_id = _run(_seed_user(email, ["customer", "owner", "admin"]))
    yield {"token": token, "user_id": user_id, "email": email,
           "H": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}

    async def _clean():
        db = _mongo()
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.users.delete_many({"email": email})
        # Safety net: purge any leftover CMS test data (in case an assertion failed
        # mid-test and skipped the inline DELETE cleanup).
        await db.categories_cms.delete_many({"slug": {"$regex": "^yoga-studios-"}})
        await db.cities_cms.delete_many({"slug": {"$regex": "^testcity-"}})
        await db.banners.delete_many({"title": {"$regex": "^TEST_"}})
        await db.fraud_flags.delete_many({"reason": {"$regex": "^TEST v6 fraud"}})
        await db.businesses.delete_many({"business_id": {"$regex": "^biz_TESTv6_"}})
        await db.reels.delete_many({"reel_id": {"$regex": "^reel_TESTv6_"}})
    _run(_clean())


@pytest.fixture(scope="module")
def customer_ctx():
    worker = os.environ.get("PYTEST_XDIST_WORKER", "gw0")
    email = f"TEST_v6_cust_{worker}_{uuid.uuid4().hex[:6]}@explore91.dev"
    token, user_id = _run(_seed_user(email, ["customer"]))
    yield {"token": token, "user_id": user_id, "email": email,
           "H": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}

    async def _clean():
        db = _mongo()
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.users.delete_many({"email": email})
        await db.tickets.delete_many({"user_id": user_id})
    _run(_clean())


# ============================================================================
# CMS Categories
# ============================================================================
class TestCategoriesCMS:
    def test_public_categories_default_count(self):
        r = requests.get(f"{BASE_URL}/api/categories", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 24

    def test_create_delete_and_public_pickup(self, admin_ctx):
        slug = f"yoga-studios-{uuid.uuid4().hex[:4]}"
        # cleanup possible leftover
        requests.delete(f"{BASE_URL}/api/admin/categories/{slug}", headers=admin_ctx["H"], timeout=15)

        # create
        r = requests.post(f"{BASE_URL}/api/admin/categories", headers=admin_ctx["H"],
                          json={"slug": slug, "name": "Yoga", "icon": "leaf-outline"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["slug"] == slug

        # public GET picks it up
        pub = requests.get(f"{BASE_URL}/api/categories", timeout=15).json()
        assert slug in {c["slug"] for c in pub}

        # admin GET marks source correctly
        adm = requests.get(f"{BASE_URL}/api/admin/categories", headers=admin_ctx["H"], timeout=15).json()
        srcs = {c["slug"]: c.get("source") for c in adm}
        assert srcs.get(slug) == "cms"
        assert srcs.get("restaurants") == "default"

        # duplicate → 409
        dup = requests.post(f"{BASE_URL}/api/admin/categories", headers=admin_ctx["H"],
                            json={"slug": slug, "name": "Yoga2", "icon": "leaf-outline"}, timeout=15)
        assert dup.status_code == 409

        # delete default → 404
        d1 = requests.delete(f"{BASE_URL}/api/admin/categories/restaurants",
                             headers=admin_ctx["H"], timeout=15)
        assert d1.status_code == 404

        # delete custom → 200
        d2 = requests.delete(f"{BASE_URL}/api/admin/categories/{slug}",
                             headers=admin_ctx["H"], timeout=15)
        assert d2.status_code == 200
        assert d2.json().get("ok") is True

    def test_invalid_slug_422(self, admin_ctx):
        r = requests.post(f"{BASE_URL}/api/admin/categories", headers=admin_ctx["H"],
                          json={"slug": "Bad Slug!", "name": "X", "icon": "x"}, timeout=15)
        assert r.status_code == 422


# ============================================================================
# CMS Cities
# ============================================================================
class TestCitiesCMS:
    def test_create_and_public_pickup(self, admin_ctx):
        slug = f"testcity-{uuid.uuid4().hex[:4]}"
        payload = {
            "slug": slug, "name": "Test City",
            "state": "Test State",
            "tagline": "For testing",
            "image": "https://images.unsplash.com/photo-1.jpg",
        }
        r = requests.post(f"{BASE_URL}/api/admin/cities", headers=admin_ctx["H"], json=payload, timeout=15)
        assert r.status_code == 200, r.text

        pub = requests.get(f"{BASE_URL}/api/cities", timeout=15).json()
        assert slug in {c["slug"] for c in pub}

        d = requests.delete(f"{BASE_URL}/api/admin/cities/{slug}", headers=admin_ctx["H"], timeout=15)
        assert d.status_code == 200

    def test_list_reports_content_counts(self, admin_ctx):
        """An admin needs to see which cities still have nothing in them."""
        r = requests.get(f"{BASE_URL}/api/admin/cities", headers=admin_ctx["H"], timeout=20)
        assert r.status_code == 200, r.text
        cities = r.json()
        assert cities
        for c in cities:
            assert isinstance(c["business_count"], int)
            assert isinstance(c["reel_count"], int)
            assert c["is_live"] == (c["business_count"] > 0), c["slug"]
            # the existing source flag must survive the annotation
            assert c["source"] in ("default", "cms")

    def test_a_new_city_starts_not_live(self, admin_ctx):
        """Freshly added cities have no listings, so the app holds them back as
        "coming soon" rather than showing an empty city."""
        slug = f"testcity-{uuid.uuid4().hex[:4]}"
        payload = {
            "slug": slug, "name": "Test City",
            "state": "Test State",
            "tagline": "For testing",
            "image": "https://images.unsplash.com/photo-1.jpg",
        }
        assert requests.post(
            f"{BASE_URL}/api/admin/cities", headers=admin_ctx["H"],
            json=payload, timeout=15,
        ).status_code == 200
        try:
            rows = requests.get(
                f"{BASE_URL}/api/admin/cities", headers=admin_ctx["H"], timeout=20
            ).json()
            row = next(c for c in rows if c["slug"] == slug)
            assert row["business_count"] == 0
            assert row["is_live"] is False

            groups = requests.get(f"{BASE_URL}/api/cities/grouped", timeout=20).json()
            pub = next(c for g in groups for c in g["cities"] if c["slug"] == slug)
            assert pub["is_live"] is False
        finally:
            requests.delete(
                f"{BASE_URL}/api/admin/cities/{slug}", headers=admin_ctx["H"], timeout=15
            )

    def test_invalid_https_image_422(self, admin_ctx):
        payload = {"slug": f"c-{uuid.uuid4().hex[:4]}", "name": "X",
                   "tagline": "y", "image": "http://insecure.jpg"}
        r = requests.post(f"{BASE_URL}/api/admin/cities", headers=admin_ctx["H"], json=payload, timeout=15)
        assert r.status_code == 422

    def test_invalid_slug_pattern_422(self, admin_ctx):
        payload = {"slug": "Bad Slug", "name": "X", "tagline": "y",
                   "image": "https://x.com/1.jpg"}
        r = requests.post(f"{BASE_URL}/api/admin/cities", headers=admin_ctx["H"], json=payload, timeout=15)
        assert r.status_code == 422


# ============================================================================
# Banners
# ============================================================================
class TestBanners:
    created_ids = []

    def test_public_empty_by_default(self):
        r = requests.get(f"{BASE_URL}/api/banners", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_and_read_active(self, admin_ctx):
        payload = {"title": "TEST_Promo", "image": "https://cdn.x.com/b.jpg",
                   "position": "home_promo", "city": "goa"}
        r = requests.post(f"{BASE_URL}/api/admin/banners", headers=admin_ctx["H"], json=payload, timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["banner_id"].startswith("bn_")
        TestBanners.created_ids.append(b["banner_id"])

        pub = requests.get(f"{BASE_URL}/api/banners", timeout=15).json()
        assert b["banner_id"] in {x["banner_id"] for x in pub}

        # city filter — goa should include it
        goa = requests.get(f"{BASE_URL}/api/banners?city=goa", timeout=15).json()
        assert b["banner_id"] in {x["banner_id"] for x in goa}

    def test_deactivate_hides_from_public(self, admin_ctx):
        bid = TestBanners.created_ids[-1]
        p = requests.patch(f"{BASE_URL}/api/admin/banners/{bid}", headers=admin_ctx["H"],
                           json={"is_active": False}, timeout=15)
        assert p.status_code == 200
        pub = requests.get(f"{BASE_URL}/api/banners", timeout=15).json()
        assert bid not in {x["banner_id"] for x in pub}

    # --- iter-7: PATCH tightening (BannerUpdate Pydantic model + https-only) ---
    def test_patch_valid_https_image_200(self, admin_ctx):
        """PATCH with a valid https image succeeds and returns updated doc."""
        bid = TestBanners.created_ids[-1]
        new_img = "https://cdn.x.com/new-image.jpg"
        p = requests.patch(f"{BASE_URL}/api/admin/banners/{bid}", headers=admin_ctx["H"],
                           json={"image": new_img}, timeout=15)
        assert p.status_code == 200, p.text
        body = p.json()
        assert body["banner_id"] == bid
        assert body["image"] == new_img

    def test_patch_http_image_now_422(self, admin_ctx):
        """PATCH image='http://...' MUST return 422 (was silently accepted before iter-7)."""
        bid = TestBanners.created_ids[-1]
        p = requests.patch(f"{BASE_URL}/api/admin/banners/{bid}", headers=admin_ctx["H"],
                           json={"image": "http://insecure.com/x.jpg"}, timeout=15)
        assert p.status_code == 422, p.text
        # verify the DB was NOT mutated — image is still the valid https one
        g = requests.get(f"{BASE_URL}/api/admin/banners", headers=admin_ctx["H"], timeout=15).json()
        row = next(x for x in g if x["banner_id"] == bid)
        assert row["image"].startswith("https://")

    def test_patch_javascript_link_422(self, admin_ctx):
        """PATCH link_url='javascript:alert(1)' MUST return 422."""
        bid = TestBanners.created_ids[-1]
        p = requests.patch(f"{BASE_URL}/api/admin/banners/{bid}", headers=admin_ctx["H"],
                           json={"link_url": "javascript:alert(1)"}, timeout=15)
        assert p.status_code == 422, p.text

    def test_patch_unknown_fields_dropped(self, admin_ctx):
        """Unknown fields should be silently dropped (exclude_none) — no 422, no mutation.

        We PATCH with only an unknown field + a valid title change. The unknown field
        must not persist; the valid title change must persist.
        """
        bid = TestBanners.created_ids[-1]
        new_title = "TEST_Promo_v7"
        p = requests.patch(f"{BASE_URL}/api/admin/banners/{bid}", headers=admin_ctx["H"],
                           json={"title": new_title, "totally_unknown_field": "evil-xss"},
                           timeout=15)
        assert p.status_code == 200, p.text
        body = p.json()
        assert body["title"] == new_title
        assert "totally_unknown_field" not in body

    def test_delete_removes(self, admin_ctx):
        bid = TestBanners.created_ids[-1]
        d = requests.delete(f"{BASE_URL}/api/admin/banners/{bid}", headers=admin_ctx["H"], timeout=15)
        assert d.status_code == 200

    def test_invalid_https_image_422(self, admin_ctx):
        r = requests.post(f"{BASE_URL}/api/admin/banners", headers=admin_ctx["H"],
                          json={"title": "x", "image": "http://insecure.jpg"}, timeout=15)
        assert r.status_code == 422

    def test_invalid_link_url_422(self, admin_ctx):
        r = requests.post(f"{BASE_URL}/api/admin/banners", headers=admin_ctx["H"],
                          json={"title": "x", "image": "https://ok.com/1.jpg",
                                "link_url": "javascript:alert(1)"}, timeout=15)
        assert r.status_code == 422


# ============================================================================
# Reels moderation
# ============================================================================
class TestReelsModeration:
    def test_admin_list_and_toggle_visibility(self, admin_ctx):
        # get any visible reel
        r = requests.get(f"{BASE_URL}/api/admin/reels?hidden=false", headers=admin_ctx["H"], timeout=15)
        assert r.status_code == 200
        reels = r.json()
        assert isinstance(reels, list) and len(reels) > 0, "expected seeded reels"
        reel_id = reels[0]["reel_id"]

        # public list currently includes it
        pub = requests.get(f"{BASE_URL}/api/reels?limit=100", timeout=15).json()
        assert reel_id in {x["reel_id"] for x in pub}

        # toggle → hidden
        t = requests.patch(f"{BASE_URL}/api/admin/reels/{reel_id}/visibility",
                           headers=admin_ctx["H"], timeout=15)
        assert t.status_code == 200
        assert t.json()["is_hidden"] is True

        pub2 = requests.get(f"{BASE_URL}/api/reels?limit=100", timeout=15).json()
        assert reel_id not in {x["reel_id"] for x in pub2}

        # toggle back → visible
        t2 = requests.patch(f"{BASE_URL}/api/admin/reels/{reel_id}/visibility",
                            headers=admin_ctx["H"], timeout=15)
        assert t2.status_code == 200
        assert t2.json()["is_hidden"] is False

    def test_toggle_non_existent_404(self, admin_ctx):
        r = requests.patch(f"{BASE_URL}/api/admin/reels/reel_nope_xyz/visibility",
                           headers=admin_ctx["H"], timeout=15)
        assert r.status_code == 404

    def test_delete_reel_cleans_likes(self, admin_ctx):
        # create a throwaway reel directly in mongo
        async def _mk():
            db = _mongo()
            rid = f"reel_TESTv6_{uuid.uuid4().hex[:6]}"
            await db.reels.insert_one({
                "reel_id": rid, "caption": "TEST reel v6",
                "video_url": "https://x.com/v.mp4",
                "created_at": datetime.now(timezone.utc),
            })
            await db.reel_likes.insert_one({"reel_id": rid, "user_id": "user_x"})
            return rid
        rid = _run(_mk())
        d = requests.delete(f"{BASE_URL}/api/admin/reels/{rid}", headers=admin_ctx["H"], timeout=15)
        assert d.status_code == 200

        async def _check():
            db = _mongo()
            assert await db.reels.find_one({"reel_id": rid}) is None
            assert await db.reel_likes.find_one({"reel_id": rid}) is None
        _run(_check())


# ============================================================================
# Support tickets
# ============================================================================
class TestTickets:
    """Each test owns the ticket it asserts on.

    Previously a ticket_id was set by the first test and read by the next two,
    so any run that did not execute them in order left the later ones
    patching a ticket that was never created.
    """

    @pytest.fixture
    def ticket(self, customer_ctx):
        r = requests.post(
            f"{BASE_URL}/api/tickets", headers=customer_ctx["H"],
            json={"subject": f"TEST v6 issue {uuid.uuid4().hex[:8]}",
                  "message": "please help"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        ticket_id = r.json()["ticket_id"]

        yield ticket_id

        async def _clean():
            await _mongo().tickets.delete_many({"ticket_id": ticket_id})
        _run(_clean())

    def test_create_and_list_mine(self, customer_ctx, ticket):
        mine = requests.get(f"{BASE_URL}/api/tickets/mine",
                            headers=customer_ctx["H"], timeout=15).json()
        assert ticket in {x["ticket_id"] for x in mine}
        assert all(x["status"] in ("open", "pending", "resolved") for x in mine)

    def test_admin_list_and_status_filter(self, admin_ctx, ticket):
        lst = requests.get(f"{BASE_URL}/api/admin/tickets",
                           headers=admin_ctx["H"], timeout=15).json()
        assert ticket in {x["ticket_id"] for x in lst}

        open_only = requests.get(f"{BASE_URL}/api/admin/tickets?status=open",
                                 headers=admin_ctx["H"], timeout=15).json()
        assert all(x["status"] == "open" for x in open_only)

    def test_admin_reply_and_resolve(self, admin_ctx, ticket):
        r = requests.patch(f"{BASE_URL}/api/admin/tickets/{ticket}",
                           headers=admin_ctx["H"],
                           json={"admin_reply": "Hi", "status": "resolved"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "resolved"
        assert r.json()["admin_reply"] == "Hi"

    def test_rate_limit_5_per_min(self):
        # Fresh customer to avoid consuming other tests' budget
        worker = os.environ.get("PYTEST_XDIST_WORKER", "gw0")
        email = f"TEST_v6_rl_{worker}_{uuid.uuid4().hex[:6]}@explore91.dev"
        token, user_id = _run(_seed_user(email, ["customer"]))
        H = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        codes = []
        for i in range(6):
            r = requests.post(f"{BASE_URL}/api/tickets", headers=H,
                              json={"subject": f"rl-{i}", "message": "spam"}, timeout=15)
            codes.append(r.status_code)
        assert codes.count(200) == 5, codes
        assert codes[-1] == 429, codes

        async def _clean():
            db = _mongo()
            await db.user_sessions.delete_many({"user_id": user_id})
            await db.users.delete_many({"email": email})
            await db.tickets.delete_many({"user_id": user_id})
        _run(_clean())


# ============================================================================
# Fraud flags
# ============================================================================
class TestFraudFlags:
    """Each test owns the flag it asserts on.

    These used to hand a flag_id between tests through a class attribute, and
    the last test deleted every flag sharing a fixed reason string. Any run
    where that ordering did not hold — or where a concurrent worker swept the
    same rows — left the later tests resolving a flag that no longer existed,
    which is the 404 that made the suite flaky in parallel.
    """

    @pytest.fixture
    def flag(self, admin_ctx):
        """An open flag that belongs to this test alone."""
        reason = f"TEST v6 fraud {uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{BASE_URL}/api/admin/flags", headers=admin_ctx["H"],
            json={"entity_type": "business",
                  "entity_id": f"biz_test_{uuid.uuid4().hex[:6]}",
                  "reason": reason},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        flag_id = r.json()["flag_id"]

        yield flag_id

        async def _clean():
            await _mongo().fraud_flags.delete_many({"flag_id": flag_id})
        _run(_clean())

    def test_create_and_list(self, admin_ctx, flag):
        lst = requests.get(f"{BASE_URL}/api/admin/flags",
                           headers=admin_ctx["H"], timeout=15).json()
        assert flag in {x["flag_id"] for x in lst}

    def test_status_open_filter(self, admin_ctx, flag):
        lst = requests.get(f"{BASE_URL}/api/admin/flags?status=open",
                           headers=admin_ctx["H"], timeout=15).json()
        assert all(x["status"] == "open" for x in lst)
        assert flag in {x["flag_id"] for x in lst}

    def test_resolve(self, admin_ctx, flag):
        r = requests.patch(f"{BASE_URL}/api/admin/flags/{flag}/resolve",
                           headers=admin_ctx["H"], timeout=15)
        assert r.status_code == 200, r.text
        lst = requests.get(f"{BASE_URL}/api/admin/flags?status=resolved",
                           headers=admin_ctx["H"], timeout=15).json()
        assert flag in {x["flag_id"] for x in lst}

    def test_invalid_entity_type_422(self, admin_ctx):
        r = requests.post(f"{BASE_URL}/api/admin/flags", headers=admin_ctx["H"],
                          json={"entity_type": "hotel", "entity_id": "x", "reason": "y"}, timeout=15)
        assert r.status_code == 422


# ============================================================================
# Block user
# ============================================================================
class TestBlockUser:
    def test_block_then_403_and_session_revoked(self, admin_ctx):
        # seed victim
        worker = os.environ.get("PYTEST_XDIST_WORKER", "gw0")
        email = f"TEST_v6_victim_{worker}_{uuid.uuid4().hex[:6]}@explore91.dev"
        vtoken, vuid = _run(_seed_user(email, ["customer"]))
        vH = {"Authorization": f"Bearer {vtoken}", "Content-Type": "application/json"}

        # Baseline /me works
        r0 = requests.get(f"{BASE_URL}/api/auth/me", headers=vH, timeout=15)
        assert r0.status_code == 200

        # Block
        b = requests.patch(f"{BASE_URL}/api/admin/users/{vuid}/block",
                           headers=admin_ctx["H"], timeout=15)
        assert b.status_code == 200
        assert b.json()["is_blocked"] is True

        # Session revoked → 401 (session doc deleted)
        r1 = requests.get(f"{BASE_URL}/api/auth/me", headers=vH, timeout=15)
        assert r1.status_code == 401

        # If we re-seed a session for the same blocked user, we should see 403 with 'blocked'
        async def _resess():
            db = _mongo()
            now = datetime.now(timezone.utc)
            tok = f"test_{uuid.uuid4().hex}"
            await db.user_sessions.insert_one({
                "session_token": tok, "user_id": vuid,
                "created_at": now, "expires_at": now + timedelta(days=7),
            })
            return tok
        tok2 = _run(_resess())
        r2 = requests.get(f"{BASE_URL}/api/auth/me",
                          headers={"Authorization": f"Bearer {tok2}"}, timeout=15)
        assert r2.status_code == 403
        assert "blocked" in r2.json().get("detail", "").lower()

        # cleanup
        async def _clean():
            db = _mongo()
            await db.user_sessions.delete_many({"user_id": vuid})
            await db.users.delete_many({"email": email})
        _run(_clean())

    def test_admin_cannot_block_self(self, admin_ctx):
        r = requests.patch(f"{BASE_URL}/api/admin/users/{admin_ctx['user_id']}/block",
                           headers=admin_ctx["H"], timeout=15)
        assert r.status_code == 400

    def test_block_non_existent_404(self, admin_ctx):
        r = requests.patch(f"{BASE_URL}/api/admin/users/user_nope_xyz/block",
                           headers=admin_ctx["H"], timeout=15)
        assert r.status_code == 404


# ============================================================================
# Business delete cascade -> reels
# ============================================================================
class TestBusinessDeleteCascade:
    def test_delete_business_removes_its_reels(self, admin_ctx):
        # seed a biz + reel linked to it
        async def _mk():
            db = _mongo()
            bid = f"biz_TESTv6_{uuid.uuid4().hex[:6]}"
            rid = f"reel_TESTv6_{uuid.uuid4().hex[:6]}"
            await db.businesses.insert_one({
                "business_id": bid, "name": "TEST_OwnerBiz v6 cascade",
                "city": "goa", "category": "bars-cafes",
                "is_approved": True,
                "created_at": datetime.now(timezone.utc),
            })
            await db.reels.insert_one({
                "reel_id": rid, "business_id": bid,
                "caption": "TEST reel cascade",
                "video_url": "https://x.com/v.mp4",
                "created_at": datetime.now(timezone.utc),
            })
            return bid, rid

        bid, rid = _run(_mk())

        d = requests.delete(f"{BASE_URL}/api/admin/businesses/{bid}",
                            headers=admin_ctx["H"], timeout=15)
        assert d.status_code == 200

        async def _check():
            db = _mongo()
            assert await db.businesses.find_one({"business_id": bid}) is None
            assert await db.reels.find_one({"reel_id": rid}) is None
        _run(_check())


# ============================================================================
# Financial reports
# ============================================================================
class TestGMVReports:
    def test_gmv_default_30d(self, admin_ctx):
        r = requests.get(f"{BASE_URL}/api/admin/reports/gmv?days=30",
                         headers=admin_ctx["H"], timeout=15)
        assert r.status_code == 200
        data = r.json()
        for k in ("days", "city", "total_bookings", "total_gmv", "total_fees", "series"):
            assert k in data
        assert data["days"] == 30
        assert isinstance(data["series"], list)

    def test_gmv_city_filter(self, admin_ctx):
        r = requests.get(f"{BASE_URL}/api/admin/reports/gmv?days=30&city=goa",
                         headers=admin_ctx["H"], timeout=15)
        assert r.status_code == 200
        assert r.json()["city"] == "goa"

    def test_gmv_days_bounds(self, admin_ctx):
        r0 = requests.get(f"{BASE_URL}/api/admin/reports/gmv?days=0",
                          headers=admin_ctx["H"], timeout=15)
        assert r0.status_code == 422
        r200 = requests.get(f"{BASE_URL}/api/admin/reports/gmv?days=200",
                            headers=admin_ctx["H"], timeout=15)
        assert r200.status_code == 422

    def test_gmv_export_csv(self, admin_ctx):
        r = requests.get(f"{BASE_URL}/api/admin/reports/gmv/export?days=7",
                         headers=admin_ctx["H"], timeout=15)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "text/csv" in ct.lower(), ct
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower(), cd
        # first line header
        assert r.text.splitlines()[0] == "date,bookings,gmv_inr,fees_inr"


# ============================================================================
# SECURITY: admin gating
# ============================================================================
class TestAdminSecurity:
    ADMIN_ENDPOINTS_GET = [
        "/api/admin/stats",
        "/api/admin/users",
        "/api/admin/businesses",
        "/api/admin/reels",
        "/api/admin/categories",
        "/api/admin/cities",
        "/api/admin/banners",
        "/api/admin/tickets",
        "/api/admin/flags",
        "/api/admin/reports/gmv",
        "/api/admin/reports/gmv/export?days=7",
    ]

    def test_no_token_returns_401(self):
        for ep in self.ADMIN_ENDPOINTS_GET:
            r = requests.get(f"{BASE_URL}{ep}", timeout=15)
            assert r.status_code == 401, f"{ep} → {r.status_code}"

    def test_customer_returns_403(self, customer_ctx):
        for ep in self.ADMIN_ENDPOINTS_GET:
            r = requests.get(f"{BASE_URL}{ep}", headers=customer_ctx["H"], timeout=15)
            assert r.status_code == 403, f"{ep} → {r.status_code}"

    def test_customer_cannot_write(self, customer_ctx):
        # POST /admin/categories
        r = requests.post(f"{BASE_URL}/api/admin/categories", headers=customer_ctx["H"],
                          json={"slug": "x-x", "name": "X", "icon": "x"}, timeout=15)
        assert r.status_code == 403
        # PATCH block-user
        r2 = requests.patch(f"{BASE_URL}/api/admin/users/user_x/block",
                            headers=customer_ctx["H"], timeout=15)
        assert r2.status_code == 403
