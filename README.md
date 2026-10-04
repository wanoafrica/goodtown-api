# goodtown-api

Goodtown's REST API: **Hono** on **Cloudflare Workers**, **MongoDB Atlas** (official driver via `nodejs_compat`), **Better Auth** for email-OTP sign-in and bearer sessions, **SendGrid** for the code emails.

Contract: [`docs/api.md`](docs/api.md). The Android app's repository interfaces map 1:1 onto it.

## Setup
```bash
npm install
cp .dev.vars.example .dev.vars        # fill MONGODB_URI, BETTER_AUTH_SECRET, SENDGRID_API_KEY
npm run seed:towns                    # Kansas towns + indexes (idempotent; reads .dev.vars)
npm run dev                           # http://localhost:8787
```
`OTP_DEBUG_LOG=1` in `.dev.vars` prints codes to the console instead of emailing.

Atlas: Network Access must allow `0.0.0.0/0` (Workers have no fixed IPs); use a dedicated DB user with readWrite on the `goodtown` database only.

## Deploy
```bash
wrangler secret put MONGODB_URI
wrangler secret put BETTER_AUTH_SECRET     # openssl rand -base64 32
wrangler secret put SENDGRID_API_KEY
wrangler secret put BETTER_AUTH_URL        # https://api.goodtown.app
npm run deploy
```

## Layout
```
src/
  index.ts          Hono app, mounts Better Auth at /api/auth and the v1 routes
  auth.ts           Better Auth config (mongo adapter, emailOTP, bearer, rate limits)
  env.ts            bindings
  db/               Mongo client (per-isolate), collections + indexes
  domain/           pure rules: age/birthdate, name, signup state machine
  routes/           auth · signup · towns · me
  middleware/       requireSession
  lib/              sendgrid · errors · hash
scripts/seed-towns.ts
test/               vitest unit tests for the domain rules
```

## Notes
- The Mongo client is cached per Worker isolate. If p50 latency is a problem, move it behind a Durable Object.
- Better Auth manages `user`, `session`, `verification` collections; Goodtown data is in `profiles`, `towns`, `townRequests`, `signupDenials`.
