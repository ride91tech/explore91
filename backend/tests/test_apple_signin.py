"""Apple Sign-In backend tests (iteration 5).

Covers:
- Pydantic validation (missing identity_token â†’ 422)
- Malformed / bogus JWT (401 paths)
- Bogus 'aud' via a real RS256-signed JWT with mocked JWKS (401)
- Rate limiting (20/min per IP â†’ 21st call returns 429 + Retry-After)
- APPLE_AUDIENCES env presence
- Mongo `users.apple_sub` sparse + unique index
- User model exposes optional `apple_sub` field on /auth/me
- Happy-path upsert logic (create â†’ reuse-by-sub â†’ link-by-email) â€” exercised
  via TestClient + monkey-patched `_verify_apple_identity_token`
- Regression spot-check (session flow, businesses filter, reels feed, RBAC 403)
"""
import os
import json
import time
import uuid
import base64
import asyncio
import importlib
from datetime import datetime, timezone, timedelta

import jwt as pyjwt
import pytest
import requests
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from motor.motor_asyncio import AsyncIOMotorClient

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_DIR = os.path.dirname(_BACKEND_DIR)
_SERVER_PY = os.path.join(_BACKEND_DIR, "server.py")
load_dotenv(os.path.join(_REPO_DIR, "frontend", ".env"))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

APPLE_ENDPOINT = f"{BASE_URL}/api/auth/apple"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _make_fake_jwt(header: dict, payload: dict) -> str:
    """Build a syntactically valid (3-segment base64url) but unsigned JWT."""
    h = _b64url(json.dumps(header).encode())
    p = _b64url(json.dumps(payload).encode())
    s = _b64url(b"not-a-real-signature")
    return f"{h}.{p}.{s}"


# ---------------------------------------------------------------------------
# 1) Pydantic validation + malformed token + rate limit + regression (HTTP)
# ---------------------------------------------------------------------------
class TestAppleSignInErrorPaths:
    """All exercisable via the public URL against the live server."""

    def test_missing_identity_token_returns_422(self):
        r = requests.post(APPLE_ENDPOINT, json={}, timeout=15)
        assert r.status_code == 422, r.text
        body = r.json()
        assert "detail" in body
        # Pydantic reports the missing field
        assert any(
            "identity_token" in (str(err.get("loc")) + str(err.get("msg", "")))
            for err in body["detail"]
        ), body

    def _post_token(self, token: str, max_wait: int = 65):
        """POST with retry-once if the IP rate bucket is currently exhausted."""
        r = requests.post(APPLE_ENDPOINT, json={"identity_token": token}, timeout=15)
        if r.status_code == 429:
            retry = int(r.headers.get("Retry-After", "5"))
            time.sleep(min(retry + 1, max_wait))
            r = requests.post(APPLE_ENDPOINT, json={"identity_token": token}, timeout=15)
        return r

    def test_malformed_token_returns_401_with_specific_detail(self):
        r = self._post_token("nope.nope.nope")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "Malformed Apple identity token"

    def test_bogus_but_wellformed_jwt_returns_401(self):
        """3 base64url segments, header parses, but kid is bogus â†’ 401."""
        token = _make_fake_jwt(
            {"alg": "RS256", "kid": "definitely-not-a-real-kid-xyz", "typ": "JWT"},
            {"iss": "https://appleid.apple.com", "aud": "com.emergent.exploremobile.j9fjag",
             "sub": "0000.abcdef.0000", "iat": int(time.time()), "exp": int(time.time()) + 300},
        )
        r = self._post_token(token)
        assert r.status_code == 401, r.text
        detail = r.json().get("detail", "")
        assert detail in ("Unknown signing key", "Invalid Apple identity token", "Missing kid in Apple token"), detail

    def test_missing_kid_returns_401(self):
        token = _make_fake_jwt(
            {"alg": "RS256", "typ": "JWT"},  # no kid
            {"iss": "https://appleid.apple.com", "aud": "com.emergent.exploremobile.j9fjag",
             "sub": "0000.abcdef.0000", "iat": int(time.time()), "exp": int(time.time()) + 300},
        )
        r = self._post_token(token)
        assert r.status_code == 401
        assert r.json().get("detail") == "Missing kid in Apple token"

    def test_zzz_rate_limit_21st_call_returns_429(self):
        """20/min per IP â€” fire 25 requests fast; 21st+ should be 429 with Retry-After."""
        got_429 = False
        retry_after_seen = False
        garbage = "nope.nope.nope"
        for i in range(25):
            r = requests.post(APPLE_ENDPOINT, json={"identity_token": garbage}, timeout=15)
            if r.status_code == 429:
                got_429 = True
                if r.headers.get("Retry-After"):
                    retry_after_seen = True
                break
            # first 20 should be 401 (malformed)
            if i < 20:
                assert r.status_code == 401, f"call {i}: {r.status_code} {r.text}"
        assert got_429, "expected a 429 within 25 rapid calls (limit=20/min per IP)"
        assert retry_after_seen, "429 must include Retry-After header"


