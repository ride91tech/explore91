# Explore91 — DPDP gap analysis

**Written 2026-10-26.**

**This is an engineering gap analysis, not legal advice.** I am not a lawyer.
It maps what the code does today against what the DPDP Act 2023 and the DPDP
Rules 2025 appear to require, so you know what to build and what to ask a
lawyer about. Every date below should be confirmed against the Gazette
notification before you rely on it.

---

## 1. The deadline is May 2027, not November

This matters because it changes what belongs in the launch plan.

| Date | What applies |
|---|---|
| 13 Nov 2025 | Rules notified. Data Protection Board provisions in force (Rules 1, 2, 17–21) |
| 13 Nov 2026 | Consent Manager registration opens — only relevant if you intend to *be* a Consent Manager. You do not |
| **13 May 2027** | **The substantive duties**: notice, consent, security safeguards, breach reporting, retention, erasure, data principal rights |

So **DPDP does not legally block the November launch.** Sources differ on
whether the notification date was 13 or 14 November 2025, and one widely-cited
guide describes a four-phase schedule from a January 2025 notification — that
January document was a draft, and that timeline looks unreliable.

**But three of the gaps below block launch for other reasons**, and most of the
rest are far cheaper to build now than to retrofit onto a live user base.
Consent and erasure in particular are close to impossible to add honestly after
the fact: you cannot collect consent retroactively from users who already
signed up without it.

---

## 2. Blocks the November launch regardless of DPDP

### 2.1 There is no privacy policy

The login screen renders:

```
By continuing you agree to Explore91's Terms & Privacy Policy.
```

It is a plain `<Text>` element in `frontend/app/login.tsx` — **not a link**, no
`onPress`, no `Linking.openURL`. There is no `privacy.tsx` or `terms.tsx` route.
`https://explore91.com/privacy` returns 200 only because the SPA catch-all
rewrite answers everything with `index.html`.

So the app asserts agreement to documents that do not exist.

**Google Play requires a privacy policy URL** on every submission. This blocks
Workstream D of the launch plan on its own, before DPDP enters the picture.

### 2.2 There is no way to delete an account

No erasure endpoint exists anywhere in `backend/routes/`. **Google Play has
required in-app account deletion** for apps that allow account creation, with a
web-accessible route as well. Also DPDP §12(3).

### 2.3 `DEV_AUTH_ENABLED` is an unauthorised-access hole

Anyone reaching `POST /api/auth/dev` signs in as any email, including the
address in `ADMIN_EMAILS`, which reaches admin over the real user table.

You have decided to ship with this, and that is your call. It is listed here
because under DPDP this is not merely a security weakness: a personal data
breach includes unauthorised *access*, and the reporting duty from May 2027
attaches to exactly this. It should not outlive OTP.

---

## 3. DPDP gaps — build before May 2027, ideally before users arrive

### 3.1 Consent and notice *(§5, §6)*

Consent must be free, specific, informed, unconditional and unambiguous, given
by clear affirmative action, and preceded by an itemised notice saying what data
is collected and for what purpose.

Today sign-in is a single Continue with one line of unlinked text. There is no
notice, no itemisation, no record of what was consented to or when.

**Build:** an itemised notice at sign-up; a stored consent record per user
(what, when, which version of the notice).

### 3.2 Withdrawal of consent *(§6(4)–(6))*

Must be as easy to withdraw as to give. No mechanism exists.

### 3.3 Erasure and retention *(§8(7), §12(3))*

Personal data must be erased when consent is withdrawn or the purpose is no
longer served. Today:

- `user_sessions` has a TTL index (7 days) — correct and already working.
- `users`, and everything keyed to a user, has **no retention rule at all**.

**Build:** account deletion that actually cascades, plus a defined retention
period for inactive accounts.

### 3.4 Children's data *(§9)* — the one most likely to be missed

DPDP requires **verifiable parental consent for anyone under 18**, and prohibits
tracking and behavioural advertising directed at children. Eighteen, not
thirteen — stricter than COPPA or GDPR.

