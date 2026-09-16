"""Admin console endpoints: platform stats, CMS, reports, moderation."""
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse

from core.db import db
from core.security import get_current_user, require_role
from models import (
    BannerUpdate,
    BannerUpsert,
    CategoryUpsert,
    CityUpsert,
    FraudFlagCreate,
    TicketUpdate,
)
from seed.data import CATEGORIES, CITIES

router = APIRouter()


# --- Stats ---------------------------------------------------------------
@router.get("/admin/stats")
async def admin_stats(current=Depends(get_current_user)):
    require_role(current, "admin")
    users_count = await db.users.count_documents({})
    biz_count = await db.businesses.count_documents({})
    pending_count = await db.businesses.count_documents({"is_approved": False})
    bookings_count = await db.bookings.count_documents({})
    reviews_count = await db.reviews.count_documents({})
    pipeline = [{"$group": {"_id": "$city", "count": {"$sum": 1}}}]
    by_city = []
    async for doc in db.businesses.aggregate(pipeline):
        by_city.append({"city": doc["_id"], "count": doc["count"]})
    return {
        "users": users_count,
        "businesses": biz_count,
        "pending_businesses": pending_count,
        "bookings": bookings_count,
        "reviews": reviews_count,
        "gross_revenue_inr": bookings_count * 5000,
        "platform_fees_inr": bookings_count * 250,
        "by_city": by_city,
    }


@router.get("/admin/users")
async def admin_list_users(current=Depends(get_current_user), limit: int = 100):
    require_role(current, "admin")
    return (
        await db.users.find({}, {"_id": 0})
        .sort("created_at", -1).to_list(limit)
    )


# --- Businesses moderation ----------------------------------------------
@router.get("/admin/businesses")
async def admin_list_businesses(
    current=Depends(get_current_user),
    pending: Optional[bool] = None,
    limit: int = 200,
):
    require_role(current, "admin")
    q: dict = {}
    if pending is True:
        q["is_approved"] = False
    elif pending is False:
        q["is_approved"] = True
    return await db.businesses.find(q, {"_id": 0}).sort("name", 1).to_list(limit)


