# Goodtown API — contract v1

Base URL: `https://api.goodtown.app` (prod, once DNS is set; until then the App Platform URL) · `http://localhost:8080` (`npm run dev`).
Interactive reference: `<base>/docs` · machine-readable: `<base>/openapi.json` (generated from the code; this file is the human-written contract and the Android mapping).
All responses are JSON. Success: `{ ok: true, ... }`. Failure: `{ ok: false, code, message?, details? }` — **clients switch on `code`**.

Auth: Bearer token in `Authorization: Bearer <token>`. The token is issued by Better Auth after a verified OTP (response header `set-auth-token`). Sessions last 90 days.

## Error codes
| code | HTTP | meaning |
|---|---|---|
| `unauthorized` | 401 | no/expired session |
| `no_account` | — | *(client-side, from `/v1/auth/email/check` returning `exists:false`)* |
| `under_18` | 403 | permanent refusal for this login |
| `invalid_name` | 422 | name failed server rules → back to AuthName |
| `invalid_date` | 422 | birthdate does not exist / future / < 1900 |
| `already_completed` | 409 | birthday already set — immutable (a retry with the *same* name + birthdate returns 200) |
| `validation` | 400/422/409 | 400 = request failed schema validation (`details` = Zod issues); 422/409 = other input problem (`message` explains) |
| `not_found` | 404 | unknown town / neighborhood |
| `rate_limited` | 429 | too many `/v1/auth/email/check` calls (10/min per IP, `Retry-After` header). Better Auth's own 429s (OTP send/verify) carry **no** `code` — clients map on the HTTP status |
| `internal` | 500 | |

Error codes are defined once in `src/lib/errors.ts` (`ERROR_CODES`); the OpenAPI schema is built from that list.
A body that is not valid JSON is `400 validation`.

## Mapping to the Android repositories
The iOS repositories (`ios/Goodtown/Data/`) mirror these names and calls one-to-one.

| Android call | HTTP |
|---|---|
| `AuthRepository.requestEmailCode(email, LogIn)` | `POST /v1/auth/email/check` → if `exists:false` raise `NoAccountException`; else `POST /api/auth/email-otp/send-verification-otp {email, type:"sign-in"}` |
| `AuthRepository.requestEmailCode(email, SignUp)` | `POST /api/auth/email-otp/send-verification-otp {email, type:"sign-in"}` |
| `AuthRepository.verifyEmailCode(email, code)` | `POST /api/auth/sign-in/email-otp {email, otp}` → store `set-auth-token`; wrong code → `WrongCodeException` |
| *(launch / after verify)* | `GET /v1/auth/state` → `{state: under_18 \| needs_profile \| suspended \| town_step \| terms \| active}` |
| `AuthRepository.completeSignUp(name, birthdate)` | `POST /v1/signup/complete {name, birthdate:"yyyy-mm-dd"}` |
| `AuthRepository.acceptTerms(version)` | `POST /v1/me/terms {version}` |
| `AuthRepository.registerPushToken(token)` | `POST /v1/me/push-token {token, platform:"android"}` |
| `AuthRepository.signOut()` | `DELETE /v1/me/push-token {token}` then `POST /api/auth/sign-out` |
| `TownRepository.resolve(lat,lng)` | `GET /v1/towns/resolve?lat&lng` → `{resolution: live \| not_live \| outside_launch_area, town?, neighborhood?}` |
| `TownRepository.searchTowns(q)` | `GET /v1/towns/search?q=` → `{towns:[...]}` |
| `TownRepository.neighborhoods(geoid)` | `GET /v1/towns/:geoid/neighborhoods` |
| `TownRepository.interest(geoid)` | `GET /v1/towns/:geoid/interest` → `{wantCount, alreadyRequested, nearestLive, nearestLiveMiles}` |
| `TownRepository.requestTown(geoid)` | `POST /v1/towns/:geoid/request` |
| `TownRepository.setHomeTown(geoid?, neighborhoodId?)` | `PUT /v1/me/home-town {geoid \| null, neighborhoodId?}` |
| `FeedRepository.home()` | `GET /v1/town/home` |
| `FeedRepository.feed(category, cursor)` | `GET /v1/feed?category=all\|food\|events\|family\|outdoors\|shops\|sports&cursor=` |
| `FeedRepository.setReaction(r, postId, active)` | `PUT` / `DELETE /v1/posts/:id/reactions/:reaction` (`want_to_go`, `love`, `been_there`, `save`, `thanks`) |
| `FeedRepository.setEventSaved(eventId, saved)` | `PUT` / `DELETE /v1/events/:id/save` |

## Town object
```json
{ "geoid": "2079000", "name": "Wichita", "kind": "city", "state": "KS", "county": "Sedgwick County", "isLive": true }
```
`geoid` is the **US Census place GEOID** (7 digits; Wichita `2079000`, Derby `2017800`, Hutchinson `2033625`) — stable,
shared with every public dataset, and what `homeTownGeoid` / town requests store. `kind` is `city` (incorporated) or
`community` (census-designated place). `isLive` = the town's centre is inside a launch area. `resolve` also returns
`neighborhood: { id, name } | null` — the neighborhood the point is in, when the town has a layer (Wichita only today);
neighborhood ids look like `wichita_city:DELANO`.

