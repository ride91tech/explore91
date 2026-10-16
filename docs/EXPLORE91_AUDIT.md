# Explore91 — Technical & Product Audit

**Date:** 2026-10-16
**Commit audited:** `7eec27f`
**Method:** read-only inspection. No application code was changed, no database
commands were run, no secrets are reproduced here.

---

## 0. Scope correction — read this first

The brief describes a Lovable-built application with a Supabase backend. That
is not what this repository is. Three separate artifacts exist and they are
routinely confused with each other:

| Artifact | What it is | Backend | Status |
|---|---|---|---|
| **`explore91-emergent`** | The real product. Expo/React Native app + FastAPI API. Built on Emergent AI, now in Claude Code. Git repo, 3 commits this session. | FastAPI + MongoDB | **This is what the audit covers** |
| **`explore91.com`** | The live site. A static front-end prototype; every network request is an asset or analytics, data is bundled in a `cityStore` JS module. Lovable-built. | **None** | Design reference only |
| **`explore91-preview`** | A local 1,061-line single-file React prototype (`src/App.jsx`), lucide-react, no network calls. Covers an onboarding flow and an India map the other two lack. | **None** | Design reference only |

**There is no Supabase.** No Postgres, no Prisma, no Drizzle, no SQL layer of
any kind — verified by search across the repository. The persistence layer is
MongoDB accessed through Motor. Any plan that assumes a Supabase migration
path, row-level security, or Postgres features needs rewriting.

**There is no separate Business application.** Business functionality exists as
an `/owner/*` section inside the consumer app, sharing its codebase, auth and
deployment.

---

## 1. Technology stack

### Backend
FastAPI 0.110.1 · Uvicorn · Motor 3.3.1 (async MongoDB) · Pydantic v2 ·
PyJWT · python-dotenv

Deployed to **Google Cloud Run**, `asia-south1` (Mumbai), against **MongoDB
Atlas** co-located in GCP Mumbai. Service: `explore91-api`.

### Frontend
Expo SDK 57 · React Native 0.86.3 · React 19.2.3 · expo-router (file-based) ·
expo-video · expo-image · react-native-reanimated 4.5.1 · react-native-maps
1.27.2

Android build is configured for release signing, arm64-only, with a config
plugin that survives `expo prebuild`.

### Scale
- 31 backend source files, 76 API endpoints, 17 MongoDB collections
- 36 frontend screens, 9 backend test files, 193 passing tests

---

## 2. Dependency assessment

**9 of 28 backend dependencies are declared but never imported by application
code:**

`boto3`, `pandas`, `numpy`, `jq`, `typer`, `passlib`, `bcrypt`, `python-jose`,
`requests-oauthlib`

`pandas` + `numpy` + `boto3` alone add hundreds of megabytes to the container
image, lengthening every Cloud Build and every cold start. `passlib`, `bcrypt`
and `python-jose` are the remnants of a password-based auth scheme that no
longer exists — their presence implies a security surface the app does not
actually have.

`requests` is imported **only by tests** (9 test files, zero application
files) but is declared as a runtime dependency.

**6 frontend dependencies are unused:** `react-native-webview`,
`react-native-dotenv`, `date-fns`, `dayjs`, `expo-blur`, `expo-symbols`.
Shipping both `date-fns` and `dayjs` while using neither is pure bundle weight.

`react-native-maps` is declared and imported in exactly **one** file — the map
experience the product direction depends on is effectively unbuilt.

---

## 3. Feature inventory

### What exists and works

| Area | State |
|---|---|
| City discovery, 11 cities with state/region/content counts | Working |
| Place listings, detail pages, categories (24), search, trending, featured | Working |
| Reels feed with topic rails and per-type CTAs | Working |
| Place interest — Interested / Going / Visited | Working |
| Journey tracking — cities, 28 states, 8 UTs counted apart | Working |
| Saved places (bookmarks) | Working |
| Reviews with ratings | Working |
| Bookings (recorded, not charged — see §9) | Partial |
| Admin console — businesses, cities, categories, banners, reels, users, tickets, fraud flags, audit trail, GMV reports | Working |
| Owner portal — listings, bookings, staff, analytics | Working |
| AI concierge — recommendations, itineraries | **Broken in production** (§10) |

### What the product direction requires and does not exist

Every item below was verified absent by search, not assumed:

