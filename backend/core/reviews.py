"""A place's rating comes from its stored reviews, one per person.

`rating` and `review_count` on a business used to be written once, when the
place was created or seeded, and never again. Seeded places showed numbers
like "4.8 from 342 reviews" with none of those reviews stored, and an
owner's new place stayed at 0.0 however it was reviewed, while search order,
trending and the owner dashboard all read those fields.

Now every review write recomputes the place from its reviews, and the boot
reconcile brings existing data into line: repeat reviews are cut to each
person's newest, the (business, user) unique index goes on, and every place
is recomputed. Places with no reviews show 0.0 from 0.
"""
from typing import Any, Optional

from core.db import db as _default_db

REVIEW_UNIQUE_INDEX = "business_user_unique"


def _rounded(avg: Optional[float]) -> float:
    return round(float(avg), 1) if avg is not None else 0.0


async def refresh_rating(business_id: str, database: Any = None) -> None:
    """Recompute one place's rating and review_count from its reviews."""
    database = database if database is not None else _default_db
    stats = await database.reviews.aggregate([
        {"$match": {"business_id": business_id}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "n": {"$sum": 1}}},
    ]).to_list(1)
    avg, n = (stats[0]["avg"], stats[0]["n"]) if stats else (None, 0)
    await database.businesses.update_one(
        {"business_id": business_id},
        {"$set": {"rating": _rounded(avg), "review_count": n}},
    )


async def reconcile_reviews(database: Any = None) -> None:
    """Boot-time repair. Idempotent, and safe on several instances at once.

    1. Keep only each person's newest review of a place. "Post again to
       replace" is the rule now; older duplicates predate it.
    2. Enforce that with a unique (business_id, user_id) index.
    3. Recompute every place's rating and review_count from its reviews.
    """
    database = database if database is not None else _default_db

    repeats = await database.reviews.aggregate([
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": {"b": "$business_id", "u": "$user_id"}, "ids": {"$push": "$_id"}}},
        {"$match": {"ids.1": {"$exists": True}}},
    ]).to_list(None)
    stale = [oid for group in repeats for oid in group["ids"][1:]]
    if stale:
        await database.reviews.delete_many({"_id": {"$in": stale}})

    await database.reviews.create_index(
        [("business_id", 1), ("user_id", 1)], unique=True, name=REVIEW_UNIQUE_INDEX
    )

    stats = await database.reviews.aggregate([
        {"$group": {"_id": "$business_id", "avg": {"$avg": "$rating"}, "n": {"$sum": 1}}},
    ]).to_list(None)
    reviewed = [s["_id"] for s in stats]
    await database.businesses.update_many(
        {"business_id": {"$nin": reviewed}},
        {"$set": {"rating": 0.0, "review_count": 0}},
    )
    for s in stats:
        await database.businesses.update_one(
            {"business_id": s["_id"]},
            {"$set": {"rating": _rounded(s["avg"]), "review_count": s["n"]}},
        )