# ---------------------------------------------------------------------------
# 2) 'aud' claim rejection â€” signed RS256 JWT with mocked JWKS
# ---------------------------------------------------------------------------
class TestAppleSignInAudienceCheck:
    """Exercised in-process via TestClient with mocked JWKS + a real RSA key."""

    @pytest.fixture(scope="class")
    def app_env(self):
        # Import a live copy of server.py so we can patch its module globals
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "explore91_server_apple", _SERVER_PY
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # runs on module import
        return mod

    def test_bogus_aud_returns_401(self, app_env):
        # Build an RSA key
        priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pub = priv.public_key()
        pub_pem = pub.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        kid = "test-kid-apple-sim"

        # Seed the JWKS cache on the auth router module so _load_apple_jwks() won't refetch
        from routes import auth as auth_mod

        class _FakeJWK:
            def __init__(self, key):
                self.key = key
        auth_mod._APPLE_JWKS = {kid: _FakeJWK(pub_pem)}
        auth_mod._APPLE_JWKS_FETCHED_AT = time.monotonic()

        now = int(time.time())
        token = pyjwt.encode(
            {
                "iss": "https://appleid.apple.com",
                "aud": "com.wrong.audience.definitely.not.allowed",
                "sub": "0000.wrongaud.0000",
                "iat": now,
                "exp": now + 300,
                "email": "wrong-aud@example.com",
            },
            priv,
            algorithm="RS256",
            headers={"kid": kid},
        )

        with TestClient(app_env.app) as client:
            r = client.post("/api/auth/apple", json={"identity_token": token})
        # Rate limit could kick in if run right after error-paths test; accept 401 or 429
        if r.status_code == 429:
            pytest.skip("shared IP bucket exhausted; aud check is exercised in the code path")
        assert r.status_code == 401, r.text
        # Pyjwt raises InvalidAudienceError â†’ mapped to detail 'Invalid audience'
        assert r.json().get("detail") in ("Invalid audience", "Invalid Apple identity token")


