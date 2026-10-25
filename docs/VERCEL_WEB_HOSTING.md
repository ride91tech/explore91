# Hosting the web app on Vercel at explore91.com

**Status:** deployed and live at **https://explore91.vercel.app**, under the
Vercel team `tech91`, project `explore91`. Everything works except the custom
domain: one DNS record at GoDaddy is the only remaining step, and it is yours
to throw because it takes the current site down (see §6).

---

## 1. Why Vercel rather than a Google load balancer

Cloud Run **cannot map a custom domain in asia-south1**. Google's docs list ten
regions and Mumbai is not among them, and the feature is still preview, labelled
"not recommended for production services". The documented alternatives are a
global external Application Load Balancer — correct, but roughly ₹1,500–2,000 a
month for the forwarding rule alone — or a static host.

Vercel serves the Expo web export as static files and proxies the handful of
server-rendered routes back to Cloud Run. No second runtime, no load balancer
bill.

---

## 2. What serves what

The app and the API stay on separate origins on purpose. Only the
server-rendered pages are proxied.

| Path | Served by | Why |
|---|---|---|
| `/`, `/admin/*`, `/business/*`, `/journey`, … | **Vercel** (static SPA) | The Expo web export; routing happens in the browser |
| `/_expo/*`, `/assets/*` | **Vercel** (static) | Bundle and assets |
| `/place/:slug` | **Cloud Run** via rewrite | Server-rendered; a crawler must see the content |
| `/city/:slug` | **Cloud Run** via rewrite | Same |
| `/sitemap.xml`, `/robots.txt` | **Cloud Run** via rewrite | Generated from live content |
| `/.well-known/*` | **Cloud Run** via rewrite | App Links / Universal Links association files |
| `/api/*` | **Cloud Run directly** — *not* proxied | See §3 |

> **`/city` belongs to both and the rewrite depends on it.** The SPA owns bare
> `/city` (the city picker) and Cloud Run owns `/city/{slug}` (the public city
> page). The rewrite is written `/city/:slug`, which matches `/city/goa` and
> **not** `/city`. Changing it to `/city/:path*` would swallow the picker.

---

## 3. Why `/api/*` is deliberately not proxied

Proxying the API through Vercel would add a hop, and the rate limiter counts
hops to decide which `X-Forwarded-For` entry to trust:

```python
parts[max(0, len(parts) - TRUSTED_PROXY_HOPS)]
```

Behind Vercel the header arrives as `client, vercel-egress`. With
`TRUSTED_PROXY_HOPS=1` the limiter reads the **last** entry — Vercel's egress IP
— so every user on earth shares one bucket and throttles each other. Setting it
to `2` fixes that path but reopens the spoofing hole for anyone hitting the
`run.app` URL directly: with a single-entry header, `max(0, 1 - 2)` is `0`, which
is the client-supplied value the limiter was rewritten to stop trusting.

Both entry points stay open, so no single hop count is correct. Sending API
calls straight to Cloud Run avoids the question: one hop, limiter correct,
spoofing still closed.

The cost is that the browser app is cross-origin to the API, which is what
`ALLOWED_ORIGINS` is for. Auth is a bearer token rather than a cookie, so no
credentialled-CORS complication. The server-rendered pages that *are* proxied
have no rate limiting at all, so the extra hop costs nothing there.

---

## 4. Deploying — what you have to do

Everything below needs your Vercel account or your registrar. Nothing in the
repo can do it.

### 4.1 Deploying a new version

Done. The CLI is authorized on this machine and the project exists. To ship a
change:

```bash
cd frontend
npm run build:web
npx vercel deploy dist --prod
```

`build:web` refuses to finish if the API base did not reach the bundle, and
writes `dist/.vercelignore` so the font assets are uploaded. Both guards exist
because their absence shipped a broken site once already — see §6.

### 4.2 Point the domain — the one step left

`explore91.com` is already attached to the project; it reads "Invalid
Configuration" only because DNS still points elsewhere. Nameservers are
GoDaddy's (`ns35`/`ns36.domaincontrol.com`) and the apex A record resolves to
`185.158.133.1`, the Lovable prototype.

