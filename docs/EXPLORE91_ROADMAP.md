# Explore91 — Implementation Roadmap (revised)

**Supersedes:** the first roadmap draft.
**Baseline:** `docs/EXPLORE91_AUDIT.md`, accepted as the planning baseline.
**Product:** Indian place discovery through creator content, with collaborative
outings and group trip planning.
**Status:** in progress. Phase 0 is closed except for staging and
`ALLOWED_ORIGINS`; Phase 1 shipped in full; the app's interface was rebuilt
against explore91.com. **Last reconciled against production: 2026-10-24** —
see §8c for what changed and §10 for what happens next.

---

## 1. What changed from the first draft

The first draft sequenced the full social graph (friends → circles → trips)
before anything collaborative shipped. The revised priorities invert that, and
they are right to: a trip planner that works for a group assembled by a link
does not need a permanent social graph, and building the graph first delays the
thing people actually want by months.

Four consequences follow, and they shape everything below:

1. **Trip membership is not friendship.** A trip has members; membership comes
   from an invite link and dies with the trip. Friends and Circles arrive later
   as a convenience for *re-assembling* known groups — not as a prerequisite.
2. **Public place pages move from "someday" to load-bearing.** They are
   priority 2, and they also unblock priority 5 (invite previews for people
   without accounts). One piece of infrastructure, two product outcomes.
3. **Revenue is no longer gated behind the consumer MVP.** Business
   subscriptions touch the owner/admin domain, not the trip domain, so they can
   run on a parallel track. See §6 — this is the single biggest schedule lever.
4. **Flash deals and travel commissions are out of scope.** The audit's finding
   that admin reports GMV on uncharged bookings still needs resolving, but as
   *reporting hygiene*, not as a payments project.

---

## 2. The public web surface — ~~decision needed~~ **SETTLED: Option A, built**

> **Resolved 2026-10-22.** Option A was chosen and shipped: Jinja2 templates on
> a root-mounted router inside the existing FastAPI service. No second runtime
> was added. The sizing below is kept because the reasoning still governs the
> replacement path — Option A can become Option B later without changing URLs,
> and the URLs are now live and shareable, so that property has gone from
> theoretical to load-bearing.

Priority 2 requires public, search-indexable place pages with WhatsApp
previews. *(At the time of writing:)* **No public web surface exists today.**
The only web build is the admin console, which is unindexed by design and
currently undeployed.

Priority 10 says keep Expo/FastAPI/MongoDB unless a change is justified. That
rules the options as follows:

| | **Option A — FastAPI-rendered pages** *(recommended)* | **Option B — separate SSR app** |
|---|---|---|
| Stack | Jinja2 templates served by the existing FastAPI service | New Next.js/Remix app, new deployment |
| Honours priority 10 | Yes — no new runtime, reuses the data layer | No — adds a second runtime and release cycle |
| SEO quality | Good. Server-rendered HTML, real URLs, sitemap, OG tags | Marginally better (image optimisation, richer routing) |
| Effort | **2–3 weeks** | **5–7 weeks** + ongoing maintenance |
| Risk | Template rendering inside an API service; keep it on a separate router | Second codebase drifts from the app's data model |

**Recommendation: Option A.** The gap in SEO quality does not justify a second
runtime at this stage, and Option A can be replaced by Option B later without
changing URLs. All estimates below assume Option A.

---

## 3. MVP vs later

**MVP** — the smallest thing that delivers "discovery through creator content,
with collaborative outings":

- Production stabilised (auth, rate limiting, deploy safety)
- Public place pages, deep links, WhatsApp previews
- User identity: handles, private-by-default visibility
- Minimal collaborative trip planner
- Trip invites by URL, with preview access for people without accounts
- Creator attribution on reels
- Public collections

**Later enhancements** — valuable, explicitly not MVP:

- Friends and Circles
- Business Pro / Premium subscriptions *(revenue — but see §6 on running this
  in parallel rather than after)*
- Instagram creator marketplace and the 20% campaign commission
- Travel booking commissions, flash deals
- Separate Business application
- Richer trip features: budgets, expense splitting, offline itineraries

---

## 4. Phases

Effort is in **engineer-weeks for one experienced full-stack engineer**. See §7
for what that assumes and where it is least reliable.

### Phase 0 — Stabilise production *(MVP, blocking everything)*

**Depends on:** nothing. **Effort: 2–3 weeks.**

