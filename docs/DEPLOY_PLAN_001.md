# Deployment plan 001 — the auth-swap release

**Status:** awaiting approval. Nothing has been deployed.
**Deploying:** `main` @ `1014350`, 11 commits ahead of production.
**Currently serving:** `explore91-api-00006-hqx`, 100% of traffic.

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

## 3. Environment variables to set with the deploy

Four are new. Deploying without them is not fatal but degrades behaviour.

| Variable | Value | If omitted |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://explore91-api-5hkjrcxhjq-el.a.run.app` for now; the real domain once it points here | Link previews fall back to the request origin — wrong behind a proxy |
| `TRUSTED_PROXY_HOPS` | `1` | Defaults to 1 anyway; set it explicitly so it is visible |
| `ALLOWED_ORIGINS` | the admin console origin, once deployed | Stays `*` — open to any origin |
| `ANDROID_CERT_FINGERPRINTS` | the debug + upload SHA-256 pair | `assetlinks.json` serves `[]`; deep links will not verify |
| `DEV_AUTH_ENABLED` | `true` — **set deliberately, 2026-10-24** | Unset is the safe default. See the note below |

---

## 4. Pre-deploy gates

Each must pass. Any failure stops the deploy.

1. **CI green on the commit being deployed.** Not yet possible — the push to
   GitHub is blocked on the PAT's missing `workflow` scope, so CI has never
   run. Until then the local equivalent stands in: 221 passed, 4 skipped,
   verified across four parallel and two serial runs.
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

```bash
# 1. Build and deploy, serving nothing yet.
gcloud run deploy explore91-api --source backend --project explore91 \
  --region asia-south1 --no-traffic --tag next \
  --set-env-vars "^|^PUBLIC_BASE_URL=...|TRUSTED_PROXY_HOPS=1|ANDROID_CERT_FINGERPRINTS=..."

# 2. Smoke the tagged revision directly (see §7). It has its own URL and
#    takes no production traffic.

# 3. 10% for 15 minutes, watching error rate and p95 latency.
gcloud run services update-traffic explore91-api --project explore91 \
  --region asia-south1 --to-tags next=10

# 4. 100% once clean.
gcloud run services update-traffic explore91-api --project explore91 \
  --region asia-south1 --to-latest
```

**Do not ship the APK in the same change window.** The API goes first and
stays backward-compatible; the app build follows only once the API is stable.
An installed app cannot be rolled back.

---

## 6. Rollback

| Layer | How | Time |
|---|---|---|
| API | Route traffic back to `explore91-api-00006-hqx` | Seconds |
| Config | Env is baked per revision, so the rollback restores it too | Seconds |
| Database | **None, and none needed** — all changes are additive | — |
| Installed app | **Impossible.** Mitigated only by shipping the API first | — |

```bash
gcloud run services update-traffic explore91-api --project explore91 \
  --region asia-south1 --to-revisions explore91-api-00006-hqx=100
```

**Roll back if:** 5xx rate rises above baseline, p95 latency doubles, `/api/`
stops answering, or auth behaves differently from §7.

One caveat worth stating: rolling back the API does **not** un-hash session
tokens. Rows upgraded under the new revision stay hashed, and `00006` looks
sessions up by raw token — so anyone who made a request during the canary
would be signed out by a rollback. They can sign in again; nothing is lost.
It is the one non-reversible effect in this release.

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

**Test 10 is the one that matters.** It is the difference between "login is
temporarily unavailable" and "everyone was signed out."

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
gcloud run services logs read explore91-api --project explore91 \
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

What it means while it is on:

- Anyone who knows the API URL can `POST /api/auth/dev` with any email and
  get a valid session. There is no credential.
- `ADMIN_EMAILS` is `valencio@ride91.green`. Signing in as that address and
  calling `POST /auth/roles` grants admin, which is the whole admin console
  over the real `explore91` database.
- The URL is not secret: it is compiled into every APK.

To close it:

```bash
gcloud run services update explore91-api --project explore91   --region asia-south1 --remove-env-vars DEV_AUTH_ENABLED
```

To close only the admin escalation while leaving consumer sign-in working —
the admin console is web-only, so this costs nothing for testing from a
phone:

```bash
gcloud run services update explore91-api --project explore91   --region asia-south1 --remove-env-vars ADMIN_EMAILS
```

Either takes effect on the next revision, within about a minute. Afterwards,
sessions already issued stay valid until they expire (7 days) or
`user_sessions` is cleared; dev-issued tokens are the ones whose
`session_token` digest belongs to a token starting `dev_`, and the
accompanying users are whatever emails were typed into the login screen.
