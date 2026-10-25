"""Enabling and disabling a category.

Before this, the only control was DELETE, and it refuses outright on the
twenty-four built-in categories — they are defined in code with no database
row to remove. So a built-in could be added to but never taken down, and the
only way to retire one was to ship a code change.

Disabling is deliberately not deletion: it withdraws the category from the
app's filters and leaves every place tagged with it alone. Those places stay
listed, keep the tag, and remain reachable under "All" — disabling is about
the taxonomy, not the content. The tests below assert that separation,
because conflating the two is the obvious way to get this wrong.

A built-in is disabled by writing an override row into categories_cms, which
is the same layer the public endpoint already merges. Re-enabling removes
that override rather than flipping the flag back, so the category returns to
having one definition instead of a redundant copy that can drift.
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

# A seeded category, defined in code with no row of its own.
BUILTIN = "cafes"


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    import asyncio

    return asyncio.new_event_loop().run_until_complete(coro)


async def _delete(collection: str, query: dict) -> None:
    """Build the client inside the coroutine.

    _run spins a fresh event loop per call and a Motor client binds to
    whichever loop was current when it was created, so building one outside
    and awaiting inside raises "the future belongs to a different loop". Easy
    to do by reflex — these wrappers exist so it cannot be.
    """
    await _mongo()[collection].delete_many(query)


async def _update(collection: str, query: dict, patch: dict) -> None:
    await _mongo()[collection].update_one(query, {"$set": patch})


@pytest.fixture(scope="module")
def admin():
    email = f"TEST_cattoggle_{WORKER}_{uuid.uuid4().hex[:6]}@explore91.dev"

    async def _seed():
        db = _mongo()
        now = datetime.now(timezone.utc)
        uid = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": uid, "email": email, "name": "Category tester",
            "picture": None, "wallet_points": 0, "home_city": "Goa",
            "roles": ["customer", "admin"], "created_at": now,
        })
        tok = f"test_{uuid.uuid4().hex}"
        await db.user_sessions.insert_one({
            "session_token": tok, "user_id": uid, "created_at": now,
            "expires_at": now + timedelta(days=7),
        })
        return tok, uid

    token, uid = _run(_seed())
    yield {"H": {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}}

    async def _clean():
        db = _mongo()
        await db.user_sessions.delete_many({"user_id": uid})
        await db.users.delete_many({"user_id": uid})

    _run(_clean())


def _public_slugs():
    return {c["slug"] for c in requests.get(f"{BASE_URL}/api/categories", timeout=20).json()}


def _admin_row(admin, slug):
    rows = requests.get(
        f"{BASE_URL}/api/admin/categories", headers=admin["H"], timeout=20
    ).json()
    return next((c for c in rows if c["slug"] == slug), None)


def _set(admin, slug, active):
    return requests.patch(
        f"{BASE_URL}/api/admin/categories/{slug}",
        headers=admin["H"], json={"is_active": active}, timeout=20,
    )


@pytest.fixture
def builtin_restored(admin):
    """Leave the built-in enabled however the test ends.

    It is shared state that every other test's category list reads, so a test
    that disabled it and then failed would take the rest of the suite with it.
    """
    yield BUILTIN
    _set(admin, BUILTIN, True)
    _run(_delete("categories_cms", {"slug": BUILTIN}))


@pytest.fixture
def custom(admin):
    slug = f"ttest-{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{BASE_URL}/api/admin/categories",
        headers=admin["H"],
        json={"slug": slug, "name": "Toggle test", "icon": "flask-outline"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    yield slug
    _run(_delete("categories_cms", {"slug": slug}))


class TestBuiltIn:
    """The case that was impossible before."""

    def test_starts_live(self, admin, builtin_restored):
        row = _admin_row(admin, builtin_restored)
        assert row is not None
        assert row["is_active"] is True
        assert BUILTIN in _public_slugs()

    def test_can_be_disabled(self, admin, builtin_restored):
        assert _set(admin, builtin_restored, False).status_code == 200
        assert builtin_restored not in _public_slugs()

    def test_disabling_leaves_its_places_alone(self, admin, builtin_restored):
        """The whole point of a toggle over a delete.

        A place keeps its tag and its listing; only the filter goes away. If
        this ever fails, disabling has become a destructive act.

        Asserts on a place this test creates rather than comparing the whole
        category before and after: other tests add and remove cafes
        concurrently, so a set comparison changed for reasons that had nothing
        to do with disabling.
        """
        r = requests.post(
            f"{BASE_URL}/api/admin/businesses",
            headers=admin["H"],
            json={
                "name": f"TEST category toggle {uuid.uuid4().hex[:6]}",
                "category": builtin_restored, "city": "goa",
                "address": "Toggle Street",
            },
            timeout=20,
        )
        assert r.status_code == 201, r.text
        mine = r.json()

        try:
            _set(admin, builtin_restored, False)

            rows = requests.get(
                f"{BASE_URL}/api/businesses",
                params={"category": builtin_restored, "limit": 100}, timeout=20,
            ).json()
            got = next(
                (b for b in rows if b["business_id"] == mine["business_id"]), None
            )
            assert got is not None, "the place vanished when its category was disabled"
            assert got["category"] == builtin_restored, "the place lost its tag"

            page = requests.get(f"{BASE_URL}/place/{mine['slug']}", timeout=20)
            assert page.status_code == 200, "its public page broke"
        finally:
            _run(_delete("businesses", {"business_id": mine["business_id"]}))

    def test_stays_visible_in_the_console(self, admin, builtin_restored):
        """Hidden from the app, not from the admin — otherwise it could never
        be turned back on."""
        _set(admin, builtin_restored, False)
        row = _admin_row(admin, builtin_restored)
        assert row is not None and row["is_active"] is False

    def test_re_enabling_removes_the_override(self, admin, builtin_restored):
        """Rather than leaving a redundant copy of the built-in behind to
        drift from the definition in code."""
        _set(admin, builtin_restored, False)
        r = _set(admin, builtin_restored, True)
        assert r.status_code == 200, r.text
        assert r.json().get("source") == "default"
        assert builtin_restored in _public_slugs()

    def test_a_customised_builtin_keeps_its_customisation(self, admin, builtin_restored):
        """An override that also renamed the category is a real edit, so
        re-enabling must not throw it away along with the flag."""
        _run(_delete("categories_cms", {"slug": builtin_restored}))
        _set(admin, builtin_restored, False)
        # rename it while disabled
        _run(_update("categories_cms", {"slug": builtin_restored},
                     {"name": "Coffee Houses"}))
        _set(admin, builtin_restored, True)
        row = _admin_row(admin, builtin_restored)
        assert row["name"] == "Coffee Houses", "the rename was discarded"
        assert row["is_active"] is True


class TestCustom:
    def test_disables_and_re_enables(self, admin, custom):
        assert custom in _public_slugs()
        assert _set(admin, custom, False).status_code == 200
        assert custom not in _public_slugs()
        assert _set(admin, custom, True).status_code == 200
        assert custom in _public_slugs()


class TestConsoleContext:
    def test_the_list_reports_how_many_places_each_one_holds(self, admin):
        """An admin should not have to guess what disabling costs."""
        row = _admin_row(admin, BUILTIN)
        assert "business_count" in row
        assert isinstance(row["business_count"], int)
        assert row["business_count"] > 0, "cafes should have seeded places"


class TestGuards:
    def test_unknown_slug_is_404(self, admin):
        assert _set(admin, "definitely-not-a-category", False).status_code == 404

    def test_non_admin_is_403(self):
        email = f"TEST_catplain_{WORKER}_{uuid.uuid4().hex[:6]}@explore91.dev"

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
            r = requests.patch(
                f"{BASE_URL}/api/admin/categories/{BUILTIN}",
                headers={"Authorization": f"Bearer {token}"},
                json={"is_active": False}, timeout=20,
            )
            assert r.status_code == 403, r.text
        finally:
            async def _clean():
                db = _mongo()
                await db.user_sessions.delete_many({"user_id": uid})
                await db.users.delete_many({"user_id": uid})

            _run(_clean())

    def test_anonymous_is_401(self):
        r = requests.patch(
            f"{BASE_URL}/api/admin/categories/{BUILTIN}",
            json={"is_active": False}, timeout=20,
        )
        assert r.status_code == 401