| # | Work | Status | Acceptance criteria |
|---|---|---|---|
| 0.1 | ~~Google OAuth clients~~ → **OTP sign-in** | **SUPERSEDED — now the critical path, see §8d** | Google Sign-In was built, then removed entirely on 2026-10-23. `/auth/dev` stands in: it takes an email and issues a session, verifying nothing. Real sign-in is now OTP |
| 0.2 | **Staging environment**: second Cloud Run service + separate Atlas database | **NOT DONE** | Staging runs the same image as the next production deploy, against data that is not production's |
| 0.3 | Deploy the auth replacement behind the gates in §8 | **DONE 2026-10-22** | Deployed by canary at 0% → 100%. `/auth/session` → 404, `/auth/google` → 404. Sessions issued before the deploy still validate |
| 0.4 | Rate limiting → shared store, keyed on trusted identity | **DONE** | MongoDB-backed fixed-window limiter; `TRUSTED_PROXY_HOPS` reads the last XFF entry, so a rotating prefix does not buy a fresh budget. Regression-tested |
| 0.5 | Set `ALLOWED_ORIGINS`; hash session tokens at rest | **HALF DONE** | Session tokens are SHA-256 at rest and pre-hash rows upgrade atomically on first use. **`ALLOWED_ORIGINS` is still unset — CORS is open to any origin** |
| 0.6 | Indexes on `place_interest` and `reviews`; drop 9 unused backend deps | **DONE** | Indexes build on boot; the runtime image is 27 packages instead of 74, and CI proves it installs the app on its own |
| 0.7 | CI running the test suite on every push | **DONE** | Two jobs on every push; backend 247 passed / 6 skipped, frontend typecheck is a hard zero-error gate |
| 0.8 | Decide the AI concierge: key it or remove the entry point | **DONE** | Entry point removed |
| 0.9 | ~~**Fix test isolation**~~ | **DONE 2026-10-17** | Id handoffs replaced with per-test fixtures, the blanket row sweep removed, the Motor client resolved per event loop. Passes repeatedly in both modes with nothing excluded; the CI deselects are gone |

**Exit:** deploying is routine rather than risky, and the three P0/P1 security
findings from the audit are closed.

> **Phase 0 is not closed.** Two items remain — 0.2 staging and the
> `ALLOWED_ORIGINS` half of 0.5 — and 0.1 has been replaced by a larger piece
> of work than it originally described. Everything shipped so far has gone
> straight to production because there is nowhere else to send it.

> **Rate-limit store (sub-decision):** Memorystore Redis is the obvious choice
> but adds a VPC connector and ~₹3–5k/month. Cloud Armor rate limiting at the
> load balancer is cheaper and needs no code, but only rate-limits by IP.
> A MongoDB-backed limiter adds no infra but adds a write per request.
> Recommend Cloud Armor for IP-level abuse plus a Mongo-backed limiter for
> per-user limits, and revisit Redis when traffic justifies it.

---

### Phase 1 — Public place pages, deep links, previews *(MVP)*

**Depends on:** 0.1–0.3 (a deploy must be safe). **Effort: 2.5–3.5 weeks.**
**Status: SHIPPED 2026-10-22.**

| # | Work | Status | Acceptance criteria |
|---|---|---|---|
| 1.1 | Public place pages at `explore91.com/place/{slug}`, server-rendered | **DONE** | Jinja2 templates on a root-mounted router (Option A). A crawler with JavaScript disabled sees the name, photo, area, description and city |
| 1.2 | Public city pages; `sitemap.xml`; `robots.txt`; canonical URLs | **DONE** | Cities with no content are omitted from the sitemap and marked `noindex`, so the content gate below is enforced in code rather than by discipline |
| 1.3 | Open Graph + Twitter card tags | **DONE** | Absolute URLs, tested. **Not yet verified in WhatsApp itself** — the acceptance criterion asks for that specifically and it is outstanding |
| 1.4 | iOS Universal Links + Android App Links | **ANDROID DONE** | `assetlinks.json` serves the debug and upload fingerprints and is in the production environment. **iOS is withheld deliberately** — `IOS_APP_ID` is unset, so the association file 404s rather than baking in a wrong appID that iOS would cache |
| 1.5 | Share sheet sends real URLs | **DONE** | Sends `message` and `url` both, since iOS reads one and Android the other |
| 1.6 | Slugs for places, stable and unique | **DONE** | Assigned at creation, backfilled on boot, and assigned on demand for any record that slips through |

**Exit:** a place can be shared into WhatsApp, previews correctly, opens the app
when installed, and is indexable by Google.

> **Two gaps against that exit condition**, both small and both real: the
> WhatsApp preview has never been checked in WhatsApp, and iOS deep links are
> off until there is an Apple developer account.

