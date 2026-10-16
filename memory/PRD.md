# Explore91 — Product Requirements

## Vision
The "Operating System for every city" — a premium mobile app to discover, book, reserve and pay for experiences across 24+ business categories, starting with Goa, Ahmedabad and Pune.

## Tech
- **Frontend**: Expo (React Native SDK 57, RN 0.86, React 19.2) + Expo Router, expo-image, expo-blur, expo-linear-gradient, expo-haptics, react-native-maps.
- **Backend**: FastAPI + Motor (MongoDB). Prefix `/api`. Modular layout under `/app/backend/{core,models,routes,seed}` — `server.py` is a thin composer that mounts 8 domain routers (auth, catalog, interactions, portal, admin, ai, reels, tickets) via a FastAPI `lifespan` handler.
- **Auth**: Google Sign-In and Apple Sign-In. The client obtains an ID token and posts it to `POST /api/auth/google` or `POST /api/auth/apple`; the backend verifies it against the provider's published JWKS (issuer, audience, expiry, signature) and returns a 7-day `session_token` stored in `expo-secure-store`. No third party sits in the login path.
- **AI**: Claude, called directly over the Anthropic Messages API. Needs `ANTHROPIC_API_KEY`; without it the AI routes return 503.
- **Storage**: MongoDB collections — `users`, `user_sessions`, `businesses`, `bookings`, `saved`, `reviews`, `staff`.

## Roles (v2)
- `customer` — default (discover, book, save, review).
- `owner` — business owner (create/manage listings, staff, view own bookings, analytics).
- `admin` — platform admin (approve/feature/remove businesses, view users, view GMV & stats).
- Any authenticated user may self-grant `owner`/`admin` via `POST /api/auth/roles` in this demo build. **Must be gated before production**.

## Screens (mobile)
### Customer
1. **Login** — Cinematic hero + Google sign-in.
2. **Discover** — City selector, search, **AI Concierge CTA**, city hero, category chips, featured, trending, nearby.
3. **Explore** — Live search, 24 category chips, **List / Map toggle** (react-native-maps native; graceful list fallback on web).
4. **Reels** — Full-bleed vertical video feed (like Instagram/TikTok). Autoplay, tap to unmute, like/comment/share rail, business chip + Book CTA linking to the listing.
5. **Saved** — Bookmarks.
6. **Profile** — Reward wallet card, upcoming bookings, account, "For business & platform" section (Business Portal / Admin / AI concierge), sign-out.
6. **Business Detail** — Swipeable gallery, tags, rating, offers, menu, services, **Reviews (list + inline rate/comment)**, sticky Book Now.
7. **Booking flow** — Modal: date/time/guests → notes recap → confirm (+50 pts).
8. **City picker** — Modal.

### AI (Claude Sonnet 4.6)
9. `/ai` — **AI Concierge** — pick mood/budget/party → 5 personalized recommendations with reasons.
10. `/ai/itinerary` — **Smart itinerary** — pick days (1–5) + interests → day-by-day timeline with real businesses.

### Business Owner Portal (`/portal/*`)
11. `/portal` — Dashboard: estimated revenue, KPIs, nav tiles, my businesses list with approval status.
12. `/portal/bookings` — All bookings received across my businesses.
13. `/portal/staff` — Add team members (name + role) per business; list & delete.
14. `/portal/analytics` — Bookings-by-day bar chart, bookings-by-business horizontal bar chart, totals.
15. `/portal/new-business` — Multi-field form; submits with `is_approved=false` awaiting admin.

### Admin Panel (`/admin/*`)
16. `/admin` — GMV/platform-fee hero, KPIs (users, businesses, pending, bookings, reviews), by-city breakdown, nav to Businesses / Users.
17. `/admin/businesses` — Filter (All / Pending / Featured); per-row Approve / Feature-toggle / Delete actions.
18. `/admin/users` — List all users with roles & wallet points.

## API surface (34 endpoints)
### Public
- `GET /api/` — health
- `GET /api/cities`
- `GET /api/categories`
- `GET /api/businesses` — filtered by city/category/q/featured (only approved)
- `GET /api/businesses/trending`
- `GET /api/businesses/{id}`
- `GET /api/businesses/{id}/reviews`

### Auth
- `POST /api/auth/google` — verify a Google ID token → `session_token`
- `POST /api/auth/apple` — verify an Apple identity token → `session_token`
- `GET  /api/auth/me`
- `POST /api/auth/logout`
- `PATCH /api/auth/me` — update `home_city`
- `POST /api/auth/roles` — self-grant `owner` / `admin` (demo)

### Customer (auth)
- `GET  /api/saved`, `POST /api/saved/toggle`
- `GET/POST/DELETE /api/bookings` — awards +50 reward points per booking
- `POST /api/reviews`

### Owner (auth + owner role)
- `GET  /api/owner/dashboard`
- `GET  /api/owner/businesses`
- `POST /api/owner/businesses` — creates pending listing
- `GET  /api/owner/bookings`
- `GET/POST/DELETE /api/owner/staff`
- `GET  /api/owner/analytics`

### Admin (auth + admin role)
- `GET  /api/admin/stats`
- `GET  /api/admin/users`
- `GET  /api/admin/businesses?pending=`
- `PATCH /api/admin/businesses/{id}/approve`
- `PATCH /api/admin/businesses/{id}/feature`
- `DELETE /api/admin/businesses/{id}`

### AI (auth)
- `POST /api/ai/recommend` — 5 curated picks tailored by mood/budget/party
- `POST /api/ai/itinerary` — day-by-day city itinerary

## Testing
- Backend: **44/44 automated tests passing** (regression + 25 new endpoint checks including RBAC, ownership scoping, is_approved filter, AI recommend/itinerary with real Claude 4.6, review flow).

## Security TODOs before production
- ~~**Gate `POST /api/auth/roles`**~~ — done. `admin` can only be self-granted by an address in `ADMIN_EMAILS`; anyone else gets 403.
- Split `server.py` into modules (currently ~1075 lines).
- Migrate from `@app.on_event` to FastAPI lifespan.
- Tighten CORS (currently `*`).

## Out of scope for this iteration (roadmap)
- Razorpay checkout on booking confirm.
- Push / SMS / WhatsApp notifications.
- Business KYC/verification workflow.
- Multi-city expansion beyond the three seed cities.
- Advertising / banner CMS.
- Fraud detection & support tickets.
