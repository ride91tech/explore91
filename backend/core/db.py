"""MongoDB client + database handle shared across the app."""
import asyncio
from typing import Any, Dict, Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from .config import DB_NAME, MONGO_URL

# Motor binds a client to the event loop it is created on, and using it from a
# different loop fails. Production runs a single loop, so this used to be one
# module-level client — but the test suite mounts the app in-process under
# several TestClient instances, each with its own loop, and the shared client
# then broke for whichever loop did not create it. That is why the Apple
# sign-in tests failed in serial mode and passed in parallel: whether they ran
# first on their worker decided which loop the client had bound to.
#
# Resolving the client per running loop fixes that without changing how any
# route uses `db`. In production there is one loop, so there is still exactly
# one client.
#
# Keyed by the loop object rather than id() so a collected loop cannot have its
# address reused by a new one. That keeps dead loops alive, which is bounded
# and harmless here: a handful in tests, exactly one in production.
_clients: Dict[Optional[Any], AsyncIOMotorClient] = {}


def _current_loop() -> Optional[Any]:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        # Called outside a running loop — only from synchronous setup.
        return None


def _database() -> AsyncIOMotorDatabase:
    loop = _current_loop()
    client = _clients.get(loop)
    if client is None:
        # Constructed while this loop is running, so Motor binds to it.
        client = AsyncIOMotorClient(MONGO_URL)
        _clients[loop] = client
    return client[DB_NAME]


class _DatabaseProxy:
    """Stands in for the database handle, resolving it per event loop.

    Every caller uses `db.<collection>`, so attribute access is the only hook
    needed. Item access is forwarded too, for collection names that are not
    valid Python identifiers.
    """

    def __getattr__(self, name: str) -> Any:
        return getattr(_database(), name)

    def __getitem__(self, name: str) -> Any:
        return _database()[name]

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<DatabaseProxy {DB_NAME!r} loops={len(_clients)}>"


db = _DatabaseProxy()

# Guard so ensure_indexes()/seed_data() run only once per Python process, even
# if the FastAPI app is remounted by another TestClient.
BOOTSTRAPPED = False
