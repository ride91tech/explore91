"""/auth/dev -- the placeholder sign-in that replaced Google.

The endpoint takes an email and issues a session, verifying nothing. That is
a complete authentication bypass, so the thing most worth testing is not that
it works but that it is OFF unless someone deliberately switches it on.

CI does not set DEV_AUTH_ENABLED, on purpose: the live-server tests here
assert the disabled behaviour a production deployment would have, and the
tests that need it on run the app in-process with the variable patched. If
this file ever needs the flag set in the workflow to pass, something has
regressed about the gate.
"""
import asyncio
import importlib.util
import os
import random
import uuid

import pytest
import requests
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from motor.motor_asyncio import AsyncIOMotorClient

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_DIR = os.path.dirname(_BACKEND_DIR)
_SERVER_PY = os.path.join(_BACKEND_DIR, "server.py")
load_dotenv(os.path.join(_REPO_DIR, "frontend", ".env"))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))

BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

DEV_ENDPOINT = f"{BASE_URL}/api/auth/dev"
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "gw0")


def _email() -> str:
    """An address this test alone owns. users.email is uniquely indexed."""
    return f"TEST_dev_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev".lower()


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _load_app(module_name: str):
    """A fresh in-process copy of the app, reading the environment as it is now."""
    spec = importlib.util.spec_from_file_location(module_name, _SERVER_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _as_fresh_client() -> dict:
    """Headers presenting a call as its own client.

    /auth/dev is limited to 20 per minute per caller. TestClient presents the
    same address every time, so all the in-process tests here shared one
    bucket -- about seven calls per run, which meant a third run inside the
    same 60s window got a 429 and the test failed on a KeyError indexing an
    error body. TRUSTED_PROXY_HOPS defaults to 1, so the limiter reads the
    last X-Forwarded-For entry, which is what a proxy would have appended.
    """
    return {"X-Forwarded-For": "198.51.100." + str(random.randint(2, 250))}


def _dev_post(client, body: dict):
    """POST /auth/dev as a fresh client, insisting on a 200.

    The assertion is the point: without it a rate-limited or rejected call
    surfaced as a KeyError on ["user"], which says nothing about what went
    wrong.
    """
    r = client.post("/api/auth/dev", json=body, headers=_as_fresh_client())
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    return r.json()


async def _purge(email: str) -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    user = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1})
    if user:
        await db.user_sessions.delete_many({"user_id": user["user_id"]})
        await db.users.delete_many({"user_id": user["user_id"]})
    client.close()


@pytest.fixture
def app_with_dev_auth(monkeypatch):
    """The app in-process, with the dev gate open.

    dev_auth_enabled() reads the environment on every call rather than
    capturing it at import, which is what lets this work without reloading
    core.config -- and is why the variable cannot be left on by an early
    import somewhere.
    """
    monkeypatch.setenv("DEV_AUTH_ENABLED", "true")
    return _load_app("explore91_server_dev")


@pytest.fixture
def app_without_dev_auth(monkeypatch):
    """The app in-process with the gate shut, whatever the developer's .env says.

    These assertions used to run against the live server, which made them
    fail the moment anyone set DEV_AUTH_ENABLED locally -- which is exactly
    what a developer has to do to use the app. A suite that is red in the
    normal working configuration is a suite people stop reading.

    What belongs here is the gate's logic. Whether a DEPLOYED service has the
    variable set is a deploy-time check, and lives in the smoke tests in
    docs/DEPLOY_PLAN_001.md.
    """
    # setenv("false"), not delenv. Loading the app imports core.config, which
    # calls load_dotenv -- so a deleted variable comes straight back from the
    # developer's .env and the gate is open again. load_dotenv does not
    # override a value that is already set, so this one holds.
    monkeypatch.setenv("DEV_AUTH_ENABLED", "false")
    return _load_app("explore91_server_nodev")


