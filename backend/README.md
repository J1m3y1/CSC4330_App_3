# Fantasi API

## Setup

```bash
npm install
cp .env.example .env   # then fill in DB credentials and secrets
npm run migrate         # applies db/migrations/*.sql in order, idempotent
npm run bootstrap-admin -- you@example.com   # promotes an existing registered user to admin
npm run dev              # nodemon, or `npm start` for a plain node run
```

The frontend (`LandingPage/`, `Dashboard/`, `SignInProcess/`, `SignUpProcess/`,
`AdminPage/`) is served by this same server, same-origin — open
`http://localhost:5000/` once it's running. Auth cookies are `SameSite=strict`,
so the frontend and API must stay same-origin (or share a registrable domain
in production); see `ALLOWED_ORIGINS`/`APP_URL` in `.env.example`.

## Required environment variables

See `.env.example` for the full list. `DB_*`, `JWT_SECRET`, and
`REFRESH_TOKEN_SECRET` are required — the server exits at boot with a clear
message if any are missing (`config/validateEnv.js`). `SMTP_*` is optional:
without it, outgoing emails are logged to the console instead of sent, but
everything else works.

## First-time flow

1. `npm run migrate`
2. Register an account through the UI (`/SignUpProcess/SignUp.html`) or
   `POST /api/auth/register`.
3. `npm run bootstrap-admin -- your-email@example.com` on that same account
   (or a different one you also register) — this is the only way to create
   an admin; there's no self-service path, by design.
4. Sign in as the admin and open `/AdminPage/Admin.html` to approve the
   pending application from step 2.
5. Sign in as the approved account and continue through
   `/Dashboard/profile-setup.html`.

## Membership upgrades (private invitation — no payment processor)

Fantasi takes no payment itself: mainstream processors (Stripe, PayPal,
Square) don't underwrite this kind of content, and a dedicated high-risk
processor (CCBill, Segpay, Epoch, Vendo) isn't wired up yet. Instead:

1. A member requests a tier — `POST /api/membership/request`
   (`FantasiAPI.requestMembershipUpgrade` on the client).
2. An admin reviews it in `/AdminPage/Admin.html` → Membership Requests, and
   grants or declines it — `POST /api/admin/membership-requests/:id/resolve`.
3. Granting calls `grantMembership()` in
   `controllers/membershipController.js`, which is also what
   `POST /api/membership/grant` (admin-only, standalone comps) uses.

If you later integrate a real processor, its webhook/postback handler is the
one new piece — have it call `grantMembership(userId, tier, grantRef)`
directly, same as the admin-approval path does.

## Photo gallery

Up to 6 photos per member (`profile_photos` table). `profiles.avatar_url`
stays as a denormalized "primary photo" cache — every existing query that
reads it (sidebar avatars, message/chatroom sender avatars, discover cards)
keeps working unchanged; `photosController.js` keeps it in sync on every
upload/delete/set-primary. Endpoints under `/api/profile/photos`.

## Tests

```bash
npm test
```

Covers the auth flow (register → pending → approve → login → refresh →
logout) against a real Postgres connection — set `DB_*` env vars before
running, same as the app itself. Not a full suite; the rest of the API is
currently verified manually (see the project's audit notes).

## Migrations

`db/migrations/*.sql`, applied in filename order by `npm run migrate`, which
tracks what's already run in a `schema_migrations` table. Never edit an
already-applied migration — add a new numbered file instead.
