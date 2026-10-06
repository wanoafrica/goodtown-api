# goodtown-api

Goodtown's REST API: **Hono** on **Node 22** (Docker), **MongoDB Atlas** (official driver), **Better Auth** for email-OTP sign-in and bearer sessions, **SendGrid** for the code emails.

Contract: [`docs/api.md`](docs/api.md). The Android app's repository interfaces map 1:1 onto it.

## Setup

```bash
npm install
cp .env.example .env                  # fill in MONGODB_URI, BETTER_AUTH_SECRET (openssl rand -base64 32), SENDGRID_API_KEY
npm run seed:towns                    # 11 Kansas towns + indexes into the `goodtown` database (idempotent)
npm run dev                           # http://localhost:8080 (tsx watch)
#   http://localhost:8080/docs          interactive API reference (Scalar) — DOCS_ENABLED=1
#   http://localhost:8080/openapi.json  OpenAPI 3.1 document
```

Node 22+ (uses `process.loadEnvFile`). Codes are logged instead of emailed while `OTP_DEBUG_LOG=1`.

## Deploy

The API is a Docker image (`Dockerfile`: Node 22 alpine, non-root, `/health` healthcheck, port 8080).

**DigitalOcean App Platform** (recommended): Create App → GitHub → `wanoafrica/goodtown-api` → it detects the Dockerfile.
Set the secrets `MONGODB_URI`, `BETTER_AUTH_SECRET`, `SENDGRID_API_KEY` as encrypted env vars and `BETTER_AUTH_URL` to the
app's public URL (`${APP_URL}` works in the spec). `.do/app.yaml` has the full spec. Deploys on every push to `main`.
Atlas Network Access must allow the app's egress IPs (or `0.0.0.0/0`).

**Anywhere else**: `docker build -t goodtown-api . && docker run --env-file .env -p 8080:8080 goodtown-api`, behind any
TLS-terminating proxy (Caddy, nginx, the platform's). The proxy must pass the client IP in `X-Forwarded-For`
(`TRUSTED_IP_HEADERS`) — Better Auth rate-limits OTP sends per IP.

History: the API ran on Cloudflare Workers until 2026-10-06. It moved to a Node host because the MongoDB driver needs a
long-lived connection pool, which Workers cannot keep across requests (see git history for the per-request workaround).

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

## API docs

`GET /docs` serves an interactive reference (Scalar) and `GET /openapi.json` the OpenAPI 3.1 document. Both are generated
at request time by `hono-openapi` from the route validators plus the `describeRoute(...)` metadata on each route, merged
with the four Better Auth endpoints the apps use (`/api/auth/*`). Response shapes live in `src/openapi/schemas.ts` —
update them together with `docs/api.md` when a route changes. They are gated by `DOCS_ENABLED=1` (on in `.env.example`; leave it unset or `0` in production for a 404).

## Emails

OTP emails are built in code (`src/lib/emailTemplates.ts`: table layout, inline CSS, Goodtown palette, text + HTML parts)
and sent with a plain `fetch` to SendGrid's v3 Mail Send API (`src/lib/sendgrid.ts`) — no SDK. The copy differs for
sign-up (no account yet) and log-in; click/open tracking is disabled for these mails. `npm run email:preview` writes both
variants to `.preview/` for a browser check. With `OTP_DEBUG_LOG=1` (local dev) codes are logged instead of sent.

## MongoDB connections

One `MongoClient` per process (`src/db/client.ts`), connected at start-up (`src/server.ts` pings the database and ensures
indexes before listening). Pool 2–20. The process exits non-zero if the database is unreachable, so the platform restarts it.

## Notes
- The Mongo client is cached per Worker isolate. If p50 latency is a problem, move it behind a Durable Object.
- Better Auth manages `user`, `session`, `verification` collections; Goodtown data is in `profiles`, `towns`, `townRequests`, `signupDenials`.
