"""Pydantic models for every domain (auth, catalog, bookings, reels, CMS)."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from core.security import ALLOWED_URL


# --- Auth / user -----------------------------------------------------------
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    wallet_points: int = 0
    home_city: str = "Goa"
    roles: List[str] = Field(default_factory=lambda: ["customer"])
    apple_sub: Optional[str] = None
    created_at: datetime


class DevSignIn(BaseModel):
    """Body for /auth/dev -- the placeholder standing in for Google Sign-In.

    The pattern is a deliberately loose email shape, not full RFC validation:
    pydantic's EmailStr would pull in email-validator, and CI checks that the
    runtime requirements install the app on their own. It only has to reject
    obvious nonsense, since the address is not verified anyway.
    """

    email: str = Field(
        min_length=3,
        max_length=254,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    )
    name: Optional[str] = Field(default=None, max_length=120)

    @field_validator("email", "name", mode="before")
    @classmethod
    def _trim(cls, v):
        """Strip before the pattern runs.

        Field patterns are checked after before-validators, so without this a
        trailing space -- which a phone keyboard adds readily -- fails
        validation instead of being tidied up.
        """
        return v.strip() if isinstance(v, str) else v


class AuthResponse(BaseModel):
    session_token: str
    user: User


class AppleSignInRequest(BaseModel):
    identity_token: str = Field(min_length=8, max_length=4096)
    email: Optional[str] = Field(default=None, max_length=254)
    full_name: Optional[str] = Field(default=None, max_length=120)


class RoleUpgrade(BaseModel):
    role: str = Field(pattern="^(customer|owner|admin)$")


# --- Catalog ---------------------------------------------------------------
class Business(BaseModel):
    business_id: str
    # Public URL slug, e.g. /place/casa-sarita-goa. Optional on the model
    # because a document is briefly slug-less between insert and backfill.
    slug: Optional[str] = None
    name: str
    category: str
    city: str
    address: str
    # Broader area label shown above the name ("North Goa"), as on the site.
    # Optional: falls back to `address`, which is already area-ish in the seed.
    area: Optional[str] = None
    lat: float
    lng: float
    cover_image: str
    gallery: List[str] = []
    rating: float = 0.0
    review_count: int = 0
    price_range: str = "$$"
    tags: List[str] = []
    description: str = ""
    # The site's "WHY GO" line — one evocative reason, distinct from the
    # factual description. Optional; the UI falls back to `description`.
    why_go: Optional[str] = None
    open_hours: str = "10:00 AM - 11:00 PM"
    phone: str = ""
    is_verified: bool = True
    is_featured: bool = False
    offers: List[str] = []
    menu: List[dict] = []
    services: List[dict] = []
    booking_type: str = "reservation"


class BusinessCreate(BaseModel):
    name: str
    category: str
    city: str
    address: str
    area: Optional[str] = Field(default=None, max_length=80)
    description: str = ""
    why_go: Optional[str] = Field(default=None, max_length=280)
    cover_image: Optional[str] = None
    price_range: str = "$$"
    tags: List[str] = []
    booking_type: str = "reservation"


class AdminBusinessCreate(BusinessCreate):
    """A place created by an admin rather than claimed by its owner.

    Separate from BusinessCreate because an admin is curating the catalogue,
    not registering their own venue, and so gets fields an owner does not:

      * `is_approved` defaults True — an admin approving their own entry a
        moment after creating it is ceremony, not review.
      * `owner_id` stays empty. The place is unclaimed, which is honest: an
        owner can claim it later and the audit trail shows who seeded it.
      * Coordinates are accepted, because seeding a city means placing pins on
        a map, and falling back to the city centroid for every venue makes the
        map useless.
    """

    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    phone: str = Field(default="", max_length=32)
    open_hours: str = Field(default="10:00 AM - 11:00 PM", max_length=80)
    gallery: List[str] = Field(default_factory=list, max_length=12)
    is_approved: bool = True
    is_featured: bool = False

    @field_validator("cover_image")
    @classmethod
    def _cover_https(cls, v: Optional[str]):
        if v and not ALLOWED_URL.match(v):
            raise ValueError("Must be an https:// URL")
        return v

    @field_validator("gallery")
    @classmethod
    def _gallery_https(cls, v: List[str]):
        for url in v:
            if not ALLOWED_URL.match(url):
                raise ValueError("Every gallery image must be an https:// URL")
        return v


class AdminBusinessUpdate(BaseModel):
    """A partial edit. Every field optional; only what is sent is written.

    Deliberately does not accept `city` or `category` as free text without the
    same normalisation the create path applies — see the route, which lowercases
    both. Nor does it accept `slug`: slugs are permanent public URLs, and
    letting them be edited silently breaks every link already shared.
    """

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    category: Optional[str] = Field(default=None, max_length=40)
    city: Optional[str] = Field(default=None, max_length=40)
    address: Optional[str] = Field(default=None, max_length=200)
    area: Optional[str] = Field(default=None, max_length=80)
    description: Optional[str] = Field(default=None, max_length=2000)
    why_go: Optional[str] = Field(default=None, max_length=280)
    cover_image: Optional[str] = Field(default=None, max_length=500)
    gallery: Optional[List[str]] = Field(default=None, max_length=12)
    price_range: Optional[str] = Field(default=None, max_length=8)
    tags: Optional[List[str]] = Field(default=None, max_length=12)
    phone: Optional[str] = Field(default=None, max_length=32)
    open_hours: Optional[str] = Field(default=None, max_length=80)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    booking_type: Optional[str] = Field(default=None, max_length=24)
    is_approved: Optional[bool] = None
    is_featured: Optional[bool] = None
    is_verified: Optional[bool] = None

    @field_validator("cover_image")
    @classmethod
    def _cover_https(cls, v: Optional[str]):
        if v and not ALLOWED_URL.match(v):
            raise ValueError("Must be an https:// URL")
        return v

    @field_validator("gallery")
    @classmethod
    def _gallery_https(cls, v: Optional[List[str]]):
        for url in v or []:
            if not ALLOWED_URL.match(url):
                raise ValueError("Every gallery image must be an https:// URL")
        return v


class AdminReelCreate(BaseModel):
    """A reel created by an admin.

    Unlike ReelCreate, `business_id` is optional: a city reel that is not of
    any one venue is a legitimate thing to publish while seeding a city, and
    forcing a venue onto it would be inventing an association.
    """

    business_id: Optional[str] = Field(default=None, max_length=64)
    city: str = Field(min_length=1, max_length=40)
    video_url: str = Field(min_length=8, max_length=500)
    cover_image: Optional[str] = Field(default=None, max_length=500)
    caption: str = Field(min_length=1, max_length=280)
    author: str = Field(default="Explore91", max_length=60)

    @field_validator("video_url", "cover_image")
    @classmethod
    def _valid_https(cls, v: Optional[str]):
        if v is None or v == "":
            return v
        if not ALLOWED_URL.match(v):
            raise ValueError("Must be an https:// URL")
        return v


class AdminReelUpdate(BaseModel):
    caption: Optional[str] = Field(default=None, min_length=1, max_length=280)
    cover_image: Optional[str] = Field(default=None, max_length=500)
    video_url: Optional[str] = Field(default=None, max_length=500)
    author: Optional[str] = Field(default=None, max_length=60)
    business_id: Optional[str] = Field(default=None, max_length=64)
    is_hidden: Optional[bool] = None

    @field_validator("video_url", "cover_image")
    @classmethod
    def _valid_https(cls, v: Optional[str]):
        if v is None or v == "":
            return v
        if not ALLOWED_URL.match(v):
            raise ValueError("Must be an https:// URL")
        return v


# --- Bookings & interactions ----------------------------------------------
class BookingCreate(BaseModel):
    business_id: str = Field(min_length=1, max_length=64)
    date: str = Field(min_length=8, max_length=16)
    time: str = Field(min_length=3, max_length=8)
    guests: int = Field(default=2, ge=1, le=50)
    notes: Optional[str] = Field(default="", max_length=500)
    service_name: Optional[str] = Field(default=None, max_length=120)


class Booking(BaseModel):
    booking_id: str
    user_id: str
    business_id: str
    business_name: str
    business_image: str
    date: str
    time: str
    guests: int
    service_name: Optional[str] = None
    status: str = "confirmed"
    notes: Optional[str] = ""
    # Money is snapshotted at booking time so later price edits don't rewrite history.
    amount_inr: int = 0
    # "service" = matched a real priced item; "estimate" = derived from price_range.
    amount_source: str = "estimate"
    created_at: datetime


class SavedToggle(BaseModel):
    business_id: str


class JourneyMark(BaseModel):
    city_slug: str = Field(pattern="^[a-z0-9-]{2,32}$")


class PlaceInterestSet(BaseModel):
    """Interested / Going / Visited — what sits where a booking button would."""
    status: str = Field(pattern="^(interested|going|visited)$")


class Review(BaseModel):
    review_id: str
    user_id: str
    user_name: str
    business_id: str
    rating: int
    comment: str
    created_at: datetime


class ReviewCreate(BaseModel):
    business_id: str = Field(min_length=1, max_length=64)
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=1, max_length=1000)


# --- Owner portal ---------------------------------------------------------
class StaffCreate(BaseModel):
    name: str
    role: str
    business_id: str


# --- Admin: CMS ------------------------------------------------------------
class CategoryUpsert(BaseModel):
    slug: str = Field(pattern="^[a-z0-9-]{2,32}$")
    name: str = Field(min_length=1, max_length=48)
    icon: str = Field(min_length=1, max_length=48)
    is_active: bool = True


class CategoryToggle(BaseModel):
    """Enable or disable a category.

    Disabling takes the category out of the app's filters without touching the
    places tagged with it. Deleting was the only control before, and it refuses
    outright on the twenty-four built-in categories — so a seasonal or mistaken
    category could never be taken down, only added to.
    """

    is_active: bool


class CityUpsert(BaseModel):
    slug: str = Field(pattern="^[a-z0-9-]{2,32}$")
    name: str = Field(min_length=1, max_length=48)
    # Canonical state/UT — counted by the journey tracker.
    state: str = Field(min_length=1, max_length=48)
    # Label shown above the city in the picker; defaults to the state.
    region: Optional[str] = Field(default=None, max_length=48)
    tagline: str = Field(min_length=1, max_length=140)
    image: str = Field(min_length=8, max_length=500)

    @field_validator("image")
    @classmethod
    def _valid_https(cls, v: str):
        if not ALLOWED_URL.match(v):
            raise ValueError("Must be an https:// URL")
        return v


class BannerUpsert(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    subtitle: Optional[str] = Field(default="", max_length=160)
    image: str = Field(min_length=8, max_length=500)
    link_url: Optional[str] = Field(default=None, max_length=500)
    city: Optional[str] = Field(default=None, max_length=32)
    position: str = Field(default="home_hero", max_length=32)
    is_active: bool = True
    sort_order: int = Field(default=0, ge=-100, le=100)

    @field_validator("image", "link_url")
    @classmethod
    def _valid_https(cls, v):
        if v is None or v == "":
            return v
        if not ALLOWED_URL.match(v):
            raise ValueError("Must be an https:// URL")
        return v


class BannerUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=80)
    subtitle: Optional[str] = Field(default=None, max_length=160)
    image: Optional[str] = Field(default=None, min_length=8, max_length=500)
    link_url: Optional[str] = Field(default=None, max_length=500)
    city: Optional[str] = Field(default=None, max_length=32)
    position: Optional[str] = Field(default=None, max_length=32)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=-100, le=100)

    @field_validator("image", "link_url")
    @classmethod
    def _valid_https(cls, v):
        if v is None or v == "":
            return v
        if not ALLOWED_URL.match(v):
            raise ValueError("Must be an https:// URL")
        return v


# --- Tickets & fraud flags -------------------------------------------------
class TicketCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=140)
    message: str = Field(min_length=1, max_length=2000)


class TicketUpdate(BaseModel):
    status: Optional[str] = Field(default=None, pattern="^(open|pending|resolved)$")
    admin_reply: Optional[str] = Field(default=None, max_length=2000)


class FraudFlagCreate(BaseModel):
    entity_type: str = Field(pattern="^(user|business|booking|review|reel)$")
    entity_id: str = Field(min_length=1, max_length=64)
    reason: str = Field(min_length=1, max_length=280)


# --- AI --------------------------------------------------------------------
class AIRecommendRequest(BaseModel):
    mood: Optional[str] = None
    budget: Optional[str] = None
    party: Optional[str] = None
    city: Optional[str] = None


class AIItineraryRequest(BaseModel):
    city: Optional[str] = None
    days: int = 2
    interests: List[str] = []


# --- Reels -----------------------------------------------------------------
class Reel(BaseModel):
    reel_id: str
    business_id: Optional[str] = None
    business_name: Optional[str] = None
    # Slug of the place this reel is of — what a shared reel links to, since
    # reels have no public page of their own.
    business_slug: Optional[str] = None
    business_category: Optional[str] = None
    city: str
    video_url: str
    cover_image: str
    caption: str
    author: str
    likes: int = 0
    views: int = 0
    created_at: datetime


class ReelLikeToggle(BaseModel):
    reel_id: str


class ReelCreate(BaseModel):
    business_id: str = Field(min_length=1, max_length=64)
    video_url: str = Field(min_length=8, max_length=500)
    caption: str = Field(min_length=1, max_length=280)
    cover_image: Optional[str] = Field(default=None, max_length=500)

    @field_validator("video_url", "cover_image")
    @classmethod
    def _valid_https(cls, v: Optional[str]):
        if v is None or v == "":
            return v
        if not ALLOWED_URL.match(v):
            raise ValueError("Must be an https:// URL")
        return v
