"""Admin content creation — POST/PATCH for places and reels.

Until these endpoints existed the only way a place entered the system was
POST /owner/businesses, which requires a business-owner account, and the only
way a reel did was POST /owner/reels. Seeding a city therefore meant one owner
login per venue or running scripts against production, neither of which the
person doing the content work can do from a browser.

The assertions worth reading are not "it returns 201". They are the side
effects that make a created place actually usable: a slug so it is shareable,
coordinates in the right city, immediate visibility on the public API and the
public page, and an audit entry naming who added it.
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

# A sample clip from the seed set, so nothing here depends on an external host
# that could change.
VIDEO = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4"


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    import asyncio

    return asyncio.new_event_loop().run_until_complete(coro)


async def _delete(collection: str, query: dict) -> None:
    """Delete, building the Motor client inside the coroutine.

    _run spins a fresh event loop per call, and a Motor client binds to the
    loop that was current when it was created. Calling _mongo() outside the
    coroutine and awaiting the result inside raises "the future belongs to a
    different loop" — which is what this helper exists to stop anyone
    rediscovering.
    """
    await _mongo()[collection].delete_many(query)


async def _seed_admin(email: str):
    db = _mongo()
    now = datetime.now(timezone.utc)
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "Admin content tester",
        "picture": None,
        "wallet_points": 500,
        "home_city": "Goa",
        "roles": ["customer", "admin"],
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


@pytest.fixture(scope="module")
def admin():
    email = f"TEST_admincontent_{WORKER}_{uuid.uuid4().hex[:6]}@explore91.dev"
    token, user_id = _run(_seed_admin(email))
    yield {"H": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}

    async def _clean():
        db = _mongo()
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.users.delete_many({"user_id": user_id})

    _run(_clean())


@pytest.fixture
def place(admin):
    """A place this test alone owns, removed afterwards whatever happens."""
    r = requests.post(
        f"{BASE_URL}/api/admin/businesses",
        headers=admin["H"],
        json={
            "name": f"TEST admin place {uuid.uuid4().hex[:6]}",
            "category": "cafes",
            "city": "Mumbai",
            "address": "Hill Road, Bandra West",
            "area": "Bandra",
            "description": "Created by the admin content tests.",
            "price_range": "$$",
            "tags": ["Coffee"],
        },
        timeout=20,
    )
    assert r.status_code == 201, r.text
    doc = r.json()

    yield doc

    async def _clean():
        db = _mongo()
        await db.reels.delete_many({"business_id": doc["business_id"]})
        await db.businesses.delete_many({"business_id": doc["business_id"]})

    _run(_clean())


class TestCreatePlace:
    def test_is_unclaimed_not_owned_by_the_admin(self, place):
        """An admin curating the catalogue is not the proprietor.

        Leaving owner_id empty is what lets a real owner claim the place
        later; pointing it at the admin would quietly make them the owner of
        every venue they seeded.
        """
        assert place.get("owner_id") == ""

    def test_is_shareable_immediately(self, place):
        """A slug at creation, not at the next boot's backfill."""
        assert place.get("slug")
        page = requests.get(f"{BASE_URL}/place/{place['slug']}", timeout=20)
        assert page.status_code == 200
        assert place["name"] in page.text

    def test_is_live_on_the_public_api(self, place, admin):
        listed = requests.get(
            f"{BASE_URL}/api/businesses", params={"city": "mumbai", "limit": 100},
            timeout=20,
        ).json()
        assert any(b["business_id"] == place["business_id"] for b in listed)

    def test_lands_in_the_right_city(self, place):
        """CITY_COORDS covered three cities and fell back to Goa for the rest,
        so a Mumbai venue was pinned off the Konkan coast. Every city in
        CITIES now has an entry; this guards the one that mattered."""
        assert 19.0 < place["lat"] < 19.2, place["lat"]
        assert 72.7 < place["lng"] < 73.0, place["lng"]

    def test_explicit_coordinates_win(self, admin):
        r = requests.post(
            f"{BASE_URL}/api/admin/businesses",
            headers=admin["H"],
            json={
                "name": f"TEST coords {uuid.uuid4().hex[:6]}",
                "category": "cafes", "city": "mumbai", "address": "x",
                "lat": 19.0176, "lng": 72.8562,
            },
            timeout=20,
        )
        assert r.status_code == 201, r.text
        doc = r.json()
        try:
            assert doc["lat"] == 19.0176 and doc["lng"] == 72.8562
        finally:
            _run(_delete("businesses", {"business_id": doc["business_id"]}))

    @pytest.mark.parametrize("field", ["cover_image"])
    def test_rejects_insecure_image_urls(self, admin, field):
        r = requests.post(
            f"{BASE_URL}/api/admin/businesses",
            headers=admin["H"],
            json={"name": "x", "category": "cafes", "city": "goa", "address": "y",
                  field: "http://insecure.example/x.jpg"},
            timeout=20,
        )
        assert r.status_code == 422, r.text