> **Dependency note:** 1.1–1.4 are the same infrastructure priority 5 needs for
> invite previews. Building it here means Phase 3 gets it free.

> **Content gate:** 8 of 11 cities have zero places. Indexing empty city pages
> invites thin-content penalties. Either fill them or exclude them from the
> sitemap until they have content.

---

### Phase 2 — Identity, handles, private-by-default *(MVP)*

**Depends on:** Phase 0. Can start while Phase 1 is in flight.
**Effort: 2.5–3 weeks.**

| # | Work | Acceptance criteria |
|---|---|---|
| 2.1 | Public handles (`@handle`), display name, avatar, bio | Unique case-insensitively; reserved words blocked; changing a handle does not break existing links |
| 2.2 | **Visibility model**, enforced in one shared check, default **private** | A stranger cannot see another user's journey, saves or trips; enforcement is one function, not a per-endpoint convention |
| 2.3 | Per-surface visibility settings (journey / saves / collections: private, link-only, public) | Changing a setting takes effect immediately for already-shared links |
| 2.4 | Refresh tokens; short-lived access tokens | Revoking a session ends access within the access-token lifetime; the per-request double DB lookup is gone |
| 2.5 | Block and report a user | A blocked user's content disappears from the blocker's surfaces immediately |

**Exit:** users are referable by handle, and nothing about a user is visible
unless they chose to make it so.

> This is the phase it is most expensive to get wrong. Retrofitting privacy
> onto a populated social product is how these leak.

---

### Phase 3 — Minimal collaborative trip planner *(MVP)*

**Depends on:** Phase 2 (identity), Phase 1 (invite previews).
**Effort: 5–7 weeks.** The largest single phase.

| # | Work | Acceptance criteria |
|---|---|---|
| 3.1 | Trip: title, city, date range, owner, members, status | A trip survives a member leaving; the owner cannot be removed by a member; deleting requires confirmation |
| 3.2 | Trip membership by invite link, with roles (owner / editor / viewer) | Membership is per-trip and ends with the trip; no permanent relationship is created |
| 3.3 | Day-by-day itinerary; add places from search, a place page, or a reel | Adding from a reel is two taps and updates for every member |
| 3.4 | Concurrent editing that does not silently lose work | Two members editing the same day produce a visible, resolvable result — last-write-wins is acceptable only if the loser is *told* |
| 3.5 | Voting on places and dates | One changeable vote per member; results hidden until the member votes or voting closes |
| 3.6 | **Invite by URL with preview for people without accounts** | A logged-out recipient sees trip name, dates, city and the itinerary at the agreed visibility level, and is prompted to sign in only to participate |
| 3.7 | Trip activity feed | A member returning after a day sees what changed without reading every item |
| 3.8 | "Who's Up?" — short-lived outing polls | Polls expire on their own; a non-responder is nagged at most once |

**Exit:** a group plans a real weekend end to end without leaving for WhatsApp.

> **Open decision blocking 3.6:** what a logged-out viewer sees. Itinerary only?
> Member names? Member avatars? Showing names leaks who someone travels with to
> anyone holding the link. Recommend: trip name, dates, city and places — **no
> member identities** — until the viewer joins.

---

### Phase 4 — Creator attribution and public collections *(MVP)*

**Depends on:** Phase 2 (identity), Phase 1 (public pages).
**Effort: 3–4 weeks.** Can overlap Phase 3's second half.

| # | Work | Acceptance criteria |
|---|---|---|
| 4.1 | Creator profiles; reels attribute to a creator | Tapping attribution opens the creator's profile and their reels |
| 4.2 | Public creator pages on the web | A creator's page is indexable and shareable |
| 4.3 | Collections: group saved places, name them, set visibility | A collection honours Phase 2 defaults; public collections are indexable |
| 4.4 | Collection and creator links preview in WhatsApp | Same card quality as place links |

**Exit:** creators have a reason to share Explore91 links, and those links bring
people back in. This is the organic growth loop.

> Phase 4 also lays the creator identity foundation that Phase 7 requires.

---

### Phase 5 — Friends and Circles *(later)*

**Depends on:** Phase 3 shipped and in real use. **Effort: 4–5 weeks.**

Deliberately after trips: build it once you know how groups actually re-form.

| # | Work | Acceptance criteria |
|---|---|---|
| 5.1 | Friends: request, accept, remove; blocking is mutual and immediate | A blocked user cannot see content or re-request |
| 5.2 | Circles: named reusable groups | Starting a trip from a Circle pre-fills members in one tap |
| 5.3 | Friends-only visibility tier | Slots into Phase 2's model without new enforcement paths |
| 5.4 | Contact discovery — **opt-in, ship last or cut** | No contact leaves the device without explicit consent; declining costs no functionality |

