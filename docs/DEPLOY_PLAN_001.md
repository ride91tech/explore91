# Deployment plan 001 — the auth-swap release

**Status:** shipped. This began as a one-off plan for the auth-swap release
and has since been used as the standing deploy procedure, so §5-§7 are
maintained; the rest is kept as the record of that release.

**Last deploy:** 2026-11-15, `explore91-api-00025-sag` (erasure endpoint,
consent on every sign-in path).

> **Do not hardcode the serving revision in this document.** An earlier
> version named `explore91-api-00006-hqx` as the rollback target. Nineteen
> revisions later it still said so, which is worse than saying nothing: a
> rollback during a real incident would have routed traffic to code from
> months earlier. §5 step 0 now captures the live revision at deploy time.

---

## 1. Read this before approving

**After this deploy, nobody can sign in — at all.**

Google Sign-In has since been removed entirely, replaced by `/auth/dev`, a
placeholder that takes an email and issues a session without verifying
anything. It answers **404** unless `DEV_AUTH_ENABLED` is set, and that
variable must never be set on this service — anyone who could reach it could
sign in as any account, including an `ADMIN_EMAILS` address that can then
self-grant admin.

So the swap is "old login → no login" until OTP sign-in is built. Apple
Sign-In is still present and still returns 503 while `APPLE_AUDIENCES` is
unset, so it is not a way in either.

That is survivable if nobody is using the app yet. It is not if they are, and
I cannot tell you which: `backend/.env` points at localhost, and I am
deliberately not using the Atlas connection string that was pasted in chat
earlier — it should still be rotated. **You can settle it in a minute** by
hitting `/api/admin/users` with an admin token and looking at the count, or
by checking Atlas directly.

**The cheaper order is OAuth clients first, then deploy.** It costs ~15
minutes of console work and removes this window entirely. I would do that
unless you know there are no real users yet.

---

## 2. What ships

| | |
|---|---|
| Auth | `/auth/session` and `/auth/google` removed; `/auth/apple` verifies ID tokens against Apple's JWKS; `/auth/dev` is 404 unless `DEV_AUTH_ENABLED` |
| Security | Rate limiting moved to a shared store and no longer bypassable via `X-Forwarded-For`; session tokens hashed at rest |
| Public web | `/place/{slug}`, `/city/{slug}`, `/sitemap.xml`, `/robots.txt`, deep-link association files |
| Data | Place slugs, `place_interest`, new indexes, 28-state geography |
| Image | 27 packages instead of 74; no compiler toolchain |

**Schema changes are additive only.** Nothing is renamed, retyped or dropped,
which is what makes the rollback in §6 safe.

**Session continuity:** existing sessions keep working. Validation is
independent of how a session was created, and pre-hash rows are upgraded
atomically on first use rather than invalidated. Returning users keep their
account — sign-in matches on email and reuses the existing record,
preserving `user_id`, `wallet_points`, `roles` and `home_city`.

---

## 3. Environment variables on production

All eight below are **already set on production** and carry forward with
every deploy that does not pass `--set-env-vars` (see §5). This table is now
a record of what exists and why, not a list of things to set.

| Variable | Current value | If it went missing |
|---|---|---|
| `MONGO_URL` | secret reference | The service cannot start |
| `DB_NAME` | `explore91` | Wrong or missing database |
| `ADMIN_EMAILS` | two addresses | Nobody can reach the admin console |
| `PUBLIC_BASE_URL` | `https://explore91.com` — set 2026-10-25 when the domain went live | `canonical` and `og:url` on every server-rendered page point at the Cloud Run host, so search engines and link unfurls use the wrong address |
| `TRUSTED_PROXY_HOPS` | `1` | Defaults to 1 anyway; set explicitly so it is visible |
| `ALLOWED_ORIGINS` | `explore91.com`, `www.explore91.com`, `explore91.vercel.app` — set 2026-10-25 | Falls back to `*`, open to every origin. Note that setting it also flips `allow_credentials` to true, which is correct here because auth is a bearer token |
| `ANDROID_CERT_FINGERPRINTS` | debug + upload SHA-256 pair | `assetlinks.json` serves `[]` and deep links stop verifying |
| `DEV_AUTH_ENABLED` | `true` — **set deliberately, 2026-10-24**; still open as of 2026-11-15 | Unset is the safe default. See §10 |

---

## 4. Pre-deploy gates

Each must pass. Any failure stops the deploy.

1. **CI green on the commit being deployed**, or the local equivalent: the
   backend suite, run several times rather than once. It is **301 passed, 5
   skipped** as of 2026-11-15, up from 221 when this was written. Run it more
   than once on purpose — two tests in it are known to fail intermittently
   (`test_security.py::TestSEC003RateLimitBypass::test_429_carries_retry_after`
   and `test_admin_v7.py::TestRevenueReporting::test_cancelled`), and a single
   green run tells you less than you think.