class TestEditPlace:
    def test_only_sent_fields_change(self, place, admin):
        r = requests.patch(
            f"{BASE_URL}/api/admin/businesses/{place['business_id']}",
            headers=admin["H"], json={"price_range": "$$$"}, timeout=20,
        )
        assert r.status_code == 200, r.text
        after = r.json()
        assert after["price_range"] == "$$$"
        assert after["area"] == "Bandra", "an unsent field was overwritten"

    def test_renaming_does_not_move_the_public_url(self, place, admin):
        """The slug is a permanent public URL that may already be shared and
        indexed. Repointing it on every rename would break those links."""
        r = requests.patch(
            f"{BASE_URL}/api/admin/businesses/{place['business_id']}",
            headers=admin["H"], json={"name": "TEST renamed entirely"}, timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["slug"] == place["slug"]

    def test_unknown_place_is_404(self, admin):
        r = requests.patch(
            f"{BASE_URL}/api/admin/businesses/biz_definitely_not_real",
            headers=admin["H"], json={"name": "x"}, timeout=20,
        )
        assert r.status_code == 404

    def test_the_subpath_routes_are_not_shadowed(self, place, admin):
        """PATCH /{id} was added next to PATCH /{id}/approve.

        A route declared in the wrong order swallows its own sub-paths — the
        same shape of bug as /reels/topics being shadowed by /reels/{id}. One
        request each is enough to prove the router still distinguishes them.
        """
        bid = place["business_id"]
        for sub in ("approve", "feature"):
            r = requests.patch(
                f"{BASE_URL}/api/admin/businesses/{bid}/{sub}",
                headers=admin["H"], timeout=20,
            )
            assert r.status_code == 200, f"/{sub}: {r.status_code} {r.text}"


class TestCreateReel:
    def test_carries_its_places_slug(self, place, admin):
        """A shared reel links to its place; reels have no page of their own."""
        r = requests.post(
            f"{BASE_URL}/api/admin/reels",
            headers=admin["H"],
            json={"business_id": place["business_id"], "city": "mumbai",
                  "video_url": VIDEO, "caption": "TEST reel"},
            timeout=20,
        )
        assert r.status_code == 201, r.text
        assert r.json()["business_slug"] == place["slug"]

    def test_takes_the_places_city_not_the_typed_one(self, place, admin):
        """Whatever city is typed, the reel belongs where the place is."""
        r = requests.post(
            f"{BASE_URL}/api/admin/reels",
            headers=admin["H"],
            json={"business_id": place["business_id"], "city": "goa",
                  "video_url": VIDEO, "caption": "TEST reel"},
            timeout=20,
        )
        assert r.status_code == 201, r.text
        assert r.json()["city"] == "mumbai"

    def test_a_city_reel_needs_no_business(self, admin):
        """Pune has places and no reels. A city reel that is not of one venue
        is a real thing to publish, and attaching an arbitrary business would
        invent an association the reel then displays as a link."""
        r = requests.post(
            f"{BASE_URL}/api/admin/reels",
            headers=admin["H"],
            json={"city": "pune", "video_url": VIDEO, "caption": "TEST city reel"},
            timeout=20,
        )
        assert r.status_code == 201, r.text
        doc = r.json()
        try:
            assert doc["business_id"] is None
            feed = requests.get(
                f"{BASE_URL}/api/reels", params={"city": "pune", "limit": 50}, timeout=20
            ).json()
            assert any(x["reel_id"] == doc["reel_id"] for x in feed)
        finally:
            _run(_delete("reels", {"reel_id": doc["reel_id"]}))

    def test_rejects_an_insecure_video_url(self, admin):
        r = requests.post(
            f"{BASE_URL}/api/admin/reels",
            headers=admin["H"],
            json={"city": "goa", "video_url": "http://insecure.example/x.mp4",
                  "caption": "x"},
            timeout=20,
        )
        assert r.status_code == 422, r.text

    def test_unknown_business_is_404(self, admin):
        r = requests.post(
            f"{BASE_URL}/api/admin/reels",
            headers=admin["H"],
            json={"business_id": "biz_not_real", "city": "goa",
                  "video_url": VIDEO, "caption": "x"},
            timeout=20,
        )
        assert r.status_code == 404


class TestEditReel:
    @pytest.fixture
    def reel(self, place, admin):
        r = requests.post(
            f"{BASE_URL}/api/admin/reels",
            headers=admin["H"],
            json={"business_id": place["business_id"], "city": "mumbai",
                  "video_url": VIDEO, "caption": "TEST reel"},
            timeout=20,
        )
        assert r.status_code == 201, r.text
        doc = r.json()
        yield doc
        _run(_delete("reels", {"reel_id": doc["reel_id"]}))

    def test_caption_edit_applies(self, reel, admin):
        r = requests.patch(
            f"{BASE_URL}/api/admin/reels/{reel['reel_id']}",
            headers=admin["H"], json={"caption": "TEST edited"}, timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["caption"] == "TEST edited"

    def test_repointing_carries_the_denormalised_fields(self, reel, admin):
        """Moving a reel to another place has to bring the slug and name with
        it, or the reel keeps linking to the previous venue."""
        other = requests.get(
            f"{BASE_URL}/api/businesses", params={"city": "goa", "limit": 1}, timeout=20
        ).json()[0]
        r = requests.patch(
            f"{BASE_URL}/api/admin/reels/{reel['reel_id']}",
            headers=admin["H"], json={"business_id": other["business_id"]}, timeout=20,
        )
        assert r.status_code == 200, r.text
        after = r.json()
        assert after["business_slug"] == other["slug"]
        assert after["business_name"] == other["name"]
        assert after["city"] == other["city"], "the reel kept the old city"

    def test_visibility_subpath_is_not_shadowed(self, reel, admin):
        r = requests.patch(
            f"{BASE_URL}/api/admin/reels/{reel['reel_id']}/visibility",
            headers=admin["H"], timeout=20,
        )
        assert r.status_code == 200, r.text


class TestAuthorisation:
    """These endpoints write to the public catalogue. Who may call them is the
    most important thing about them."""

    PAYLOAD = {"name": "x", "category": "cafes", "city": "goa", "address": "y"}

    def test_anonymous_is_401(self):
        r = requests.post(f"{BASE_URL}/api/admin/businesses", json=self.PAYLOAD, timeout=20)
        assert r.status_code == 401

    def test_a_signed_in_non_admin_is_403(self):
        email = f"TEST_plain_{WORKER}_{uuid.uuid4().hex[:6]}@explore91.dev"

        async def _seed():
            db = _mongo()
            now = datetime.now(timezone.utc)
            uid = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.insert_one({
                "user_id": uid, "email": email, "name": "Plain", "picture": None,
                "wallet_points": 0, "home_city": "Goa", "roles": ["customer"],
                "created_at": now,
            })
            tok = f"test_{uuid.uuid4().hex}"
            await db.user_sessions.insert_one({
                "session_token": tok, "user_id": uid, "created_at": now,
                "expires_at": now + timedelta(days=7),
            })
            return tok, uid

        token, uid = _run(_seed())
        try:
            r = requests.post(
                f"{BASE_URL}/api/admin/businesses",
                headers={"Authorization": f"Bearer {token}"},
                json=self.PAYLOAD, timeout=20,
            )
            assert r.status_code == 403, r.text
        finally:
            async def _clean():
                db = _mongo()
                await db.user_sessions.delete_many({"user_id": uid})
                await db.users.delete_many({"user_id": uid})

            _run(_clean())


class TestAudit:
    def test_creating_a_place_names_who_did_it(self, place, admin):
        """A write to the public catalogue with no attribution is the thing
        an audit log exists to prevent."""
        rows = requests.get(
            f"{BASE_URL}/api/admin/audit", headers=admin["H"],
            params={"limit": 100}, timeout=20,
        ).json()
        rows = rows.get("rows", rows) if isinstance(rows, dict) else rows
        mine = [
            r for r in rows
            if r.get("action") == "business.create"
            and r.get("entity_id") == place["business_id"]
        ]
        assert mine, "no audit entry for the created place"
        assert mine[0].get("actor_email"), "audit entry names no actor"
