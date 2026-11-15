# Turning on email sign-in codes

**Status:** built and tested, not live. The backend endpoints, both sign-in
screens and the tests are in `main`. Nothing below has been done in
production yet.

This replaces `DEV_AUTH_ENABLED` as the way in. Email rather than SMS for
launch because SMS in India needs DLT registration (one to two weeks, not
started) and email needs none. Phone can be added later behind the same two
endpoints — see `backend/core/otp.py`.

---

## The order matters

Get this wrong and **every sign-in breaks**, including the admin console.

1. Sending domain verified (§1)
2. Secrets and config on Cloud Run (§2)
3. Backend deployed (§3) — the endpoints exist but the old app still uses
   dev sign-in, so nothing changes for users yet
4. **Prove a real code arrives in a real inbox** (§4)
5. Web app redeployed and APK rebuilt (§5) — both now use codes
6. Only then close `DEV_AUTH_ENABLED` (§6)

The web app and the admin console are switched together in this release on
purpose. If only the app had moved, closing dev sign-in in step 6 would have
locked operators out of their own console.

---

## 1. A domain that can send

Codes are sent through [Resend](https://resend.com). It was chosen because its
API is one HTTP call; the sender lives in one function in `core/otp.py`, so
swapping to SES, Postmark or SendGrid later is a small change.

1. Create a Resend account and add the domain `explore91.com`.
2. Resend shows DNS records — SPF, DKIM and usually an MX for bounces. Add
   them at **GoDaddy**, on the `explore91.com` zone. This is the zone with
   `ns35`/`ns36` nameservers, not `ride91.com`.
3. Wait for Resend to show the domain as verified.

Until the domain verifies, Resend will not send from an `@explore91.com`
address, so a send that fails at this stage is a DNS problem rather than a code
problem. Check the domain's status in Resend before debugging anything else.

The zone currently has no MX records, so nothing about existing mail can be
disturbed by adding these.

## 2. Secrets and config

Four values. Two are secrets and go in Secret Manager, the same way
`MONGO_URL` already does (as `explore91-mongo-url`). **Do not paste either
secret into chat, a ticket or a commit.**

| Variable | What | Where |
|---|---|---|
| `OTP_PEPPER` | 48+ random characters. Keys the stored code digests, so a database read cannot recover a live code | Secret Manager |
| `RESEND_API_KEY` | From the Resend dashboard | Secret Manager |
| `OTP_EMAIL_BACKEND` | `resend` | plain env |
| `OTP_FROM_EMAIL` | `Explore91 <login@explore91.com>` | plain env |

The pepper must be **generated, not chosen**. 32 characters is the minimum the
code accepts; anything shorter and sign-in reports itself unconfigured.

The runtime service account is
`597388632883-compute@developer.gserviceaccount.com`. It needs the
**Secret Manager Secret Accessor** role on each new secret, exactly as it has
on `explore91-mongo-url` — without it the revision fails to start.

`OTP_EMAIL_BACKEND=log` exists for local development only. It writes live codes
to the log, so it refuses to run when `K_SERVICE` is set, which Cloud Run sets
on every revision. Setting it in production does nothing except leave sign-in
unconfigured.

## 3. Deploy the backend

Use the procedure in `DEPLOY_PLAN_001.md` §5, unchanged — in particular, no
`--set-env-vars`. The new config goes on with `--update-env-vars` and
`--update-secrets` as its own step.

New checks to add to the smoke on the tagged revision:

| Check | Expected |
|---|---|
| `POST /api/auth/otp/send` before config | 503 — the route exists and says it is not configured |
| the same after config, with a real address | 202 |
| `POST /api/auth/otp/verify` with a made-up code | 400 |
| `POST /api/auth/dev` | still 200 — dev sign-in is untouched until step 6 |

## 4. Prove it on a real inbox

Before anything user-facing changes, send a code to a real address you can
read, from the tagged revision, and sign in with it. Check the email lands in
the inbox and not spam. A Resend account that is not fully verified fails here
quietly, and this is the last point where that costs nothing.

## 5. Ship the clients

- **Web:** `npm run build:web` then the Vercel deploy, as before.
- **APK:** rebuild. The installed one is from 2026-10-25 and uses dev sign-in;
  it also predates the age-confirmation field, so it can no longer create
  accounts at all.

## 6. Close the bypass

Only once real users are signing in with codes:

- Remove `DEV_AUTH_ENABLED` from the service.
- Purge sessions whose token began `dev_`. They are stored hashed, so the
  prefix cannot be matched in the database — the practical route is to delete
  sessions created before the cutover, which signs everyone out once.
- `POST /api/auth/dev` must then return **404**.

This is roadmap step 0.1e.

---

## What the code guarantees

All of these have tests in `backend/tests/test_otp.py`, and each was checked
by breaking it on purpose and confirming its test failed:

- A code works **exactly once**, including when two requests carry it at the
  same moment.
- **Five** wrong guesses burn the code, even if the right one follows.
- Codes expire after **ten minutes**, and asking again replaces the old one.
- Stored as a keyed digest: the database alone cannot recover a code.
- Every failure — wrong, expired, used, never sent — returns the **same**
  response, so nothing can be learned from which one it was.
- At most **five** sends per address per hour, so one inbox cannot be flooded.
- A new account still needs the 18-or-older confirmation, and records consent,
  through the same helper as every other sign-in path.
