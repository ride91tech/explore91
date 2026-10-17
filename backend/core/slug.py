"""Readable, stable URL slugs for public pages."""
import re
import unicodedata
from typing import Callable, Optional

# Trimmed so a slug stays readable in a WhatsApp preview and well under the
# ~2000-character practical URL limit even with a long business name.
MAX_SLUG_LEN = 80

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def slugify(*parts: Optional[str]) -> str:
    """Turn text into a URL slug.

    Accents are folded rather than dropped, so "Café Bodega" becomes
    "cafe-bodega" instead of "caf-bodega". Devanagari and other non-Latin
    scripts fold to nothing, so callers must handle an empty result — see
    `unique_slug`, which falls back to an id.
    """
    joined = " ".join(p for p in parts if p)
    folded = unicodedata.normalize("NFKD", joined)
    ascii_only = folded.encode("ascii", "ignore").decode("ascii").lower()
    return _NON_ALNUM.sub("-", ascii_only).strip("-")[:MAX_SLUG_LEN].strip("-")


async def unique_slug(
    *parts: Optional[str],
    exists: Callable,
    fallback: str,
) -> str:
    """A slug nothing else is using.

    `exists` is an async predicate taking a candidate slug. Collisions get a
    numeric suffix rather than a hash, because "casa-sarita-goa-2" still tells
    a human what they are looking at.

    A name that folds away to nothing — an all-Devanagari title, say — falls
    back to the supplied id so the page is still addressable.
    """
    base = slugify(*parts) or slugify(fallback) or "place"

    candidate = base
    suffix = 2
    while await exists(candidate):
        # Keep the whole thing within MAX_SLUG_LEN once the suffix is added.
        tail = f"-{suffix}"
        candidate = f"{base[: MAX_SLUG_LEN - len(tail)].strip('-')}{tail}"
        suffix += 1
    return candidate


async def ensure_business_slug(business: dict) -> Optional[str]:
    """Return a business's slug, assigning one if it has none.

    Every business gets a slug at creation and the boot-time backfill covers
    older rows, but a document can still turn up without one — inserted by a
    migration, or created while a backfill was mid-run. Anything that
    denormalises the slug (reels, so a shared reel has somewhere to point)
    would otherwise quietly produce an unshareable record, and the only
    symptom is a share button that sends bare text.

    Imported here rather than at module scope to keep this module importable
    without a database.
    """
    from .db import db

    existing = business.get("slug")
    if existing:
        return existing

    business_id = business.get("business_id")
    if not business_id:
        return None

    async def taken(candidate: str) -> bool:
        return await db.businesses.count_documents({"slug": candidate}, limit=1) > 0

    slug = await unique_slug(
        business.get("name"), business.get("city"),
        exists=taken, fallback=business_id,
    )
    await db.businesses.update_one(
        {"business_id": business_id}, {"$set": {"slug": slug}}
    )
    return slug
