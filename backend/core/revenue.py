"""What bookings are worth, counted the same way for admins and owners.

Moved out of routes/admin.py so the owner dashboard uses this rule too. It
used to show a hard-coded "demo" ₹50 per booking, cancelled ones included,
labelled "Estimated revenue", while the admin reports summed real amounts.
"""
from core.db import db

# Platform take rate applied to gross booking value.
TAKE_RATE = 0.05

# Cancelled bookings are kept for history but never counted as revenue.
BILLABLE = {"status": {"$ne": "cancelled"}}


async def booking_revenue(match: dict) -> dict:
    """Sum booked value, split by whether the amount is real or estimated.

    "confirmed" is a priced service line item; everything else is an
    estimate from the place's price band (see routes.interactions.booking_amount).
    """
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
