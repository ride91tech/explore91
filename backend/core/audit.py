"""Append-only audit trail for admin actions."""
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from .db import db

# Arrays/blobs that would bloat an audit row without helping an investigation.
_SKIP_KEYS = {"gallery", "menu", "services", "offers", "tags", "description"}
_MAX_STR = 200


def snapshot(doc: Optional[Any]) -> Optional[Any]:
    """Trim a document down to something worth keeping in an audit row."""
    if not isinstance(doc, dict):
        return doc
    out = {}
    for key, value in doc.items():
        if key in _SKIP_KEYS or key == "_id":
            continue
        if isinstance(value, str) and len(value) > _MAX_STR:
            value = value[:_MAX_STR] + "…"
        out[key] = value
    return out


async def record(
    actor: dict,
    action: str,
    entity_type: str,
    entity_id: str,
    before: Optional[Any] = None,
    after: Optional[Any] = None,
    note: str = "",
) -> None:
    """Write one audit entry. Never raises — auditing must not break the action."""
    try:
        await db.admin_audit.insert_one({
            "audit_id": f"au_{uuid.uuid4().hex[:12]}",
            "actor_id": actor.get("user_id"),
            "actor_email": actor.get("email"),
            "actor_name": actor.get("name"),
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "before": snapshot(before),
            "after": snapshot(after),
            "note": note,
            "created_at": datetime.now(timezone.utc),
        })
    except Exception:  # pragma: no cover - audit must never block the caller
        import logging
        logging.getLogger("explore91").exception("audit write failed: %s %s", action, entity_id)