## Better Auth endpoints used (under `/api/auth`)
Only these four are reachable; every other Better Auth path answers `404 not_found`.
- `POST /email-otp/send-verification-otp` `{ email, type: "sign-in" }` — 3/min per IP
- `POST /sign-in/email-otp` `{ email, otp }` — creates the user on first success; 5 attempts per code, 5-minute expiry
- `GET /get-session` — validates the bearer token
- `POST /sign-out`

## Rules enforced server-side
- Adults only: `complete_signup` with age < 18 → `under_18`, and a SHA-256 of the email goes on the denial list permanently (admin clears via `clearedAt`).
- Birthday immutable after `complete_signup`.
- Home town must be a **live** town; `null` or an omitted `geoid` = browse mode. Either sets `townStepDone`.
- Push tokens: a token belongs to the account signed in on that device now — registering it removes it from every other profile. At most 10 tokens per account (oldest dropped).
- Rate limits are per client IP: the socket address, or `TRUSTED_IP_HEADERS` (production: `do-connecting-ip`) only when `TRUST_PROXY=1`.
- Expired sessions and OTP codes are removed by MongoDB TTL indexes (`session.expiresAt`, `verification.expiresAt`). OTP codes are stored hashed.
- The request log never contains query strings (they carry coordinates and search terms).
- `GET /health` = process up (liveness); `GET /ready` = database reachable (503 otherwise).
- Sessions resolved from a bearer token are cached in the API process for 30 s (sign-out evicts immediately), so a burst of calls from one screen does one session lookup.
- `terms.version` must equal the server's `TERMS_VERSION` or the call is rejected with the current version in `details`.
- Launch areas = `launch_areas` (Wichita centre, 25 mi). `resolve` is **live** when the *point* is inside one; the town comes from Census boundaries (county → smallest containing place), rural points snap to the nearest town centre within 40 km, and anything outside every Kansas county is `outside_launch_area`.
- `search` returns up to 10 Kansas towns by name prefix: live first, then cities before communities, A–Z.

## Town feed (Main 5:628, Player 5:2408)
The viewer's town is their home town, or Wichita while browsing (`homeTownGeoid: null`).

**Guests** ("Looking around", no account — Figma GuestTown 106:34): `GET /v1/town/home` and `GET /v1/feed` also answer
without credentials. A guest gets Wichita, `firstName: null`, "new" = since local midnight (no visit is recorded),
`myReactions: []` and `saved: false`; guest reads are limited to 120 a minute per IP (`429 rate_limited`). Credentials
that are sent but no longer resolve still answer `401`. Reactions and event saves always need a session (`401`); the
apps show the "Join Goodtown to do that" sheet (GuestJoin 106:226) instead of calling them.

`GET /v1/town/home` →
```json
{ "ok": true, "town": { "geoid": "2079000", "name": "Wichita" }, "firstName": "Maria", "newSinceLastVisit": 5,
  "todayNote": null, "today": { "videos": 12, "events": 6, "deals": 4 },
  "neighborsPostingToday": [{ "id": "<userId>", "name": "Maria", "avatarTone": 0 }] }
```
`todayNote` (weather line) is null until a weather source exists; the apps hide it.

`GET /v1/feed?category&cursor` → `{ ok, items, nextCursor }`, newest first. A page holds up to 6 videos; one
upcoming event follows the first two and one live deal follows the event (deals only in All / Food / Shops).
`category=events` lists upcoming events only. `nextCursor` is opaque — pass it back as `cursor`; `null` = the end.
Items:
- `{ type: "video", id, author: {id, name, isBusiness, isVerified, avatarTone}, title, quote, place, postedAt, isNew,
  videoUrl, thumbnailUrl, thumbnailTone, business: {id, name, isVerified, isOpenNow, distanceMiles, dealId,
  thumbnailUrl, thumbnailTone} | null, myReactions: [reaction] }`
- `{ type: "event", id, title, startsAt, place, category, saved }`
- `{ type: "deal", id, title, businessName, endsAt }`
- `{ type: "caught_up" }` — once, where posts newer than the previous visit give way to older ones.

**"New"** = posted after the previous visit. A visit is Town activity without a 30-minute gap; `/town/home` and the
first feed page start or continue it (`profiles.townSeenAt` / `townBaselineAt`), and the cursor keeps the baseline
fixed while paging. A first visit counts everything since local midnight (America/Chicago).

**Distance** (`distanceMiles`) is measured from the viewer's home neighborhood centre (or town centre) — the API never
stores the device location. `isOpenNow` comes from the business's weekly hours in local time; null when unknown.

`PUT|DELETE /v1/posts/:id/reactions/:reaction` and `PUT|DELETE /v1/events/:id/save` → `{ ok: true, active }`;
idempotent; unknown id → `404 not_found`, unknown reaction → `400 validation`.

Collections: `posts`, `businesses`, `events`, `deals`, `postReactions`, `eventSaves` (`src/feed/model.ts`). Demo
content: `npm run seed:feed` (everything tagged `seed: true`; `npm run seed:feed -- --remove` deletes it). Seed places are real
rows of `geo_neighborhoods` (Delano, Riverside, Old Town, College Hill, Midtown when present, else other active Wichita
neighborhoods A–Z), so every seeded post / business has a `neighborhoodId`; run `npm run load:kansas` first.
Uploading videos (and moderation of `held` posts) comes with the Upload screen.
