"""Application configuration loaded from environment variables."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"
APPLE_AUDIENCES = {
    a.strip()
    for a in (os.environ.get("APPLE_AUDIENCES", "") or "").split(",")
    if a.strip()
}
SESSION_TTL_DAYS = 7


def dev_auth_enabled() -> bool:
    """Whether /auth/dev will mint a session.

    /auth/dev is a placeholder standing in for Google Sign-In until OTP
    lands. It takes an email and nothing else, so anything that can reach it
    can sign in as anybody -- including an address in ADMIN_EMAILS, which can
    then self-grant admin through /auth/roles. It is a complete
    authentication bypass by design.

    So it is off unless this is explicitly set, and the route answers 404
    rather than advertising itself. Read from the environment on every call,
    not captured at import, so a test can switch it without reloading the
    module -- and so nobody can leave it on by having imported this early.

    Never set DEV_AUTH_ENABLED on the production service.
    """
    return (os.environ.get("DEV_AUTH_ENABLED", "") or "").strip().lower() in {
        "1", "true", "yes", "on",
    }

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


# --- Deep links -----------------------------------------------------------
# Serving /.well-known/assetlinks.json and apple-app-site-association is what
# lets a tapped https://explore91.com/place/... open the app instead of a
# browser tab. Both files are public by design; the values below are app
# identifiers and certificate fingerprints, not secrets.

ANDROID_PACKAGE = os.environ.get("ANDROID_PACKAGE", "com.explore91.app")

# SHA-256 of every certificate that signs a build which should claim these
# links. One per distribution channel, because each signs with a different
# key: debug, your upload keystore, and — once you ship through Play — the
# App signing key Google re-signs with, which you take from
# Play Console > Setup > App integrity. Omitting that last one is the usual
# reason links work in a sideloaded build and stop working after release.
ANDROID_CERT_FINGERPRINTS = [
    f.strip().upper()
    for f in (os.environ.get("ANDROID_CERT_FINGERPRINTS", "") or "").split(",")
    if f.strip()
]

# "<TeamID>.<bundleId>", e.g. ABCDE12345.com.explore91.app. Unset until there
# is an Apple developer account; the association file is withheld rather than
# served with a placeholder, because a wrong appID silently breaks the link
# and iOS caches the file.
IOS_APP_ID = os.environ.get("IOS_APP_ID", "").strip()

# Paths the app claims. Anything outside this list stays in the browser —
# /admin and /owner deliberately so.
DEEP_LINK_PATHS = ["/place/*", "/city/*"]
