"""Application configuration loaded from environment variables."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

EMERGENT_AUTH_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"
APPLE_AUDIENCES = {
    a.strip()
    for a in (os.environ.get("APPLE_AUDIENCES", "") or "").split(",")
    if a.strip()
}
SESSION_TTL_DAYS = 7

# Emails allowed to self-grant "admin" role via /auth/roles.
ADMIN_EMAILS = {
    e.strip().lower()
    for e in (os.environ.get("ADMIN_EMAILS", "") or "").split(",")
    if e.strip()
}

# Browser origins allowed to call the API. Native apps don't send an Origin
# header and are unaffected; this only governs the web admin console.
# Unset means "*", which is fine locally but must be set on a public deploy.
ALLOWED_ORIGINS = [
    o.strip()
    for o in (os.environ.get("ALLOWED_ORIGINS", "") or "").split(",")
    if o.strip()
] or ["*"]
