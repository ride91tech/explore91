"""Idempotent seed helpers for businesses and reels."""
import random
import uuid
from datetime import datetime, timedelta, timezone

from core.db import db
from core.security import logger
from .data import (
    CITY_COORDS,
    REEL_CAPTIONS,
    SAMPLE_IMAGES,
    SAMPLE_VIDEOS,
    SEED_BUSINESSES,
    img_for,
)


async def seed_reels() -> None:
    count = await db.reels.count_documents({})
    if count > 0:
        return
    businesses = await db.businesses.find({}, {"_id": 0}).to_list(200)
    if not businesses:
        return
    now = datetime.now(timezone.utc)
    docs = []
    visual_cats = {
        "restaurants", "cafes", "hotels", "resorts", "clubs", "bars",
        "spas", "salons", "events", "adventure", "tours",
    }
    pool = [b for b in businesses if b.get("category") in visual_cats] or businesses
    random.seed(91)
    for i in range(24):
        biz = pool[i % len(pool)]
        caption = REEL_CAPTIONS[i % len(REEL_CAPTIONS)]
        docs.append({
            "reel_id": f"rl_{uuid.uuid4().hex[:10]}",
            "business_id": biz["business_id"],
            "business_name": biz["name"],
            "business_category": biz["category"],
            "city": biz["city"],
            "video_url": SAMPLE_VIDEOS[i % len(SAMPLE_VIDEOS)],
            "cover_image": biz["cover_image"],
            "caption": caption,
            "author": biz["name"],
            "likes": random.randint(120, 4200),
            "views": random.randint(1500, 45000),
            "created_at": now - timedelta(days=random.randint(0, 20)),
        })
    await db.reels.insert_many(docs)
    logger.info("Seeded %s reels", len(docs))


async def seed_data() -> None:
    # Ensure all pre-existing seeded businesses have is_approved + owner_id
    await db.businesses.update_many(
        {"is_approved": {"$exists": False}},
        {"$set": {"is_approved": True, "owner_id": None}},
    )
    count = await db.businesses.count_documents({})
    if count > 0:
        logger.info("Seed skipped — %s businesses already present", count)
        await seed_reels()
        return
    docs = []
    for i, (
        name, cat, city, addr, rating, revs, price, tags, btype, desc,
    ) in enumerate(SEED_BUSINESSES):
        lat0, lng0 = CITY_COORDS.get(city, (0, 0))
        lat = lat0 + ((i % 10) - 5) * 0.01
        lng = lng0 + (((i * 7) % 10) - 5) * 0.01
        imgs = SAMPLE_IMAGES.get(cat, SAMPLE_IMAGES["services"])
        cover = img_for(cat, i)
        gallery = list(dict.fromkeys([cover] + imgs))[:5]
        offers = []
        if i % 3 == 0:
            offers.append("Flat 20% off on first booking")
        if i % 4 == 0:
            offers.append("Complimentary welcome drink")
        menu, services = [], []
        if cat in ("restaurants", "cafes", "bars"):
            menu = [
                {"name": "Chef's Signature Platter", "price": 1490, "image": imgs[0]},
                {"name": "Seasonal Small Plates", "price": 690},
                {"name": "House Cocktail", "price": 550},
                {"name": "Dessert Tasting Trio", "price": 490},
            ]
        elif cat in ("salons", "spas"):
            services = [
                {"name": "Signature Facial", "duration": "60 min", "price": 2200},
                {"name": "Deep Tissue Massage", "duration": "90 min", "price": 3200},
                {"name": "Hair Styling", "duration": "45 min", "price": 1200},
            ]
        elif cat in ("doctors", "dentists", "hospitals"):
            services = [
                {"name": "Consultation", "duration": "20 min", "price": 800},
                {"name": "Follow-up", "duration": "15 min", "price": 500},
            ]
        elif cat in ("gyms",):
            services = [
                {"name": "Day Pass", "duration": "1 day", "price": 500},
                {"name": "Personal Training", "duration": "60 min", "price": 1500},
            ]
        docs.append({
            "business_id": f"biz_{uuid.uuid4().hex[:10]}",
            "owner_id": None,
            "name": name,
            "category": cat,
            "city": city,
            "address": addr,
            "lat": lat,
            "lng": lng,
            "cover_image": cover,
            "gallery": gallery,
            "rating": rating,
            "review_count": revs,
            "price_range": price,
            "tags": tags,
            "description": desc,
            "open_hours": "10:00 AM - 11:00 PM",
            "phone": "+91 90000 00000",
            "is_verified": True,
            "is_featured": i % 5 == 0,
            "is_approved": True,
            "offers": offers,
            "menu": menu,
            "services": services,
            "booking_type": btype,
        })
    await db.businesses.insert_many(docs)
    logger.info("Seeded %s businesses", len(docs))
    await seed_reels()


async def ensure_indexes() -> None:
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("apple_sub", unique=True, sparse=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.businesses.create_index("business_id", unique=True)
    await db.businesses.create_index([("city", 1), ("category", 1)])
    await db.businesses.create_index("owner_id")
    await db.businesses.create_index("is_approved")
    await db.staff.create_index("business_id")
    await db.bookings.create_index("user_id")
    await db.bookings.create_index("business_id")
    await db.saved.create_index("user_id", unique=True)
    await db.reels.create_index("reel_id", unique=True)
    await db.reels.create_index([("city", 1), ("created_at", -1)])
    await db.reel_likes.create_index([("reel_id", 1), ("user_id", 1)], unique=True)
    await db.banners.create_index("banner_id", unique=True)
    await db.banners.create_index([("position", 1), ("sort_order", 1)])
    await db.categories_cms.create_index("slug", unique=True)
    await db.cities_cms.create_index("slug", unique=True)
    await db.tickets.create_index("ticket_id", unique=True)
    await db.tickets.create_index("user_id")
    await db.tickets.create_index("status")
    await db.fraud_flags.create_index("flag_id", unique=True)
    await db.fraud_flags.create_index("status")