> 5.4 is the largest privacy exposure in this plan and attracts regulatory
> attention in India under the DPDP Act. Recommend cutting it from this phase.

---

### Phase 6 — Business subscriptions *(revenue; runs in parallel — see §6)*

**Depends on:** Phase 0. **Not dependent on Phases 1–5.**
**Effort: 5–8 weeks**, with the widest uncertainty in the plan.

| # | Work | Acceptance criteria |
|---|---|---|
| 6.1 | Define the Pro (₹1,499) vs Premium (₹9,999) feature matrix | Written down; every gated feature maps to a tier; the 6.7× price gap is defensible to a merchant |
| 6.2 | Razorpay Subscriptions with UPI Autopay / e-mandate | A merchant subscribes, is charged on renewal, and can cancel; a failed renewal retries then downgrades |
| 6.3 | Tier gating in the owner portal and in listing presentation | A lapsed subscription downgrades the listing without deleting it or its data |
| 6.4 | GST-compliant invoicing (18% on B2B SaaS) | Every charge produces a numbered invoice with GSTIN; merchants can download invoices |
| 6.5 | Fix the GMV reporting fiction from the audit | Admin separates *subscription revenue* (real) from *recorded booking value* (not charged, partly estimated) and labels them so |
| 6.6 | Dunning, grace period, refund handling | A merchant whose card fails is warned before downgrade |

> **Why the range is wide:** RBI's e-mandate rules for recurring payments, the
> merchant onboarding and KYC flow, and GST invoicing are each capable of
> adding a week on their own. The code is not the hard part.

---

### Phase 7 — Instagram creator marketplace *(later)*

**Depends on:** Phase 4 (creator identity) **and** Phase 6 (payments proven).
**Effort: 8–14 weeks.** The least certain estimate here.

| # | Work | Acceptance criteria |
|---|---|---|
| 7.1 | Instagram Graph API integration for creator stats | Token expiry and rate limits handled without breaking the profile |
| 7.2 | Campaign lifecycle: brief → quote → accept → deliver → approve | Both sides see one state; disputes have an audit trail |
| 7.3 | **20% commission on completed bookings** | Commission is computed on an agreed base (see §9) and is visible to both sides before acceptance |
| 7.4 | Creator payouts with KYC | A creator is onboarded, verified, and paid on an agreed schedule |
| 7.5 | TDS under s.194-O and GST handling | Deductions are correct, documented, and reflected in creator statements |
| 7.6 | Campaign reporting | Metrics reconcile with the source platform |

> **Start the paperwork early.** Instagram Graph API access needs app review and
> business verification — weeks of calendar time, little of it engineering. If
> Phase 7 matters, begin during Phase 4.
>
> **This phase makes Explore91 a money intermediary.** Holding funds between
> business and creator brings KYC, TDS, GST and possibly payment-aggregator
> considerations. Get this reviewed by someone qualified before building it;
> the engineering estimate assumes that review does not force a different model.

---

## 5. Dependency graph

```
Phase 0  Stabilise ──┬──► Phase 1  Public pages ──┐
                     │                            │
                     ├──► Phase 2  Identity ──────┼──► Phase 3  Trips ──► Phase 5  Friends
                     │                            │         │
                     │                            └─────────┴──► Phase 4  Creators
                     │                                                 │
                     └──► Phase 6  Subscriptions ──────────────────────┴──► Phase 7  Marketplace
```

Hard dependencies only:
- Everything waits on **Phase 0**.
- **Phase 3** needs Phase 2's identity and Phase 1's invite previews.
- **Phase 4** needs Phase 2's identity and Phase 1's public pages.
- **Phase 5** needs Phase 3 in real use — the point is to learn from it first.
- **Phase 7** needs Phase 4's creator identity *and* Phase 6's proven payments.
- **Phase 6** needs only Phase 0.

---

## 6. What can run in parallel

**With one engineer, nothing runs in parallel** — the sequence is Phase 0 → 1 →
2 → 3 → 4, roughly 15–21 weeks to MVP, then Phase 6 for first revenue at around
week 20–29. That is a long time with no income.

**With two engineers**, the highest-value split is:

| Track | Phases | Rationale |
|---|---|---|
| **A — Consumer** | 0 → 1 → 2 → 3 → 4 | The product promise |
| **B — Business** | 0.4–0.7 → 6 | Different domain (owner/admin), different data, almost no overlap with trips |