2. **Runtime-only install boots.** A clean virtualenv on `requirements.txt`
   alone imports the app — already verified, 27 packages.
3. **Image builds.** Cloud Build must succeed; the Dockerfile lost its
   compiler toolchain this release, so a missing wheel would surface here.
4. **Atlas backup verified** by restoring to a scratch database, not by the
   backup merely existing.
5. **A human watching.** Do not deploy and walk away.

> **No staging environment exists.** Roadmap 0.2 calls for one and it has not
> been built. This deploy therefore goes straight to production, which is a
> real reduction in safety and the main argument for doing the canary in §5
> rather than cutting traffic over at once.

---

## 5. Deploy sequence

Deploy with **no traffic**, verify the new revision directly, then move
traffic in steps.

> **Never pass `--set-env-vars` on a routine deploy.** It *replaces* the
> whole environment rather than adding to it. The version of this section
> written for release 001 listed three variables; production now carries
> eight, so running it verbatim silently drops `MONGO_URL`, `DB_NAME`,
> `ADMIN_EMAILS`, `ALLOWED_ORIGINS` and `DEV_AUTH_ENABLED` — the service
> comes up unable to reach the database, with CORS reopened to every origin.
> Omit the flag and the per-revision env carries forward, which is the same
> property §6 relies on for rollback. To change one variable, use
> `--update-env-vars` as its own deploy, with a flags-file if the value
> contains a comma (see `deploy/allowed-origins.yaml`).

```bash
# 0. Capture what is serving NOW. This is the rollback target; write it down.
gcloud.cmd run services describe explore91-api --project explore91 \
  --region asia-south1 --format="value(status.traffic.revisionName)"

# 1. Build and deploy, serving nothing yet. No env flags - see above.
gcloud.cmd run deploy explore91-api --source backend --project explore91 \
  --region asia-south1 --no-traffic --tag next

# 2. Smoke the tagged revision directly (see §7). It has its own URL at
#    https://next---explore91-api-5hkjrcxhjq-el.a.run.app and takes no
#    production traffic. Confirm the eight env vars survived, not merely
#    that it answers 200: a Mongo-backed read, a CORS probe and the
#    canonical tag each prove a different variable is still there.

# 3. 10% while there is traffic to watch. See the note below.
gcloud.cmd run services update-traffic explore91-api --project explore91 \
  --region asia-south1 --to-tags next=10

# 4. 100% once clean.
gcloud.cmd run services update-traffic explore91-api --project explore91 \
  --region asia-south1 --to-latest
```

> **`gcloud.cmd`, not `gcloud`.** PowerShell's execution policy is
> `Restricted` on the dev machine, so the `.ps1` shim fails with a
> `SecurityError`. Git Bash can use bare `gcloud`.

> **On the 15-minute soak at 10%:** its purpose is to catch errors under real
> load. Pre-launch there is no load, so holding for fifteen minutes produces
> no signal and the step becomes theatre. Until there are users, send a burst
> of requests across the split, confirm they are clean, and promote. Once the
> app is public, hold the soak properly, watch error rate and p95 — and
> delete this note.

**Do not ship the APK in the same change window.** The API goes first and
stays backward-compatible; the app build follows only once the API is stable.
An installed app cannot be rolled back.

---

## 6. Rollback

| Layer | How | Time |
|---|---|---|
| API | Route traffic back to the revision captured in §5 step 0 | Seconds |
| Config | Env is baked per revision, so the rollback restores it too | Seconds |
| Database | **None, and none needed** — all changes are additive | — |
| Installed app | **Impossible.** Mitigated only by shipping the API first | — |

```bash
# <PREVIOUS> is what §5 step 0 printed before this deploy. If it was not
# captured, list the revisions and pick the one that was serving:
gcloud.cmd run revisions list --service explore91-api --project explore91 \
  --region asia-south1 --format="table(name, creationTimestamp)" --limit 10

gcloud.cmd run services update-traffic explore91-api --project explore91 \
  --region asia-south1 --to-revisions <PREVIOUS>=100
```

**Roll back if:** 5xx rate rises above baseline, p95 latency doubles, `/api/`
stops answering, or auth behaves differently from §7.

~~One caveat worth stating: rolling back the API does **not** un-hash session
tokens...~~ **No longer applies.** That caveat was about rolling back to
`00006`, which predated session-token hashing. Every revision you could now
roll back to hashes them, so a rollback no longer signs anyone out.

The caveat it leaves behind is the general one: a rollback restores code and
env, not data. Check whether the release wrote anything that an older
revision cannot read before assuming a rollback is clean.

---

## 7. Smoke tests

