# Turning on email sign-in codes

**Status:** built and tested, not live. Email codes go through MSG91; phone codes go by WhatsApp through Kapso. The backend endpoints, both sign-in
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

## 1. A domain that can send — MSG91

Codes are delivered through **MSG91's email API**, since the account already
exists and MSG91 is also the route to SMS once DLT is approved (§7). Resend is
still supported as a fallback backend; nothing else changes if you switch.

Explore91 still generates and checks every code itself. MSG91 only delivers
the message. Its own SendOTP product would generate and verify codes on its
side, which would bypass the protections listed at the end of this document
and their tests, so it is deliberately not used.

**Send from a subdomain, not `explore91.com`.** Use `mail.explore91.com`.
MSG91's verification adds MX records, and on the root domain those would claim
`@explore91.com` mail for MSG91 — the domain you will want for real mailboxes,
starting with the privacy contact (see the warning below).

1. In MSG91: **Email → Domains → add `mail.explore91.com`**.
2. MSG91 shows TXT and MX records. Add them at **GoDaddy** on the
   **explore91.com** zone (`ns35`/`ns36`), with names under `mail`.
3. Wait for MSG91 to show the domain verified.
4. **Email → Templates → create a template** whose body uses a variable named
   exactly **`otp`**, and note its **template ID**. Suggested text:
   *"Your Explore91 sign-in code is {otp}. It expires in 10 minutes and works
   once. If you didn't ask for this, ignore this email — nobody can sign in
   without the code."* Use MSG91's own variable syntax for `otp`.

> **MSG91 can answer a failure with HTTP 200.** A wrong authkey, among other
> errors, comes back as a 200 with the failure in the body. The code treats a
> send as successful only when the body says `status: "success"` and
> `hasError: false`; anything else becomes a 502 to the app. There is a test
> for exactly this, and swapping in a status-code-only check fails four of
> them.

> **`privacy@explore91.com` does not receive mail.** `explore91.com` has no MX
> records, so anything sent there bounces — and the privacy notice publishes
> it as the grievance contact, which DPDP s13 requires to work. Not fixed
> here, because it needs a decision: either add `explore91.com` to the Google
> Workspace that already runs `ride91.com` mail, or change the published
> address (`PRIVACY_CONTACT_EMAIL`, and the text in `app/privacy.tsx`) to one
> that already works.

## 2. Secrets and config

Two of these are secrets and belong in Secret Manager, the same way
`MONGO_URL` already does (as `explore91-mongo-url`). **Do not paste either
into chat, a ticket or a commit.**

| Variable | What | Where |
|---|---|---|
| `OTP_PEPPER` | 48+ random characters, **generated**. Keys the stored code digests so a database read cannot recover a live code | Secret Manager |
| `MSG91_AUTHKEY` | MSG91 → Settings → Authkey | Secret Manager |
| `OTP_EMAIL_BACKEND` | `msg91` | plain env |
| `MSG91_EMAIL_DOMAIN` | `mail.explore91.com` — the verified domain | plain env |
| `MSG91_EMAIL_TEMPLATE_ID` | the template ID from §1 step 4 | plain env |
| `OTP_FROM_EMAIL` | `Explore91 <login@mail.explore91.com>` | plain env |

32 characters is the minimum pepper the code accepts; anything shorter and
sign-in reports itself unconfigured.

The runtime service account,
`597388632883-compute@developer.gserviceaccount.com`, needs the **Secret
Manager Secret Accessor** role on each new secret, as it has on
`explore91-mongo-url`; without it the revision fails to start.

`OTP_EMAIL_BACKEND=log` is for local development only. It writes live codes to
the log, so it refuses to run when `K_SERVICE` is set, which Cloud Run sets on
every revision.

<details>
<summary>Using Resend instead</summary>

Set `OTP_EMAIL_BACKEND=resend`, `RESEND_API_KEY` (Secret Manager) and
`OTP_FROM_EMAIL`. The MSG91 variables are then ignored.
</details>

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
the inbox and not spam. An unverified MSG91 domain or a template whose variable is not
named `otp` fails here — the second one quietly, with an email that arrives
without its code. This is the last point where finding out costs nothing.

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

## 7. Phone sign-in by WhatsApp — Kapso

Built and tested; turns on by configuration alone. **Phone is the preferred
way in**: the login screen asks for a mobile number first and offers email as
the alternative. It reads `GET /api/auth/methods` to decide, so until WhatsApp
is configured the screen simply shows email — it never offers a channel that
would answer 503.

WhatsApp is not SMS, so **DLT does not apply**. Meta's own approval does, and
[Kapso](https://kapso.com) does not remove it: it speeds up our side (a free
sandbox number, a clean API, Meta's fees passed through with no markup), not
Meta's.

1. Create a Kapso account and project, and test on the **sandbox number**
   first. **The sandbox cannot send templates** — only text and interactive
   messages — so run the backend locally with `OTP_PHONE_BACKEND=kapso-sandbox`,
   which sends the code as plain text instead. That proves the account, the
   key, number handling and the sign-in round trip on a real phone. It does
   **not** prove the authentication template: only a connected production
   number can. Sandbox mode is refused on Cloud Run, where it would quietly
   fail every real user. To join, send the activation code from your phone to
   the sandbox number; codes expire after 15 minutes.
2. Connect a real number through Meta Embedded Signup. Meta must approve the
   **display name**, and **business verification** raises the messaging limit.
   This is the step with an unpredictable timeline — start it first.
3. Create an **authentication template** with a **copy-code button**. Meta
   fixes the wording; we only supply the code. Note its name and language.
4. Configure:

| Variable | What | Where |
|---|---|---|
| `KAPSO_API_KEY` | Kapso → Integrations → API keys | Secret Manager |
| `KAPSO_PHONE_NUMBER_ID` | the connected number's ID | plain env |
| `KAPSO_OTP_TEMPLATE` | the authentication template's name | plain env |
| `KAPSO_OTP_TEMPLATE_LANG` | its language code, e.g. `en` (the default) | plain env |
| `OTP_PHONE_BACKEND` | leave unset (`kapso`); `log` is for local development only and is refused on Cloud Run | — |

`OTP_PEPPER` is shared with email codes; nothing extra is needed for it.

**Accounts are phone-first.** A new number creates an account with no email,
and its display name defaults to "Explorer" — never the number, because
display names are shown publicly on reviews. A phone-only account cannot be
an admin: the admin allowlist is by email, and the console says so.

### Not done yet: linking

An account created with an email and later signed into with a phone number
becomes **two accounts**. Pre-launch there are almost no existing accounts,
so this is acceptable for now, but it needs a "add your phone to this
account" step (verify a code while signed in, attach the number) before it
matters. Roadmap 0.1b.

## 8. What the first deploy of this does to the database

The users collection's email index changes from **unique** to **unique when
present** — a plain unique index allows exactly one account with no email, so
the second phone-only sign-up would fail. The swap runs at startup, once:
every later start sees it done and does nothing (tested — zero index drops on
an already-migrated database). If a duplicate email ever slipped into the
moment between dropping the old index and creating the new one, the new
revision fails to start rather than running without the constraint, and the
canary at 0% traffic catches that before anyone is affected.

The privacy notice moves to **version 2026-11-15** (phone numbers collected;
Kapso, Meta and MSG91 named). The notice promises that material changes are
agreed to rather than quietly replaced, so a returning user's next sign-in
records consent against the new version; their earlier grant is kept in
`consent_history`, not overwritten. Sessions last 7 days, so everyone active
will have re-agreed within a week.

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