| Target feature | Status |
|---|---|
| Friends / followers | **Absent** |
| Circles (private groups) | **Absent** |
| Collections | **Absent** |
| Collaborative trip planning | **Absent** |
| Voting on places or dates | **Absent** |
| WhatsApp invites | **Absent** |
| Shareable links / invite codes | **Absent** |
| "Who's Up?" quick outings | **Absent** |
| Video → trip plan conversion | **Absent** |
| Creator profiles | **Absent** |
| Instagram creator marketplace | **Absent** |
| Campaign booking & reporting | **Absent** |
| Business subscriptions / billing | **Absent** |
| Separate Business application | **Absent** |

Earlier keyword searches appeared to find "circles", "groups", "friends",
"creator" and "campaign". On inspection every hit was a false positive —
`checkmark-circle` icon names, MongoDB `$group` stages, `CityGroupT`, the word
"Friends" as an AI party-size option, and "campaigns" in banner copy. **None of
the target product direction is built.**

The social layer is not a gap in an otherwise-social product. It is the entire
product, unstarted.

---

## 4. Architecture

```
Expo app (iOS / Android / web)
    │  bearer token, JSON over HTTPS
    ▼
FastAPI on Cloud Run (asia-south1)
    │  Motor (async)
    ▼
MongoDB Atlas (GCP Mumbai)
```

`server.py` is a thin composer mounting 10 routers under `/api` via a FastAPI
`lifespan` handler. Domain separation is clean: `auth`, `catalog`,
`interactions`, `journey`, `places`, `portal`, `admin`, `ai`, `reels`,
`tickets`. This structure is sound and worth preserving.

The admin console is the Expo **web** build of the same codebase, gated by
role. It is **not currently deployed** — only `explore91-api` runs on Cloud Run.

---

## 5. Data model

17 collections, no schema enforcement at the database layer, no migration
framework, no schema versioning. Shape is governed only by Pydantic models at
the API boundary, which means any document written before a model changed
retains its old shape indefinitely.

**31 indexes** are created at startup in `seed/seed.py:135` — including a TTL
index on `user_sessions.expires_at` and compound indexes on the hot read paths
(`businesses` by city+category, `reels` by city+created_at). This is better
than typical for a project at this stage.

**Two collections have no indexes at all:**
- `place_interest` — queried by `user_id` on every Trips load and every reel
  feed load. Needs `{user_id, business_id}` unique and `{user_id, updated_at}`.
- `reviews` — queried by `business_id` on every place page.

Both will table-scan. `place_interest` is the more urgent of the two because it
is read on three separate screens.

**No migrations** means there is no way to backfill a new field across existing
documents, and no record of what shape the data was at any past point.

---

## 6. Authentication & roles

Google and Apple Sign-In. The client obtains an ID token; the backend verifies
it against the provider's published JWKS — issuer, audience, expiry and
signature are all checked. This is the correct design and it replaced a
third-party-hosted login that previously sat in the auth path.

Sessions are **opaque random tokens** (`g_` + two UUID4 hex values, ~244 bits)
stored in `user_sessions` with a 7-day TTL, held client-side in
`expo-secure-store` (Keychain / Keystore; `AsyncStorage` on web).

Three roles — `customer`, `owner`, `admin` — as an array on the user document.
`admin` can only be self-granted by an address in `ADMIN_EMAILS`; everyone else
receives 403. There is a test holding that in place.

### Problems

1. **Session tokens are stored unhashed.** A read-only leak of `user_sessions`
   yields directly usable sessions for every logged-in user. Store a SHA-256
   hash and compare hashes.
2. **Two database round-trips per authenticated request** — session lookup then
   user lookup, on every single call. At the stated target of ~1M users this is
   the hottest path in the system.
3. **No refresh or rotation.** A 7-day token is valid for 7 days, full stop;
   there is no revocation beyond deleting the row and no re-issue on use.

---

## 7. Security & privacy risks

Ranked by exposure.

### High

**7.1 — Rate limiting does not work in production.**
`core/security.py:20` holds rate-limit buckets in a process-local dict, with a
comment stating production should use Redis. Production is autoscaled Cloud
Run, so the effective limit is `limit × instance_count`, and buckets reset
whenever an instance recycles. Review spam, reel-view inflation and auth
hammering are all effectively unlimited under load — precisely when limits
matter.

**7.2 — The rate-limit key is attacker-controlled.**
`client_key()` at `core/security.py:40` takes the **first** value of
`X-Forwarded-For`. Clients can send that header themselves; Cloud Run appends
rather than replaces. Rotating a fake XFF value per request defeats IP-based
limiting entirely, including on the unauthenticated paths where it is the only
control.

