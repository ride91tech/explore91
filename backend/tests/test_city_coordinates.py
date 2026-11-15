"""Cities carry coordinates, so the app can pick the one you are in.

The app chooses its city from the device's approximate location: the
nearest live city. That needs each city's centre, which the backend already
knew (seed CITY_COORDS) but never sent.
"""
import os

import requests

BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")


def test_cities_carry_coordinates():
    cities = requests.get(f"{BASE_URL}/api/cities", timeout=15).json()
    goa = next(c for c in cities if c["slug"] == "goa")
    assert (round(goa["lat"], 2), round(goa["lng"], 2)) == (15.30, 74.12), goa
    # Every seeded city has a centre. A city an admin adds in the CMS without
    # coordinates simply has none, and the app leaves it out of "nearest".
    from seed.data import CITY_COORDS
    missing = [c["slug"] for c in cities
               if c["slug"] in CITY_COORDS and not isinstance(c.get("lat"), float)]
    assert not missing, missing


def test_grouped_cities_carry_coordinates_and_liveness():
    groups = requests.get(f"{BASE_URL}/api/cities/grouped", timeout=15).json()
    cities = [c for g in groups for c in g["cities"]]
    pune = next(c for c in cities if c["slug"] == "pune")
    assert (round(pune["lat"], 2), round(pune["lng"], 2)) == (18.52, 73.86), pune
    assert "is_live" in pune
