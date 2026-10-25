"""Public server-rendered pages.

These are the only surface a crawler or a link-preview fetcher can see, since
neither runs JavaScript. The assertions below are deliberately about what is
in the response body, not about what the page would look like after hydration.
"""
import os
import re

import pytest
import requests
from dotenv import load_dotenv

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_DIR = os.path.dirname(_BACKEND_DIR)
load_dotenv(os.path.join(_REPO_DIR, "frontend", ".env"))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))

BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")


def _meta(html: str, prop: str):
    """Read a meta tag's content, by property= or name=."""
    for attr in ("property", "name"):
        m = re.search(
            rf'<meta\s+{attr}="{re.escape(prop)}"\s+content="([^"]*)"', html
        )
        if m:
            return m.group(1)
    return None


def _strip_tags(html: str) -> str:
    body = html.split("<main", 1)[-1]
    return " ".join(re.sub(r"<[^>]+>", " ", body).split())


@pytest.fixture(scope="module")
def a_place():
    r = requests.get(
        f"{BASE_URL}/api/businesses", params={"city": "goa", "limit": 1}, timeout=20
    )
    assert r.status_code == 200, r.text
    docs = r.json()
    assert docs, "need a seeded place in Goa"
    place = docs[0]
    assert place.get("slug"), "places must carry a slug for their public URL"
    return place


class TestSlugs:
    def test_every_approved_place_has_one(self):
        r = requests.get(
            f"{BASE_URL}/api/businesses", params={"city": "goa", "limit": 100}, timeout=30
        )
        assert r.status_code == 200
        missing = [b["name"] for b in r.json() if not b.get("slug")]
        assert not missing, f"places without a slug: {missing[:5]}"

    def test_slugs_are_unique(self):
        slugs = []
        for city in ("goa", "ahmedabad", "pune"):
            r = requests.get(
                f"{BASE_URL}/api/businesses",
                params={"city": city, "limit": 100}, timeout=30,
            )
            slugs += [b["slug"] for b in r.json() if b.get("slug")]
        assert len(slugs) == len(set(slugs)), "slug collision"

    def test_slug_is_readable(self, a_place):
        """A shared link should say what it points at."""
        assert re.fullmatch(r"[a-z0-9-]+", a_place["slug"]), a_place["slug"]
        first_word = a_place["name"].split()[0].lower()
        cleaned = re.sub(r"[^a-z0-9]", "", first_word)
        if cleaned:
            assert cleaned in a_place["slug"].replace("-", "")


class TestPlacePage:
    def test_renders_without_javascript(self, a_place):
        r = requests.get(f"{BASE_URL}/place/{a_place['slug']}", timeout=20)
        assert r.status_code == 200
        assert "text/html" in r.headers["content-type"]
        text = _strip_tags(r.text)
        assert a_place["name"] in text, "the name must be in the HTML body"

    def test_link_preview_metadata(self, a_place):
        r = requests.get(f"{BASE_URL}/place/{a_place['slug']}", timeout=20)
        html = r.text
        assert _meta(html, "og:title")
        assert _meta(html, "og:description")
        assert _meta(html, "og:site_name") == "Explore91"

        # Preview fetchers drop relative URLs, so these must be absolute.
        for prop in ("og:url", "og:image"):
            value = _meta(html, prop)
            if value:
                assert value.startswith("http"), f"{prop} is not absolute: {value}"

        assert f"/place/{a_place['slug']}" in _meta(html, "og:url")

    def test_has_canonical(self, a_place):
        r = requests.get(f"{BASE_URL}/place/{a_place['slug']}", timeout=20)
        m = re.search(r'<link rel="canonical" href="([^"]+)"', r.text)
        assert m, "missing canonical link"
        assert m.group(1).startswith("http")

    def test_links_to_nearby_places(self, a_place):
        r = requests.get(f"{BASE_URL}/place/{a_place['slug']}", timeout=20)
        others = re.findall(r'href="/place/([a-z0-9-]+)"', r.text)
        assert a_place["slug"] not in others, "a place should not link to itself"

    def test_unknown_place_is_404_not_200(self):
        """A soft 404 would get the junk URL indexed."""
        r = requests.get(f"{BASE_URL}/place/definitely-not-a-place", timeout=20)
        assert r.status_code == 404
        assert 'name="robots"' in r.text