**7.3 — CORS is open to all origins in production.**
`ALLOWED_ORIGINS` is unset on the deployed service, so it defaults to `*`.
`allow_credentials` is correctly disabled in that case and auth is a bearer
token rather than a cookie, which limits the damage — but any site can call the
API with a token it has obtained.

### Medium

**7.4 — Session tokens unhashed at rest** (see §6).

**7.5 — No request size or upload limits** beyond Pydantic field lengths.

**7.6 — Admin audit trail cannot be verified.** `admin_audit` records actions
but is append-only by convention, not enforcement; an admin with database
access can rewrite it.

### Handled well

- Both `.env` files are gitignored; **no secrets are tracked in git** (verified).
- User input is escaped before being used in MongoDB regex searches
  (`catalog.py`), closing a ReDoS vector.
- Stored URLs are validated against an `https://`-only pattern.
- `_id` is projected out of every response, so Mongo internals never leak.
- The test suite refuses to run against a non-localhost target unless
  `ALLOW_REMOTE_TESTS=1`, preventing destructive tests firing at production.

---

## 8. Performance, responsiveness & accessibility

### Performance
- 31 indexes cover most hot paths; two collections do not (§5).
- Two DB round-trips per authenticated request (§6).
- `/cities/grouped` runs two aggregations per call; acceptable at 11 cities,
  worth caching at 100.
- Container image is inflated by ~hundreds of MB of unused dependencies (§2),
  which lengthens cold starts on a scale-to-zero service.

### Responsiveness
Four screens read `Dimensions.get("window")` once at render and never update:
`reels.tsx:35`, `business/[id].tsx:163`, `city.tsx:29`, `login.tsx:17`. The
reels screen uses that value for full-screen page height, so **rotating the
device or resizing breaks the pager**. `useWindowDimensions` is the reactive
API and is already used elsewhere in the codebase.

### Accessibility
**189 `testID` props against 2 `accessibilityLabel` and 2 `accessibilityRole`.
Zero `accessibilityHint`, zero `allowFontScaling`.**

Icon-only controls — close, like, share, mute, the city-picker dismiss — carry
no labels, so they are announced as unlabelled buttons under TalkBack and
VoiceOver. The app is not usable by a screen-reader user today, and this is
also an App Store and Play Store review risk.

---

## 9. Monetization — reality check

**There is no payment integration of any kind.** No Razorpay, Stripe, PayU,
Paytm, PhonePe or Cashfree; no payment intent, no checkout session. Verified by
search.

Despite that, the admin console reports **GMV and platform fees at a 5% take
rate** (`admin.py:28`). Those figures are computed from `amount_inr` on booking
documents. And `amount_inr` is frequently an **estimate**: when a booking does
not match a priced service, `interactions.py` derives the amount from the
business's price band (`$` → ₹400, `$$` → ₹1,200, and so on) and tags it
`amount_source: "estimate"`.

So the revenue dashboard reports money that was never charged, partly derived
from guessed prices. Anyone reading it as revenue will be wrong. The
`amount_source` field means the distinction is at least recoverable.

**Wallet points are an unbacked liability.** Users receive 500 points on signup
and 50 per booking. The balance is displayed in the profile and the admin user
table. **There is no redemption path anywhere in the codebase.** Points
accumulate forever and can never be spent. This also contradicts the direction
set by the site, which uses badges and achievements and has no points concept.

---

## 10. Incomplete features, broken flows & technical debt

