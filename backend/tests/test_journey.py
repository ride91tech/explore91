"""Geography and journey tracking — the model the Explore91 site leads with.

Cities carry a state (counted toward coverage) and a region (how the picker
groups them); the journey endpoints turn visits into cities/states/% of India.
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
    email = f"TEST_journey_{worker}_{uuid.uuid4().hex[:6]}@explore91.dev"
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    token = f"test_{uuid.uuid4().hex}"

    async def _seed():
        db = _mongo()
        now = datetime.now(timezone.utc)
        await db.users.insert_one({
            "user_id": user_id, "email": email, "name": "Journey Tester",
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
        await db.journey_visits.delete_many({"user_id": user_id})
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.users.delete_many({"email": email})
    _run(_clean())


class TestCityGeography:
    def test_every_city_has_a_state(self):
        cities = requests.get(f"{BASE_URL}/api/cities", timeout=15).json()
        missing = [c["name"] for c in cities if not c.get("state")]
        assert not missing, f"cities without a state: {missing}"

    def test_region_defaults_to_state(self):
        cities = requests.get(f"{BASE_URL}/api/cities", timeout=15).json()
        for c in cities:
            assert c.get("region"), f"{c['name']} has no region"

    def test_region_can_differ_from_state(self):
        """Goa is a state but belongs under a broader heading, like the site."""
        cities = {c["slug"]: c for c in
                  requests.get(f"{BASE_URL}/api/cities", timeout=15).json()}
        assert cities["goa"]["state"] == "Goa"
        assert cities["goa"]["region"] == "West Coast"
        assert cities["delhi"]["region"] == "Capital Region"

    def test_grouped_buckets_cities_by_region(self):
        groups = requests.get(f"{BASE_URL}/api/cities/grouped", timeout=15).json()
        assert groups, "expected at least one region"
        by_region = {g["region"]: [c["name"] for c in g["cities"]] for g in groups}
        # Two Rajasthan cities should share one heading rather than appear twice.
        assert sorted(by_region["Rajasthan"]) == ["Jaipur", "Udaipur"]
        # Every city appears exactly once across all groups.
        flat = [n for names in by_region.values() for n in names]
        assert len(flat) == len(set(flat))

    def test_grouped_covers_every_city(self):
        cities = requests.get(f"{BASE_URL}/api/cities", timeout=15).json()
        groups = requests.get(f"{BASE_URL}/api/cities/grouped", timeout=15).json()
        grouped = {c["slug"] for g in groups for c in g["cities"]}
        assert grouped == {c["slug"] for c in cities}


class TestJourney:
    def test_requires_auth(self):
        assert requests.get(f"{BASE_URL}/api/journey", timeout=15).status_code == 401

    def test_starts_empty(self, traveller):
        j = requests.get(f"{BASE_URL}/api/journey", headers=traveller["H"], timeout=15).json()
        assert j == {**j, "cities": 0, "states": 0, "india_percent": 0}

    def test_marking_a_city_counts_city_and_state(self, traveller):
        j = requests.post(f"{BASE_URL}/api/journey/visit", headers=traveller["H"],
                          json={"city_slug": "goa"}, timeout=15).json()
        assert j["cities"] == 1
        assert j["states"] == 1
        assert j["india_percent"] > 0

    def test_second_city_same_state_does_not_raise_state_count(self, traveller):
        requests.post(f"{BASE_URL}/api/journey/visit", headers=traveller["H"],
                      json={"city_slug": "jaipur"}, timeout=15)
        before = requests.get(f"{BASE_URL}/api/journey", headers=traveller["H"], timeout=15).json()
        # Udaipur is also Rajasthan — cities go up, states must not.
        after = requests.post(f"{BASE_URL}/api/journey/visit", headers=traveller["H"],
                              json={"city_slug": "udaipur"}, timeout=15).json()
        assert after["cities"] == before["cities"] + 1
        assert after["states"] == before["states"]

    def test_marking_twice_is_idempotent(self, traveller):
        before = requests.get(f"{BASE_URL}/api/journey", headers=traveller["H"], timeout=15).json()
        after = requests.post(f"{BASE_URL}/api/journey/visit", headers=traveller["H"],
                              json={"city_slug": "goa"}, timeout=15).json()
        assert after["cities"] == before["cities"]
        assert after["states"] == before["states"]

    def test_percent_is_share_of_all_states_not_listed_cities(self, traveller):
        """Coverage is measured against the whole country, so it stays honest
        as cities are added."""
        j = requests.get(f"{BASE_URL}/api/journey", headers=traveller["H"], timeout=15).json()
        assert j["states_total"] == 36
        assert j["india_percent"] == round(j["states"] / 36 * 100)

    def test_unknown_city_rejected(self, traveller):
        r = requests.post(f"{BASE_URL}/api/journey/visit", headers=traveller["H"],
                          json={"city_slug": "atlantis"}, timeout=15)
        assert r.status_code == 404

    def test_unmark_removes_it(self, traveller):
        before = requests.get(f"{BASE_URL}/api/journey", headers=traveller["H"], timeout=15).json()
        after = requests.delete(f"{BASE_URL}/api/journey/visit/goa",
                                headers=traveller["H"], timeout=15).json()
        assert after["cities"] == before["cities"] - 1
        assert "goa" not in [v["city_slug"] for v in after["visited"]]

    def test_unmark_city_never_visited_404s(self, traveller):
        r = requests.delete(f"{BASE_URL}/api/journey/visit/leh",
                            headers=traveller["H"], timeout=15)
        assert r.status_code == 404
