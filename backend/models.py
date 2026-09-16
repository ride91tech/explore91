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


class SessionRequest(BaseModel):
    session_id: str


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
    name: str
    category: str
    city: str
    address: str
    lat: float
    lng: float
    cover_image: str
    gallery: List[str] = []
    rating: float = 0.0
    review_count: int = 0
    price_range: str = "$$"
    tags: List[str] = []
    description: str = ""
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
    description: str = ""
    cover_image: Optional[str] = None
    price_range: str = "$$"
    tags: List[str] = []
    booking_type: str = "reservation"


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
    created_at: datetime


class SavedToggle(BaseModel):
    business_id: str


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


class CityUpsert(BaseModel):
    slug: str = Field(pattern="^[a-z0-9-]{2,32}$")
    name: str = Field(min_length=1, max_length=48)
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