Against the tagged revision before any traffic, then again at 100%.

| # | Check | Expected |
|---|---|---|
| 1 | `GET /api/` | 200, `{"service":"Explore91"}` |
| 2 | `GET /api/cities` | 200, 11 cities |
| 3 | `GET /api/businesses?city=goa&limit=5` | 200, 5 places, each with a `slug` |
| 4 | `GET /api/reels/topics?city=goa` | 200, non-empty — **new in this release** |
| 5 | `GET /place/{slug}` | 200, HTML, `og:title` present |
| 6 | `GET /sitemap.xml` | 200, 3 cities listed, empty ones absent |
| 7 | `GET /.well-known/assetlinks.json` | 200, fingerprints present |
| 8 | `POST /api/auth/session` | **404** — confirms the old endpoint is gone |
| 9 | `POST /api/auth/google` with junk | **404** — the provider is gone |
| 9b | `POST /api/auth/dev` with any email | **200 while the test window is open** (see §10); **404** once it is closed, which is the state to return to |
| 10 | `GET /api/auth/me` with an existing session token | **200** — continuity held |
| 11 | `GET /api/admin/stats` without a token | 401 |
| 12 | `DELETE /api/auth/me` without a token | **401, not 405.** 405 means the route is missing, i.e. the backend is older than the web app, which ships a Delete button |
| 13 | `GET /api/categories` with `Origin: https://explore91.com` | `access-control-allow-origin` echoed back — proves `ALLOWED_ORIGINS` survived the deploy |
| 14 | the same with `Origin: https://evil.example.com` | **no** `access-control-allow-origin` header. The body is still 200; CORS is enforced by the browser on the missing header, not by the server refusing |
| 15 | `GET /place/{slug}` | `canonical` points at `explore91.com`, not a `run.app` host — proves `PUBLIC_BASE_URL` survived |

**Test 10 is the one that matters.** It is the difference between "login is
temporarily unavailable" and "everyone was signed out."

**Tests 13-15 exist because `--set-env-vars` was once in §5.** Each proves a
different variable is still present. A revision with a wiped environment
answers 200 on `/api/` and looks healthy right up until someone signs in.

---

## 8. Monitoring, first hour

- **Cloud Run metrics:** request count, 4xx/5xx rate, p95 latency, instance
  count, cold starts.
- **Logs:** `severity>=ERROR`, and specifically `rate_limit: store
  unavailable` — the limiter fails open, so that line is the only signal that
  it has stopped limiting.
- **Atlas:** connection count and slow queries. The new `place_interest` and
  `reviews` indexes build on first boot; on a large collection that is not
  instant.

```bash
gcloud.cmd run services logs read explore91-api --project explore91 \
  --region asia-south1 --limit 100
```

---

## 9. What I need from you

1. **Approve, or do OAuth clients first** (§1 — my recommendation).
2. **Values for the env vars in §3** that you want set now.
3. **Whether to skip the Atlas backup check** if you consider the data
   disposable at this stage. I will not skip it unless you say so.

---

## 10. The open test window — `DEV_AUTH_ENABLED=true`

**Set on production 2026-10-24, deliberately, so a test APK has a working
login.** Recording it here because every other line in this document says not
to, and a future reader following those lines would switch it off without
knowing it was a decision.

**Still open as of 2026-11-15, reaffirmed by the owner on 2026-10-25** after
the domain went live. The risk changed that day and the decision did not: the
bypass used to sit behind an unguessable `run.app` hostname and now sits
behind `explore91.com/admin`, which is the first address anyone would try. It
should not outlive OTP (roadmap §8d), where closing it is step 0.1e.

What it means while it is on:

- Anyone who knows the API URL can `POST /api/auth/dev` with any email and
  get a valid session. There is no credential.
- `ADMIN_EMAILS` is `valencio@ride91.green,valencio.vr7@gmail.com`. Signing in as either and
  calling `POST /auth/roles` grants admin, which is the whole admin console
  over the real `explore91` database.
- The URL is not secret: it is compiled into every APK.

To close it:

```bash
gcloud.cmd run services update explore91-api --project explore91   --region asia-south1 --remove-env-vars DEV_AUTH_ENABLED
```

To close only the admin escalation while leaving consumer sign-in working —
the admin console is web-only, so this costs nothing for testing from a
phone:

```bash
gcloud.cmd run services update explore91-api --project explore91 \n  --region asia-south1 --remove-env-vars ADMIN_EMAILS
```

Either takes effect on the next revision, within about a minute. Afterwards,
sessions already issued stay valid until they expire (7 days) or
`user_sessions` is cleared; dev-issued tokens are the ones whose
`session_token` digest belongs to a token starting `dev_`, and the
accompanying users are whatever emails were typed into the login screen.
