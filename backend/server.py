"""Explore91 backend — thin app entrypoint that composes routers & lifespan."""
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import db as core_db
from core.config import ALLOWED_ORIGINS
from routes import (
    admin, ai, auth, catalog, interactions, journey, places, portal, reels,
    tickets,
)
from seed.seed import ensure_indexes, seed_data

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Run indexes + seed exactly once per process, since motor binds to the
    # first event loop it sees. Subsequent TestClient remounts skip startup.
    if not core_db.BOOTSTRAPPED:
        await ensure_indexes()
        await seed_data()
        core_db.BOOTSTRAPPED = True
    yield
    # Shutdown — do NOT close the client; it is shared across app instances.


app = FastAPI(title="Explore91 API", lifespan=lifespan)

api = APIRouter(prefix="/api")
api.include_router(auth.router)
api.include_router(catalog.router)
api.include_router(interactions.router)
api.include_router(journey.router)
api.include_router(places.router)
api.include_router(portal.router)
api.include_router(admin.router)
api.include_router(ai.router)
api.include_router(reels.router)
api.include_router(tickets.router)

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    # allow_credentials with "*" is rejected by browsers anyway; auth here is a
    # bearer token, not a cookie, so credentials aren't needed.
    allow_credentials=ALLOWED_ORIGINS != ["*"],
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    # Pagination totals are unreadable from JS without this.
    expose_headers=["X-Total-Count"],
)

if ALLOWED_ORIGINS == ["*"]:
    logging.getLogger("explore91").warning(
        "CORS is open to all origins. Set ALLOWED_ORIGINS before exposing this publicly."
    )
