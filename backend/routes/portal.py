"""Business owner portal endpoints."""
import uuid
from collections import Counter
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_user, require_role
from models import BusinessCreate, StaffCreate
from seed.data import CITY_COORDS, SAMPLE_IMAGES

router = APIRouter()


@router.get("/owner/dashboard")
async def owner_dashboard(current=Depends(get_current_user)):
    require_role(current, "owner")
    my_biz = await db.businesses.find(
        {"owner_id": current["user_id"]}, {"_id": 0}
    ).to_list(200)
    biz_ids = [b["business_id"] for b in my_biz]
    bookings = await db.bookings.find(
        {"business_id": {"$in": biz_ids}}, {"_id": 0}
    ).to_list(500)
    upcoming = [b for b in bookings if b.get("status") == "confirmed"]
    revenue = sum(50 for _ in bookings)  # demo: ₹50 platform fee per booking
    return {
        "business_count": len(my_biz),
        "booking_count": len(bookings),
        "upcoming_count": len(upcoming),
        "revenue_inr": revenue * 100,
        "avg_rating": round(
            sum(b.get("rating", 0) for b in my_biz) / max(1, len(my_biz)), 2
        ),
        "businesses": my_biz,
        "recent_bookings": sorted(
            bookings,
            key=lambda x: x.get("created_at", datetime.min),
            reverse=True,
        )[:10],
    }


@router.get("/owner/businesses")
async def owner_list_businesses(current=Depends(get_current_user)):
    require_role(current, "owner")
    return await db.businesses.find(
        {"owner_id": current["user_id"]}, {"_id": 0}
    ).to_list(200)


@router.post("/owner/businesses")
async def owner_create_business(
    payload: BusinessCreate, current=Depends(get_current_user)
):
    require_role(current, "owner")
    cover = (
        payload.cover_image
        or SAMPLE_IMAGES.get(payload.category, SAMPLE_IMAGES["services"])[0]
    )
    lat0, lng0 = CITY_COORDS.get(payload.city.lower(), (15.3, 74.1))
    doc = {
        "business_id": f"biz_{uuid.uuid4().hex[:10]}",
        "owner_id": current["user_id"],
        "name": payload.name,
        "category": payload.category.lower(),
        "city": payload.city.lower(),
        "address": payload.address,
        "lat": lat0,
        "lng": lng0,
        "cover_image": cover,
        "gallery": [cover],
        "rating": 0.0,
        "review_count": 0,
        "price_range": payload.price_range,
        "tags": payload.tags,
        "description": payload.description,
        "open_hours": "10:00 AM - 11:00 PM",
        "phone": "",
        "is_verified": False,
        "is_featured": False,
        "is_approved": False,  # requires admin approval
        "offers": [],
        "menu": [],
        "services": [],
        "booking_type": payload.booking_type,
    }
    await db.businesses.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/owner/bookings")
async def owner_bookings(current=Depends(get_current_user)):
    require_role(current, "owner")
    my_biz = await db.businesses.find(
        {"owner_id": current["user_id"]}, {"_id": 0, "business_id": 1}
    ).to_list(200)
    biz_ids = [b["business_id"] for b in my_biz]
    return (
        await db.bookings.find({"business_id": {"$in": biz_ids}}, {"_id": 0})
        .sort("date", 1).to_list(500)
    )


@router.get("/owner/staff")
async def list_staff(current=Depends(get_current_user)):
    require_role(current, "owner")
    my_biz_ids = [
        b["business_id"]
        async for b in db.businesses.find(
            {"owner_id": current["user_id"]}, {"_id": 0, "business_id": 1}
        )
    ]
    return await db.staff.find(
        {"business_id": {"$in": my_biz_ids}}, {"_id": 0}
    ).to_list(200)


@router.post("/owner/staff")
async def add_staff(payload: StaffCreate, current=Depends(get_current_user)):
    require_role(current, "owner")
    biz = await db.businesses.find_one(
        {"business_id": payload.business_id, "owner_id": current["user_id"]}, {"_id": 0}
    )
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found for this owner")
    doc = {
        "staff_id": f"st_{uuid.uuid4().hex[:10]}",
        "business_id": payload.business_id,
        "name": payload.name,
        "role": payload.role,
        "created_at": datetime.now(timezone.utc),
    }
    await db.staff.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.delete("/owner/staff/{staff_id}")
async def delete_staff(staff_id: str, current=Depends(get_current_user)):
    require_role(current, "owner")
    my_biz_ids = [
        b["business_id"]
        async for b in db.businesses.find(
            {"owner_id": current["user_id"]}, {"_id": 0, "business_id": 1}
        )
    ]
    r = await db.staff.delete_one(
        {"staff_id": staff_id, "business_id": {"$in": my_biz_ids}}
    )
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Staff not found")
    return {"ok": True}


@router.get("/owner/analytics")
async def owner_analytics(current=Depends(get_current_user)):
    require_role(current, "owner")
    my_biz = await db.businesses.find(
        {"owner_id": current["user_id"]}, {"_id": 0}
    ).to_list(200)
    biz_ids = [b["business_id"] for b in my_biz]
    bookings = await db.bookings.find(
        {"business_id": {"$in": biz_ids}}, {"_id": 0}
    ).to_list(1000)
    counter = Counter([b.get("date", "") for b in bookings])
    days = sorted(counter.keys())[-14:]
    by_day = [{"date": d, "count": counter[d]} for d in days]
    by_biz = [
        {
            "name": b["name"],
            "bookings": sum(
                1 for x in bookings if x["business_id"] == b["business_id"]
            ),
        }
        for b in my_biz
    ]
    return {"by_day": by_day, "by_business": by_biz, "total": len(bookings)}
