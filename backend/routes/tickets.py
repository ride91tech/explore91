"""End-user support tickets (create + list own)."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request

from core.db import db
from core.security import client_key, get_current_user, rate_limit
from models import TicketCreate

router = APIRouter()


@router.post("/tickets")
async def create_ticket(
    payload: TicketCreate,
    request: Request,
    current=Depends(get_current_user),
):
    rate_limit("ticket", client_key(request, current), limit=5, window_sec=60)
    doc = {
        "ticket_id": f"tk_{uuid.uuid4().hex[:10]}",
        "user_id": current["user_id"],
        "user_name": current["name"],
        "user_email": current["email"],
        "subject": payload.subject.strip(),
        "message": payload.message.strip(),
        "status": "open",
        "admin_reply": None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.tickets.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/tickets/mine")
async def list_my_tickets(current=Depends(get_current_user)):
    return (
        await db.tickets.find({"user_id": current["user_id"]}, {"_id": 0})
        .sort("created_at", -1).to_list(100)
    )
