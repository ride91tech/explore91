"""AI Concierge & Itinerary endpoints, talking to Anthropic's API directly."""
import json
import os
import re
from typing import List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.security import client_key, get_current_user, logger, rate_limit
from models import AIItineraryRequest, AIRecommendRequest

router = APIRouter()

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")


async def _ai_pick(system: str, user_prompt: str, session_id: str) -> str:
    """One completion from Anthropic. `session_id` is kept for call-site
    compatibility; these are single-turn prompts with no stored history."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="AI features aren't configured. Set ANTHROPIC_API_KEY.",
        )

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 1024,
                "system": system,
                "messages": [{"role": "user", "content": user_prompt}],
            },
        )

    if r.status_code != 200:
        logger.error("anthropic %s: %s", r.status_code, r.text[:300])
        raise HTTPException(status_code=502, detail="AI service temporarily unavailable")

    blocks = r.json().get("content", [])
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")


def _shortlist_for_ai(businesses: List[dict], limit: int = 30) -> List[dict]:
    return [
        {
            "id": b["business_id"],
            "name": b["name"],
            "category": b["category"],
            "city": b["city"],
            "tags": b.get("tags", []),
            "rating": b.get("rating", 0),
            "price": b.get("price_range", "$$"),
            "description": (b.get("description") or "")[:120],
        }
        for b in businesses[:limit]
    ]


@router.post("/ai/recommend")
async def ai_recommend(
    payload: AIRecommendRequest,
    request: Request,
    current=Depends(get_current_user),
):
    rate_limit("ai", client_key(request, current), limit=10, window_sec=60)
    city = (payload.city or current.get("home_city") or "Goa").lower()
    docs = (
        await db.businesses.find(
            {"city": city, "is_approved": {"$ne": False}}, {"_id": 0}
        )
        .sort("rating", -1).to_list(50)
    )
    catalog = _shortlist_for_ai(docs, 30)
    system = (
        "You are Explore91's expert local concierge for Indian cities. "
        "Given a shortlist of businesses, respond with EXACTLY a strict JSON array "
        "(no markdown, no prose) of 5 recommendations tailored to the user. "
        "Each item must be: "
        '{"id": "<business_id from list>", "reason": "<one crisp sentence, max 140 chars>"} .'
    )
    prompt = (
        f"User context — city: {city}; mood: {payload.mood or 'any'}; "
        f"budget: {payload.budget or 'any'}; party: {payload.party or 'any'}.\n\n"
        f"Available businesses (choose only from these ids):\n{catalog}"
    )
    try:
        raw = await _ai_pick(
            system, prompt, session_id=f"rec-{current['user_id']}"
        )
    except Exception:
        logger.exception("AI recommend failed")
        raise HTTPException(status_code=502, detail="AI service temporarily unavailable")

    txt = raw.strip()
    m = re.search(r"\[.*\]", txt, re.S)
    parsed = []
    if m:
        try:
            parsed = json.loads(m.group(0))
        except Exception:
            parsed = []
    id_to_biz = {b["business_id"]: b for b in docs}
    picks = []
    for item in parsed[:5]:
        bid = item.get("id")
        if bid in id_to_biz:
            picks.append({"business": id_to_biz[bid], "reason": item.get("reason", "")})
    # Fallback: top rated
    if not picks:
        for b in docs[:5]:
            picks.append({
                "business": b,
                "reason": f"Highly rated {b['category']} in {b['city'].title()}.",
            })
    return {"city": city, "picks": picks}


@router.post("/ai/itinerary")
async def ai_itinerary(
    payload: AIItineraryRequest,
    request: Request,
    current=Depends(get_current_user),
):
    rate_limit("ai", client_key(request, current), limit=10, window_sec=60)
    city = (payload.city or current.get("home_city") or "Goa").lower()
    days = max(1, min(payload.days, 5))
    docs = (
        await db.businesses.find(
            {"city": city, "is_approved": {"$ne": False}}, {"_id": 0}
        )
        .sort("rating", -1).to_list(80)
    )
    catalog = _shortlist_for_ai(docs, 60)
    system = (
        "You are Explore91's premier itinerary planner. "
        "Given a shortlist of businesses in an Indian city and user interests, "
        "plan a day-by-day itinerary. "
        "Respond with EXACTLY strict JSON of shape: "
        '{"title": "...", "summary": "...", "days": ['
        '{"day": 1, "theme": "...", "stops": [{"time": "09:00", "id": "<business_id>", "note": "..."}]} '
        "]} — no markdown, no prose outside the JSON. Include 4-5 stops per day mixing categories."
    )
    prompt = (
        f"Plan a {days}-day trip to {city.title()}. "
        f"User interests: {', '.join(payload.interests) if payload.interests else 'a bit of everything'}. "
        f"Available businesses (choose ONLY from these ids):\n{catalog}"
    )
    try:
        raw = await _ai_pick(
            system, prompt, session_id=f"itin-{current['user_id']}"
        )
    except Exception:
        logger.exception("AI itinerary failed")
        raise HTTPException(status_code=502, detail="AI service temporarily unavailable")

    txt = raw.strip()
    m = re.search(r"\{.*\}", txt, re.S)
    data: dict = {}
    if m:
        try:
            data = json.loads(m.group(0))
        except Exception:
            data = {}
    id_to_biz = {b["business_id"]: b for b in docs}
    for day in data.get("days", []):
        for stop in day.get("stops", []):
            biz = id_to_biz.get(stop.get("id"))
            if biz:
                stop["business"] = biz
    if not data.get("days"):
        picks_per_day = 4
        data = {
            "title": f"A curated {days}-day escape in {city.title()}",
            "summary": "Handpicked by Explore91's local editors.",
            "days": [],
        }
        for d in range(days):
            stops = []
            for i, b in enumerate(docs[d * picks_per_day:(d + 1) * picks_per_day]):
                stops.append({
                    "time": ["09:00", "13:00", "17:00", "20:00"][i % 4],
                    "id": b["business_id"],
                    "note": f"Explore this {b['category']} in {b['city'].title()}.",
                    "business": b,
                })
            data["days"].append({"day": d + 1, "theme": f"Day {d+1}", "stops": stops})
    return data
