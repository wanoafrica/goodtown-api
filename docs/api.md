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
| `already_completed` | 409 | birthday already set — immutable |
| `validation` | 400/422/409 | 400 = request failed schema validation (`details` = Zod issues); 422/409 = other input problem (`message` explains) |
| `not_found` | 404 | unknown town / neighborhood |
| `rate_limited` | 429 | too many OTP sends / attempts (Better Auth) |
| `internal` | 500 | |

## Mapping to the Android repositories
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
- `POST /email-otp/send-verification-otp` `{ email, type: "sign-in" }` — 3/min per IP
- `POST /sign-in/email-otp` `{ email, otp }` — creates the user on first success; 5 attempts per code, 5-minute expiry
- `GET /get-session` — validates the bearer token
- `POST /sign-out`

## Rules enforced server-side
- Adults only: `complete_signup` with age < 18 → `under_18`, and a SHA-256 of the email goes on the denial list permanently (admin clears via `clearedAt`).
- Birthday immutable after `complete_signup`.
- Home town must be a **live** town; `null` = browse mode. Either sets `townStepDone`.
- `terms.version` must equal the server's `TERMS_VERSION` or the call is rejected with the current version in `details`.
- Launch areas = `launch_areas` (Wichita centre, 25 mi). `resolve` is **live** when the *point* is inside one; the town comes from Census boundaries (county → smallest containing place), rural points snap to the nearest town centre within 40 km, and anything outside every Kansas county is `outside_launch_area`.
- `search` returns up to 10 Kansas towns by name prefix: live first, then cities before communities, A–Z.