At GoDaddy, change the apex A record:

| Type | Name | Value |
|---|---|---|
| A | @ | `216.198.79.1` |

Vercel's newer range; the legacy `76.76.21.21` still works.

**The Lovable prototype goes offline the moment that record changes**, because
it is what that record currently points at. Give it a subdomain first if you
want to keep it.

### 4.3 Two backend settings that must change with it

Neither is optional; the site is subtly wrong without them.

```bash
gcloud run services update explore91-api --project explore91 --region asia-south1 \
  --update-env-vars PUBLIC_BASE_URL=https://explore91.com
```

`PUBLIC_BASE_URL` is what the server-rendered pages build their `og:url` and
`canonical` tags from. Left pointing at `run.app`, every page served at
explore91.com would declare the Cloud Run URL as its canonical address, and
search engines would index that instead.

`ALLOWED_ORIGINS` must include the domain or the browser app cannot call the
API at all. It contains commas, so it needs a flags-file — a bare
`--update-env-vars` splits on the comma and fails:

```yaml
# allowed-origins.yaml
--update-env-vars:
  ALLOWED_ORIGINS: https://explore91.com
```

```bash
gcloud run services update explore91-api --project explore91 \
  --region asia-south1 --flags-file=allowed-origins.yaml
```

This also closes a standing item: `ALLOWED_ORIGINS` is currently unset, so CORS
is open to every origin and the service logs a warning about it on each boot.

### 4.4 Rebuild the APK afterwards

`EXPO_PUBLIC_SITE_URL` in `frontend/.env` is the Cloud Run URL, so shared links
currently point there. They work, but once the domain is live they should be
`https://explore91.com` — and the Android App Links association already names
that domain, so deep links only start opening the app once both agree.

---

## 5. Before you point a memorable domain at this

`DEV_AUTH_ENABLED` is still `true` on production. Anyone who reaches
`POST /api/auth/dev` signs in as any email, including the address in
`ADMIN_EMAILS`, which can then self-grant admin over real data.

That risk was accepted while the only way in was an unguessable `run.app`
hostname. `explore91.com` is the first thing anyone would try. Close it — or at
minimum drop `ADMIN_EMAILS` so the bypass cannot reach the console — before the
DNS change, not after.

---

## 6. Three faults this deployment uncovered

All three produced a 200 and a page that loaded, which is why none of them
showed up until the site was actually served and read in a browser.

**The API base was blank.** `build-console.mjs` sets
`EXPO_PUBLIC_BACKEND_URL` to `""` so the console can make same-origin relative
requests; `build-web.mjs` sets the absolute Cloud Run URL. Neither passed
`--clear`, and babel-preset-expo inlines each `EXPO_PUBLIC_*` read at
transform time without that value reliably reaching Metro's transform cache
key. Whichever script ran first decided what `src/api.ts` carried, and every
later build got a cache hit that reproduced it byte for byte — identical
bundle hash, no warning. The deployed app requested relative `/api/...`, the
SPA rewrite answered with `index.html`, and every screen rendered empty.
Both scripts now pass `--clear` and export to separate directories.

**The fonts were never uploaded.** The Vercel CLI ignores any path containing
a `node_modules` segment, and Expo exports fonts to
`dist/assets/node_modules/...`. On a prebuilt upload all seven were dropped,
and each `.ttf` fell through to the SPA rewrite and came back as `index.html`
with a 200. `document.fonts` reported `status: "error"` for every face and the
app drew every icon as a tofu box, silently. `build-web.mjs` now writes
`dist/.vercelignore` containing `!node_modules`. That file belongs in `dist/`
and never in `frontend/`, where it would upload the real `node_modules`.

**Nothing checked that any of it worked.** Verifying that the API URL was
"present in the bundle" is what hid the first fault: `EXPO_PUBLIC_SITE_URL`
holds the same string, so a single occurrence looked like success when it was
`src/links.ts` alone. `build-web.mjs` now counts occurrences against the
number of modules that read the variable and fails the build on a shortfall.
