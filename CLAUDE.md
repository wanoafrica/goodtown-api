# goodtown-api — instructions for Claude Code

REST API for the Goodtown apps (`goodtown-mobile`): **Hono 4** on **Node 22** (Docker, DigitalOcean App Platform),
**MongoDB Atlas** (database `goodtown` — the only database; never create another), **Better Auth** (email OTP,
bearer sessions), **SendGrid**. Read `README.md`, then `docs/api.md` (the human-written contract the apps map onto).

## Conventions
- Responses: `{ ok: true, ... }` / `{ ok: false, code, message?, details? }` — clients switch on `code`.
- Every route has `describeRoute(...)` metadata and a schema in `src/openapi/schemas.ts`; `/docs` (Scalar) and
  `/openapi.json` are generated from them when `DOCS_ENABLED=1`. Update `docs/api.md` with any contract change.
- Env is validated by zod in `src/env.ts`; local values in `.env` (git-ignored, never print or commit secrets).
- Towns are US Census GEOIDs; the Kansas map lives in `geo_*` collections loaded by `npm run load:kansas`
  (see README "Kansas map"). Live = within a launch town's radius (`launch_areas`).
- Sessions are opaque Better Auth tokens; `requireSession` caches a resolved session 30 s (evicted on sign-out).

## Commands
`npm run dev` (tsx watch, :8080) · `npm test` (vitest) · `npm run typecheck` · `npm run build` (esbuild →
`dist/server.js`) · `npm run load:kansas` · `npm run email:preview`. Docker: `docker compose up --build`.

## Git
Commit as `Nasir Khalid <nasir.khalid.new@gmail.com>`, plain messages, no `Co-Authored-By` / `Claude-Session` /
other trailers. Production secrets are set in the hosting dashboard, never in the repo.

## Where things stand (2026-10-07)
- Done: auth + sign-up state machine, towns/geo (Census), home town, terms, push-token stubs, emails, Docker,
  Town feed (`/v1/town/home`, `/v1/feed` — both also open to guests, rate limited — reactions, event saves;
  `npm run seed:feed` for demo content).
- Next: deploy on DigitalOcean App Platform (`.do/app.yaml`), then point the apps' release `API_BASE_URL` at it;
  suspension enforcement (revoke sessions + reject in `requireSession`); video upload + moderation (posts are
  only seeded today); weather for `todayNote`; Delete-account; phone OTP; push sending.