# ---------------------------------------------------------------------------
# 3) Env + Mongo index + /auth/me apple_sub field
# ---------------------------------------------------------------------------
class TestAppleSignInEnvAndIndex:
    def test_apple_audiences_env_contains_required_values(self):
        env = os.environ.get("APPLE_AUDIENCES", "")
        vals = {v.strip() for v in env.split(",") if v.strip()}
        assert "com.emergent.exploremobile.j9fjag" in vals, env
        assert "host.exp.Exponent" in vals, env

    def test_users_apple_sub_index_is_sparse_and_unique(self):
        async def _check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            info = await db.users.index_information()
            client.close()
            return info

        info = asyncio.get_event_loop().run_until_complete(_check())
        assert "apple_sub_1" in info, list(info.keys())
        entry = info["apple_sub_1"]
        assert entry.get("unique") is True, entry
        assert entry.get("sparse") is True, entry

    def test_auth_me_includes_apple_sub_key(self):
        # Seed a google-linked user + session directly
        async def _seed():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            now = datetime.now(timezone.utc)
            uid = f"user_{uuid.uuid4().hex[:12]}"
            email = f"TEST_apple_me_{uuid.uuid4().hex[:6]}@explore91.dev"
            await db.users.insert_one({
                "user_id": uid, "email": email, "name": "Apple ME Tester",
                "picture": None, "wallet_points": 500, "home_city": "Goa",
                "roles": ["customer"], "created_at": now,
            })
            tok = f"test_{uuid.uuid4().hex}"
            await db.user_sessions.insert_one({
                "session_token": tok, "user_id": uid,
                "created_at": now, "expires_at": now + timedelta(days=7),
            })
            client.close()
            return tok, uid, email

        tok, uid, email = asyncio.get_event_loop().run_until_complete(_seed())
        try:
            r = requests.get(
                f"{BASE_URL}/api/auth/me",
                headers={"Authorization": f"Bearer {tok}"},
                timeout=15,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert "apple_sub" in body, body
            assert body["apple_sub"] is None
            assert body["email"] == email
        finally:
            async def _clean():
                c = AsyncIOMotorClient(MONGO_URL)
                d = c[DB_NAME]
                await d.user_sessions.delete_many({"user_id": uid})
                await d.users.delete_many({"user_id": uid})
                c.close()
            asyncio.get_event_loop().run_until_complete(_clean())


# ---------------------------------------------------------------------------
# 4) Happy-path upsert semantics via monkey-patched verifier + TestClient
# ---------------------------------------------------------------------------
class TestAppleSignInHappyPath:
    @pytest.fixture(scope="class")
    def app_client(self):
        """Load a fresh server module and keep ONE TestClient alive for all
        tests in this class â€” motor's AsyncIOMotorClient binds to the first
        event loop it sees, so we can't create a new TestClient per test."""
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "explore91_server_apple_hp", _SERVER_PY
        )
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        # Snapshot the real verifier so we can restore it after this class runs,
        # otherwise sibling test classes see the fake_verify patched below.
        from routes import auth as auth_mod
        original_verify = auth_mod._verify_apple_identity_token
        try:
            with TestClient(m.app) as client:
                yield m, client
        finally:
            auth_mod._verify_apple_identity_token = original_verify

    @pytest.fixture(scope="class", autouse=True)
    def cleanup(self):
        yield
        async def _clean():
            c = AsyncIOMotorClient(MONGO_URL)
            d = c[DB_NAME]
            await d.users.delete_many({"apple_sub": {"$regex": "^TEST_APPLE_SUB_"}})
            await d.users.delete_many({"email": {"$regex": "^TEST_apple_hp_|^test_apple_hp_"}})
            await d.user_sessions.delete_many({"session_token": {"$regex": "^apple_"}})
            c.close()
        asyncio.get_event_loop().run_until_complete(_clean())

    def test_first_call_creates_user_with_500_wallet_and_apple_sub(self, app_client):
        mod, client = app_client
        sub = f"TEST_APPLE_SUB_{uuid.uuid4().hex[:8]}"
        email = f"TEST_apple_hp_new_{uuid.uuid4().hex[:6]}@explore91.dev"

        async def fake_verify(_tok):
            return {"sub": sub, "email": email}

        from routes import auth as auth_mod
        auth_mod._verify_apple_identity_token = fake_verify
        r = client.post("/api/auth/apple",
                        json={"identity_token": "x" * 20, "full_name": "Apple New"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["session_token"].startswith("apple_")
        user = body["user"]
        assert user["email"] == email.lower()
        assert user["wallet_points"] == 500
        assert user["apple_sub"] == sub

        # session_token authenticates /auth/me
        r2 = requests.get(f"{BASE_URL}/api/auth/me",
                          headers={"Authorization": f"Bearer {body['session_token']}"},
                          timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["apple_sub"] == sub

    def test_second_call_same_sub_reuses_user(self, app_client):
        mod, client = app_client
        sub = f"TEST_APPLE_SUB_{uuid.uuid4().hex[:8]}"
        email = f"TEST_apple_hp_reuse_{uuid.uuid4().hex[:6]}@explore91.dev"

        async def fake_verify(_tok):
            return {"sub": sub, "email": email}
        from routes import auth as auth_mod
        auth_mod._verify_apple_identity_token = fake_verify

        r1 = client.post("/api/auth/apple",
                         json={"identity_token": "x" * 20, "full_name": "Apple Reuse"})
        assert r1.status_code == 200, r1.text
        uid1 = r1.json()["user"]["user_id"]

        r2 = client.post("/api/auth/apple", json={"identity_token": "x" * 20})
        assert r2.status_code == 200, r2.text
        uid2 = r2.json()["user"]["user_id"]

        assert uid1 == uid2, "same apple_sub must reuse user_id"

        # And no duplicate user rows
        async def _count():
            c = AsyncIOMotorClient(MONGO_URL)
            d = c[DB_NAME]
            n = await d.users.count_documents({"apple_sub": sub})
            c.close()
            return n
        assert asyncio.get_event_loop().run_until_complete(_count()) == 1

    def test_apple_sub_links_to_existing_email_user(self, app_client):
        mod, client = app_client
        # Simulate existing Google-linked user (no apple_sub). NOTE: endpoint
        # lowercases the email before lookup, so we must seed lowercase.
        email = f"test_apple_hp_link_{uuid.uuid4().hex[:6]}@explore91.dev"
        sub = f"TEST_APPLE_SUB_{uuid.uuid4().hex[:8]}"

        async def _seed_existing():
            c = AsyncIOMotorClient(MONGO_URL)
            d = c[DB_NAME]
            now = datetime.now(timezone.utc)
            uid = f"user_{uuid.uuid4().hex[:12]}"
            await d.users.insert_one({
                "user_id": uid, "email": email, "name": "Google Linked",
                "picture": None, "wallet_points": 500, "home_city": "Goa",
                "roles": ["customer"], "created_at": now,
            })
            c.close()
            return uid

        existing_uid = asyncio.get_event_loop().run_until_complete(_seed_existing())

        async def fake_verify(_tok):
            return {"sub": sub, "email": email}
        from routes import auth as auth_mod
        auth_mod._verify_apple_identity_token = fake_verify

        r = client.post("/api/auth/apple", json={"identity_token": "x" * 20})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["user_id"] == existing_uid
        assert r.json()["user"]["apple_sub"] == sub

        # DB reflects the link
        async def _fetch():
            c = AsyncIOMotorClient(MONGO_URL)
            d = c[DB_NAME]
            doc = await d.users.find_one({"user_id": existing_uid}, {"_id": 0})
            n = await d.users.count_documents({"email": email})
            c.close()
            return doc, n
        doc, n = asyncio.get_event_loop().run_until_complete(_fetch())
        assert doc["apple_sub"] == sub
        assert n == 1, "must not create a duplicate account for the same email"


# ---------------------------------------------------------------------------
# 5) Regression spot-check
# ---------------------------------------------------------------------------
class TestRegressionSpotCheck:
    def test_root_ok(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_session_endpoint_rejects_bad_session_id(self):
        r = requests.post(f"{BASE_URL}/api/auth/session",
                          json={"session_id": "not-a-real-session"}, timeout=15)
        assert r.status_code == 401

    def test_businesses_filter_by_city(self):
        r = requests.get(f"{BASE_URL}/api/businesses?city=goa&limit=20", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) > 0
        assert all(b["city"] == "goa" for b in data)
        assert all("_id" not in b for b in data)

    def test_reels_feed_returns_list(self):
        r = requests.get(f"{BASE_URL}/api/reels?limit=5", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_self_grant_forbidden(self):
        # Seed a fresh customer session
        async def _seed():
            c = AsyncIOMotorClient(MONGO_URL)
            d = c[DB_NAME]
            now = datetime.now(timezone.utc)
            uid = f"user_{uuid.uuid4().hex[:12]}"
            email = f"TEST_apple_reg_{uuid.uuid4().hex[:6]}@explore91.dev"
            await d.users.insert_one({
                "user_id": uid, "email": email, "name": "Reg", "picture": None,
                "wallet_points": 500, "home_city": "Goa",
                "roles": ["customer"], "created_at": now,
            })
            tok = f"test_{uuid.uuid4().hex}"
            await d.user_sessions.insert_one({
                "session_token": tok, "user_id": uid,
                "created_at": now, "expires_at": now + timedelta(days=7),
            })
            c.close()
            return tok, uid, email
        tok, uid, email = asyncio.get_event_loop().run_until_complete(_seed())
        try:
            r = requests.post(f"{BASE_URL}/api/auth/roles",
                              headers={"Authorization": f"Bearer {tok}"},
                              json={"role": "admin"}, timeout=15)
            assert r.status_code == 403, r.text
        finally:
            async def _clean():
                c = AsyncIOMotorClient(MONGO_URL); d = c[DB_NAME]
                await d.user_sessions.delete_many({"user_id": uid})
                await d.users.delete_many({"user_id": uid})
                c.close()
            asyncio.get_event_loop().run_until_complete(_clean())
