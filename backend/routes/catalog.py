"""Cities, categories, businesses & banners (public reads)."""
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from core.db import db
from seed.data import CATEGORIES, CITIES, CITY_COORDS

router = APIRouter()


def _distance_km(a: dict, b: dict) -> float:
    """Great-circle distance between two places; places without coordinates
    sort last rather than failing."""
    try:
        lat1, lng1, lat2, lng2 = (math.radians(float(v)) for v in (a["lat"], a["lng"], b["lat"], b["lng"]))
    except (KeyError, TypeError, ValueError):
        return math.inf
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * 6371 * math.asin(math.sqrt(h))


def _with_region(city: dict) -> dict:
    """Cities added before the geography fields existed have neither.

    Also attaches the city's centre (lat, lng) when known, so the app can
    choose the city nearest the device. A CMS city with no coordinates of
    its own and no seed entry gets none, and the app skips it.
    """
    state = city.get("state") or ""
    out = {**city, "state": state, "region": city.get("region") or state}
    if out.get("lat") is None or out.get("lng") is None:
        coords = CITY_COORDS.get(city.get("slug", ""))
        if coords:
            out["lat"], out["lng"] = float(coords[0]), float(coords[1])
    return out


async def content_counts() -> dict:
    """Published content per city slug: {slug: {"business_count", "reel_count"}}.

    Two grouped aggregations rather than a count per city, so the cost doesn't
    grow as cities are added.
    """
    counts: dict = {}

    def bump(slug, key, n):
        if not slug:
            return
        counts.setdefault(slug, {"business_count": 0, "reel_count": 0})[key] = int(n)

    async for row in db.businesses.aggregate(
        [
            {"$match": {"is_approved": {"$ne": False}}},
            {"$group": {"_id": "$city", "n": {"$sum": 1}}},
        ]
    ):
        bump(row["_id"], "business_count", row["n"])

    async for row in db.reels.aggregate(
        [{"$group": {"_id": "$city", "n": {"$sum": 1}}}]
    ):
        bump(row["_id"], "reel_count", row["n"])

    return counts


def with_content(city: dict, counts: dict) -> dict:
    """Annotate a city with how much there is to see in it.

    The home screen is built entirely from businesses, so a city without any
    has nothing to render. Flagging it here lets the picker offer it as
    "coming soon" instead of dropping the user into empty carousels.
    """
    row = counts.get(city["slug"]) or {}
    businesses = int(row.get("business_count", 0))
    return {
        **city,
        "business_count": businesses,
        "reel_count": int(row.get("reel_count", 0)),
        "is_live": businesses > 0,
    }


@router.get("/cities")
async def get_cities():
    custom = await db.cities_cms.find({}, {"_id": 0}).to_list(200)
    known = {c["slug"] for c in custom}
    merged = [c for c in CITIES if c["slug"] not in known] + custom
    return [_with_region(c) for c in merged]


@router.get("/cities/grouped")
async def get_cities_grouped():
    """Cities bucketed by region, for the city picker.

    Regions are ordered by how many cities they hold, then alphabetically, so
    the picker stays stable as cities are added.

    Every city carries `business_count`, `reel_count` and `is_live`. Cities
    with no content stay in their region bucket rather than being hidden, so
    the client can show them as "coming soon" and keep one source of truth for
    which cities exist.
    """
    cities = await get_cities()
    counts = await content_counts()
    buckets: dict = {}
    for c in cities:
        buckets.setdefault(c["region"] or "Other", []).append(
            with_content(c, counts)
        )
    return [
        {"region": region, "cities": sorted(items, key=lambda c: c["name"])}
        for region, items in sorted(
            buckets.items(), key=lambda kv: (-len(kv[1]), kv[0])
        )
    ]


@router.get("/categories")
async def get_categories():
    """Categories the app should offer as filters.

    categories_cms is an override layer: a row with the same slug as a
    built-in replaces it. That is what lets a built-in be disabled at all —
    the twenty-four in code cannot be edited, so disabling one writes an
    override carrying is_active=False.

    Disabled categories are withheld here but the places tagged with them are
    untouched: they stop being reachable by that filter and still appear
    under "All". Disabling is about the taxonomy, not the content.
    """
    custom = await db.categories_cms.find({}, {"_id": 0}).to_list(200)
    known = {c["slug"] for c in custom}
    merged = [c for c in CATEGORIES if c["slug"] not in known] + custom
    # Absent is_active means active — built-ins carry no flag at all.
    return [c for c in merged if c.get("is_active", True)]


@router.get("/businesses")
async def list_businesses(
    city: Optional[str] = None,
    category: Optional[str] = None,
    q: Optional[str] = Query(default=None, max_length=60),
    featured: Optional[bool] = None,
    limit: int = Query(default=60, ge=1, le=100),
):
    query: dict = {"is_approved": {"$ne": False}}
    if city:
        query["city"] = city.lower()
    if category:
        query["category"] = category.lower()
    if featured is not None:
        query["is_featured"] = featured
    if q:
        query["$and"] = _search_words(q)
    docs = await db.businesses.find(query, {"_id": 0}).limit(limit).to_list(limit)
    return docs


# Where a word in the search box can match. This was name, tags and
# description only, as one exact phrase, so in Goa "restaurant" found none of
# its restaurants, "Panjim" missed Casa Sarita ("Fontainhas, Panjim") and
# "sarita casa" found nothing.
SEARCH_FIELDS = ("name", "tags", "description", "category", "address", "area")


