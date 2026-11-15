"""Search finds places the way people describe them.

/businesses?q= matched only name, tags and description, as one exact phrase.
In Goa, "restaurant" found none of the 3 restaurants, "cafes" none of the 2
cafes, "Panjim" missed Casa Sarita (address "Fontainhas, Panjim") and
"sarita casa" found nothing. Now every word must match one of name, tags,
description, category, address or area, in any order.

Shared links (explore91.com/place/<slug>) opened "Unmatched Route" in the
app, which had no way to turn a slug into a place. /businesses/slug/<slug>
does that, for listed places only, like the public web page.
"""
import os

import requests

BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")


def _search(q, city="goa"):
    r = requests.get(f"{BASE_URL}/api/businesses", params={"city": city, "q": q, "limit": 100}, timeout=15)
    assert r.status_code == 200, r.text
    return {b["business_id"] for b in r.json()}


def _category(cat, city="goa"):
    r = requests.get(f"{BASE_URL}/api/businesses", params={"city": city, "category": cat, "limit": 100}, timeout=15)
    return {b["business_id"] for b in r.json()}


def _casa_sarita():
    r = requests.get(f"{BASE_URL}/api/businesses", params={"city": "goa", "limit": 100}, timeout=15)
    return next(b for b in r.json() if b["name"] == "Casa Sarita")


class TestSearch:
    def test_category_words_find_the_category(self):
        restaurants = _category("restaurants")
        assert restaurants, "seed data should have Goa restaurants"
        assert restaurants <= _search("restaurant")
        assert restaurants <= _search("Restaurants")
        assert _category("cafes") <= _search("cafes")

    def test_address_words_find_the_place(self):
        casa = _casa_sarita()
        assert "Panjim" in casa["address"]
        assert casa["business_id"] in _search("Panjim")

    def test_words_match_in_any_order(self):
        casa = _casa_sarita()["business_id"]
        assert casa in _search("Casa Sarita")
        assert casa in _search("sarita casa")
        assert casa in _search("  casa   sarita ")

    def test_every_word_must_match(self):
        # "casa" alone matches Casa Sarita; adding a word nothing has must not
        # widen the result to anything that merely mentions "casa".
        assert _search("casa zzqxnotaword") == set()

    def test_regex_characters_are_literal(self):
        assert requests.get(f"{BASE_URL}/api/businesses",
                            params={"city": "goa", "q": "casa (["}, timeout=15).status_code == 200


class TestSlugLookup:
    def test_a_listed_place_is_found_by_slug(self):
        casa = _casa_sarita()
        r = requests.get(f"{BASE_URL}/api/businesses/slug/{casa['slug']}", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["business_id"] == casa["business_id"]

    def test_an_unknown_slug_is_404(self):
        r = requests.get(f"{BASE_URL}/api/businesses/slug/no-such-place-anywhere", timeout=15)
        assert r.status_code == 404, r.text
