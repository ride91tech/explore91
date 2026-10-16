"""Cities, categories, businesses & banners (public reads)."""
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from core.db import db
from seed.data import CATEGORIES, CITIES

router = APIRouter()


def _with_region(city: dict) -> dict:
    """Cities added before the geography fields existed have neither."""
    state = city.get("state") or ""
    return {**city, "state": state, "region": city.get("region") or state}


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
    custom = await db.categories_cms.find({}, {"_id": 0}).to_list(200)
    known = {c["slug"] for c in custom}
    return [c for c in CATEGORIES if c["slug"] not in known] + custom


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
        # Escape user input to prevent MongoDB regex DoS (ReDoS)
        safe = re.escape(q.strip())
        query["$or"] = [
            {"name": {"$regex": safe, "$options": "i"}},
            {"tags": {"$regex": safe, "$options": "i"}},
            {"description": {"$regex": safe, "$options": "i"}},
        ]
    docs = await db.businesses.find(query, {"_id": 0}).limit(limit).to_list(limit)
    return docs


@router.get("/businesses/trending")
async def trending(city: Optional[str] = None, limit: int = 8):
    query: dict = {"is_approved": {"$ne": False}}
    if city:
        query["city"] = city.lower()
    docs = (
        await db.businesses.find(query, {"_id": 0})
        .sort("rating", -1).limit(limit).to_list(limit)
    )
    return docs


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
        {"business_id": business_id}, {"_id": 0, "city": 1, "category": 1}
    )
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")

    base = {
        "is_approved": {"$ne": False},
        "city": biz.get("city"),
        "business_id": {"$ne": business_id},
    }
    others = (
        await db.businesses.find(
            {**base, "category": {"$ne": biz.get("category")}}, {"_id": 0}
        ).sort("rating", -1).limit(limit).to_list(limit)
    )
    if len(others) < limit:
        short = limit - len(others)
        others += (
            await db.businesses.find(
                {**base, "category": biz.get("category")}, {"_id": 0}
            ).sort("rating", -1).limit(short).to_list(short)
        )
    return others


@router.get("/banners")
async def list_banners(city: Optional[str] = None, position: Optional[str] = None):
    q: dict = {"is_active": True}
    if position:
        q["position"] = position
    if city:
        q["$or"] = [{"city": None}, {"city": city.lower()}]
    return await db.banners.find(q, {"_id": 0}).sort("sort_order", 1).to_list(50)
