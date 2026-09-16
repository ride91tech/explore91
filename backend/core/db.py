"""MongoDB client + database handle shared across the app."""
from motor.motor_asyncio import AsyncIOMotorClient

from .config import DB_NAME, MONGO_URL

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# Guard so ensure_indexes()/seed_data() run only once per Python process,
# even if the FastAPI app is remounted (multiple TestClient contexts in one
# pytest session share this same motor client and its event loop binding).
BOOTSTRAPPED = False
