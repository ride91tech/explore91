"""Reviews, likes and saves keep their counts honest.

Before this, POST /reviews never touched a place's rating or review_count,
so a place showed its seeded "4.8 from 342 reviews" forever (with none of
those reviews stored) and an owner's new place stayed at 0.0 however it was
reviewed. One person could post any number of reviews of a place, and a
review for a place that does not exist was accepted. A double-tap on a reel
like returned a 500, and a double-tap on save lost the second toggle.
"""
import asyncio
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))

BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _seed_user(tag: str):
    db = _mongo()
    uid = f"user_TESTri_{uuid.uuid4().hex[:8]}"
    token = f"tok_TESTri_{uuid.uuid4().hex}"
    await db.users.insert_one({
        "user_id": uid, "email": f"TESTri_{tag}_{uuid.uuid4().hex[:6]}@explore91.test",
        "name": f"Reviewer {tag}", "roles": ["customer"], "wallet_points": 0,
        "created_at": datetime.now(timezone.utc),
    })
    await db.user_sessions.insert_one({
        "user_id": uid, "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return uid, {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def users():
    made = [_run(_seed_user(t)) for t in ("a", "b")]
    yield made
    async def _clean():
        db = _mongo()
        ids = [u for u, _ in made]
        await db.users.delete_many({"user_id": {"$in": ids}})
        await db.user_sessions.delete_many({"user_id": {"$in": ids}})
        await db.reviews.delete_many({"user_id": {"$in": ids}})
        await db.saved.delete_many({"user_id": {"$in": ids}})
        await db.reel_likes.delete_many({"user_id": {"$in": ids}})
    _run(_clean())


@pytest.fixture
def place():
    """A throwaway place whose rating nothing else touches."""
    bid = f"biz_TESTri_{uuid.uuid4().hex[:8]}"
    async def _mk():
        await _mongo().businesses.insert_one({
            "business_id": bid, "name": "TESTri Place", "category": "cafes", "city": "goa",
            "address": "Test lane", "lat": 15.5, "lng": 73.8, "cover_image": "https://example.com/x.jpg",
            "rating": 4.8, "review_count": 342, "is_approved": True,
        })
    _run(_mk())
    yield bid
    async def _rm():
        db = _mongo()
        await db.businesses.delete_one({"business_id": bid})
        await db.reviews.delete_many({"business_id": bid})
    _run(_rm())


def _review(headers, bid, rating, comment="TESTri review"):
    return requests.post(f"{BASE_URL}/api/reviews", headers=headers, timeout=15,
                         json={"business_id": bid, "rating": rating, "comment": comment})


def _place(bid):
    return requests.get(f"{BASE_URL}/api/businesses/{bid}", timeout=15).json()


class TestReviews:
    def test_review_for_a_missing_place_is_refused(self, users):
        r = _review(users[0][1], "biz_TESTri_doesnotexist", 5)
        assert r.status_code == 404, r.text

    def test_rating_comes_from_real_reviews(self, users, place):
        assert _review(users[0][1], place, 5).status_code == 200
        p = _place(place)
        assert (p["rating"], p["review_count"]) == (5.0, 1), p

        assert _review(users[1][1], place, 2).status_code == 200
        p = _place(place)
        assert (p["rating"], p["review_count"]) == (3.5, 2), p

    def test_a_second_review_replaces_the_first(self, users, place):
        uid, h = users[0]
        first = _review(h, place, 5, "TESTri first visit").json()
        second = _review(h, place, 1, "TESTri second visit").json()
        assert second["review_id"] == first["review_id"]

        mine = [r for r in requests.get(f"{BASE_URL}/api/businesses/{place}/reviews", timeout=15).json()
                if r["user_id"] == uid]
        assert len(mine) == 1, mine
        assert (mine[0]["rating"], mine[0]["comment"]) == (1, "TESTri second visit")
        p = _place(place)
        assert (p["rating"], p["review_count"]) == (1.0, 1), p

    def test_startup_reconcile_fixes_existing_data(self, users, place):
        """Seeded numbers and old repeat reviews are corrected at boot."""
        from core.reviews import reconcile_reviews

        uid = users[1][0]
        async def _setup():
            db = _mongo()
            # Repeat reviews written before the unique index existed. The index
            # now refuses them, so drop it the way an old database lacks it.
            await db.reviews.drop_index("business_user_unique") if "business_user_unique" in (
                await db.reviews.index_information()) else None
            now = datetime.now(timezone.utc)
            await db.reviews.insert_many([
                {"review_id": f"rv_TESTri_{i}_{uuid.uuid4().hex[:6]}", "user_id": uid, "user_name": "x",
                 "business_id": place, "rating": r, "comment": "TESTri old", "created_at": now - timedelta(days=d)}
                for i, (r, d) in enumerate([(1, 3), (2, 2), (4, 1)])
            ])
            await reconcile_reviews(db)
            left = await db.reviews.find({"business_id": place}, {"_id": 0}).to_list(10)
            biz = await db.businesses.find_one({"business_id": place}, {"_id": 0})
            idx = await db.reviews.index_information()
            return left, biz, idx
        left, biz, idx = _run(_setup())
        assert [r["rating"] for r in left] == [4], "only the newest review per person should remain"
        assert (biz["rating"], biz["review_count"]) == (4.0, 1), biz
        assert idx["business_user_unique"]["unique"] is True


def test_owner_average_ignores_places_with_no_reviews():
    """A 5.0 place and an unreviewed one average to 5.0, not 2.5."""
    from routes.portal import _review_weighted_rating

    assert _review_weighted_rating([]) == 0.0
    assert _review_weighted_rating([{"rating": 0.0, "review_count": 0}]) == 0.0
    assert _review_weighted_rating([{"rating": 5.0, "review_count": 2},
                                    {"rating": 0.0, "review_count": 0}]) == 5.0
    # weighted by review count: 3 reviews at 4.0 and 1 at 2.0
    assert _review_weighted_rating([{"rating": 4.0, "review_count": 3},
                                    {"rating": 2.0, "review_count": 1}]) == 3.5


def _together(fn):
    """Run fn twice at the same moment, like a double-tap."""
    out = [None, None]
    def go(i): out[i] = fn()
    ts = [threading.Thread(target=go, args=(i,)) for i in (0, 1)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return out


@pytest.fixture
def reel():
    """A throwaway reel: other modules delete reels, so do not borrow one."""
    rid = f"rl_TESTri_{uuid.uuid4().hex[:8]}"
    async def _mk():
        await _mongo().reels.insert_one({
            "reel_id": rid, "business_id": "biz_TESTri", "business_name": "TESTri", "city": "goa",
            "business_category": "cafes", "video_url": "https://example.com/v.mp4",
            "cover_image": "https://example.com/c.jpg", "caption": "TESTri", "author": "TESTri",
            "likes": 0, "views": 0, "created_at": datetime.now(timezone.utc),
        })
    _run(_mk())
    yield rid
    async def _rm():
        db = _mongo()
        await db.reels.delete_one({"reel_id": rid})
        await db.reel_likes.delete_many({"reel_id": rid})
    _run(_rm())


class TestDoubleTaps:
    def test_double_tap_like_toggles_twice_without_errors(self, users, reel):
        uid, h = users[0]
        # Read the count from the database: GET /reels/{id} hides reels whose
        # place is not listed, and this throwaway reel has no real place.
        likes = lambda: _run(_mongo().reels.find_one({"reel_id": reel}))["likes"]
        liked = lambda: reel in requests.get(f"{BASE_URL}/api/reels/my/likes", headers=h, timeout=15).json()
        before = likes()
        for _ in range(5):  # a race is timing-dependent, so tap several times
            rs = _together(lambda: requests.post(f"{BASE_URL}/api/reels/like", headers=h, timeout=15,
                                                 json={"reel_id": reel}))
            assert [r.status_code for r in rs] == [200, 200], [r.text for r in rs]
            assert not liked(), "two taps should leave the reel unliked"
            assert likes() == before, "the like count drifted"

    def test_double_tap_save_toggles_twice(self, users):
        uid, h = users[1]
        bid = requests.get(f"{BASE_URL}/api/businesses", params={"limit": 1}, timeout=15).json()[0]["business_id"]
        saved = lambda: any(b["business_id"] == bid for b in
                            requests.get(f"{BASE_URL}/api/saved", headers=h, timeout=15).json())
        for _ in range(5):
            rs = _together(lambda: requests.post(f"{BASE_URL}/api/saved/toggle", headers=h, timeout=15,
                                                 json={"business_id": bid}))
            assert [r.status_code for r in rs] == [200, 200], [r.text for r in rs]
            assert sorted(r.json()["saved"] for r in rs) == [False, True]
            assert not saved(), "two taps should leave the place unsaved"
