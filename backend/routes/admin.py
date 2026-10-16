"""Admin console endpoints: platform stats, CMS, reports, moderation."""
import asyncio
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import PlainTextResponse

from core import audit
from routes.catalog import content_counts, with_content
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

# Platform take rate applied to gross booking value.
TAKE_RATE = 0.05

# Cancelled bookings are kept for history but never counted as revenue.
BILLABLE = {"status": {"$ne": "cancelled"}}


def _search(term: str, fields: List[str]) -> dict:
    """Case-insensitive OR-match across `fields`, escaped against regex DoS."""
    safe = re.escape(term.strip())
    return {"$or": [{f: {"$regex": safe, "$options": "i"}} for f in fields]}


async def _revenue(match: dict) -> dict:
    """Sum booked value, split by whether the amount is real or estimated."""
    pipeline = [
        {"$match": {**match, **BILLABLE}},
        {
            "$group": {
                "_id": "$amount_source",
                "amount": {"$sum": {"$ifNull": ["$amount_inr", 0]}},
                "count": {"$sum": 1},
            }
        },
    ]
    confirmed = estimated = 0
    unpriced = 0
    async for row in db.bookings.aggregate(pipeline):
        if row["_id"] == "service":
            confirmed += row["amount"]
        else:
            estimated += row["amount"]
            if not row["amount"]:
                unpriced += row["count"]
    gross = confirmed + estimated
    return {
        "gross_revenue_inr": gross,
        "platform_fees_inr": int(gross * TAKE_RATE),
        "confirmed_revenue_inr": confirmed,
        "estimated_revenue_inr": estimated,
        "bookings_without_amount": unpriced,
    }


# --- Stats ---------------------------------------------------------------
@router.get("/admin/stats")
async def admin_stats(current=Depends(get_current_user)):
    require_role(current, "admin")
    users_count, biz_count, pending_count, bookings_count, cancelled_count, reviews_count = (
        await asyncio.gather(
            db.users.count_documents({}),
            db.businesses.count_documents({}),
            db.businesses.count_documents({"is_approved": False}),
            db.bookings.count_documents(BILLABLE),
            db.bookings.count_documents({"status": "cancelled"}),
            db.reviews.count_documents({}),
        )
    )
    by_city = []
    async for doc in db.businesses.aggregate(
        [{"$group": {"_id": "$city", "count": {"$sum": 1}}}, {"$sort": {"count": -1}}]
    ):
        by_city.append({"city": doc["_id"], "count": doc["count"]})
    return {
        "users": users_count,
        "businesses": biz_count,
        "pending_businesses": pending_count,
        "bookings": bookings_count,
        "cancelled_bookings": cancelled_count,
        "reviews": reviews_count,
        **(await _revenue({})),
        "by_city": by_city,
    }


@router.get("/admin/users")
async def admin_list_users(
    response: Response,
    current=Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: Optional[str] = Query(default=None, max_length=120),
):
    require_role(current, "admin")
    match = _search(q, ["name", "email"]) if q and q.strip() else {}
    total = await db.users.count_documents(match)
    rows = (
        await db.users.find(match, {"_id": 0})
        .sort("created_at", -1).skip(offset).limit(limit).to_list(limit)
    )
    response.headers["X-Total-Count"] = str(total)
    return rows


