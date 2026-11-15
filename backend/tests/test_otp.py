"""Sign-in by emailed code.

The happy path is the least interesting thing here. Auth code fails in the
cases nobody exercises, so most of this file is the properties that make a
six-digit code safe to accept: it works once, it stops working after five
wrong guesses or ten minutes, a database read cannot recover it, concurrent
requests cannot double-spend it, and every failure looks the same from
outside.

Runs in-process with the email sender replaced, so codes are captured
without any mail leaving the machine.
"""
import asyncio
import hashlib
import importlib.util
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from motor.motor_asyncio import AsyncIOMotorClient

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_DIR = os.path.dirname(_BACKEND_DIR)
_SERVER_PY = os.path.join(_BACKEND_DIR, "server.py")
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "gw0")
PEPPER = "test-pepper-" + "x" * 40


# ---------------------------------------------------------------- helpers --

def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


async def _find(collection: str, query: dict):
    """Client built inside the coroutine: Motor binds to the loop current at
    first use, and _run makes a fresh loop every call."""
    return await AsyncIOMotorClient(MONGO_URL)[DB_NAME][collection].find_one(
        query, {"_id": 0}
    )


async def _update(collection: str, query: dict, patch: dict) -> None:
    await AsyncIOMotorClient(MONGO_URL)[DB_NAME][collection].update_one(
        query, {"$set": patch}
    )


async def _insert(collection: str, doc: dict) -> None:
    await AsyncIOMotorClient(MONGO_URL)[DB_NAME][collection].insert_one(doc)


async def _drop(collection: str, query: dict) -> None:
    await AsyncIOMotorClient(MONGO_URL)[DB_NAME][collection].delete_many(query)


def _email(tag: str) -> str:
    # Lowercase on purpose: sign-in lowercases before lookup, and a mixed-case
    # seed is silently never matched.
    return f"test_otp_{tag}_{WORKER}_{uuid.uuid4().hex[:8]}@explore91.dev"


def _fresh() -> dict:
    """Present each call as its own client, so the per-IP limiters - which
    see TestClient as one address - do not collide across tests."""
    return {"X-Forwarded-For": "10.{}.{}.{}".format(
        random.randint(0, 255), random.randint(0, 255), random.randint(1, 254))}


def _cleanup(email: str) -> None:
    async def go():
        row = await _find("users", {"email": email})
        if row:
            await _drop("user_sessions", {"user_id": row["user_id"]})
            await _drop("users", {"user_id": row["user_id"]})
        await _drop("otp_codes", {"email": email})
    _run(go())


