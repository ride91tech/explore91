"""Interested / Going / Visited — the mechanic explore91.com uses in place of
a booking button, and the thing that fills in the journey map.
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

BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://localhost:8000").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def traveller():
    worker = os.environ.get("PYTEST_XDIST_WORKER", "gw0")
    email = f"TEST_interest_{worker}_{uuid.uuid4().hex[:6]}@explore91.dev"
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    token = f"test_{uuid.uuid4().hex}"

    async def _seed():
        db = _mongo()
        now = datetime.now(timezone.utc)
        await db.users.insert_one({
            "user_id": user_id, "email": email, "name": "Interest Tester",
            "picture": None, "wallet_points": 0, "home_city": "Goa",
            "roles": ["customer"], "created_at": now,
        })
        await db.user_sessions.insert_one({
            "session_token": token, "user_id": user_id,
            "created_at": now, "expires_at": now + timedelta(days=1),
        })
    _run(_seed())

    yield {"user_id": user_id, "H": {"Authorization": f"Bearer {token}",
                                     "Content-Type": "application/json"}}

    async def _clean():
        db = _mongo()
        await db.place_interest.delete_many({"user_id": user_id})
        await db.journey_visits.delete_many({"user_id": user_id})
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.users.delete_many({"email": email})
    _run(_clean())


@pytest.fixture(scope="module")
def goa_place():
    r = requests.get(f"{BASE_URL}/api/businesses",
                     params={"city": "goa", "limit": 1}, timeout=20)
    assert r.status_code == 200, r.text
    docs = r.json()
    assert docs, "need at least one seeded place in Goa"
    return docs[0]["business_id"]


class TestAuth:
    def test_requires_auth(self, goa_place):
        for call in (
            lambda: requests.get(f"{BASE_URL}/api/places/interest", timeout=15),
            lambda: requests.put(f"{BASE_URL}/api/places/{goa_place}/interest",
                                 json={"status": "going"}, timeout=15),
            lambda: requests.delete(f"{BASE_URL}/api/places/{goa_place}/interest",
                                    timeout=15),
        ):
            assert call().status_code == 401


class TestValidation:
    def test_unknown_place_404(self, traveller):
        r = requests.put(f"{BASE_URL}/api/places/does_not_exist_xxx/interest",
                         headers=traveller["H"], json={"status": "going"}, timeout=15)
        assert r.status_code == 404

    def test_bad_status_422(self, traveller, goa_place):
        r = requests.put(f"{BASE_URL}/api/places/{goa_place}/interest",
                         headers=traveller["H"], json={"status": "booked"}, timeout=15)
        assert r.status_code == 422

    def test_bad_filter_422(self, traveller):
        r = requests.get(f"{BASE_URL}/api/places/interest",
                         headers=traveller["H"], params={"status": "nope"}, timeout=15)
        assert r.status_code == 422


class TestInterestFlow:
    def test_set_read_replace_and_clear(self, traveller, goa_place):
        H = traveller["H"]
        url = f"{BASE_URL}/api/places/{goa_place}/interest"

        # nothing flagged yet
        assert requests.get(url, headers=H, timeout=15).json()["status"] is None

        assert requests.put(url, headers=H, json={"status": "interested"},
                            timeout=15).status_code == 200
        assert requests.get(url, headers=H, timeout=15).json()["status"] == "interested"

        # changing your mind replaces rather than accumulates
        assert requests.put(url, headers=H, json={"status": "going"},
                            timeout=15).status_code == 200
        assert requests.get(url, headers=H, timeout=15).json()["status"] == "going"

        rows = requests.get(f"{BASE_URL}/api/places/interest",
                            headers=H, timeout=20).json()
        mine = [r for r in rows if r["business_id"] == goa_place]
        assert len(mine) == 1, "one row per place, not one per change"
        assert mine[0]["interest_status"] == "going"

        assert requests.delete(url, headers=H, timeout=15).status_code == 200
        assert requests.get(url, headers=H, timeout=15).json()["status"] is None
        # clearing twice is a 404, not a silent success
        assert requests.delete(url, headers=H, timeout=15).status_code == 404

    def test_bucket_list_filter(self, traveller, goa_place):
        H = traveller["H"]
        url = f"{BASE_URL}/api/places/{goa_place}/interest"
        requests.put(url, headers=H, json={"status": "interested"}, timeout=15)

        bucket = requests.get(f"{BASE_URL}/api/places/interest", headers=H,
                              params={"status": "interested"}, timeout=20).json()
        assert goa_place in {r["business_id"] for r in bucket}
        assert all(r["interest_status"] == "interested" for r in bucket)

        going = requests.get(f"{BASE_URL}/api/places/interest", headers=H,
                             params={"status": "going"}, timeout=20).json()
        assert goa_place not in {r["business_id"] for r in going}

        # list rows carry the full place, so the Trips tab can render a card
        assert all("name" in r and "cover_image" in r for r in bucket)
        requests.delete(url, headers=H, timeout=15)

    def test_visited_fills_in_the_journey(self, traveller, goa_place):
        """The site says the map fills in on its own — this is that wiring."""
        H = traveller["H"]
        requests.delete(f"{BASE_URL}/api/journey/visit/goa", headers=H, timeout=15)

        before = requests.get(f"{BASE_URL}/api/journey", headers=H, timeout=20).json()
        assert "goa" not in {v["city_slug"] for v in before["visited"]}

        requests.put(f"{BASE_URL}/api/places/{goa_place}/interest",
                     headers=H, json={"status": "visited"}, timeout=15)

        after = requests.get(f"{BASE_URL}/api/journey", headers=H, timeout=20).json()
        assert "goa" in {v["city_slug"] for v in after["visited"]}
        assert after["cities"] == before["cities"] + 1

        # un-flagging the place doesn't erase having been in the city
        requests.delete(f"{BASE_URL}/api/places/{goa_place}/interest",
                        headers=H, timeout=15)
        still = requests.get(f"{BASE_URL}/api/journey", headers=H, timeout=20).json()
        assert "goa" in {v["city_slug"] for v in still["visited"]}


class TestJourneyGeographyMath:
    """28 states, 8 union territories, counted apart."""

    def test_totals_match_the_site(self, traveller):
        j = requests.get(f"{BASE_URL}/api/journey",
                         headers=traveller["H"], timeout=20).json()
        assert j["states_total"] == 28
        assert j["union_territories_total"] == 8

    def test_union_territory_does_not_count_as_a_state(self, traveller):
        """Delhi is a UT. Counting it among the 28 would skew the percentage."""
        H = traveller["H"]
        requests.delete(f"{BASE_URL}/api/journey/visit/goa", headers=H, timeout=15)
        requests.post(f"{BASE_URL}/api/journey/visit", headers=H,
                      json={"city_slug": "delhi"}, timeout=15)

        j = requests.get(f"{BASE_URL}/api/journey", headers=H, timeout=20).json()
        assert j["union_territories"] >= 1
        # a UT-only trip is 0% of the 28 states, and says so rather than rounding up
        assert j["states"] == 0
        assert j["india_percent"] == 0

    def test_one_state_reads_as_three_percent(self, traveller):
        """floor(1/28*100) = 3, which is what explore91.com shows."""
        H = traveller["H"]
        requests.post(f"{BASE_URL}/api/journey/visit", headers=H,
                      json={"city_slug": "goa"}, timeout=15)
        j = requests.get(f"{BASE_URL}/api/journey", headers=H, timeout=20).json()
        assert j["states"] == 1
        assert j["india_percent"] == 3
        requests.delete(f"{BASE_URL}/api/journey/visit/goa", headers=H, timeout=15)