Running Track B in parallel pulls **first revenue forward by roughly three
months**. The tracks touch in only two places — shared auth from Phase 0, and
the admin console — so the merge risk is low.

Within Track A, Phase 2 can start before Phase 1 finishes (they share no code),
and Phase 4 can overlap Phase 3's second half.

**Recommendation:** if a second engineer is available at any point, put them on
Track B. If not, consider pulling Phase 6 ahead of Phase 3 — it is the only
phase that produces revenue, and priority 8 orders it only against *travel
booking payments*, not against the trip planner.

---

## 7. Effort estimates, assumptions and uncertainties

### Summary

| Phase | Effort | Confidence |
|---|---|---|
| 0 — Stabilise | 2–3 wk | High |
| 1 — Public pages | 2.5–3.5 wk | Medium-high |
| 2 — Identity | 2.5–3 wk | High |
| 3 — Trips | 5–7 wk | Medium |
| 4 — Creators & collections | 3–4 wk | Medium |
| **MVP total** | **15–21 wk** | **Medium** |
| 5 — Friends & Circles | 4–5 wk | Medium |
| 6 — Subscriptions | 5–8 wk | **Low** |
| 7 — Marketplace | 8–14 wk | **Very low** |

### Assumptions

1. One experienced full-stack engineer, able to work across FastAPI, React
   Native and GCP. A specialist in one would take materially longer.
2. Estimates are **engineering time only** — no design, QA, content production,
   app-store review, legal review or marketing.
3. Product decisions in §9 are answered when a phase needs them, not during it.
4. The existing architecture is kept (priority 10). No Supabase migration, no
   second runtime.
5. Atlas and Cloud Run capacity are adequate; no re-platforming.
6. App-store review adds 1–7 days per release and is not in the figures.

### Where these are least reliable

- **Phase 7 (8–14 wk)** is the weakest number. Instagram app review is outside
  our control and routinely takes weeks. Financial-intermediary compliance
  could change the model entirely. Treat as a planning placeholder, not a
  commitment.
- **Phase 6 (5–8 wk)** hinges on RBI e-mandate flows and GST invoicing, not on
  code. If Razorpay onboarding or merchant KYC stalls, the whole range moves.
- **Phase 3 (5–7 wk)** assumes last-write-wins concurrency is acceptable. If
  real-time collaborative editing is expected, add 3–4 weeks and a sync layer.
- **Phase 1** assumes Option A. Option B adds 3–4 weeks.
- **Nothing here accounts for the empty-content problem.** 8 of 11 cities have
  no places and Pune has no reels. Filling them is content operations, not
  engineering, and it gates both SEO value and the product feeling alive.

### What would make these estimates worse

- Adding real-time collaboration to Phase 3.
- Shipping the separate Business application rather than the owner portal.
- Contact discovery in Phase 5 (DPDP Act compliance).
- Discovering mid-flight that Phase 6's tier matrix needs features that do not
  exist yet — hence 6.1 first.

---

## 8. Production deployment gates and rollback

Today: **one Cloud Run service, no staging, six healthy revisions.** API
rollback is available and instant. Mobile rollback is not available at all.

### Gates — every production deploy

1. **CI green.** Full backend suite passes; `tsc --noEmit` introduces no new errors.
2. **Staging first.** The exact image runs in staging against the staging
   database, with a smoke suite covering auth, place read, reel feed, trip
   read and one authenticated write.
3. **Manual auth check on a real device** against staging. Automated tests have
   never caught a broken OAuth client; a device does.
4. **Schema changes are additive only.** No field is renamed, retyped or
   removed in the same deploy that stops writing it. Removal is a later deploy,
   after the previous app version is out of circulation.
5. **Backward compatibility with the live app.** An installed app cannot be
   rolled back, so the API must keep serving the previous app version for at
   least one release cycle.
6. **Backup verified** before any deploy that changes how data is written —
   verified by restoring to a scratch database, not by the backup's existence.
7. **Canary.** Deploy with `--no-traffic`, send 10% of traffic, watch error rate
   and p95 latency for 15 minutes, then ramp.

### Rollback requirements

| Layer | Mechanism | Time |
|---|---|---|
| **API** | Route traffic to the previous Cloud Run revision | Seconds |
| **Config / env** | Re-deploy the previous revision (env is baked per revision) | Seconds |
| **Database** | **No rollback.** Additive-only changes are what makes API rollback safe | — |
| **Mobile app** | **Cannot be rolled back.** Mitigate with server-side feature flags and a forced-update path | Hours–days |

