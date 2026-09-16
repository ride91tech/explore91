"""Customer-side interactions: saved listings, bookings, reviews."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.security import client_key, get_current_user, rate_limit
from models import (
    Booking,
    BookingCreate,
    Review,
    ReviewCreate,
    SavedToggle,
)

router = APIRouter()


# --- Saved (favorites) ----------------------------------------------------
@router.get("/saved")
async def get_saved(current=Depends(get_current_user)):
    doc = (
        await db.saved.find_one({"user_id": current["user_id"]}, {"_id": 0})
        or {"business_ids": []}
    )
    ids = doc.get("business_ids", [])
    if not ids:
        return []
    businesses = await db.businesses.find(
        {"business_id": {"$in": ids}}, {"_id": 0}
    ).to_list(200)
    return businesses


@router.post("/saved/toggle")
async def toggle_saved(payload: SavedToggle, current=Depends(get_current_user)):
    doc = (
        await db.saved.find_one({"user_id": current["user_id"]}, {"_id": 0})
        or {"user_id": current["user_id"], "business_ids": []}
    )
    ids = doc.get("business_ids", [])
    if payload.business_id in ids:
        ids.remove(payload.business_id)
        saved = False
    else:
        ids.append(payload.business_id)
        saved = True
    await db.saved.update_one(
        {"user_id": current["user_id"]},
        {"$set": {"business_ids": ids, "user_id": current["user_id"]}},
        upsert=True,
    )
    return {"saved": saved, "business_id": payload.business_id}


# --- Bookings -------------------------------------------------------------
@router.post("/bookings", response_model=Booking)
async def create_booking(payload: BookingCreate, current=Depends(get_current_user)):
    biz = await db.businesses.find_one({"business_id": payload.business_id}, {"_id": 0})
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    booking = {
        "booking_id": f"bk_{uuid.uuid4().hex[:12]}",
        "user_id": current["user_id"],
        "business_id": biz["business_id"],
        "business_name": biz["name"],
        "business_image": biz["cover_image"],
        "date": payload.date,
        "time": payload.time,
        "guests": payload.guests,
        "service_name": payload.service_name,
        "status": "confirmed",
        "notes": payload.notes or "",
        "created_at": datetime.now(timezone.utc),
    }
    await db.bookings.insert_one(dict(booking))
    # Award 50 reward points per booking
    await db.users.update_one(
        {"user_id": current["user_id"]}, {"$inc": {"wallet_points": 50}}
    )
    booking.pop("_id", None)
    return Booking(**booking)


@router.get("/bookings")
async def list_bookings(current=Depends(get_current_user)):
    return (
        await db.bookings.find({"user_id": current["user_id"]}, {"_id": 0})
        .sort("created_at", -1).to_list(200)
    )


@router.delete("/bookings/{booking_id}")
async def cancel_booking(booking_id: str, current=Depends(get_current_user)):
    r = await db.bookings.update_one(
        {"booking_id": booking_id, "user_id": current["user_id"]},
        {"$set": {"status": "cancelled"}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"ok": True}


# --- Reviews --------------------------------------------------------------
@router.get("/businesses/{business_id}/reviews")
async def list_reviews(business_id: str):
    return (
        await db.reviews.find({"business_id": business_id}, {"_id": 0})
        .sort("created_at", -1).to_list(50)
    )


@router.post("/reviews", response_model=Review)
async def create_review(
    payload: ReviewCreate, request: Request, current=Depends(get_current_user)
):
    rate_limit("review", client_key(request, current), limit=10, window_sec=60)
    review = {
        "review_id": f"rv_{uuid.uuid4().hex[:12]}",
        "user_id": current["user_id"],
        "user_name": current["name"],
        "business_id": payload.business_id,
        "rating": payload.rating,
        "comment": payload.comment,
        "created_at": datetime.now(timezone.utc),
    }
    await db.reviews.insert_one(dict(review))
    review.pop("_id", None)
    return Review(**review)
