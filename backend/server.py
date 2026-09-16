"""Explore91 backend — thin app entrypoint that composes routers & lifespan."""
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import db as core_db
from routes import admin, ai, auth, catalog, interactions, portal, reels, tickets
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
api.include_router(portal.router)
api.include_router(admin.router)
api.include_router(ai.router)
api.include_router(reels.router)
api.include_router(tickets.router)

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
