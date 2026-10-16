"""Application configuration loaded from environment variables."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

# OAuth client IDs that may sign in to this app. One per platform, from the
# Google Cloud console. A token minted for any other client is rejected, which
# is what stops someone replaying a Google token from an unrelated app.
GOOGLE_CLIENT_IDS = {
    c.strip()
    for c in (os.environ.get("GOOGLE_CLIENT_IDS", "") or "").split(",")
    if c.strip()
}
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