| # | Issue | Evidence |
|---|---|---|
| 1 | **Login will break on the next deploy.** `/auth/session` is deleted from the repo, `/auth/google` replaces it, but `GOOGLE_CLIENT_IDS` is unset on Cloud Run. Production still runs the old revision. Deploying anything — including unrelated fixes — ships the removal and takes login down. | Cloud Run env vars: `DB_NAME`, `ADMIN_EMAILS`, `MONGO_URL` only |
| 2 | **AI concierge is dead in production.** `routes/ai.py` requires `ANTHROPIC_API_KEY`, which is not set. The "Explore91 Concierge" button on the home screen returns 502. | 2 failing tests |
| 3 | **8 of 11 cities have no content.** Jaipur, Udaipur, Mumbai, Varanasi, Leh, Kochi, Shillong, Delhi have zero businesses and zero reels. Pune has 26 businesses but **zero reels**. | Live API counts |
| 4 | **No shareable links.** `Share.share()` sends text only, no URL. | `reels.tsx:155` |
| 5 | **No deep linking.** Custom scheme `explore91` only — no iOS `associatedDomains`, no Android `intentFilters`. A link to a place cannot open the app. | `app.json` |
| 6 | **No SEO and no public web pages.** The app has no public web presence; the only web surface is the admin console, which is unindexed by design and currently undeployed. | — |
| 7 | **3 tests fail from shared state.** `TestAdminPanel` passes a business id between tests through `request.config.cache`, which breaks across xdist workers and across runs. Confirmed pre-existing against a clean checkout of `HEAD`. | — |
| 8 | **Admin console is not deployed.** `Dockerfile.web`, `nginx.conf` and `.gcloudignore` exist; only `explore91-api` runs. | Cloud Run service list |
| 9 | **Login copy contradicts the product.** "Discover, **book**, and live your city… **book** across restaurants, hotels, spas, events" on a discovery-first product. | `login.tsx` |
| 10 | **Seeded content is incoherent.** Captions are randomised across businesses — a "Signature massage" caption on a cafe reel, "Adventure day pass" on a salon. | Reels feed |
| 11 | 11 TypeScript errors remain, all pre-existing (icon `glyphMap` typing, nullable `user` in `admin/_layout.tsx`). | `tsc --noEmit` |
| 12 | No CI. Tests exist and pass but nothing runs them automatically. | — |
| 13 | Repository folder is still named `explore91-emergent`. | — |

---

## 11. Priority-ranked issues

**P0 — blocks shipping anything**
1. `GOOGLE_CLIENT_IDS` unset; next deploy breaks login (§10.1)
2. Rate limiting ineffective and bypassable (§7.1, §7.2)

**P1 — material risk or user-visible breakage**
3. No payment integration while reporting GMV and fees (§9)
4. Wallet points as an unbacked, unredeemable liability (§9)
5. Session tokens unhashed at rest (§6)
6. AI concierge returns 502 in production (§10.2)
7. Accessibility effectively absent (§8)
8. 8 of 11 cities empty (§10.3)

**P2 — scale and correctness**
9. Missing indexes on `place_interest` and `reviews` (§5)
10. Two DB round-trips per authenticated request (§6)
11. CORS open to all origins (§7.3)
12. Static `Dimensions` reads break rotation (§8)
13. ~9 unused backend dependencies inflating the image (§2)

**P3 — hygiene**
14. No CI; 3 tests fail from shared state
15. No migration framework
16. Unused frontend dependencies
17. Login copy contradicts positioning

---

## 12. Recommended architecture

**Keep:** the modular FastAPI router layout, Mumbai co-location of API and
database, JWKS-based token verification, the Expo/expo-router app, the config
plugin approach to Android build settings, the existing index strategy.

**Change:**

1. **Sessions → signed, short-lived access tokens + refresh tokens.** Removes
   the per-request session lookup and makes revocation explicit. Store only
   hashes of refresh tokens.
2. **Rate limiting → Redis** (Memorystore, same region), keyed on user id where
   authenticated and on Cloud Run's trusted client IP otherwise — never on
   raw `X-Forwarded-For`.
3. **Add a migration runner.** Even a simple forward-only script table makes
   schema change safe.
4. **Introduce a social-graph domain** before any social feature is built:
   `follows` / `circles` / `circle_members`, with the privacy model decided
   up front. Retro-fitting privacy onto a built social graph is where these
   products go wrong.
5. **Payments as its own module** behind an interface, so the provider is
   swappable and GMV reporting can distinguish *recorded*, *authorised* and
   *settled*.
6. **Split the Business app only when it earns its own release cycle.** Until
   then, keep `/owner/*` in the same codebase behind role gating — a second app
   is a second deployment, a second store listing and a second auth surface.

**Do not** migrate to Supabase. The brief presumes it; nothing in the codebase
uses it. A migration would mean rewriting 76 endpoints and 17 collections for
no stated product benefit.

---

## 13. What this audit did not cover

Stated plainly so it is not mistaken for a clean bill of health:

- No load testing or profiling was performed; performance findings are from
  reading code and index definitions.
- No penetration testing; security findings are from code inspection.
- The Android release build was not produced or tested during this audit.
- iOS has never been built — there is no Apple developer account configured and
  no iOS build has been attempted.
- Cost modelling for Cloud Run and Atlas at the stated scale was not done.
