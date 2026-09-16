"""Cities, categories, businesses & banners (public reads)."""
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from core.db import db
from seed.data import CATEGORIES, CITIES

router = APIRouter()


@router.get("/cities")
async def get_cities():
    custom = await db.cities_cms.find({}, {"_id": 0}).to_list(200)
    known = {c["slug"] for c in custom}
    return [c for c in CITIES if c["slug"] not in known] + custom


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


@router.get("/banners")
async def list_banners(city: Optional[str] = None, position: Optional[str] = None):
    q: dict = {"is_active": True}
    if position:
        q["position"] = position
    if city:
        q["$or"] = [{"city": None}, {"city": city.lower()}]
    return await db.banners.find(q, {"_id": 0}).sort("sort_order", 1).to_list(50)