Explore91 has **no date of birth and no age gate**. There is currently no way to
know whether a user is a child, which means there is no way to comply.

This interacts badly with Phase 7 (creator marketplace) and with any future ad
product. It is a schema decision, so it is much cheaper before launch.

### 3.5 Grievance redressal *(§13)*

Data principals must have a readily available means of contacting whoever
answers data questions. There is a `/support` route; it is not framed as a
grievance mechanism and no contact is published.

### 3.6 Breach notification

From May 2027, breaches must be reported to the Board and to affected
principals. No incident response process exists, and there is no staging
environment to rehearse one in.

### 3.7 Processor contracts *(§8(2))*

You are the Data Fiduciary. MongoDB Atlas, Google Cloud and Vercel are
processors acting on your behalf, and the Act requires contracts with them. All
three offer standard data processing addenda. This is paperwork, not code — and
it is a lawyer question.

### 3.8 Personal data in application logs

`backend/routes/auth.py:196` writes an email address into Cloud Run logs:

```python
logger.warning("DEV SIGN-IN: issuing a session for %s, no credential checked", email)
```

Cloud Run logs are retained by Google and are not covered by any retention rule
of yours. This disappears with `DEV_AUTH_ENABLED`, but the pattern is worth a
look elsewhere before it spreads.

---

## 4. What is already right

Worth stating, because it is a shorter list to maintain than to rebuild.

- **No location collection.** `expo-location` is not installed; the app never
  asks for device location. This removes an entire category of obligation.
- **No behavioural advertising or third-party trackers** in the app.
- **Session expiry** via a TTL index, 7 days.
- **Minimal collection**: email, name, optional picture, home city. No DOB, no
  address, no payment data — because there are no payments yet.
- **Transport security** everywhere, and `ALLOWED_ORIGINS` now closed.
- Phone numbers on `Business` records are *business* contact details, published
  deliberately — not personal data of a data principal in the same sense.

The data footprint is genuinely small. That is the best position to be in when
adding consent, and it will stop being true the moment payments and OTP land.

---

## 5. Recommended sequence

**Before the November launch** — because Play requires them, not because DPDP
does yet:

1. Write and host a privacy policy and terms; make the login line a real link.
2. Build account deletion, in-app and web-reachable.
3. Add a date-of-birth or age-confirmation field at sign-up. Cheap now, a
   migration later, and §9 is unanswerable without it.

**With OTP (§8d of the roadmap)** — the sign-in screen is being rewritten
anyway, which is the natural moment:

4. Itemised consent notice plus a stored consent record.
5. Close `DEV_AUTH_ENABLED` and stop logging email addresses.

**Before 13 May 2027:**

6. Consent withdrawal.
7. Retention rules and cascading erasure.
8. Grievance contact published; breach response process written down.
9. Processor addenda with Atlas, Google Cloud and Vercel — with a lawyer.

---

## 6. What to take to a lawyer

Not for an engineer to answer, and cheap to ask alongside the processor
addenda:

- Whether Explore91 is likely to be classed a **Significant Data Fiduciary**,
  which adds a Data Protection Officer in India, DPIAs and audits. Unlikely at
  launch scale, plausible later.
- How §9 verifiable parental consent should work in practice for a travel app.
- Whether the business listings' contact details carry any obligation of their
  own.
- The Gazette dates above, confirmed.

---

## Sources

- [DPDP Rules, 2025 Notified — PIB](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)
- [DPDP Rules 2025 — all 22 rules and effective dates](https://dpdpa.dcomply.in/rules/)
- [DPDP Rules 2025 Timeline: every deadline up to 13 May 2027](https://legismith.com/dpdp-rules-2025-timeline/)
- [DPDP Compliance Guide 2026](https://www.privybyidfy.com/blog/dpdp-compliance-guide-2026-what-indian-enterprises-must-do-before-may-2027)
- [DPDP Rules 2025: Compliance Roadmap & Deadlines](https://www.tcsa.in/resources/dpdp-rules-2025-implementation-roadmap)