# --- Businesses moderation ----------------------------------------------
@router.get("/admin/businesses")
async def admin_list_businesses(
    response: Response,
    current=Depends(get_current_user),
    pending: Optional[bool] = None,
    featured: Optional[bool] = None,
    q: Optional[str] = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    require_role(current, "admin")
    match: dict = {}
    if pending is True:
        match["is_approved"] = False
    elif pending is False:
        match["is_approved"] = True
    if featured is not None:
        match["is_featured"] = featured
    if q and q.strip():
        match.update(_search(q, ["name", "category", "city", "address"]))
    total = await db.businesses.count_documents(match)
    rows = (
        await db.businesses.find(match, {"_id": 0})
        .sort("name", 1).skip(offset).limit(limit).to_list(limit)
    )
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.patch("/admin/businesses/{business_id}/approve")
async def admin_approve_business(
    business_id: str, current=Depends(get_current_user)
):
    require_role(current, "admin")
    before = await db.businesses.find_one({"business_id": business_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Business not found")
    await db.businesses.update_one(
        {"business_id": business_id},
        {"$set": {"is_approved": True, "is_verified": True}},
    )
    after = await db.businesses.find_one({"business_id": business_id}, {"_id": 0})
    await audit.record(
        current, "business.approve", "business", business_id,
        before={"is_approved": before.get("is_approved"), "name": before.get("name")},
        after={"is_approved": True},
    )
    return after


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
    await audit.record(
        current, "business.feature", "business", business_id,
        before={"is_featured": biz.get("is_featured", False), "name": biz.get("name")},
        after={"is_featured": new_val},
    )
    return {"business_id": business_id, "is_featured": new_val}


@router.delete("/admin/businesses/{business_id}")
async def admin_delete_business(
    business_id: str, current=Depends(get_current_user)
):
    require_role(current, "admin")
    biz = await db.businesses.find_one({"business_id": business_id}, {"_id": 0})
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    await db.businesses.delete_one({"business_id": business_id})
    removed_reels = await db.reels.delete_many({"business_id": business_id})
    await audit.record(
        current, "business.delete", "business", business_id,
        before=biz,
        note=f"cascade removed {removed_reels.deleted_count} reel(s)",
    )
    return {"ok": True}


# --- Reels moderation ---------------------------------------------------
@router.get("/admin/reels")
async def admin_list_reels(
    response: Response,
    current=Depends(get_current_user),
    hidden: Optional[bool] = None,
    q: Optional[str] = Query(default=None, max_length=120),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    require_role(current, "admin")
    match: dict = {}
    if hidden is True:
        match["is_hidden"] = True
    elif hidden is False:
        match["is_hidden"] = {"$ne": True}
    if q and q.strip():
        match.update(_search(q, ["caption", "business_name", "author", "city"]))
    total = await db.reels.count_documents(match)
    rows = (
        await db.reels.find(match, {"_id": 0})
        .sort("created_at", -1).skip(offset).limit(limit).to_list(limit)
    )
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.patch("/admin/reels/{reel_id}/visibility")
async def admin_toggle_reel(reel_id: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    reel = await db.reels.find_one({"reel_id": reel_id}, {"_id": 0})
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")
    new_val = not reel.get("is_hidden", False)
    await db.reels.update_one({"reel_id": reel_id}, {"$set": {"is_hidden": new_val}})
    await audit.record(
        current, "reel.visibility", "reel", reel_id,
        before={"is_hidden": reel.get("is_hidden", False), "caption": reel.get("caption")},
        after={"is_hidden": new_val},
    )
    return {"reel_id": reel_id, "is_hidden": new_val}


@router.delete("/admin/reels/{reel_id}")
async def admin_delete_reel(reel_id: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    reel = await db.reels.find_one({"reel_id": reel_id}, {"_id": 0})
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")
    await db.reels.delete_one({"reel_id": reel_id})
    await db.reel_likes.delete_many({"reel_id": reel_id})
    await audit.record(current, "reel.delete", "reel", reel_id, before=reel)
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
    await audit.record(current, "category.create", "category", payload.slug, after=doc)
    return doc


@router.delete("/admin/categories/{slug}")
async def admin_delete_category(slug: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    before = await db.categories_cms.find_one({"slug": slug}, {"_id": 0})
    r = await db.categories_cms.delete_one({"slug": slug})
    if r.deleted_count == 0:
        raise HTTPException(
            status_code=404, detail="Category not found or is a built-in"
        )
    await audit.record(current, "category.delete", "category", slug, before=before)
    return {"ok": True}


# --- Cities CMS ---------------------------------------------------------
@router.get("/admin/cities")
async def admin_list_cities(current=Depends(get_current_user)):
    require_role(current, "admin")
    custom = await db.cities_cms.find({}, {"_id": 0}).to_list(200)
    known = {c["slug"] for c in custom}
    merged = [{**c, "source": "default"} for c in CITIES if c["slug"] not in known]
    merged += [{**c, "source": "cms"} for c in custom]
    # Surface how much content each city holds. A city with none renders as
    # "coming soon" in the app, and that is the thing an admin needs to see.
    counts = await content_counts()
    return [with_content(c, counts) for c in merged]


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
    await audit.record(current, "city.create", "city", payload.slug, after=doc)
    return doc


@router.delete("/admin/cities/{slug}")
async def admin_delete_city(slug: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    before = await db.cities_cms.find_one({"slug": slug}, {"_id": 0})
    r = await db.cities_cms.delete_one({"slug": slug})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="City not found or is a built-in")
    await audit.record(current, "city.delete", "city", slug, before=before)
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
    await audit.record(
        current, "banner.create", "banner", doc["banner_id"], after=doc
    )
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
    before = await db.banners.find_one({"banner_id": banner_id}, {"_id": 0})
    r = await db.banners.update_one({"banner_id": banner_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Banner not found")
    await audit.record(
        current, "banner.update", "banner", banner_id,
        before={k: (before or {}).get(k) for k in updates},
        after=updates,
    )
    return await db.banners.find_one({"banner_id": banner_id}, {"_id": 0})


@router.delete("/admin/banners/{banner_id}")
async def admin_delete_banner(banner_id: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    before = await db.banners.find_one({"banner_id": banner_id}, {"_id": 0})
    r = await db.banners.delete_one({"banner_id": banner_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Banner not found")
    await audit.record(current, "banner.delete", "banner", banner_id, before=before)
    return {"ok": True}


# --- Financial reports --------------------------------------------------
async def _gmv_report(days: int, city: Optional[str]) -> dict:
    """Booked value per day.

    Both the window filter and the day bucket use `created_at`, so a booking
    made today for a future date lands on today rather than outside the range.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)
    match: dict = {"created_at": {"$gte": since}, **BILLABLE}
    if city:
        biz_ids = [
            b["business_id"]
            async for b in db.businesses.find(
                {"city": city.lower()}, {"_id": 0, "business_id": 1}
            )
        ]
        match["business_id"] = {"$in": biz_ids}

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": {
                    "$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}
                },
                "bookings": {"$sum": 1},
                "gmv": {"$sum": {"$ifNull": ["$amount_inr", 0]}},
                "confirmed": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$amount_source", "service"]},
                            {"$ifNull": ["$amount_inr", 0]},
                            0,
                        ]
                    }
                },
            }
        },
        {"$sort": {"_id": 1}},
    ]

    series = []
    total_bookings = total_gmv = total_confirmed = 0
    async for row in db.bookings.aggregate(pipeline):
        gmv = int(row["gmv"])
        series.append({
            "date": row["_id"],
            "bookings": row["bookings"],
            "gmv": gmv,
            "fees": int(gmv * TAKE_RATE),
            "confirmed": int(row["confirmed"]),
        })
        total_bookings += row["bookings"]
        total_gmv += gmv
        total_confirmed += int(row["confirmed"])

    return {
        "days": days,
        "city": city,
        "total_bookings": total_bookings,
        "total_gmv": total_gmv,
        "total_fees": int(total_gmv * TAKE_RATE),
        "confirmed_gmv": total_confirmed,
        "estimated_gmv": total_gmv - total_confirmed,
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
    response: Response,
    current=Depends(get_current_user),
    status: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    require_role(current, "admin")
    q: dict = {}
    if status:
        q["status"] = status
    total = await db.tickets.count_documents(q)
    rows = (
        await db.tickets.find(q, {"_id": 0})
        .sort("created_at", -1).skip(offset).limit(limit).to_list(limit)
    )
    response.headers["X-Total-Count"] = str(total)
    return rows


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
    before = await db.tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})
    r = await db.tickets.update_one({"ticket_id": ticket_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await audit.record(
        current, "ticket.update", "ticket", ticket_id,
        before={k: (before or {}).get(k) for k in updates},
        after=updates,
    )
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
    await audit.record(
        current, "flag.create", payload.entity_type, payload.entity_id,
        after={"flag_id": doc["flag_id"], "reason": payload.reason},
    )
    return doc


@router.get("/admin/flags")
async def admin_list_flags(
    response: Response,
    current=Depends(get_current_user),
    status: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    require_role(current, "admin")
    q: dict = {}
    if status:
        q["status"] = status
    total = await db.fraud_flags.count_documents(q)
    rows = (
        await db.fraud_flags.find(q, {"_id": 0})
        .sort("created_at", -1).skip(offset).limit(limit).to_list(limit)
    )
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.patch("/admin/flags/{flag_id}/resolve")
async def admin_resolve_flag(flag_id: str, current=Depends(get_current_user)):
    require_role(current, "admin")
    r = await db.fraud_flags.update_one(
        {"flag_id": flag_id}, {"$set": {"status": "resolved"}}
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Flag not found")
    await audit.record(
        current, "flag.resolve", "flag", flag_id, after={"status": "resolved"}
    )
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
    revoked = 0
    if new_val:
        revoked = (await db.user_sessions.delete_many({"user_id": user_id})).deleted_count
    await audit.record(
        current, "user.block" if new_val else "user.unblock", "user", user_id,
        before={"is_blocked": user.get("is_blocked", False), "email": user.get("email")},
        after={"is_blocked": new_val},
        note=f"revoked {revoked} session(s)" if new_val else "",
    )
    return {"user_id": user_id, "is_blocked": new_val}


# --- Audit trail ---------------------------------------------------------
@router.get("/admin/audit")
async def admin_list_audit(
    response: Response,
    current=Depends(get_current_user),
    action: Optional[str] = Query(default=None, max_length=64),
    entity_id: Optional[str] = Query(default=None, max_length=64),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    require_role(current, "admin")
    q: dict = {}
    if action:
        q["action"] = action
    if entity_id:
        q["entity_id"] = entity_id
    total = await db.admin_audit.count_documents(q)
    rows = (
        await db.admin_audit.find(q, {"_id": 0})
        .sort("created_at", -1).skip(offset).limit(limit).to_list(limit)
    )
    response.headers["X-Total-Count"] = str(total)
    return rows
