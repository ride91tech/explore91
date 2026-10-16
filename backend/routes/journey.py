"""Journey tracking: which cities and states a traveller has explored.

This is the mechanic the Explore91 site leads with — cities visited, states
visited, and a percentage of the country covered.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_user
from models import JourneyMark
from seed.data import (
    CITIES,
    INDIA_STATES,
    INDIA_STATE_COUNT,
    INDIA_UNION_TERRITORIES,
    INDIA_UT_COUNT,
)

router = APIRouter()


async def _known_cities() -> dict:
    """Seed cities plus any added through the admin CMS, keyed by slug."""
    custom = await db.cities_cms.find({}, {"_id": 0}).to_list(200)
    known = {c["slug"]: c for c in CITIES}
    known.update({c["slug"]: c for c in custom})
    return known


def _state_of(city: dict) -> str:
    return city.get("state") or city.get("region") or ""


@router.get("/journey")
async def get_journey(current=Depends(get_current_user)):
    """The traveller's coverage so far."""
    cities = await _known_cities()
    visits = await db.journey_visits.find(
        {"user_id": current["user_id"]}, {"_id": 0}
    ).sort("visited_at", -1).to_list(500)

    # Only count visits to cities that still exist; a removed city shouldn't
    # inflate the total.
    live = [v for v in visits if v["city_slug"] in cities]
    regions = {_state_of(cities[v["city_slug"]]) for v in live}
    regions.discard("")

    # States and union territories are counted apart. The percentage is over
    # the 28 states, matching explore91.com, which means a UT-only trip reads
    # as 0% -- so UT coverage is surfaced in its own right instead of being
    # folded in and quietly distorting the figure.
    states = regions & INDIA_STATES
    territories = regions & INDIA_UNION_TERRITORIES

    return {
        "cities": len(live),
        "states": len(states),
        # Truncated, not rounded: one state of 28 reads as 3%, as on the site.
        "india_percent": int(len(states) / INDIA_STATE_COUNT * 100),
        "states_total": INDIA_STATE_COUNT,
        "union_territories": len(territories),
        "union_territories_total": INDIA_UT_COUNT,
        "visited": [
            {
                "city_slug": v["city_slug"],
                "name": cities[v["city_slug"]]["name"],
                "state": _state_of(cities[v["city_slug"]]),
                "visited_at": v["visited_at"],
            }
            for v in live
        ],
    }


@router.post("/journey/visit")
async def mark_visited(payload: JourneyMark, current=Depends(get_current_user)):
    """Mark a city explored. Idempotent — re-marking keeps the first date."""
    cities = await _known_cities()
    if payload.city_slug not in cities:
        raise HTTPException(status_code=404, detail="Unknown city")

    await db.journey_visits.update_one(
        {"user_id": current["user_id"], "city_slug": payload.city_slug},
        {"$setOnInsert": {"visited_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return await get_journey(current)


@router.delete("/journey/visit/{city_slug}")
async def unmark_visited(city_slug: str, current=Depends(get_current_user)):
    r = await db.journey_visits.delete_one(
        {"user_id": current["user_id"], "city_slug": city_slug}
    )
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="That city isn't marked as visited")
    return await get_journey(current)
