"""Reels feed, likes, views and owner-authored uploads."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from core.db import db
from core.security import client_key, get_current_user, rate_limit, require_role
from models import Reel, ReelCreate, ReelLikeToggle
from seed.data import CATEGORIES

router = APIRouter()


@router.get("/reels")
async def list_reels(
    city: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(default=30, ge=1, le=100),
):
    query: dict = {"is_hidden": {"$ne": True}}
    if city:
        query["city"] = city.lower()
    if category:
        query["business_category"] = category.lower()
    return (
        await db.reels.find(query, {"_id": 0})
        .sort("created_at", -1).limit(limit).to_list(limit)
    )


# Declared before /reels/{reel_id}: FastAPI matches in order, and the dynamic
# route would otherwise swallow "topics" as a reel id.
@router.get("/reels/topics")
async def reel_topics(city: Optional[str] = None):
    """Topic rails for the reels feed.

    Built from the categories actually present in the city's reels rather
    than a fixed list. explore91.com shows a fixed set of topics, but over
    real data that strands you on rails with nothing behind them — the Goa
    feed has four topics, not fourteen.
    """
    match: dict = {"is_hidden": {"$ne": True}}
    if city:
        match["city"] = city.lower()

    rows = await db.reels.aggregate([
        {"$match": match},
        {"$group": {"_id": "$business_category", "count": {"$sum": 1}}},
    ]).to_list(100)

    names = {c["slug"]: c["name"] for c in CATEGORIES}
    topics = [
        {
            "slug": r["_id"],
            "name": names.get(r["_id"], (r["_id"] or "").replace("-", " ").title()),
            "count": r["count"],
        }
        for r in rows
        if r["_id"]
    ]
    # Busiest first, then alphabetical, so the rail order is stable.
    topics.sort(key=lambda t: (-t["count"], t["name"]))
    return topics


@router.get("/reels/{reel_id}")
async def get_reel(reel_id: str):
    doc = await db.reels.find_one({"reel_id": reel_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Reel not found")
    return doc


@router.post("/reels/{reel_id}/view")
async def track_view(reel_id: str, request: Request):
    await rate_limit("reel_view", client_key(request), limit=60, window_sec=60)
    r = await db.reels.update_one({"reel_id": reel_id}, {"$inc": {"views": 1}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reel not found")
    return {"ok": True}


@router.post("/reels/like")
async def toggle_reel_like(
    payload: ReelLikeToggle, current=Depends(get_current_user)
):
    reel = await db.reels.find_one({"reel_id": payload.reel_id}, {"_id": 0})
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")
    existing = await db.reel_likes.find_one(
        {"reel_id": payload.reel_id, "user_id": current["user_id"]}
    )
    if existing:
        await db.reel_likes.delete_one({"_id": existing["_id"]})
        await db.reels.update_one(
            {"reel_id": payload.reel_id}, {"$inc": {"likes": -1}}
        )
        liked = False
    else:
        await db.reel_likes.insert_one({
            "reel_id": payload.reel_id,
            "user_id": current["user_id"],
            "created_at": datetime.now(timezone.utc),
        })
        await db.reels.update_one(
            {"reel_id": payload.reel_id}, {"$inc": {"likes": 1}}
        )
        liked = True
    updated = await db.reels.find_one({"reel_id": payload.reel_id}, {"_id": 0})
    return {"liked": liked, "likes": updated["likes"] if updated else 0}


@router.get("/reels/my/likes")
async def my_reel_likes(current=Depends(get_current_user)):
    docs = await db.reel_likes.find(
        {"user_id": current["user_id"]}, {"_id": 0}
    ).to_list(500)
    return [d["reel_id"] for d in docs]


@router.post("/owner/reels", response_model=Reel)
async def owner_create_reel(
    payload: ReelCreate, current=Depends(get_current_user)
):
    require_role(current, "owner")
    biz = await db.businesses.find_one(
        {"business_id": payload.business_id, "owner_id": current["user_id"]},
        {"_id": 0},
    )
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found for this owner")
    doc = {
        "reel_id": f"rl_{uuid.uuid4().hex[:10]}",
        "business_id": biz["business_id"],
        "business_name": biz["name"],
        "business_category": biz["category"],
        "city": biz["city"],
        "video_url": payload.video_url,
        "cover_image": payload.cover_image or biz["cover_image"],
        "caption": payload.caption,
        "author": biz["name"],
        "likes": 0,
        "views": 0,
        "created_at": datetime.now(timezone.utc),
    }
    await db.reels.insert_one(dict(doc))
    doc.pop("_id", None)
    return Reel(**doc)
