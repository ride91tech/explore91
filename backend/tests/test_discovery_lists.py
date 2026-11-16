"""The lists people discover places through mean what they say.

- "While you're here" (/businesses/{id}/nearby) picked the highest-rated
  places anywhere in the city, not the nearest: for Casa Sarita it offered
  places 4.8, 7.6 and 3.5 km away while two were next door.
- "Trending in the city" sorted by rating. Ratings come from real reviews
  now and most places have none, so in Pune a dentist and a university were
  "trending". It now ranks what people engaged with in the last 30 days.
- A delisted place (is_approved False) stayed in Saved and the bucket list
  and could still be booked, reviewed and flagged.

Each test builds places in a city of its own, so nothing else running in
the suite changes the order it expects.
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from booking_dates import future_date

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _db():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _place(city, key, category, lat, lng, **extra):
    return {
        "business_id": f"biz_TESTdl_{key}_{uuid.uuid4().hex[:6]}", "name": f"TESTdl {key}",
        "category": category, "city": city, "address": "x", "lat": lat, "lng": lng,
        "cover_image": "", "rating": 0.0, "review_count": 0, "is_featured": False,
        "is_approved": True, **extra,
    }


@pytest.fixture
def city():
    """A city of its own; everything in it is removed afterwards."""
    slug = f"testdl{uuid.uuid4().hex[:8]}"
    yield slug

    async def _clean():
        db = _db()
        ids = [b["business_id"] async for b in db.businesses.find({"city": slug}, {"business_id": 1})]
        await db.businesses.delete_many({"city": slug})
        await db.place_interest.delete_many({"business_id": {"$in": ids}})
        await db.reviews.delete_many({"business_id": {"$in": ids}})
        await db.bookings.delete_many({"business_id": {"$in": ids}})
        reels = [r["reel_id"] async for r in db.reels.find({"business_id": {"$in": ids}}, {"reel_id": 1})]
        await db.reels.delete_many({"reel_id": {"$in": reels}})
        await db.reel_likes.delete_many({"reel_id": {"$in": reels}})
    _run(_clean())


@pytest.fixture
def user():
    uid, token = f"user_TESTdl_{uuid.uuid4().hex[:8]}", f"tok_TESTdl_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)

    async def _mk():
        db = _db()
        await db.users.insert_one({"user_id": uid, "email": f"{uid}@explore91.test", "name": "TESTdl",
                                   "roles": ["customer"], "wallet_points": 0, "created_at": now})
        await db.user_sessions.insert_one({"user_id": uid, "session_token": token,
                                           "expires_at": now + timedelta(days=1), "created_at": now})
    _run(_mk())
    yield uid, {"Authorization": f"Bearer {token}"}

    async def _rm():
        db = _db()
        await db.users.delete_one({"user_id": uid})
        await db.user_sessions.delete_many({"user_id": uid})
        await db.saved.delete_many({"user_id": uid})
        await db.place_interest.delete_many({"user_id": uid})
    _run(_rm())


def _insert(*docs):
    _run(_db().businesses.insert_many([dict(d) for d in docs]))


class TestNearby:
    def test_nearest_places_come_first_not_the_best_rated(self, city):
        origin = _place(city, "origin", "cafes", 15.500, 73.800)
        near_other = _place(city, "near_bar", "bars", 15.505, 73.800)          # ~0.6 km
        far_rated = _place(city, "far_spa", "spas", 15.700, 73.800,            # ~22 km
                           rating=5.0, review_count=9, is_featured=True)
        near_same = _place(city, "near_cafe", "cafes", 15.503, 73.800)         # ~0.3 km
        _insert(origin, near_other, far_rated, near_same)

        one = requests.get(f"{BASE_URL}/api/businesses/{origin['business_id']}/nearby",
                           params={"limit": 1}, timeout=15).json()
        assert [b["business_id"] for b in one] == [near_other["business_id"]]

        # Other categories first, nearest first; the same category fills in.
        three = requests.get(f"{BASE_URL}/api/businesses/{origin['business_id']}/nearby",
                             params={"limit": 3}, timeout=15).json()
        assert [b["business_id"] for b in three] == [
            near_other["business_id"], far_rated["business_id"], near_same["business_id"]]


class TestTrending:
    def test_recent_engagement_beats_rating_and_old_activity(self, city):
        now = datetime.now(timezone.utc)
        hot = _place(city, "hot", "bars", 15.5, 73.8)                            # 3 recent flags
        liked = _place(city, "liked", "clubs", 15.5, 73.8)                       # 2 recent reel likes
        featured = _place(city, "featured", "spas", 15.5, 73.8, is_featured=True, rating=5.0, review_count=4)
        rated = _place(city, "rated", "cafes", 15.5, 73.8, rating=4.0, review_count=2)
        stale = _place(city, "stale", "gyms", 15.5, 73.8)                        # 5 flags, 60 days ago
        _insert(hot, liked, featured, rated, stale)
        reel = f"rl_TESTdl_{uuid.uuid4().hex[:8]}"

        async def _engage():
            db = _db()
            await db.place_interest.insert_many(
                [{"user_id": f"u{i}", "business_id": hot["business_id"], "status": "interested",
                  "city": city, "created_at": now, "updated_at": now} for i in range(3)]
                + [{"user_id": f"u{i}", "business_id": stale["business_id"], "status": "going",
                    "city": city, "created_at": now - timedelta(days=60),
                    "updated_at": now - timedelta(days=60)} for i in range(5)])
            await db.reels.insert_one({"reel_id": reel, "business_id": liked["business_id"], "city": city,
                                       "likes": 2, "views": 0, "created_at": now})
            await db.reel_likes.insert_many([{"reel_id": reel, "user_id": f"u{i}", "created_at": now}
                                             for i in range(2)])
        _run(_engage())

        r = requests.get(f"{BASE_URL}/api/businesses/trending", params={"city": city, "limit": 5}, timeout=15)
        got = [(b["name"].split()[-1], b["trend_score"]) for b in r.json()]
        # Only places with recent engagement, most first. Being featured or
        # well rated isn't trending, and activity from 60 days ago doesn't count.
        assert got == [("hot", 3), ("liked", 2)], got

    def test_a_quiet_city_has_nothing_trending(self, city):
        _insert(_place(city, "quiet", "cafes", 15.5, 73.8, is_featured=True, rating=4.5, review_count=3))
        r = requests.get(f"{BASE_URL}/api/businesses/trending", params={"city": city}, timeout=15)
        assert r.status_code == 200 and r.json() == [], r.text


class TestDelistedPlaces:
    def test_saved_and_bucket_list_drop_delisted_places(self, city, user):
        uid, h = user
        listed = _place(city, "listed", "cafes", 15.5, 73.8)
        delisted = _place(city, "delisted", "bars", 15.5, 73.8, is_approved=False)
        _insert(listed, delisted)
        now = datetime.now(timezone.utc)

        async def _flag():
            db = _db()
            await db.saved.update_one({"user_id": uid}, {"$set": {
                "business_ids": [listed["business_id"], delisted["business_id"]]}}, upsert=True)
            await db.place_interest.insert_many([
                {"user_id": uid, "business_id": b["business_id"], "status": "interested", "city": city,
                 "created_at": now, "updated_at": now} for b in (listed, delisted)])
        _run(_flag())

        saved = {b["business_id"] for b in requests.get(f"{BASE_URL}/api/saved", headers=h, timeout=15).json()}
        assert saved == {listed["business_id"]}
        bucket = {b["business_id"] for b in requests.get(
            f"{BASE_URL}/api/places/interest", headers=h, timeout=15).json()}
        assert bucket == {listed["business_id"]}

    def test_delisted_places_cannot_be_booked_reviewed_or_flagged(self, city, user):
        _, h = user
        delisted = _place(city, "gone", "bars", 15.5, 73.8, is_approved=False)
        _insert(delisted)
        bid = delisted["business_id"]

        book = requests.post(f"{BASE_URL}/api/bookings", headers=h, timeout=15, json={
            "business_id": bid, "date": future_date(3), "time": "19:30", "guests": 2})
        assert book.status_code == 404, book.text
        review = requests.post(f"{BASE_URL}/api/reviews", headers=h, timeout=15, json={
            "business_id": bid, "rating": 5, "comment": "TESTdl"})
        assert review.status_code == 404, review.text
        flag = requests.put(f"{BASE_URL}/api/places/{bid}/interest", headers=h, timeout=15,
                            json={"status": "going"})
        assert flag.status_code == 404, flag.text