### Non-negotiables

- **Never deploy the backend and a mandatory app change together.** Ship the
  API change first, backward-compatible; ship the app after.
- **Every user-visible feature behind a server-side flag**, so it can be
  disabled without an app release. This is the only mobile rollback that exists.
- **The first deploy after Phase 0.1 is the riskiest in the project** — it
  removes `/auth/session`. It gets the full gate sequence and a human watching
  auth success rate for an hour.

---

## 8a. Decisions taken (2026-10-17)

Recorded here so the phases below are read against them.

| # | Decision |
|---|---|
| **Visibility** | **Private by default** for journeys, saved places, collections and trips. Sharing is per-item and explicit. Group members see only what is shared with the group. |
| **Handles** | **Assigned lazily**, when a public identity or sharing feature first needs one. No extra onboarding friction. Users can customise a handle later. |
| **Invite preview (logged out)** | Trip name, destination, dates, itinerary and a general estimated budget, subject to the organiser's sharing settings. **Never** participant identities, private comments, personal expenses or profile information. Joining or editing requires authentication *and* authorisation. |
| **Launch geography** | **Three properly populated cities**, not eleven thin ones. Architecture stays capable of all Indian cities. Candidates proposed in §8b. |
| **Subscriptions** | Two tiers — Pro ₹1,499/month, Premium ₹9,999/month. Feature matrix to be prepared and approved before implementation. |
| **GST** | Prices are **exclusive** of applicable GST for planning. Tax calculated and shown separately at checkout. Final treatment to be confirmed with an accountant before billing goes live. |

Two consequences worth noting:

- *Lazy handles* mean a user can reach a share action without an identity, so
  handle assignment has to be an inline step inside the share flow, not a
  separate screen. It also means handle uniqueness is enforced later, when
  more users exist and good names are scarcer — allow editing, and reserve
  nothing.
- *Budget in the logged-out preview* is the one field that can leak more than
  it looks: a per-person figure plus a visible participant count would imply
  individual spend. Show a trip-level range only, never a per-head number.

---

## 8b. Proposed launch cities

Current content, measured against production **2026-10-24** — unchanged from
the 2026-10-17 measurement, which is itself the finding:

| City | Places | Reels | State |
|---|---|---|---|
| Goa | 28 | 15 | Ready |
| Ahmedabad | 26 | 9 | Ready |
| Pune | 26 | **0** | Places only — the Reels tab is empty in a launch city |
| Mumbai, Delhi, Jaipur, Udaipur, Varanasi, Leh, Kochi, Shillong | 0 | 0 | Empty |

**Recommendation: Goa, Pune, Mumbai.**

- **Goa** is not in question: the most content, the highest travel intent, and
  the archetypal discovery destination.
- **Mumbai** is the largest origin city in India for exactly the trips this
  product plans. For a *collaborative trip planner*, the origin matters as
  much as the destination — the group that plans a Goa weekend is usually
  sitting in Mumbai.
- **Pune** completes the Mumbai–Pune–Goa corridor, the most travelled weekend
  route in the region, and it already has 26 places.

The cost of that choice is content: Mumbai needs a full build, and Pune needs
reels, which are the core mechanic. **If content for Mumbai cannot be funded
before launch, swap it for Ahmedabad**, which is ready today at 26 places and
9 reels — the trade is a weaker corridor story for a city that ships now.

What this does *not* mean is launching a city empty. The eleven-city list
exists today and eight of those cities are blank; whichever three are chosen
should be the only ones offered until they have content.

> **Reassessed 2026-10-24 — this needs a decision, not another week.** A week
> has passed and the numbers have not moved: Mumbai is still empty and Pune
> still has no reels. Reels are the core mechanic, so a launch trio of Goa,
> Pune and Mumbai currently ships **one** city with creator content and two
> without.
>
> Measured against what exists rather than what the corridor story wants, the
> trio available today is **Goa, Ahmedabad, Pune**. The honest choice is
> between funding a Mumbai content build now — it is people and sourcing work
> with a long tail, and it will not go faster by starting later — or swapping
> Mumbai for Ahmedabad and making Mumbai the first post-launch city.
>
> This is not an engineering decision and nothing in engineering is waiting on
> it, which is exactly why it has drifted for a week.

---

## 8c. What shipped since this plan was written

Recorded because several phases above were written as future work and are now
history, and because two of these were not in the plan at all.

