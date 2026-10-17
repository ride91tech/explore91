"""Public, server-rendered pages.

These are the only part of Explore91 a crawler or a link-preview fetcher can
see. Neither runs JavaScript, so the HTML has to carry the content in the
response body — which is why these are rendered here rather than by the Expo
app. They also give a shared link somewhere to land for someone who does not
have the app installed.

Mounted at the root, deliberately outside the /api prefix: these are pages,
not API responses, and their URLs are public and permanent.
"""
import json
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from fastapi.templating import Jinja2Templates

from core.config import (
    ANDROID_CERT_FINGERPRINTS,
    ANDROID_PACKAGE,
    DEEP_LINK_PATHS,
    IOS_APP_ID,
)
from core.db import db
from routes.catalog import get_cities
from seed.data import CATEGORIES

router = APIRouter(include_in_schema=False)

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))

# Absolute URLs are required: link-preview fetchers drop relative og:image and
# og:url values. Set PUBLIC_BASE_URL to the real origin in production.
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")

_CATEGORY_NAMES = {c["slug"]: c["name"] for c in CATEGORIES}

# How many places a city page lists. Enough to be a useful page, bounded so a
# well-stocked city does not render a megabyte of HTML.
CITY_PAGE_LIMIT = 60


def _base_url(request: Request) -> str:
    """The origin to build absolute URLs from.

    Prefers the configured value; falls back to whatever the request arrived
    on, which keeps local development and preview deploys working without
    configuration. Both are trusted here only to build display URLs — nothing
    is authorised from them.
    """
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    return str(request.base_url).rstrip("/")


def _truncate(text: str, limit: int = 200) -> str:
    """Trim to a whole word. Preview cards cut mid-word otherwise."""
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",.;:") + "…"


def _not_found(request: Request, message: str) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "not_found.html",
        {
            "page_title": "Not found · Explore91",
            "description": message,
            "canonical": _base_url(request) + request.url.path,
            "image": None,
            "noindex": True,
            "message": message,
        },
        status_code=404,
    )


async def _city_by_slug(slug: str) -> Optional[dict]:
    for city in await get_cities():
        if city["slug"] == slug:
            return city
    return None


@router.get("/place/{slug}", response_class=HTMLResponse)
async def place_page(slug: str, request: Request):
    place = await db.businesses.find_one(
        {"slug": slug, "is_approved": {"$ne": False}}, {"_id": 0}
    )
    if not place:
        return _not_found(request, "That place isn't listed on Explore91.")

    city = await _city_by_slug(place.get("city", ""))
    city_name = city["name"] if city else (place.get("city") or "").title()

    nearby = (
        await db.businesses.find(
            {
                "is_approved": {"$ne": False},
                "city": place.get("city"),
                "business_id": {"$ne": place["business_id"]},
                "slug": {"$exists": True, "$ne": None},
            },
            {"_id": 0, "slug": 1, "name": 1, "category": 1, "address": 1},
        )
        .sort("rating", -1)
        .limit(3)
        .to_list(3)
    )

    why_go = place.get("why_go") or place.get("description") or ""
    where = place.get("area") or place.get("address") or city_name
    description = _truncate(why_go) or f"{place['name']} in {where}, on Explore91."

    return templates.TemplateResponse(
        request,
        "place.html",
        {
            "page_title": f"{place['name']} · {city_name} · Explore91",
            "og_title": f"{place['name']} — {where}",
            "description": description,
            "canonical": f"{_base_url(request)}/place/{slug}",
            "image": place.get("cover_image"),
            "og_type": "article",
            "place": place,
            "why_go": why_go,
            "city_name": city_name,
            "category_name": _CATEGORY_NAMES.get(place.get("category", "")),
            "nearby": nearby,
        },
    )