class TestCityPage:
    def test_populated_city_lists_places(self):
        r = requests.get(f"{BASE_URL}/city/goa", timeout=30)
        assert r.status_code == 200
        assert len(re.findall(r'class="card"', r.text)) > 0
        assert 'name="robots"' not in r.text, "a populated city should be indexable"

    def test_empty_city_is_noindex(self):
        """Eight of eleven cities have no content. Indexing those pages is
        thin content, and it drags down the pages that do have something."""
        r = requests.get(f"{BASE_URL}/city/jaipur", timeout=30)
        assert r.status_code == 200
        assert len(re.findall(r'class="card"', r.text)) == 0
        assert 'content="noindex' in r.text

    def test_unknown_city_is_404(self):
        assert requests.get(f"{BASE_URL}/city/atlantis", timeout=20).status_code == 404


class TestSitemapAndRobots:
    def test_sitemap_is_valid_xml_with_absolute_urls(self):
        r = requests.get(f"{BASE_URL}/sitemap.xml", timeout=30)
        assert r.status_code == 200
        assert "xml" in r.headers["content-type"]
        urls = re.findall(r"<loc>([^<]+)</loc>", r.text)
        assert urls
        assert all(u.startswith("http") for u in urls)

    def test_sitemap_omits_cities_with_no_content(self):
        r = requests.get(f"{BASE_URL}/sitemap.xml", timeout=30)
        listed = {
            u.rsplit("/", 1)[1]
            for u in re.findall(r"<loc>([^<]+)</loc>", r.text)
            if "/city/" in u
        }
        assert "goa" in listed
        for empty in ("jaipur", "udaipur", "leh", "shillong"):
            assert empty not in listed, f"{empty} has no places and should not be listed"

    def test_robots_keeps_crawlers_out_of_the_api(self):
        r = requests.get(f"{BASE_URL}/robots.txt", timeout=20)
        assert r.status_code == 200
        assert "Disallow: /api/" in r.text
        assert "Disallow: /admin" in r.text
        assert "Sitemap:" in r.text

    def test_pages_do_not_shadow_the_api(self):
        """The web router is mounted at the root; /api must still answer."""
        r = requests.get(f"{BASE_URL}/api/", timeout=20)
        assert r.status_code == 200
        assert r.json().get("service") == "Explore91"


class TestDeepLinkAssociation:
    """The files that turn a shared https link into an app launch.

    Both have delivery requirements that are easy to get subtly wrong, and a
    wrong file fails silently — the link just opens a browser tab.
    """

    def test_assetlinks_is_served_as_json(self):
        r = requests.get(f"{BASE_URL}/.well-known/assetlinks.json", timeout=20)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/json")

    def test_assetlinks_has_no_redirect(self):
        """Android's verifier follows no redirects."""
        r = requests.get(
            f"{BASE_URL}/.well-known/assetlinks.json", timeout=20, allow_redirects=False
        )
        assert r.status_code == 200, f"redirected with {r.status_code}"

    def test_assetlinks_shape(self):
        r = requests.get(f"{BASE_URL}/.well-known/assetlinks.json", timeout=20)
        statements = r.json()
        assert isinstance(statements, list)
        if not statements:
            pytest.skip("ANDROID_CERT_FINGERPRINTS not configured")
        target = statements[0]["target"]
        assert statements[0]["relation"] == [
            "delegate_permission/common.handle_all_urls"
        ]
        assert target["namespace"] == "android_app"
        assert target["package_name"]
        prints = target["sha256_cert_fingerprints"]
        assert prints, "no fingerprints — links will not verify"
        for fp in prints:
            # 32 colon-separated hex bytes; a SHA-1 here is the classic error.
            assert len(fp.split(":")) == 32, f"not a SHA-256 fingerprint: {fp}"

    def test_apple_file_has_no_extension(self):
        """iOS fetches exactly this path; .json appended breaks it."""
        r = requests.get(
            f"{BASE_URL}/.well-known/apple-app-site-association", timeout=20
        )
        assert r.status_code in (200, 404)
        if r.status_code == 404:
            pytest.skip("IOS_APP_ID not configured")
        assert r.headers["content-type"].startswith("application/json")
        details = r.json()["applinks"]["details"]
        assert details and details[0]["appIDs"]
        # "<TeamID>.<bundleId>" — a bare bundle id is a common mistake.
        assert "." in details[0]["appIDs"][0]


