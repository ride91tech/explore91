# Explore91 — November public launch plan

**Written 2026-10-25.** Target launch **Tuesday 24 November**, go/no-go
**Monday 17 November**. That leaves four working weeks and one week of slack,
and the slack is not padding — one dependency on the critical path is
controlled by telecom operators rather than by us.

This plan is deliberately narrower than the roadmap. The roadmap describes the
product; this describes what can be true by 24 November and what cannot.

---

## 1. The shape of the problem

Three things are true at once, and only the first is widely appreciated.

**The app is finished enough.** explore91.com serves it, the admin console
works, deep links resolve, and as of today the server-rendered place and city
pages declare the right canonical host.

**A stranger still cannot sign in.** `DEV_AUTH_ENABLED` is the only way in and
it is a bypass, not an authentication system. Everything about launch — Play
Store review, press, any user at all — is downstream of replacing it.

**Two of the three decided launch cities are not launchable.** This is a
measurement, not an impression. Taken from the production API today:

| City | Places | Reels | State |
|---|---:|---:|---|
| Goa | 28 | 15 | Launch-ready |
| **Ahmedabad** | 26 | 9 | **Launch-ready** — the designated *fallback* |
| Pune | 26 | **0** | Places only. The Reels tab is empty |
| **Mumbai** | **0** | **0** | Entirely empty. A decided launch city |

Eight further cities — Mumbai, Jaipur, Udaipur, Varanasi, Leh, Kochi,
Shillong and Delhi — have zero places and zero reels. **The app already handles
this correctly**: `/cities/grouped` returns `is_live` per city and the picker
sorts anything empty into a separate "Coming soon" list, so none of them is
openable. Verified against production today. This was listed as a launch task
in an earlier draft of this plan; it was already solved, and the task is
removed.

---

## 2. Scope decision: launch Goa and Ahmedabad

**Recommendation: launch two cities, Goa and Ahmedabad. Drop Mumbai from the
November scope. Hold Pune until it has reels.**

The decision on 2026-10-17 named Goa, Pune and Mumbai with Ahmedabad as
fallback. The content numbers have since inverted that: Ahmedabad is the
second-most-complete city we have, and Mumbai has nothing. Taking a city from
zero to launch quality is weeks of non-engineering work with a long tail, and
there is no version of that which lands by 17 November alongside everything
else.

Dropping Mumbai costs less than it sounds. It is already in the picker's
"Coming soon" list and cannot be opened, so this is a decision not to *promote*
it in November rather than a feature being pulled.

Pune is the closer call. It has the places but no reels, and reels are the core
mechanic — a city whose Reels tab is empty is a worse first impression than a
city that is not offered yet. If 15–20 Pune reels exist by 17 November it joins
the launch; otherwise it follows in December. That is a content decision, not an
engineering one, and it should be made on evidence on the 17th rather than
hoped for now.

**This needs your sign-off.** It reverses a decision you took on 17 October,
and everything in §4 assumes it.

---

## 3. What is explicitly not in the November launch

Naming these now is cheaper than discovering them on the 20th.

| Excluded | Why |
|---|---|
| **Pro / Premium subscriptions** | There is no payments code in the backend at all — no Razorpay integration, no subscription model, nothing. Phase 6 is greenfield, and the feature matrix it depends on is still unwritten |
| **iOS** | No App Store submission started. Android-only for November |
| **Friends and Circles (Phase 5)** | Roadmap-deferred; unchanged |
| **Creator marketplace (Phase 7)** | Roadmap-deferred; unchanged |
| **Booking commissions** | Depends on payments |
| **Mumbai** | §2 |

Launching without subscriptions means **November earns no revenue**. That is
the correct trade: shipping a payment flow onto an auth system that is five
days old is how you get charged-but-not-subscribed tickets in week one.

---

## 4. The plan

Four workstreams. Only the first is on the critical path; the others are sized
to fit inside it.

### Workstream A — OTP sign-in *(critical path)*

Roadmap §8d. Engineering is 3–5 days. **The DLT registration is not, and it has
not been started.**

Sending transactional SMS in India requires registration through a DLT platform
— entity, header and template, each approved separately — with a believed lead
time of one to two weeks. Started Monday 26 October, approval lands somewhere
between 2 and 9 November. Started in week two, it becomes the reason launch
slips.

- **Mon 26 Oct — begin DLT registration.** Before anything else, this week,
  whatever else is happening. Confirm the real timeline with the provider on
  day one rather than trusting the one-to-two-week estimate.
- **Price email OTP and WhatsApp OTP as a fallback in the same conversation.**
  The endpoint shape (`/auth/otp/send`, `/auth/otp/verify`) does not change with
  the channel, so this costs an hour now and buys a launch if DLT runs long.
- Weeks 1–2: build 0.1b–0.1d against a stubbed sender, so engineering is not
  idle waiting on paperwork.
- **The day OTP works on a real number, execute 0.1e** — remove
  `DEV_AUTH_ENABLED`, purge `dev_` sessions, verify `POST /auth/dev` returns 404
  in production.