def _load_app(name: str):
    spec = importlib.util.spec_from_file_location(name, _SERVER_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --------------------------------------------------------------- fixtures --

@pytest.fixture
def inbox(monkeypatch):
    """Configured OTP, with every sent code captured here instead of mailed."""
    monkeypatch.setenv("OTP_EMAIL_BACKEND", "log")
    monkeypatch.setenv("OTP_PEPPER", PEPPER)
    monkeypatch.delenv("K_SERVICE", raising=False)

    import core.otp as otp
    sent: dict = {}

    async def capture(to, code):
        sent[to] = code

    monkeypatch.setattr(otp, "send_code_email", capture)
    return sent


@pytest.fixture
def app(inbox):
    return _load_app(f"explore91_server_otp_{uuid.uuid4().hex[:6]}")


def _send(client, email):
    return client.post("/api/auth/otp/send", json={"email": email}, headers=_fresh())


def _verify(client, email, code, is_adult=True, name=None):
    body = {"email": email, "code": code, "is_adult": is_adult}
    if name:
        body["name"] = name
    return client.post("/api/auth/otp/verify", json=body, headers=_fresh())


# ------------------------------------------------------------------ tests --

class TestNotConfigured:
    """503 rather than 404: unlike /auth/dev this route is meant to exist in
    production, so a missing provider is a fault to surface."""

    @pytest.fixture
    def bare_app(self, monkeypatch):
        # setenv to an invalid value, not delenv: load_dotenv would restore a
        # deleted variable from a developer's .env.
        monkeypatch.setenv("OTP_EMAIL_BACKEND", "none")
        return _load_app(f"explore91_server_otp_bare_{uuid.uuid4().hex[:6]}")

    def test_send_is_503(self, bare_app):
        with TestClient(bare_app.app) as c:
            assert _send(c, _email("off")).status_code == 503

    def test_verify_is_503(self, bare_app):
        with TestClient(bare_app.app) as c:
            assert _verify(c, _email("off"), "123456").status_code == 503


class TestSignIn:
    def test_a_code_signs_you_in(self, app, inbox):
        email = _email("happy")
        try:
            with TestClient(app.app) as c:
                assert _send(c, email).status_code == 202
                code = inbox[email]
                r = _verify(c, email, code, name="Happy")
                assert r.status_code == 200, r.text
                body = r.json()
                assert body["session_token"].startswith("otp_")
                me = c.get("/api/auth/me",
                           headers={"Authorization": f"Bearer {body['session_token']}"})
                assert me.status_code == 200
                assert me.json()["email"] == email
        finally:
            _cleanup(email)

    def test_a_new_account_records_consent(self, app, inbox):
        """Through the shared sign-in helper, so it gets the same consent
        rule as every other path - which is the reason the helper exists."""
        email = _email("consent")
        try:
            with TestClient(app.app) as c:
                _send(c, email)
                assert _verify(c, email, inbox[email]).status_code == 200
            row = _run(_find("users", {"email": email}))
            assert (row.get("consent") or {}).get("notice_version")
            assert row.get("is_adult_confirmed") is True
        finally:
            _cleanup(email)

    def test_the_address_is_matched_case_insensitively(self, app, inbox):
        email = _email("case")
        try:
            with TestClient(app.app) as c:
                _send(c, email.upper())
                code = inbox[email]          # stored and sent lowercased
                assert _verify(c, email.upper(), code).status_code == 200
        finally:
            _cleanup(email)


class TestCodeSecurity:
    def test_the_code_is_not_stored_in_recoverable_form(self, app, inbox):
        """A million codes is nothing to hash. An unkeyed digest would let
        anyone with read access recover a live code in milliseconds."""
        email = _email("digest")
        try:
            with TestClient(app.app) as c:
                _send(c, email)
            code = inbox[email]
            row = _run(_find("otp_codes", {"email": email}))
            assert code not in str(row), "the code is stored in plain text"
            plain = hashlib.sha256(f"{email}:{code}".encode()).hexdigest()
            assert row["code_digest"] != plain, \
                "digest is unkeyed - a database read would recover the code"
        finally:
            _cleanup(email)

    def test_a_wrong_code_is_refused(self, app, inbox):
        email = _email("wrong")
        try:
            with TestClient(app.app) as c:
                _send(c, email)
                wrong = f"{(int(inbox[email]) + 1) % 1_000_000:06d}"
                assert _verify(c, email, wrong).status_code == 400
        finally:
            _cleanup(email)

    def test_a_code_works_exactly_once(self, app, inbox):
        email = _email("once")
        try:
            with TestClient(app.app) as c:
                _send(c, email)
                code = inbox[email]
                assert _verify(c, email, code).status_code == 200
                assert _verify(c, email, code).status_code == 400, \
                    "a used code signed in a second time"
        finally:
            _cleanup(email)

    def test_five_wrong_guesses_burn_the_code(self, app, inbox):
        """After the limit, even the right code must fail - otherwise the
        limit only delays a brute force rather than stopping it."""
        email = _email("burn")
        try:
            with TestClient(app.app) as c:
                _send(c, email)
                code = inbox[email]
                wrong = f"{(int(code) + 1) % 1_000_000:06d}"
                for _ in range(5):
                    assert _verify(c, email, wrong).status_code == 400
                assert _verify(c, email, code).status_code == 400, \
                    "the correct code worked after the attempt limit"
        finally:
            _cleanup(email)

    def test_an_expired_code_is_refused(self, app, inbox):
        email = _email("expired")
        try:
            with TestClient(app.app) as c:
                _send(c, email)
                code = inbox[email]
                _run(_update("otp_codes", {"email": email},
                             {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}))
                assert _verify(c, email, code).status_code == 400
        finally:
            _cleanup(email)

    def test_asking_again_replaces_the_old_code(self, app, inbox):
        email = _email("replace")
        try:
            with TestClient(app.app) as c:
                _send(c, email)
                first = inbox[email]
                _send(c, email)
                second = inbox[email]
                if first == second:
                    pytest.skip("drew the same code twice (1 in a million)")
                assert _verify(c, email, first).status_code == 400
                assert _verify(c, email, second).status_code == 200
        finally:
            _cleanup(email)

    def test_every_failure_looks_the_same(self, app, inbox):
        """Distinguishing wrong from expired from never-sent would tell an
        attacker which codes are worth continuing against."""
        sent, never = _email("same_a"), _email("same_b")
        try:
            with TestClient(app.app) as c:
                _send(c, sent)
                wrong = f"{(int(inbox[sent]) + 1) % 1_000_000:06d}"
                a = _verify(c, sent, wrong)
                b = _verify(c, never, "123456")
                assert a.status_code == b.status_code == 400
                assert a.json() == b.json()
        finally:
            _cleanup(sent)
            _cleanup(never)

    def test_concurrent_claims_spend_a_code_once(self, monkeypatch):
        """Two requests carrying the right code at the same moment must not
        both get a session. find_one_and_delete is what guarantees it."""
        monkeypatch.setenv("OTP_PEPPER", PEPPER)
        import core.otp as otp
        email = _email("race")

        async def go():
            # A client created on this loop; the module-level one may already
            # be bound to TestClient's loop from another test.
            monkeypatch.setattr(otp, "db", AsyncIOMotorClient(MONGO_URL)[DB_NAME])
            code = await otp.issue_code(email)
            results = await asyncio.gather(*[otp.claim_code(email, code) for _ in range(8)])
            return results

        try:
            results = _run(go())
            assert results.count(True) == 1, f"code claimed {results.count(True)} times"
        finally:
            _run(_drop("otp_codes", {"email": email}))

    def test_malformed_codes_never_reach_the_database(self, app, inbox):
        """Rejected by the model, so they cannot spend an attempt."""
        email = _email("malformed")
        try:
            with TestClient(app.app) as c:
                _send(c, email)
                for bad in ("12345", "1234567", "12a456", ""):
                    assert _verify(c, email, bad).status_code == 422
                row = _run(_find("otp_codes", {"email": email}))
                assert row["attempts"] == 0, "a malformed code spent an attempt"
        finally:
            _cleanup(email)


class TestAgeGate:
    def test_a_new_account_needs_the_confirmation(self, app, inbox):
        email = _email("minor")
        try:
            with TestClient(app.app) as c:
                _send(c, email)
                r = _verify(c, email, inbox[email], is_adult=False)
                assert r.status_code == 403, r.text
            assert _run(_find("users", {"email": email})) is None
        finally:
            _cleanup(email)

    def test_an_existing_account_signs_in_without_it(self, app, inbox):
        email = _email("existing")
        uid = f"user_{uuid.uuid4().hex[:12]}"
        _run(_insert("users", {
            "user_id": uid, "email": email, "name": "Existing", "picture": None,
            "wallet_points": 0, "home_city": "Goa", "roles": ["customer"],
            "created_at": datetime.now(timezone.utc),
        }))
        try:
            with TestClient(app.app) as c:
                _send(c, email)
                r = _verify(c, email, inbox[email], is_adult=False)
                assert r.status_code == 200, "an existing user was locked out"
                assert r.json()["user"]["user_id"] == uid
        finally:
            _cleanup(email)


class TestLimits:
    def test_one_address_cannot_be_flooded(self, app, inbox):
        """Per-address, so it holds even when the sender rotates IPs."""
        email = _email("flood")
        try:
            with TestClient(app.app) as c:
                codes = [_send(c, email).status_code for _ in range(6)]
            assert codes[:5] == [202] * 5
            assert codes[5] == 429, f"sixth send was {codes[5]}"
        finally:
            _cleanup(email)
            _run(_drop("rate_limits", {"_id": {"$regex": f"^otp_send_addr:e:{email}"}}))


class TestBackendGuards:
    def test_the_log_backend_refuses_to_run_on_cloud_run(self, monkeypatch):
        """It writes live codes to the log. K_SERVICE is set on every Cloud
        Run revision, so its presence means production."""
        monkeypatch.setenv("OTP_EMAIL_BACKEND", "log")
        monkeypatch.setenv("OTP_PEPPER", PEPPER)
        monkeypatch.setenv("K_SERVICE", "explore91-api")
        import core.otp as otp
        assert otp.otp_configured() is False

    def test_a_short_pepper_is_not_a_pepper(self, monkeypatch):
        monkeypatch.setenv("OTP_EMAIL_BACKEND", "log")
        monkeypatch.setenv("OTP_PEPPER", "short")
        monkeypatch.delenv("K_SERVICE", raising=False)
        import core.otp as otp
        assert otp.otp_configured() is False

    def test_resend_without_credentials_is_not_configured(self, monkeypatch):
        monkeypatch.setenv("OTP_EMAIL_BACKEND", "resend")
        monkeypatch.setenv("OTP_PEPPER", PEPPER)
        monkeypatch.setenv("RESEND_API_KEY", "")
        import core.otp as otp
        assert otp.otp_configured() is False


# ------------------------------------------------------------------ MSG91 --

MSG91_ENV = {
    "OTP_EMAIL_BACKEND": "msg91",
    "OTP_PEPPER": PEPPER,
    "MSG91_AUTHKEY": "test-authkey-not-real-0123456789",
    "MSG91_EMAIL_DOMAIN": "mail.explore91.com",
    "MSG91_EMAIL_TEMPLATE_ID": "explore91_otp",
    "OTP_FROM_EMAIL": "Explore91 <login@mail.explore91.com>",
}

MSG91_OK = {
    "status": "success", "hasError": False, "errors": {},
    "data": {"unique_id": "a1d2e4b8-4d04-41f9-b8f2-34be6a5c6d49"},
    "message": "Thank you. Your request has been queued.",
}


def _msg91_env(monkeypatch, **overrides):
    for k, v in {**MSG91_ENV, **overrides}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("K_SERVICE", raising=False)


def _mock_msg91(monkeypatch, status=200, body=None, raw=None):
    """Route the module's HTTP client to a canned MSG91 answer, recording
    what was sent."""
    import httpx
    import core.otp as otp
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["json"] = __import__("json").loads(request.content)
        if raw is not None:
            return httpx.Response(status, content=raw)
        return httpx.Response(status, json=body if body is not None else MSG91_OK)

    monkeypatch.setattr(otp, "_http_client",
                        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return seen


class TestMsg91:
    def test_configured_only_with_every_setting(self, monkeypatch):
        import core.otp as otp
        _msg91_env(monkeypatch)
        assert otp.otp_configured() is True
        for missing in ("MSG91_AUTHKEY", "MSG91_EMAIL_DOMAIN",
                        "MSG91_EMAIL_TEMPLATE_ID", "OTP_FROM_EMAIL"):
            monkeypatch.setenv(missing, "")
            assert otp.otp_configured() is False, f"configured without {missing}"
            monkeypatch.setenv(missing, MSG91_ENV[missing])

    def test_sends_the_code_in_the_shape_msg91_expects(self, monkeypatch):
        import core.otp as otp
        _msg91_env(monkeypatch)
        seen = _mock_msg91(monkeypatch)
        _run(otp.send_code_email("someone@example.com", "482913"))
        assert seen["url"] == "https://control.msg91.com/api/v5/email/send"
        assert seen["headers"]["authkey"] == MSG91_ENV["MSG91_AUTHKEY"]
        body = seen["json"]
        assert body["recipients"][0]["to"][0]["email"] == "someone@example.com"
        assert body["recipients"][0]["variables"]["otp"] == "482913"
        assert body["from"] == {"name": "Explore91", "email": "login@mail.explore91.com"}
        assert body["domain"] == "mail.explore91.com"
        assert body["template_id"] == "explore91_otp"

    def test_a_200_carrying_a_failure_is_a_failure(self, monkeypatch):
        """The trap. MSG91 answers some failures with HTTP 200 and the
        failure in the body. Checking the status alone would tell the user a
        code was sent when nothing will ever arrive."""
        import core.otp as otp
        _msg91_env(monkeypatch)
        _mock_msg91(monkeypatch, 200, {"status": "fail", "hasError": True,
                                       "errors": {"template_id": ["invalid"]}})
        with pytest.raises(RuntimeError):
            _run(otp.send_code_email("someone@example.com", "482913"))

    def test_a_bad_authkey_answered_with_200_is_a_failure(self, monkeypatch):
        import core.otp as otp
        _msg91_env(monkeypatch)
        _mock_msg91(monkeypatch, 200, {"code": "401", "errors": "Unauthorized",
                                       "status": "fail", "apiError": None, "hasError": True})
        with pytest.raises(RuntimeError):
            _run(otp.send_code_email("someone@example.com", "482913"))

    @pytest.mark.parametrize("status,raw", [(200, b"<html>gateway</html>"),
                                            (200, b""), (500, None), (401, None)])
    def test_anything_short_of_a_clear_success_is_a_failure(self, monkeypatch, status, raw):
        import core.otp as otp
        _msg91_env(monkeypatch)
        _mock_msg91(monkeypatch, status, body={"status": "fail", "hasError": True}, raw=raw)
        with pytest.raises(RuntimeError):
            _run(otp.send_code_email("someone@example.com", "482913"))

    def test_the_authkey_never_reaches_the_log(self, monkeypatch, caplog):
        import logging
        import core.otp as otp
        _msg91_env(monkeypatch)
        _mock_msg91(monkeypatch, 200, {"status": "fail", "hasError": True})
        with caplog.at_level(logging.DEBUG, logger="explore91.otp"):
            with pytest.raises(RuntimeError):
                _run(otp.send_code_email("someone@example.com", "482913"))
        assert MSG91_ENV["MSG91_AUTHKEY"] not in caplog.text
        assert "482913" not in caplog.text, "the code was logged"

    def test_the_route_reports_failure_instead_of_claiming_sent(self, monkeypatch):
        """End to end: a 200-with-failure from MSG91 must surface as a 502 to
        the app, not a 202 that leaves the person waiting for nothing."""
        _msg91_env(monkeypatch)
        _mock_msg91(monkeypatch, 200, {"status": "fail", "hasError": True})
        app = _load_app(f"explore91_server_msg91_{uuid.uuid4().hex[:6]}")
        email = _email("msg91fail")
        try:
            with TestClient(app.app) as c:
                assert _send(c, email).status_code == 502
        finally:
            _cleanup(email)

    def test_the_route_sends_and_then_signs_in(self, monkeypatch):
        _msg91_env(monkeypatch)
        seen = _mock_msg91(monkeypatch)
        app = _load_app(f"explore91_server_msg91_{uuid.uuid4().hex[:6]}")
        email = _email("msg91ok")
        try:
            with TestClient(app.app) as c:
                assert _send(c, email).status_code == 202
                code = seen["json"]["recipients"][0]["variables"]["otp"]
                r = _verify(c, email, code)
                assert r.status_code == 200, r.text
                assert r.json()["session_token"].startswith("otp_")
        finally:
            _cleanup(email)

    @pytest.mark.parametrize("value,expected", [
        ("Explore91 <login@explore91.com>", ("Explore91", "login@explore91.com")),
        ('"Explore 91" <a@b.co>', ("Explore 91", "a@b.co")),
        ("login@explore91.com", ("Explore91", "login@explore91.com")),
    ])
    def test_the_sender_string_splits_into_name_and_address(self, value, expected):
        import core.otp as otp
        assert otp._split_from(value) == expected


# --------------------------------------------------------- WhatsApp (Kapso) --

KAPSO_ENV = {
    "OTP_PEPPER": PEPPER,
    "KAPSO_API_KEY": "test-kapso-key-not-real-0123456789",
    "KAPSO_PHONE_NUMBER_ID": "647015955153740",
    "KAPSO_OTP_TEMPLATE": "explore91_login",
}
KAPSO_OK = {
    "messaging_product": "whatsapp",
    "contacts": [{"input": "919876543210", "wa_id": "919876543210"}],
    "messages": [{"id": "wamid.HBgNMTU1NTE0OTU5Nzg1FQIAERgSMDhGRjdBMDEy"}],
}


def _kapso_env(monkeypatch, **overrides):
    for k, v in {**KAPSO_ENV, **overrides}.items():
        monkeypatch.setenv(k, v)


def _mock_kapso(monkeypatch, status=200, body=None):
    import httpx
    import json as _json
    import core.otp as otp
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["json"] = _json.loads(request.content)
        return httpx.Response(status, json=KAPSO_OK if body is None else body)

    monkeypatch.setattr(otp, "_http_client",
                        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return seen


class TestWhatsApp:
    def test_configured_only_with_every_setting(self, monkeypatch):
        import core.otp as otp
        _kapso_env(monkeypatch)
        assert otp.whatsapp_configured() is True
        for missing in ("KAPSO_API_KEY", "KAPSO_PHONE_NUMBER_ID", "KAPSO_OTP_TEMPLATE"):
            monkeypatch.setenv(missing, "")
            assert otp.whatsapp_configured() is False, f"configured without {missing}"
            monkeypatch.setenv(missing, KAPSO_ENV[missing])

    def test_the_code_goes_in_both_places_meta_requires(self, monkeypatch):
        """Authentication templates reject a send that carries the code in
        the body but not on the copy-code button, or the reverse."""
        import core.otp as otp
        _kapso_env(monkeypatch)
        seen = _mock_kapso(monkeypatch)
        _run(otp.send_code_whatsapp("+919876543210", "482913"))
        assert seen["url"] == ("https://api.kapso.ai/meta/whatsapp/v24.0/"
                               "647015955153740/messages")
        assert seen["headers"]["x-api-key"] == KAPSO_ENV["KAPSO_API_KEY"]
        body = seen["json"]
        assert body["to"] == "919876543210", "Meta wants digits without the +"
        assert body["type"] == "template"
        assert body["template"]["name"] == "explore91_login"
        comps = {c["type"]: c for c in body["template"]["components"]}
        assert comps["body"]["parameters"][0]["text"] == "482913"
        assert comps["button"]["sub_type"] == "url"
        assert comps["button"]["index"] == "0"
        assert comps["button"]["parameters"][0]["text"] == "482913"

    def test_a_meta_error_is_a_failure(self, monkeypatch):
        import core.otp as otp
        _kapso_env(monkeypatch)
        _mock_kapso(monkeypatch, 400, {"error": {
            "message": "Template name does not exist in the translation",
            "type": "OAuthException", "code": 132001}})
        with pytest.raises(RuntimeError):
            _run(otp.send_code_whatsapp("+919876543210", "482913"))

    def test_a_200_without_a_message_id_is_a_failure(self, monkeypatch):
        """Only a wamid proves Meta accepted the message."""
        import core.otp as otp
        _kapso_env(monkeypatch)
        _mock_kapso(monkeypatch, 200, {"messaging_product": "whatsapp", "messages": []})
        with pytest.raises(RuntimeError):
            _run(otp.send_code_whatsapp("+919876543210", "482913"))

    def test_neither_the_key_nor_the_code_reaches_the_log(self, monkeypatch, caplog):
        import logging
        import core.otp as otp
        _kapso_env(monkeypatch)
        _mock_kapso(monkeypatch, 400, {"error": {"code": 131026, "type": "OAuthException"}})
        with caplog.at_level(logging.DEBUG, logger="explore91.otp"):
            with pytest.raises(RuntimeError):
                _run(otp.send_code_whatsapp("+919876543210", "482913"))
        assert KAPSO_ENV["KAPSO_API_KEY"] not in caplog.text
        assert "482913" not in caplog.text
        assert "9876543210" not in caplog.text, "the recipient was logged"
        assert "131026" in caplog.text, "Meta's error code should be logged for debugging"

    def test_refuses_to_send_when_unconfigured(self, monkeypatch):
        import core.otp as otp
        _kapso_env(monkeypatch, KAPSO_API_KEY="")
        with pytest.raises(otp.OtpNotConfigured):
            _run(otp.send_code_whatsapp("+919876543210", "482913"))

    @pytest.mark.parametrize("raw,expected", [
        ("9876543210", "+919876543210"),
        ("+91 98765 43210", "+919876543210"),
        ("919876543210", "+919876543210"),
        ("09876543210", "+919876543210"),
        ("98765-43210", "+919876543210"),
        ("5876543210", None),          # Indian mobiles start 6-9
        ("98765", None),
        ("+1 415 555 0100", None),     # not Indian - refused, not guessed
        ("", None),
    ])
    def test_indian_mobiles_normalise_and_others_are_refused(self, raw, expected):
        import core.otp as otp
        assert otp.normalise_in_mobile(raw) == expected