| | |
|---|---|
| **Phase 0** | Closed except for staging (0.2) and `ALLOWED_ORIGINS` (half of 0.5). Rate limiting, token hashing, index work, dependency pruning, CI and test isolation are all done |
| **Phase 1** | Shipped in full — public place and city pages, sitemap, robots, Open Graph, Android App Links, real share URLs, stable slugs |
| **Google Sign-In removed** | Built, then removed entirely on 2026-10-23. Installed-app clients cannot do the implicit flow the original code assumed, and the direction moved to OTP regardless. `/auth/google` now 404s |
| **`/auth/dev` placeholder** | Takes an email, issues a session, verifies nothing. Inert unless `DEV_AUTH_ENABLED` is set, and 404s rather than 403s so an unconfigured deployment does not advertise it. **It is currently switched ON in production** — see §8d |
| **Interface rebuilt** *(not in this plan)* | The app was monochrome; the website is emerald and gold on warm off-white, set in Outfit and Figtree. Every screen now carries the site's design language. Colour values were taken from the live site rather than converted by hand |
| **Apple Sign-In** | Still present and still unconfigured — returns 503, having previously returned 500. Not a way in |

---

## 8d. Phase 0.1 (replacement) — OTP sign-in *(MVP, blocking)*

**Depends on:** nothing technical. **Effort: 3–5 days of engineering, but see
the lead time below.** This replaces the Google OAuth item and is now the
single thing gating the most.

Three separate things make this the critical path:

1. **It is the only way to close the production hole.** `DEV_AUTH_ENABLED` is
   on, so anyone who knows the API URL can sign in as any email — including
   the address in `ADMIN_EMAILS`, which can then self-grant admin over the
   real database. That cannot be turned off while it is the only way in.
2. **Phase 2 is blocked behind it.** Identity, handles and private-by-default
   were decided on 2026-10-17 (§8a) and have been idle since, because there is
   no real identity to attach them to.
3. **It is the line between a demo and an installable product.** Everything
   else is polish on something a stranger still cannot sign in to.

| # | Work | Acceptance criteria |
|---|---|---|
| 0.1a | Choose an SMS provider and complete DLT registration | Entity, header and template approved; a test OTP arrives on an Indian number |
| 0.1b | `phone` on the user document, unique sparse index | An existing email-created account can attach a phone without a duplicate record |
| 0.1c | `POST /auth/otp/send` and `/auth/otp/verify`, rate-limited per number *and* per caller | Brute-forcing a six-digit code is bounded; codes expire; a verified number returns a session indistinguishable from today's |
| 0.1d | Second step on the login screen | The screen already takes an identifier and a Continue; this adds a step rather than a rewrite |
| 0.1e | Remove `DEV_AUTH_ENABLED` from production; purge `dev_` sessions | `POST /auth/dev` → 404 on production. Sessions whose token began `dev_` are gone |

> **Start the DLT registration this week, whatever else happens.** Sending
> transactional SMS in India requires registration with the telecom operators
> through a DLT platform — entity, header and template, each approved
> separately — and the lead time is believed to be one to two weeks. Confirm
> the current timeline with whichever provider is chosen; this is the kind of
> dependency that becomes the critical path without anyone deciding it should.
> If it is long, WhatsApp OTP or email OTP are worth pricing as a first cut,
> since the endpoint shape does not change.

> **Account continuity:** sign-in has matched on email since Google, and
> `/auth/dev` kept that rule. Accounts created under either still resolve, and
> will still resolve after OTP, provided phone is added alongside email rather
> than replacing it.

---

## 9. Unresolved business decisions

Engineering is blocked or at risk until these are answered. Ordered by when
they are needed. **Answered items are struck through and kept** — the record of
what was decided is more useful than a shorter list.

### Needed for Phase 1
1. **Public page content.** Do public place pages show user reviews and public
   collections, or only business-supplied content? Reviews are user content and
   carry moderation and privacy obligations once indexed. *(Still open. Pages
   shipped showing business-supplied content only, which answers it in
   practice but not on purpose.)*
2. ~~**Empty cities.**~~ **ANSWERED in code 2026-10-22.** Cities with no
   content are excluded from the sitemap and marked `noindex` automatically,
   so this can no longer be got wrong by forgetting. The separate question of
   *which three to launch* is §8b and is still open.

### Needed for Phase 2
3. ~~**Default visibility**~~ **ANSWERED 2026-10-17 — private.** See §8a.
4. ~~**Is a handle mandatory at signup**~~ **ANSWERED 2026-10-17 — assigned
   lazily.** See §8a.

### Needed for Phase 3
5. ~~**What a logged-out invite viewer sees.**~~ **ANSWERED 2026-10-17.** Name,
   destination, dates, itinerary and a trip-level budget range; never
   participant identities, private comments, personal expenses or profile
   information. See §8a.