class TestDisabledByDefault:
    """The behaviour an unconfigured deployment has, and must keep."""

    def test_returns_404(self, app_without_dev_auth):
        with TestClient(app_without_dev_auth.app) as client:
            r = client.post("/api/auth/dev", json={"email": "anyone@example.com"})
        assert r.status_code == 404

    def test_404_not_403(self, app_without_dev_auth):
        """A 403 would confirm the route exists. A 404 says nothing."""
        with TestClient(app_without_dev_auth.app) as client:
            r = client.post("/api/auth/dev", json={"email": "anyone@example.com"})
        assert r.status_code != 403

    def test_no_session_is_issued(self, app_without_dev_auth):
        with TestClient(app_without_dev_auth.app) as client:
            r = client.post("/api/auth/dev", json={"email": "anyone@example.com"})
        assert "session_token" not in r.text

    def test_rejected_before_the_body_is_validated(self, app_without_dev_auth):
        """A malformed body is still just a 404.

        If this returns 422 the gate has moved below request parsing, and a
        disabled instance is confirming both that the route exists and what
        it expects.
        """
        with TestClient(app_without_dev_auth.app) as client:
            r = client.post("/api/auth/dev", json={"not_an_email_field": 1})
        assert r.status_code == 404

    @pytest.mark.parametrize("value", ["", "false", "0", "no", "off", "maybe"])
    def test_only_an_affirmative_value_opens_it(self, monkeypatch, value):
        """Anything that is not clearly a yes leaves the gate shut."""
        monkeypatch.setenv("DEV_AUTH_ENABLED", value)
        with TestClient(_load_app(f"explore91_server_v_{abs(hash(value))}").app) as client:
            r = client.post("/api/auth/dev", json={"email": "anyone@example.com"})
        assert r.status_code == 404, f"DEV_AUTH_ENABLED={value!r} opened the route"


class TestEnabled:
    def test_issues_a_working_session(self, app_with_dev_auth):
        email = _email()
        try:
            with TestClient(app_with_dev_auth.app) as client:
                body = _dev_post(client, {"email": email})
                token = body["session_token"]
                assert body["user"]["email"] == email

                me = client.get(
                    "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
                )
                assert me.status_code == 200, me.text
                assert me.json()["email"] == email
        finally:
            _run(_purge(email))

    def test_token_is_identifiable_as_dev(self, app_with_dev_auth):
        """The prefix is how these get found and purged when OTP lands."""
        email = _email()
        try:
            with TestClient(app_with_dev_auth.app) as client:
                body = _dev_post(client, {"email": email})
            assert body["session_token"].startswith("dev_")
        finally:
            _run(_purge(email))

    def test_returning_user_keeps_their_account(self, app_with_dev_auth):
        """Same rule Google used, so accounts survive the swap -- and the
        next one, when OTP replaces this."""
        email = _email()
        try:
            with TestClient(app_with_dev_auth.app) as client:
                first = _dev_post(client, {"email": email})["user"]
                second = _dev_post(client, {"email": email})["user"]
            assert first["user_id"] == second["user_id"]
            assert first["wallet_points"] == second["wallet_points"]
        finally:
            _run(_purge(email))

    def test_grants_only_the_customer_role(self, app_with_dev_auth):
        """No privilege shortcut. Admin still goes through /auth/roles, which
        is allowlisted against ADMIN_EMAILS."""
        email = _email()
        try:
            with TestClient(app_with_dev_auth.app) as client:
                user = _dev_post(client, {"email": email})["user"]
            assert user["roles"] == ["customer"]
        finally:
            _run(_purge(email))

    def test_email_is_normalised(self, app_with_dev_auth):
        """Mixed case and stray spaces must not create a second account."""
        email = _email()
        try:
            with TestClient(app_with_dev_auth.app) as client:
                a = _dev_post(client, {"email": email})["user"]
                b = _dev_post(client, {"email": f"  {email.upper()}  "})["user"]
            assert a["user_id"] == b["user_id"]
        finally:
            _run(_purge(email))

    @pytest.mark.parametrize("bad", ["", "nope", "no@domain", "a b@c.de", "@x.com"])
    def test_rejects_junk_identifiers(self, app_with_dev_auth, bad):
        with TestClient(app_with_dev_auth.app) as client:
            r = client.post("/api/auth/dev", json={"email": bad})
        assert r.status_code == 422, r.text

    def test_missing_field_is_422(self, app_with_dev_auth):
        with TestClient(app_with_dev_auth.app) as client:
            r = client.post("/api/auth/dev", json={})
        assert r.status_code == 422


class TestGoogleIsGone:
    def test_route_removed(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/google", json={"id_token": "x.y.z"}, timeout=15
        )
        assert r.status_code == 404

    def test_config_no_longer_reads_google_client_ids(self):
        """The env var is dead. Leaving the reader behind invites someone to
        set it and assume sign-in works."""
        from core import config

        assert not hasattr(config, "GOOGLE_CLIENT_IDS")
        assert not hasattr(config, "GOOGLE_JWKS_URL")
