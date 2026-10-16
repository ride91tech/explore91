"""Place-level interest: the Interested / Going / Visited mechanic.

explore91.com puts this on every place and every CityReel where a booking
button would otherwise sit — the place page says so outright: "No booking.
Just a note for later." The three states feed the rest of the product:

  interested -> the Bucket List on the Trips tab
  going      -> plans, shown alongside saved places
  visited    -> fills in the journey map, which the site describes as
                happening on its own as you open reels and get directions

Interest is one row per (user, place), so changing your mind replaces the
previous state rather than accumulating.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core.db import db
from core.security import get_current_user
from models import PlaceInterestSet

router = APIRouter()

INTENTS = ("interested", "going", "visited")


async def _business_or_404(business_id: str) -> dict:
    biz = await db.businesses.find_one(
        {"business_id": business_id}, {"_id": 0, "business_id": 1, "city": 1, "name": 1}
    )
    if not biz:
        raise HTTPException(status_code=404, detail="Place not found")
    return biz


async def _mark_city_visited(user_id: str, city_slug: str) -> None:
    """Visiting a place means you were in the city.

    Idempotent, and $setOnInsert keeps the earliest date so re-marking never
    rewrites history.
    """
    if not city_slug:
        return
    await db.journey_visits.update_one(
        {"user_id": user_id, "city_slug": city_slug},
        {"$setOnInsert": {"visited_at": datetime.now(timezone.utc)}},
        upsert=True,
    )


@router.get("/places/interest")
async def list_interest(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=60, ge=1, le=100),
    current=Depends(get_current_user),
):
    """Places the traveller flagged, newest first, hydrated with the place."""
    if status is not None and status not in INTENTS:
        raise HTTPException(
            status_code=422, detail=f"status must be one of {', '.join(INTENTS)}"
        )

    query: dict = {"user_id": current["user_id"]}
    if status:
        query["status"] = status
    rows = (
        await db.place_interest.find(query, {"_id": 0})
        .sort("updated_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    if not rows:
        return []

    ids = [r["business_id"] for r in rows]
    found = await db.businesses.find(
        {"business_id": {"$in": ids}}, {"_id": 0}
    ).to_list(len(ids))
    by_id = {b["business_id"]: b for b in found}

    # A place can be delisted after being flagged; drop those rather than
    # returning a row with nothing to render.
    out = []
    for r in rows:
        biz = by_id.get(r["business_id"])
        if biz:
            out.append({**biz, "interest_status": r["status"], "interest_at": r["updated_at"]})
    return out


@router.get("/places/{business_id}/interest")
async def get_interest(business_id: str, current=Depends(get_current_user)):
    """What this traveller has flagged for one place, for the detail screen."""
    row = await db.place_interest.find_one(
        {"user_id": current["user_id"], "business_id": business_id}, {"_id": 0}
    )
    return {"business_id": business_id, "status": row["status"] if row else None}


@router.put("/places/{business_id}/interest")
async def set_interest(
    business_id: str, payload: PlaceInterestSet, current=Depends(get_current_user)
):
    """Flag a place interested / going / visited, replacing any previous flag."""
    biz = await _business_or_404(business_id)
    now = datetime.now(timezone.utc)

    await db.place_interest.update_one(
        {"user_id": current["user_id"], "business_id": business_id},
        {
            "$set": {"status": payload.status, "updated_at": now},
            "$setOnInsert": {"city": biz.get("city", ""), "created_at": now},
        },
        upsert=True,
    )

    if payload.status == "visited":
        await _mark_city_visited(current["user_id"], biz.get("city", ""))

    return {"business_id": business_id, "status": payload.status}


@router.delete("/places/{business_id}/interest")
async def clear_interest(business_id: str, current=Depends(get_current_user)):
    """Un-flag a place. The city stays on the journey map — you were still there."""
    r = await db.place_interest.delete_one(
        {"user_id": current["user_id"], "business_id": business_id}
    )
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="That place isn't flagged")
    return {"business_id": business_id, "status": None}
