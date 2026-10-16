"""Explore91 backend end-to-end tests (public + protected)."""
import pytest


# ---- Health ---------------------------------------------------------------
class TestHealth:
    def test_root_ok(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        data = r.json()
        assert data.get("service") == "Explore91"
        assert data.get("status") == "ok"


# ---- Cities & Categories --------------------------------------------------
class TestCitiesCategories:
    def test_cities(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/cities")
        assert r.status_code == 200
        cities = r.json()
        slugs = {c["slug"] for c in cities}
        assert {"goa", "ahmedabad", "pune"}.issubset(slugs)

    def test_categories_24(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/categories")
        assert r.status_code == 200
        cats = r.json()
        assert len(cats) == 24
        # spot-check
        slugs = {c["slug"] for c in cats}
        assert {"restaurants", "cafes", "hotels", "spas", "gyms"}.issubset(slugs)


# ---- Businesses (public) --------------------------------------------------
class TestBusinesses:
    def test_list_goa(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/businesses", params={"city": "goa"})
        assert r.status_code == 200
        docs = r.json()
        assert len(docs) >= 20  # ~26 seeded
        assert all(d["city"] == "goa" for d in docs)
        # No _id leak
        assert all("_id" not in d for d in docs)

    def test_filter_category(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/businesses",
            params={"city": "goa", "category": "restaurants"},
        )
        assert r.status_code == 200
        docs = r.json()
        assert len(docs) > 0
        assert all(d["category"] == "restaurants" and d["city"] == "goa" for d in docs)

    def test_search_casa(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/businesses", params={"q": "Casa"})
        assert r.status_code == 200
        docs = r.json()
        names = [d["name"] for d in docs]
        assert any("Casa Sarita" in n for n in names)

    def test_featured_only(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/businesses",
            params={"city": "goa", "featured": "true"},
        )
        assert r.status_code == 200
        docs = r.json()
        assert len(docs) > 0
        assert all(d["is_featured"] is True for d in docs)

    def test_trending_pune(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/businesses/trending", params={"city": "pune"})
        assert r.status_code == 200
        docs = r.json()
        assert len(docs) > 0
        ratings = [d["rating"] for d in docs]
        assert ratings == sorted(ratings, reverse=True)
        assert all(d["city"] == "pune" for d in docs)

    def test_get_by_id(self, api_client, base_url):
        # pick a real id
        r = api_client.get(f"{base_url}/api/businesses", params={"city": "goa", "limit": 1})
        biz = r.json()[0]
        bid = biz["business_id"]
        r2 = api_client.get(f"{base_url}/api/businesses/{bid}")
        assert r2.status_code == 200
        detail = r2.json()
        assert detail["business_id"] == bid
        assert "gallery" in detail
        assert "menu" in detail
        assert "services" in detail
        assert "_id" not in detail

    def test_get_by_invalid_id(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/businesses/does_not_exist_xxx")
        assert r.status_code == 404


class TestNearby:
    """"While you're here" — the cross-sell row on a place page."""

    @pytest.fixture(scope="class")
    def base_place(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/businesses", params={"city": "goa", "limit": 1})
        return r.json()[0]

    def test_returns_other_places_in_the_same_city(self, api_client, base_url, base_place):
        r = api_client.get(f"{base_url}/api/businesses/{base_place['business_id']}/nearby")
        assert r.status_code == 200, r.text
        rows = r.json()
        assert rows
        assert all(b["city"] == base_place["city"] for b in rows)
        assert all(b["business_id"] != base_place["business_id"] for b in rows),             "a place is not nearby itself"
        assert all("_id" not in b for b in rows)

    def test_prefers_a_different_category(self, api_client, base_url, base_place):
        """Three more restaurants under a restaurant is a poor suggestion."""
        r = api_client.get(f"{base_url}/api/businesses/{base_place['business_id']}/nearby")
        rows = r.json()
        # Goa is well stocked, so the row should fill without same-category fallback.
        assert all(b["category"] != base_place["category"] for b in rows)

    def test_respects_limit(self, api_client, base_url, base_place):
        r = api_client.get(
            f"{base_url}/api/businesses/{base_place['business_id']}/nearby",
            params={"limit": 2},
        )
        assert r.status_code == 200
        assert len(r.json()) <= 2

    def test_unknown_place_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/businesses/not_a_real_id/nearby")
        assert r.status_code == 404


# ---- Auth (unauthenticated) -----------------------------------------------
class TestAuthUnauth:
    def test_google_rejects_bogus_token(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/google",
            json={"id_token": "not.a.real.token"},
        )
        # 401 once Google Sign-In is configured, 503 before then — either way a
        # junk token never yields a session.
        assert r.status_code in (401, 503)

    def test_third_party_session_endpoint_is_gone(self, api_client, base_url):
        """Login no longer routes through anyone else's server."""
        r = api_client.post(
            f"{base_url}/api/auth/session",
            json={"session_id": "fake_invalid_session_id_xxx"},
        )
        assert r.status_code == 404

    def test_me_without_token(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_saved_without_token(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/saved")
        assert r.status_code == 401

    def test_bookings_without_token(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/bookings")
        assert r.status_code == 401


# ---- Auth (authenticated with seeded session) -----------------------------
class TestAuthenticated:
    def test_me(self, api_client, base_url, auth_headers, test_session):
        _, _, email = test_session
        r = api_client.get(f"{base_url}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        u = r.json()
        assert u["email"] == email
        assert "_id" not in u

    def test_update_home_city(self, api_client, base_url, auth_headers):
        r = api_client.patch(
            f"{base_url}/api/auth/me",
            headers=auth_headers,
            json={"home_city": "Pune"},
        )
        assert r.status_code == 200
        assert r.json()["home_city"] == "Pune"
        # verify persistence
        r2 = api_client.get(f"{base_url}/api/auth/me", headers=auth_headers)
        assert r2.json()["home_city"] == "Pune"


# ---- Saved ----------------------------------------------------------------
class TestSaved:
    @pytest.fixture(scope="class")
    def biz_id(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/businesses", params={"city": "goa", "limit": 1})
        return r.json()[0]["business_id"]

    def test_toggle_and_list(self, api_client, base_url, auth_headers, biz_id):
        # toggle ON
        r = api_client.post(
            f"{base_url}/api/saved/toggle",
            headers=auth_headers,
            json={"business_id": biz_id},
        )
        assert r.status_code == 200
        assert r.json()["saved"] is True

        r2 = api_client.get(f"{base_url}/api/saved", headers=auth_headers)
        assert r2.status_code == 200
        ids = [b["business_id"] for b in r2.json()]
        assert biz_id in ids

        # toggle OFF (idempotent)
        r3 = api_client.post(
            f"{base_url}/api/saved/toggle",
            headers=auth_headers,
            json={"business_id": biz_id},
        )
        assert r3.status_code == 200
        assert r3.json()["saved"] is False


# ---- Bookings -------------------------------------------------------------
class TestBookings:
    @pytest.fixture(scope="class")
    def biz_id(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/businesses", params={"city": "goa", "limit": 1})
        return r.json()[0]["business_id"]

    def test_create_lists_awards_points_and_cancel(
        self, api_client, base_url, auth_headers, biz_id
    ):
        # get points BEFORE
        me_before = api_client.get(f"{base_url}/api/auth/me", headers=auth_headers).json()
        before_pts = me_before["wallet_points"]

        payload = {
            "business_id": biz_id,
            "date": "2026-02-14",
            "time": "20:00",
            "guests": 2,
            "notes": "TEST_booking",
        }
        r = api_client.post(
            f"{base_url}/api/bookings", headers=auth_headers, json=payload
        )
        assert r.status_code == 200, r.text
        booking = r.json()
        assert booking["status"] == "confirmed"
        assert booking["business_id"] == biz_id
        booking_id = booking["booking_id"]

        # points +50
        me_after = api_client.get(f"{base_url}/api/auth/me", headers=auth_headers).json()
        assert me_after["wallet_points"] == before_pts + 50

        # list
        r2 = api_client.get(f"{base_url}/api/bookings", headers=auth_headers)
        assert r2.status_code == 200
        ids = [b["booking_id"] for b in r2.json()]
        assert booking_id in ids

        # cancel
        r3 = api_client.delete(
            f"{base_url}/api/bookings/{booking_id}", headers=auth_headers
        )
        assert r3.status_code == 200
        # verify status cancelled
        r4 = api_client.get(f"{base_url}/api/bookings", headers=auth_headers)
        target = next(b for b in r4.json() if b["booking_id"] == booking_id)
        assert target["status"] == "cancelled"


# ---- Reviews --------------------------------------------------------------
class TestReviews:
    def test_create_and_list(self, api_client, base_url, auth_headers):
        r = api_client.get(
            f"{base_url}/api/businesses", params={"city": "goa", "limit": 1}
        )
        biz_id = r.json()[0]["business_id"]

        payload = {
            "business_id": biz_id,
            "rating": 5,
            "comment": "TEST_review — excellent experience",
        }
        rc = api_client.post(
            f"{base_url}/api/reviews", headers=auth_headers, json=payload
        )
        assert rc.status_code == 200, rc.text
        rev = rc.json()
        assert rev["rating"] == 5
        assert rev["business_id"] == biz_id
        assert "_id" not in rev

        rl = api_client.get(f"{base_url}/api/businesses/{biz_id}/reviews")
        assert rl.status_code == 200
        comments = [r["comment"] for r in rl.json()]
        assert any("TEST_review" in c for c in comments)
        assert all("_id" not in r for r in rl.json())