**Gate: no launch with `DEV_AUTH_ENABLED` set.** It currently grants admin over
the real database to anyone who finds explore91.com/admin.

### Workstream B — Content *(parallel, not engineering)*

- Pune: 15–20 reels, or it ships in December.
- Goa and Ahmedabad: review what is there rather than add to it. 28 and 26
  places is enough; the quality of the top 10 in each matters more than the 29th.
- Mumbai and the other empty cities need no action: they already sit in the
  picker's "Coming soon" list and cannot be opened.

### Workstream C — Pre-launch engineering *(parallel, small)*

Each is hours rather than days, and each is a real exposure.

| | Why it blocks launch |
|---|---|
| **Fix `eas.json`** | `preview` and `production` builds point `EXPO_PUBLIC_BACKEND_URL` at `https://explore91-backend.onrender.com`, which returns **404**. Any EAS build — which is how you ship to Play — targets a dead backend. The locally-built APK is unaffected because it reads `frontend/.env`, which is why this has gone unnoticed |
| **Set `ALLOWED_ORIGINS`** | `deploy/allowed-origins.yaml` is written and committed, not applied. CORS is open to every origin |
| **Rotate the Atlas credential** | Pasted into a chat several sessions ago, never rotated. Overdue independently of launch |
| **Delete `smoke-check@explore91.dev`** | A real user record left in production by deploy smoke tests |
| **Rebuild and re-sign the APK** | `EXPO_PUBLIC_SITE_URL` now points at explore91.com; the installed build still carries the Cloud Run origin, so deep links will not open the app until both agree |
| **Staging environment (roadmap 0.2)** | Tolerable with no users. Stops being tolerable the day OTP ships. If it cannot be built before launch, say so explicitly and accept it rather than assume it exists |

### Workstream D — Play Store *(parallel, long lead)*

Not started, and review time is outside our control.

- Store listing, screenshots, privacy policy, data-safety form.
- **Internal testing track first**, as soon as a build with real OTP exists.
- Confirm the Play App Signing key fingerprint is in
  `ANDROID_CERT_FINGERPRINTS`. Omitting it is the usual reason deep links work
  in a sideloaded build and break after release — the variable currently holds
  two fingerprints; verify the Play one is among them before submission.
- Submit for production review **no later than Mon 17 November**, to leave
  review time before the 24th.

---

## 5. Week by week

| Week | A — OTP | B — Content | C — Engineering | D — Play |
|---|---|---|---|---|
| **26 Oct – 1 Nov** | **Start DLT.** Price email/WhatsApp fallback | Pune reel sourcing begins | `eas.json`, `ALLOWED_ORIGINS`, Atlas rotation | Draft listing, privacy policy |
| **2 – 8 Nov** | Build 0.1b–0.1d against a stub | Pune reels continue | Delete smoke-check user; fix Pune tagline | Data-safety form, screenshots |
| **9 – 15 Nov** | DLT live, real sends, then 0.1e | Goa/Ahmedabad top-10 review | Rebuild APK; staging if feasible | Internal testing track |
| **16 – 22 Nov** | Harden, rate-limit review, soak | **Pune go/no-go on evidence** | Freeze | **Submit for review by the 17th** |
| **23 – 29 Nov** | — | — | — | **Launch Tue 24 Nov** |

---

## 6. Go/no-go — Monday 17 November

Launch on the 24th only if all of these are true. Any one false moves the date
rather than lowering the bar.

1. A stranger can sign in with a phone number on a production build.
2. `POST /api/auth/dev` returns **404** in production and `dev_` sessions are
   purged.
3. `ALLOWED_ORIGINS` is set; the Atlas credential is rotated.
4. Every launch city has both places **and** reels. (The picker already hides
   empty cities behind "Coming soon" — verified, not a task.)
5. No duplicate or placeholder copy in the launch cities' taglines.
6. An EAS production build points at Cloud Run and is on the internal track.
7. Deep links open the app from a link shared out of the app itself.
8. The backend suite passes — 284 tests at last run.

---

## 7. The three risks that actually decide this

**DLT lead time.** The only item whose duration we do not control, sitting on
the only path that blocks everything. Mitigated by starting Monday and by
pricing a non-SMS fallback in the same conversation. Unmitigated, it is a
December launch.

**Launching auth and launching to the public in the same fortnight.** OTP will
be days old on launch day, with no staging environment to have caught what the
tests did not. The honest mitigation is the internal testing track used
seriously for a week, not a day.

**Content as the silent critical path.** Engineering items have owners and get
tracked; "Pune needs reels" does not, and it has been open since the roadmap was
written. If nobody is named against Workstream B this week, Pune will not launch
in November — and the decision will have been made by default rather than on
the 17th.

---

## 8. What I need from you

1. **Sign off §2** — Goa and Ahmedabad, Mumbai dropped, Pune conditional. It
   reverses the 17 October decision and the rest of the plan assumes it.
2. **Name an owner for Workstream B this week.** It is the one stream with no
   engineering dependency and therefore no natural owner.
3. **Confirm 24 November**, or give me the date you want and I will work
   backwards and tell you what has to give.