def _search_words(q: str) -> list:
    """Each word must appear in some field; words may come in any order.

    Words are regex-escaped, so input cannot build a pathological pattern
    (ReDoS), and capped at six so a pasted paragraph stays cheap.
    """
    words = q.split()[:6]
    return [
        {"$or": [{f: {"$regex": re.escape(w), "$options": "i"}} for f in SEARCH_FIELDS]}
        for w in words
    ] or [{}]


@router.get("/businesses/slug/{slug}")
async def get_business_by_slug(slug: str):
    """A listed place by its public slug, for shared links opened in the app.

    explore91.com/place/<slug> opens the app on devices that have it, and the
    app had no way to turn a slug into a place, so every shared link landed
    on "Unmatched Route". Unlisted places are hidden, as on the web page.
    """
    doc = await db.businesses.find_one(
        {"slug": slug, "is_approved": {"$ne": False}}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Business not found")
    return doc


TRENDING_WINDOW_DAYS = 30


async def _recent_engagement(ids: list, since: datetime) -> dict:
    """{business_id: how many things people did with it since `since`}.

    Counts interested/going/visited flags, reviews written or revised,
    bookings that weren't cancelled, and likes on the place's reels. Saves
    are left out: the saved list keeps no dates, so it can't say "recent".
    """
    counts: dict = {}

    def add(rows, key=lambda r: r["_id"]):
        for r in rows:
            counts[key(r)] = counts.get(key(r), 0) + r["n"]

    per_place = {"$group": {"_id": "$business_id", "n": {"$sum": 1}}}
    in_ids = {"$in": ids}
    add(await db.place_interest.aggregate([
        {"$match": {"business_id": in_ids, "updated_at": {"$gte": since}}}, per_place,
    ]).to_list(None))
    add(await db.reviews.aggregate([
        {"$match": {"business_id": in_ids, "$or": [{"created_at": {"$gte": since}},
                                                   {"updated_at": {"$gte": since}}]}}, per_place,
    ]).to_list(None))
    add(await db.bookings.aggregate([
        {"$match": {"business_id": in_ids, "created_at": {"$gte": since}, "status": {"$ne": "cancelled"}}},
        per_place,
    ]).to_list(None))
    reels = await db.reels.find({"business_id": in_ids}, {"_id": 0, "reel_id": 1, "business_id": 1}).to_list(5000)
    if reels:
        place_of = {r["reel_id"]: r["business_id"] for r in reels}
        add(await db.reel_likes.aggregate([
            {"$match": {"reel_id": {"$in": list(place_of)}, "created_at": {"$gte": since}}},
            {"$group": {"_id": "$reel_id", "n": {"$sum": 1}}},
        ]).to_list(None), key=lambda r: place_of[r["_id"]])
    return counts


@router.get("/businesses/trending")
async def trending(city: Optional[str] = None, limit: int = Query(default=8, ge=1, le=50)):
    """What people in the city are engaging with now.

    This used to be the highest-rated places. Ratings come from real
    reviews now and most places have none, so in Pune a dentist and a
    university were "trending". It now lists only places with engagement
    in the last 30 days (see _recent_engagement), most first, each with its
    `trend_score`. A quiet city gets an empty list and the app hides the
    section: padding it with featured places just repeated the "Featured
    this week" row above it.
    """
    query: dict = {"is_approved": {"$ne": False}}
    if city:
        query["city"] = city.lower()
    places = await db.businesses.find(query, {"_id": 0}).to_list(5000)
    if not places:
        return []
    since = datetime.now(timezone.utc) - timedelta(days=TRENDING_WINDOW_DAYS)
    score = await _recent_engagement([b["business_id"] for b in places], since)
    hot = [{**b, "trend_score": score[b["business_id"]]} for b in places if score.get(b["business_id"])]
    hot.sort(key=lambda b: (
        -b["trend_score"],
        -(b.get("rating") or 0),
        -(b.get("review_count") or 0),
        b.get("name") or "",
    ))
    return hot[:limit]


@router.get("/businesses/{business_id}")
async def get_business(business_id: str):
    doc = await db.businesses.find_one({"business_id": business_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Business not found")
    return doc


@router.get("/businesses/{business_id}/nearby")
async def nearby(business_id: str, limit: int = Query(default=3, ge=1, le=10)):
    """"While you're here" — what else is worth the walk.

    Prefers a different category to the place you're on: three more
    restaurants under a restaurant is a worse suggestion than a beach, a
    heritage quarter and a cafe, which is how the site pitches it. Falls back
    to the same category when the city is too thin to fill the row.
    """
    biz = await db.businesses.find_one(
        {"business_id": business_id}, {"_id": 0, "city": 1, "category": 1, "lat": 1, "lng": 1}
    )
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")

    # Nearest first. This used to sort by rating across the whole city, so
    # "worth the walk" could be the other end of Goa (Casa Sarita was offered
    # places 4.8, 7.6 and 3.5 km away with two next door). A city is at most
    # a few hundred places, so measuring each one here is cheap.
    candidates = await db.businesses.find(
        {"is_approved": {"$ne": False}, "city": biz.get("city"), "business_id": {"$ne": business_id}},
        {"_id": 0},
    ).to_list(1000)

    def away(b: dict) -> float:
        return _distance_km(biz, b)

    others = sorted((b for b in candidates if b.get("category") != biz.get("category")), key=away)
    same = sorted((b for b in candidates if b.get("category") == biz.get("category")), key=away)
    return (others + same)[:limit]


@router.get("/banners")
async def list_banners(city: Optional[str] = None, position: Optional[str] = None):
    q: dict = {"is_active": True}
    if position:
        q["position"] = position
    if city:
        q["$or"] = [{"city": None}, {"city": city.lower()}]
    return await db.banners.find(q, {"_id": 0}).sort("sort_order", 1).to_list(50)