class TestReelSlugDenormalisation:
    def test_reels_carry_their_places_slug(self):
        """A shared reel links to its place; reels have no page of their own."""
        r = requests.get(
            f"{BASE_URL}/api/reels", params={"city": "goa", "limit": 20}, timeout=30
        )
        assert r.status_code == 200
        reels = [x for x in r.json() if x.get("business_id")]
        if not reels:
            pytest.skip("no reels seeded")
        missing = [x["reel_id"] for x in reels if not x.get("business_slug")]
        assert not missing, f"reels without business_slug: {missing[:5]}"

    def test_that_slug_actually_resolves(self):
        """Sharing a reel of a listed place must land on that place's page.

        Scoped to approved places on purpose. The public feed also carries
        reels of unapproved businesses — see test_unapproved_place_has_no_
        public_page — and those 404 correctly, so asserting on an arbitrary
        reel would be asserting the wrong thing.
        """
        reels = requests.get(
            f"{BASE_URL}/api/reels", params={"city": "goa", "limit": 20}, timeout=30
        ).json()
        listed = {
            b["business_id"]
            for b in requests.get(
                f"{BASE_URL}/api/businesses",
                params={"city": "goa", "limit": 100}, timeout=30,
            ).json()
        }
        shareable = [
            x for x in reels
            if x.get("business_slug") and x.get("business_id") in listed
        ]
        if not shareable:
            pytest.skip("no reels on listed places")
        page = requests.get(
            f"{BASE_URL}/place/{shareable[0]['business_slug']}", timeout=20
        )
        assert page.status_code == 200, "a shared reel would 404"

    def test_every_reel_in_the_feed_points_at_a_listed_place(self):
        """A reel must never outlive the listing it links to.

        This replaces a test that documented the opposite. The feed used to
        filter on is_hidden alone, so a reel of an unapproved place stayed in
        the app while the page it linked to returned 404 — and that test went
        looking for exactly such a reel to assert the 404. The feed now
        excludes them, so there is nothing to find, and the invariant worth
        asserting is the absence.

        The old version also compared two separate reads of shared state and
        raced whenever something unapproved a place between them. This reads
        the feed once and follows each link, so a concurrent change can only
        make it fetch a page that is genuinely reachable.

        The reverse direction — unapproving a place pulls its reels — is
        covered with owned data in test_admin_content.
        """
        reels = requests.get(
            f"{BASE_URL}/api/reels", params={"city": "goa", "limit": 20}, timeout=30
        ).json()
        linked = [x for x in reels if x.get("business_slug")]
        if not linked:
            pytest.skip("no reels on listed places right now")

        broken = []
        for reel in linked[:5]:
            page = requests.get(f"{BASE_URL}/place/{reel['business_slug']}", timeout=20)
            if page.status_code != 200:
                broken.append((reel["business_slug"], page.status_code))
        assert not broken, f"reels in the feed link to dead pages: {broken}"