6. **Does an invite link grant edit or view by default?** Edit is friendlier;
   view is safer when links get forwarded.
7. **Trip size limit**, and whether anyone can invite or only the owner.

### Needed for Phase 6
8. **Pro vs Premium feature matrix.** Undefined today. A 6.7× price gap needs a
   clear story. **Requested 2026-10-17, still unwritten — see §10.3. This is
   the cheapest unblocking act available and it keeps slipping.**
9. ~~**Are ₹1,499 and ₹9,999 inclusive or exclusive of 18% GST?**~~
   **ANSWERED 2026-10-17 — exclusive**, shown separately at checkout, subject
   to confirmation with an accountant before billing goes live. See §8a.
10. **Billing cycle**: monthly only, or annual with a discount? Free trial?
11. **Refund and downgrade policy.**
12. **What happens to a lapsed listing** — hidden, downgraded, or unchanged
    with features removed?

### Needed for Phase 7
13. **Is the 20% commission on gross or net**, and who bears the payment
    gateway fee?
14. **Does Explore91 hold funds** between business and creator, or is it
    introduction-only with payment direct? This single answer changes the
    regulatory burden more than any engineering choice in this document.
15. **Creator payout schedule and KYC threshold.**
16. **Who owns campaign content rights** after delivery?

### Structural
17. **Is the separate Business application still intended**, or does the owner
    portal suffice? Affects Phase 6's shape.
18. **Wallet points** — users hold balances (500 at signup, 50 per booking)
    with no redemption path. Honour them, convert them to something, or retire
    them with notice? They are a liability today.
19. ~~**Target launch geography**~~ **ANSWERED 2026-10-17 — three cities done
    properly.** Which three is still open; see §8b, where a week of no content
    movement has changed what the honest answer is.
20. **Apple Sign-In** — finish it or drop it? It is wired and verified against
    Apple's JWKS but has never been configured, so it returns 503. It needs an
    Apple developer account, which `IOS_APP_ID` and iOS deep links (1.4) also
    need. One decision unblocks three items.

---

## 10. Recommended immediate sequence *(revised 2026-10-24)*

The previous sequence is spent: decisions 3, 4 and 19 were answered on
2026-10-17 (§8a), Phase 0 is closed but for two items, and the public web
surface question was settled by building Option A.

The app now *looks* finished and still cannot be given to a stranger. Three
things stand in the way, and they are not equally hard.

### 1. OTP sign-in — the critical path *(§8d)*

Everything else is downstream of it. It is the only way to close the open
production hole, Phase 2 has been idle behind it for a week, and it is the
line between a demo build and an installable product.

**Start the DLT registration immediately**, in parallel with everything else
on this list. The engineering is 3–5 days; the paperwork may be longer, and it
is the half nobody schedules.

### 2. Content for the launch cities — in parallel, and not engineering

Mumbai is a decided launch city with nothing in it. Pune has 26 places and
zero reels, so its Reels tab — the core mechanic — is empty. This is people
and sourcing work with a long tail and no engineering dependency, so it should
be running while OTP is built, not after.

It also needs the decision in §8b: fund Mumbai, or swap it for Ahmedabad.

### 3. The Pro / Premium feature matrix — an hour that unblocks weeks

Asked for on 2026-10-17 and still not written. It is a decision document, not
code, and all of Phase 6 revenue work is behind it.

### 4. Then: Phase 2 — identity, handles, private-by-default

Fully specified in §8a, blocked only by there being no real identity yet.
It becomes the obvious next build the day OTP lands.

---

### Housekeeping to fold into the above

Small, overdue, and each one a genuine exposure:

| | |
|---|---|
| **Rotate the Atlas credential** | Pasted into a chat several sessions ago and never rotated |
| **Set `ALLOWED_ORIGINS`** | Unset, so CORS is open to any origin. The server logs a warning about it on every boot |
| **Delete `smoke-check@explore91.dev`** | A real user record created by deploy smoke tests, sitting in the production database |
| **Close `DEV_AUTH_ENABLED`** | Deliberately open for test builds (`docs/DEPLOY_PLAN_001.md` §10). Closes itself as step 0.1e |
| **Build staging (0.2)** | Tolerable while there were no users. It stops being tolerable the day OTP ships |

### What not to start yet

Creator marketplace (Phase 7), Friends and Circles (Phase 5), and booking
commissions. All real; none of them survive contact with *there is no
authentication and two of three launch cities are empty*.
