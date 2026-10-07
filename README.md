# goodtown-api

Goodtown's REST API: **Hono** on **Node 22** (Docker), **MongoDB Atlas** (official driver), **Better Auth** for email-OTP sign-in and bearer sessions, **SendGrid** for the code emails.

Contract: [`docs/api.md`](docs/api.md). The Android app's repository interfaces map 1:1 onto it.

## Setup

```bash
npm install
cp .env.example .env                  # fill in MONGODB_URI, BETTER_AUTH_SECRET (openssl rand -base64 32), SENDGRID_API_KEY
npm run load:kansas                   # Kansas map → `goodtown` database (Census TIGER + Wichita neighborhoods; idempotent, ~2 min)
npm run dev                           # http://localhost:8080 (tsx watch)
#   http://localhost:8080/docs          interactive API reference (Scalar) — DOCS_ENABLED=1
#   http://localhost:8080/openapi.json  OpenAPI 3.1 document
```

Node 22+ (uses `process.loadEnvFile`). Codes are logged instead of emailed while `OTP_DEBUG_LOG=1`; without it
`SENDGRID_API_KEY` is required, and `OTP_DEBUG_LOG=1` is refused when `NODE_ENV=production` (the Docker image).

**Docker locally**: `docker compose up --build` runs the production image against `MONGODB_URI` from `.env` (Atlas).
Fully offline: `docker compose --profile local-db up --build` with `MONGODB_URI=mongodb://mongo:27017/?replicaSet=rs0`
— a single-node replica set (Better Auth's adapter uses transactions), data in the `mongo-data` volume.

## Deploy

The API is a Docker image (`Dockerfile`: Node 22 alpine, non-root, `/health` healthcheck, port 8080; pin the base image
by digest with `--build-arg NODE_IMAGE=node:22-alpine@sha256:…`). `GET /ready` also checks the database.

**DigitalOcean App Platform** (recommended): Create App → GitHub → `wanoafrica/goodtown-api` → it detects the Dockerfile.
Set the secrets `MONGODB_URI`, `BETTER_AUTH_SECRET`, `SENDGRID_API_KEY` as encrypted env vars and `BETTER_AUTH_URL` to the
app's public URL (`${APP_URL}` works in the spec). `.do/app.yaml` has the full spec (it sets `TRUSTED_IP_HEADERS=do-connecting-ip` + `TRUST_PROXY=1` so rate limits see the
real client IP). Deploys on every push to `main`.
Atlas Network Access must allow the app's egress IPs (or `0.0.0.0/0`).

**Anywhere else**: `docker build -t goodtown-api . && docker run --env-file .env -p 8080:8080 goodtown-api`, behind any
TLS-terminating proxy (Caddy, nginx, the platform's). Have the proxy put the client IP in a single-value header (e.g.
`X-Real-IP`), set `TRUSTED_IP_HEADERS` to it and `TRUST_PROXY=1`. Without `TRUST_PROXY=1` the API ignores client-sent IP
headers and uses the socket address — otherwise anyone could dodge the per-IP limits by sending a fake header.
Rate-limit counters are in memory: keep one instance (or move them to MongoDB) before scaling out.

History: the API ran on Cloudflare Workers until 2026-10-06. It moved to a Node host because the MongoDB driver needs a
long-lived connection pool, which Workers cannot keep across requests (see git history for the per-request workaround).

## Layout
```
src/
  index.ts          Hono app, mounts Better Auth at /api/auth and the v1 routes
  auth.ts           Better Auth config (mongo adapter, emailOTP, bearer, rate limits)
  env.ts            bindings
  db/               Mongo client (one per process), collections + indexes
  geo/              Kansas map: collections + 2dsphere indexes (model), live/launch rules (live), point → county/town/neighborhood (locate), name helpers (names)
  domain/           pure rules: age/birthdate, name, signup state machine
  routes/           auth · signup · towns · me
  middleware/       requireSession · rateLimit
  lib/              sendgrid · errors · hash · clientIp
scripts/load-kansas.ts   loads the map (below)
test/               vitest unit tests for the domain rules, geo helpers, env/IP/rate-limit/error hardening
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

## Kansas map (`src/geo`, `scripts/load-kansas.ts`)

Towns are identified by their **US Census GEOID** — the same ids the Android app, the SwiftUI port and any future
data source share: county = 5 digits (Sedgwick `20173`), place = 7 digits (Wichita `2079000`, Derby `2017800`).

| Collection | Source | Rows |
|---|---|---|
| `geo_counties` | TIGER/Line `COUNTY`, STATEFP 20 | 105 |
| `geo_towns` | TIGER/Line `PLACE` for Kansas — incorporated cities (`kind: city`) and census-designated places (`kind: community`, LSAD 57); `countyGeoid/countyName` from the centre point; `center` = Census interior point; `areaM2` = ALAND | 739 |
| `geo_neighborhoods` | City of Wichita "Neighborhood Associations" ArcGIS layer; `id = wichita_city:<OFFICIAL NAME>`, display name via `wichitaDisplayName`; associations that vanish from the layer are deactivated, never deleted | 76 |
| `launch_areas` | where Goodtown is open: `{ townGeoid, radiusM }` — Wichita, 25 mi (inserted once; edit the radius in Atlas, the loader never overwrites it) | 1 |
| `geo_sources` | attribution + row counts | 2 |

Rules (`src/geo/live.ts`, `src/geo/locate.ts`): a point is **live** when it is within a launch town's radius of that
town's centre; a town is live when its centre is. `resolve` finds the county and the smallest place whose boundary
contains the point, snapping rural points to the nearest town centre within 40 km; outside every Kansas county →
`outside_launch_area`. Geometry is GeoJSON (WGS84) with 2dsphere indexes — `$geoIntersects` for containment, `$near`
for distance. One TIGER polygon (Colby) is stored as published because the normalised shape fails Mongo's validation;
the loader logs it.

`npm run load:kansas` downloads ~90 MB from census.gov (set `TIGER_CACHE_DIR=./tigercache` to keep the zips between
runs; `TIGER_YEAR` defaults to 2024) and upserts everything, so it is safe to re-run after a Census release.

## Notes
- Better Auth manages `user`, `session`, `verification` collections; Goodtown data is in `profiles`, `townRequests`, `signupDenials`, and the `geo_*` / `launch_areas` collections above.