@router.get("/city/{slug}", response_class=HTMLResponse)
async def city_page(slug: str, request: Request):
    city = await _city_by_slug(slug)
    if not city:
        return _not_found(request, "We don't cover that city yet.")

    places = (
        await db.businesses.find(
            {
                "city": slug,
                "is_approved": {"$ne": False},
                "slug": {"$exists": True, "$ne": None},
            },
            {"_id": 0, "slug": 1, "name": 1, "category": 1, "address": 1, "rating": 1},
        )
        .sort("rating", -1)
        .limit(CITY_PAGE_LIMIT)
        .to_list(CITY_PAGE_LIMIT)
    )

    return templates.TemplateResponse(
        request,
        "city.html",
        {
            "page_title": f"{city['name']} · Explore91",
            "og_title": f"{city['name']} — {city.get('tagline', '')}".strip(" —"),
            "description": _truncate(
                city.get("tagline") or f"Discover {city['name']} on Explore91."
            ),
            "canonical": f"{_base_url(request)}/city/{slug}",
            "image": city.get("image"),
            "city": city,
            "places": places,
            # A city with nothing in it is a thin page; keep it out of the
            # index until it has content, rather than inviting a penalty.
            "noindex": not places,
        },
    )


@router.get("/sitemap.xml")
async def sitemap(request: Request):
    """Every public URL worth indexing.

    Cities with no places are omitted along with their places — an empty city
    page is thin content, and listing it invites exactly the penalty that
    makes the rest rank worse.
    """
    base = _base_url(request)
    cities = await get_cities()

    urls = [f"{base}/"]
    for city in cities:
        count = await db.businesses.count_documents(
            {"city": city["slug"], "is_approved": {"$ne": False}}
        )
        if not count:
            continue
        urls.append(f"{base}/city/{city['slug']}")

    async for place in db.businesses.find(
        {"is_approved": {"$ne": False}, "slug": {"$exists": True, "$ne": None}},
        {"_id": 0, "slug": 1},
    ):
        urls.append(f"{base}/place/{place['slug']}")

    body = "".join(f"<url><loc>{u}</loc></url>" for u in urls)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"{body}</urlset>"
    )
    return Response(content=xml, media_type="application/xml")


@router.get("/robots.txt", response_class=PlainTextResponse)
async def robots(request: Request):
    # The API and the admin console have no business in a search index.
    return (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n"
        "Disallow: /admin\n"
        "Disallow: /owner\n"
        f"Sitemap: {_base_url(request)}/sitemap.xml\n"
    )


# --- Deep-link association files -----------------------------------------
#
# These two files are what turn a shared https:// link into an app launch.
# Both have strict delivery requirements that are easy to get wrong:
#
#   * served over https, from the apex the link points at
#   * Content-Type: application/json
#   * no redirects — both verifiers follow none
#   * the Apple file has NO .json extension
#
# They are served from the API because that is what already answers on this
# origin. If the public site ever moves behind a CDN, these must move with it.


@router.get("/.well-known/assetlinks.json")
async def android_asset_links():
    """Android App Links: lets Android verify this site vouches for the app.

    Returns an empty list when no fingerprints are configured rather than a
    malformed entry — Android treats a broken file as "not verified", which
    is the same outcome but much harder to diagnose than an obviously empty
    one.
    """
    if not ANDROID_CERT_FINGERPRINTS:
        return Response(content="[]", media_type="application/json")

    statements = [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": ANDROID_PACKAGE,
                "sha256_cert_fingerprints": ANDROID_CERT_FINGERPRINTS,
            },
        }
    ]
    return Response(
        content=json.dumps(statements, indent=2), media_type="application/json"
    )


@router.get("/.well-known/apple-app-site-association")
async def apple_app_site_association():
    """iOS Universal Links.

    404s until IOS_APP_ID is set. That is deliberate: iOS caches this file,
    and serving a placeholder appID would bake a broken association in for
    users who happened to install early.
    """
    if not IOS_APP_ID:
        return Response(
            content=json.dumps({"applinks": {"details": []}}),
            media_type="application/json",
            status_code=404,
        )

    payload = {
        "applinks": {
            "details": [
                {
                    "appIDs": [IOS_APP_ID],
                    "components": [{"/": path} for path in DEEP_LINK_PATHS],
                }
            ]
        }
    }
    return Response(
        content=json.dumps(payload, indent=2), media_type="application/json"
    )