@router.patch("/admin/businesses/{business_id}/approve")
async def admin_approve_business(
    business_id: str, current=Depends(get_current_user)
):
    require_role(current, "admin")
    r = await db.businesses.update_one(
        {"business_id": business_id},
        {"$set": {"is_approved": True, "is_verified": True}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Business not found")
    return await db.businesses.find_one({"business_id": business_id}, {"_id": 0})


@router.patch("/admin/businesses/{business_id}/feature")
async def admin_toggle_feature(
    business_id: str, current=Depends(get_current_user)
):
    require_role(current, "admin")
    biz = await db.businesses.find_one({"business_id": business_id}, {"_id": 0})
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    new_val = not biz.get("is_featured", False)
    await db.businesses.update_one(
        {"business_id": business_id}, {"$set": {"is_featured": new_val}}
    )
    return {"business_id": business_id, "is_featured": new_val}


@router.delete("/admin/businesses/{business_id}")
async def admin_delete_business(
    business_id: str, current=Depends(get_current_user)
):
    require_role(current, "admin")
    r = await db.businesses.delete_one({"business_id": business_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Business not found")
    await db.reels.delete_many({"business_id": business_id})
    return {"ok": True}


# --- Reels moderation ---------------------------------------------------
@router.get("/admin/reels")
async def admin_list_reels(
    current=Depends(get_current_user),
    hidden: Optional[bool] = None,
    limit: int = Query(default=100, ge=1, le=200),
):
    require_role(current, "admin")
    q: dict = {}
    if hidden is True:
        q["is_hidden"] = True
    elif hidden is False:
        q["is_hidden"] = {"$ne": True}
    return (
        await db.reels.find(q, {"_id": 0})
        .sort("created_at", -1).limit(limit).to_list(limit)
    )


@router.patch("/admin/reels/{reel_id}/visibility")
async def admin_toggle_reel(reel_id: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    reel = await db.reels.find_one({"reel_id": reel_id}, {"_id": 0})
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")
    new_val = not reel.get("is_hidden", False)
    await db.reels.update_one({"reel_id": reel_id}, {"$set": {"is_hidden": new_val}})
    return {"reel_id": reel_id, "is_hidden": new_val}


@router.delete("/admin/reels/{reel_id}")
async def admin_delete_reel(reel_id: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    r = await db.reels.delete_one({"reel_id": reel_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reel not found")
    await db.reel_likes.delete_many({"reel_id": reel_id})
    return {"ok": True}


# --- Categories CMS -----------------------------------------------------
@router.get("/admin/categories")
async def admin_list_categories(current=Depends(get_current_user)):
    require_role(current, "admin")
    custom = await db.categories_cms.find({}, {"_id": 0}).to_list(200)
    known = {c["slug"] for c in custom}
    merged = [{**c, "source": "default"} for c in CATEGORIES if c["slug"] not in known]
    merged += [{**c, "source": "cms"} for c in custom]
    return merged


@router.post("/admin/categories")
async def admin_create_category(
    payload: CategoryUpsert, current=Depends(get_current_user)
):
    require_role(current, "admin")
    exists = await db.categories_cms.find_one({"slug": payload.slug}, {"_id": 0})
    if exists:
        raise HTTPException(
            status_code=409, detail="Category with this slug already exists"
        )
    doc = payload.model_dump()
    await db.categories_cms.insert_one(dict(doc))
    return doc


@router.delete("/admin/categories/{slug}")
async def admin_delete_category(slug: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    r = await db.categories_cms.delete_one({"slug": slug})
    if r.deleted_count == 0:
        raise HTTPException(
            status_code=404, detail="Category not found or is a built-in"
        )
    return {"ok": True}


# --- Cities CMS ---------------------------------------------------------
@router.get("/admin/cities")
async def admin_list_cities(current=Depends(get_current_user)):
    require_role(current, "admin")
    custom = await db.cities_cms.find({}, {"_id": 0}).to_list(200)
    known = {c["slug"] for c in custom}
    merged = [{**c, "source": "default"} for c in CITIES if c["slug"] not in known]
    merged += [{**c, "source": "cms"} for c in custom]
    return merged


@router.post("/admin/cities")
async def admin_create_city(payload: CityUpsert, current=Depends(get_current_user)):
    require_role(current, "admin")
    exists = await db.cities_cms.find_one({"slug": payload.slug}, {"_id": 0})
    if exists:
        raise HTTPException(
            status_code=409, detail="City with this slug already exists"
        )
    doc = payload.model_dump()
    await db.cities_cms.insert_one(dict(doc))
    return doc


@router.delete("/admin/cities/{slug}")
async def admin_delete_city(slug: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    r = await db.cities_cms.delete_one({"slug": slug})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="City not found or is a built-in")
    return {"ok": True}


# --- Banners CMS --------------------------------------------------------
@router.get("/admin/banners")
async def admin_list_banners(current=Depends(get_current_user)):
    require_role(current, "admin")
    return await db.banners.find({}, {"_id": 0}).sort("sort_order", 1).to_list(200)


@router.post("/admin/banners")
async def admin_create_banner(
    payload: BannerUpsert, current=Depends(get_current_user)
):
    require_role(current, "admin")
    doc = payload.model_dump()
    doc["banner_id"] = f"bn_{uuid.uuid4().hex[:10]}"
    doc["created_at"] = datetime.now(timezone.utc)
    if doc.get("city"):
        doc["city"] = doc["city"].lower()
    await db.banners.insert_one(dict(doc))
    return doc


@router.patch("/admin/banners/{banner_id}")
async def admin_update_banner(
    banner_id: str, payload: BannerUpdate, current=Depends(get_current_user)
):
    require_role(current, "admin")
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    if "city" in updates and updates["city"]:
        updates["city"] = updates["city"].lower()
    r = await db.banners.update_one({"banner_id": banner_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Banner not found")
    return await db.banners.find_one({"banner_id": banner_id}, {"_id": 0})


@router.delete("/admin/banners/{banner_id}")
async def admin_delete_banner(banner_id: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    r = await db.banners.delete_one({"banner_id": banner_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Banner not found")
    return {"ok": True}


# --- Financial reports --------------------------------------------------
async def _gmv_report(days: int, city: Optional[str]) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    match: dict = {"created_at": {"$gte": since}}
    if city:
        biz_ids = [
            b["business_id"]
            async for b in db.businesses.find(
                {"city": city.lower()}, {"_id": 0, "business_id": 1}
            )
        ]
        match["business_id"] = {"$in": biz_ids}
    bookings = await db.bookings.find(match, {"_id": 0}).to_list(5000)
    by_day: Dict[str, dict] = defaultdict(lambda: {"bookings": 0, "gmv": 0, "fees": 0})
    AVG_TICKET = 5000
    TAKE_RATE = 0.05
    for b in bookings:
        d = b.get("date") or b["created_at"].strftime("%Y-%m-%d")
        by_day[d]["bookings"] += 1
        by_day[d]["gmv"] += AVG_TICKET
        by_day[d]["fees"] += int(AVG_TICKET * TAKE_RATE)
    series = [{"date": d, **v} for d, v in sorted(by_day.items())]
    total_bookings = len(bookings)
    return {
        "days": days,
        "city": city,
        "total_bookings": total_bookings,
        "total_gmv": total_bookings * AVG_TICKET,
        "total_fees": total_bookings * int(AVG_TICKET * TAKE_RATE),
        "series": series,
    }


@router.get("/admin/reports/gmv")
async def admin_gmv_report(
    current=Depends(get_current_user),
    days: int = Query(default=30, ge=1, le=180),
    city: Optional[str] = None,
):
    require_role(current, "admin")
    return await _gmv_report(days, city)


@router.get("/admin/reports/gmv/export")
async def admin_gmv_export(
    current=Depends(get_current_user),
    days: int = Query(default=30, ge=1, le=180),
    city: Optional[str] = None,
):
    require_role(current, "admin")
    data = await _gmv_report(days, city)
    lines = ["date,bookings,gmv_inr,fees_inr"]
    for row in data["series"]:
        lines.append(
            f"{row['date']},{row['bookings']},{row['gmv']},{row['fees']}"
        )
    body = "\n".join(lines)
    return PlainTextResponse(
        body,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=gmv-{days}d.csv"},
    )


# --- Tickets admin ------------------------------------------------------
@router.get("/admin/tickets")
async def admin_list_tickets(
    current=Depends(get_current_user), status: Optional[str] = None
):
    require_role(current, "admin")
    q: dict = {}
    if status:
        q["status"] = status
    return (
        await db.tickets.find(q, {"_id": 0})
        .sort("created_at", -1).to_list(200)
    )


@router.patch("/admin/tickets/{ticket_id}")
async def admin_update_ticket(
    ticket_id: str, payload: TicketUpdate, current=Depends(get_current_user)
):
    require_role(current, "admin")
    updates: dict = {}
    if payload.status is not None:
        updates["status"] = payload.status
    if payload.admin_reply is not None:
        updates["admin_reply"] = payload.admin_reply
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.tickets.update_one({"ticket_id": ticket_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return await db.tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})


# --- Fraud flags & user blocking ----------------------------------------
@router.post("/admin/flags")
async def admin_flag(
    payload: FraudFlagCreate, current=Depends(get_current_user)
):
    require_role(current, "admin")
    doc = {
        "flag_id": f"fl_{uuid.uuid4().hex[:10]}",
        "entity_type": payload.entity_type,
        "entity_id": payload.entity_id,
        "reason": payload.reason,
        "status": "open",
        "created_by": current["user_id"],
        "created_at": datetime.now(timezone.utc),
    }
    await db.fraud_flags.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/admin/flags")
async def admin_list_flags(
    current=Depends(get_current_user), status: Optional[str] = None
):
    require_role(current, "admin")
    q: dict = {}
    if status:
        q["status"] = status
    return (
        await db.fraud_flags.find(q, {"_id": 0})
        .sort("created_at", -1).to_list(200)
    )


@router.patch("/admin/flags/{flag_id}/resolve")
async def admin_resolve_flag(flag_id: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    r = await db.fraud_flags.update_one(
        {"flag_id": flag_id}, {"$set": {"status": "resolved"}}
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Flag not found")
    return {"ok": True}


@router.patch("/admin/users/{user_id}/block")
async def admin_block_user(user_id: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    if user_id == current["user_id"]:
        raise HTTPException(status_code=400, detail="You cannot block yourself")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    new_val = not user.get("is_blocked", False)
    await db.users.update_one({"user_id": user_id}, {"$set": {"is_blocked": new_val}})
    # Revoke all sessions on block
    if new_val:
        await db.user_sessions.delete_many({"user_id": user_id})
    return {"user_id": user_id, "is_blocked": new_val}
