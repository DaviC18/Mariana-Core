Status: APPROVED by Davi — "eu aprovo as suas recomendações" (2026-10-27)

Approval relayed word for word by the coordinator: "eu aprovo as suas recomendações, me mande um relatorio assim que terminar". Per the coordinator, a plain approval accepts every recommendation:
- Q1: treat the server as public.
- D-1: Davi is `admin`; consultants get a `consultant` role later (admin UI out of scope).
- D-2: delete `POST /conversations/:id/messages`. Step 4 is unblocked.
- D-3: unknown, not answered. Any current caller must send `Authorization: Bearer <ADMIN_API_KEY>` after step 3.
- D-4: remove `@fastify/multipart` (step 1).
- D-5: constant-time webhook secret compares (step 9).
- D-6: no HSTS for now.
- D-7: `TRUST_PROXY_HOPS=1` behind ngrok.
- D-8: no new npm dependency; the limiter and headers are built in-house.
- Condition: send Davi a report when the work is finished.

# 2026-10-27-api-auth — protect every non-webhook HTTP route

Source: F2-05 / Q1 / D-R3-2 in `docs/work/2026-10-26-flow-review/plan.md:226,645,747` and `test-report.md:1040`.
Note: the Skill tool was not available in this session; systematic-debugging / writing-plans were followed by hand (evidence first, small red→green steps).

## Summary
- Every route except the 3 webhooks, `GET /` and the Google OAuth browser hops requires `Authorization: Bearer <ADMIN_API_KEY>` (constant-time compare, per-IP failure limiter, fixed 401).
- The OAuth start link becomes a signed, short-lived, one-time ticket; the OAuth `state` gets expiry, single use and browser binding.
- No change to WhatsApp customer behavior. The auth layer is shaped so a future admin UI (session cookie, roles) plugs in without rewriting routes.

## Root causes / findings

| ID | Finding | Status | Evidence |
|---|---|---|---|
| A1 | No route has auth | confirmed | `src/server.ts:56-74` registers every plugin at root; no `onRequest` hook, no auth plugin in `package.json:24-30` |
| A2 | `GET /leads` dumps every lead (phone, email) | confirmed | `src/routes/leads/get-leads.ts:11` `db.select().from(leads)` with no filter or limit; same pattern `GET /messages` (`get-messages.ts:7`), `GET /conversations` (`get-conversations.ts:6`) |
| A3 | `POST /conversations/:id/messages` accepts `system`/`assistant` and runs a real AI turn without `expectedConversationId` | confirmed | `create-messages.ts:14` enum user/assistant/system; `receive-customer-message.ts:118-145` calls `generateMarianaResponse` without `expectedConversationId`, through the legacy in-memory debounce; a `system` row is injected into the AI history (prompt injection) |
| A4 | `POST /appointments` creates real Google Calendar events, open | confirmed | `create-appointments.ts:33` |
| A5 | `/auth/google?consultantId=` is open: anyone can link THEIR Google account to any consultant (calendar takeover: bookings land in the attacker calendar) | confirmed | `auth-google.ts:50-86` only checks the consultant exists |
| A6 | OAuth `state`: no expiry, no single use, not bound to the browser, `!==` compare, key reused from `GOOGLE_CLIENT_SECRET` | confirmed | `auth-google.ts:12-48`: nonce never stored, no timestamp, `signature !== expectedSignature` at :41, HMAC key `env.GOOGLE_CLIENT_SECRET` at :16,:37. Signature does block forging; it does not block replay or login-CSRF |
| A7 | Callback reflects the raw `error` query param and logs the raw Google error | confirmed (low) | `auth-google.ts:99-103` echoes `oauthError`; `:174` `request.log.error(catchError)` logs the whole GaxiosError (gaxios 7.3.1 has a default redactor; still log safe fields only) |
| A8 | `setCredentials(tokens)` on the shared singleton keeps the last consultant's tokens in process memory | confirmed (low) | `auth-google.ts:149`; singleton `oauth.ts:10`; only used here, so no cross-consultant race today |
| A9 | `GOOGLE_REDIRECT_URI` not validated | confirmed | `env.ts` `GOOGLE_REDIRECT_URI: z.string().min(1)` |
| A10 | Webhook secrets compared with `===` (timing) | confirmed (low) | WhatsApp verify token `webhook-whatsapp.ts:262`; Meta verify token `webhook-meta-ads.ts:74`; Google Ads key `webhook-google-ads.ts:62`. HMAC signatures already use `timingSafeEqual` (`utils/verify-webhook-signature.ts`) |
| A11 | Secrets in logs | mostly OK | `lib/logger.ts`: request serializer logs no headers; `authorization` redacted; `code`/`state`/`*token|secret|key` query values masked. Gap: a new `ticket` query param would NOT be masked (regex `(token|secret|key|signature|password)$`) → must be added |
| A12 | CORS | OK as is | no CORS plugin → browsers cannot read cross-origin responses; header-based key is never sent automatically → no CSRF on the API. Keep it that way |
| A13 | Security headers | missing | no helmet / no `onSend` header hook |
| A14 | `server.ts` calls `listen()` at import → the full route table cannot be tested with `inject` | confirmed | `server.ts:134` `listen();` |
| A15 | `@fastify/multipart` registered globally, unused | confirmed | only reference is `server.ts:14,55` |

Side findings, out of scope: `googleAccountEmail` is stored from env, not from the authorized account (`auth-google.ts:156`); server binds `0.0.0.0` (`server.ts:79`).

## Design

- **`src/app.ts` `buildApp()`**: builds Fastify (logger, zod compilers, `trustProxy` from env, security headers) and registers two scopes. `server.ts` keeps only `listen`, workers, shutdown.
  - Public scope: `GET /`, `GET|POST /webhooks/whatsapp`, `GET|POST /webhooks/meta-ads`, `POST /webhooks/google-ads`, `GET /auth/google` (ticket), `GET /auth/google/callback` (state + cookie). Each keeps its own verification.
  - Admin scope (encapsulated plugin with `onRequest: requireAdmin`): every other route. New routes default here; the inventory test fails if a route lands in the public list without being in the allowlist.
- **`requireAdmin`** (`src/lib/security/admin-auth.ts`): parses `Authorization: Bearer <key>`; `safeEqual(sha256(given), sha256(ADMIN_API_KEY))` with `timingSafeEqual` (fixed length, no length oracle); sets `request.principal = { role: "admin", via: "api_key" }`. Any failure → 401 `{ error: "unauthorized" }` + `WWW-Authenticate: Bearer`, same body for missing/wrong/malformed. Log `admin_auth_failed` with ip, method, route pattern, reason category — never the header value.
- **Failure limiter** (`src/lib/security/auth-failure-limiter.ts`, in-memory, no new dependency): counts only failed auth per client IP; 10 failures / 15 min → 429 + `Retry-After` for that IP; success clears the counter; map capped (e.g. 10 000 keys, oldest evicted). Only the admin scope and the OAuth ticket route use it; webhooks never.
- **Trust proxy**: `TRUST_PROXY_HOPS` (int, default 0). Behind ngrok set 1 so `request.ip` is the real client; otherwise all clients share ngrok's IP and a brute-forcer locks the admin out (admin-only DoS, WhatsApp unaffected).
- **OAuth connect**: protected `POST /admin/google-calendar/connect-link {consultantId}` → `{ url, expiresAt }`. URL = `/auth/google?ticket=<base64url(payload).hmac>`; payload `{ purpose: "gcal_connect", consultantId, nonce, exp }`, TTL 10 min, HMAC key derived from `APP_SIGNING_SECRET`. `GET /auth/google` verifies, consumes the nonce (in-memory set pruned at exp), sets cookie `gcal_oauth_nonce` (HttpOnly, SameSite=Lax, Secure in production, Path `/auth/google/callback`, Max-Age 600), builds `state = {consultantId, nonce, iat}.hmac` and redirects. Callback requires valid HMAC, age ≤ 10 min, unused nonce, cookie nonce == state nonce; then clears the cookie. No raw key in any URL.
- **Future admin UI** (not built now): server-side session in an HttpOnly/Secure/SameSite cookie + CSRF token on mutations; roles `admin` (everything) and `consultant` (own appointments, own "Conectar Google Calendar"); login via Google Sign-In (consultants already have Google) or password+argon2. Needs `users`/`sessions` tables → **blocked by the migration freeze**. Prefer sessions over JWT (revocable, no token in JS). `requireAdmin` becomes `requireRole("admin")` reading `request.principal` from either strategy; the connect-link route already fits ("consultant connects own calendar").
- **Must NOT change**: webhook request/response contracts, dedup, rotation, outbox, task handlers, any invariant in `CLAUDE.md`; no DB schema/migration; no new npm dependency.

## Route decisions

| Route | File | Decision (rec.) |
|---|---|---|
| `GET /` | `server.ts:76` | public; drop the `log.info("something")` |
| `GET/POST /webhooks/whatsapp` | `webhook-whatsapp.ts:256,284` | public, own verify token + HMAC |
| `GET/POST /webhooks/meta-ads` | `webhook-meta-ads.ts:62,111` | public, own verify token + HMAC |
| `POST /webhooks/google-ads` | `webhook-google-ads.ts:42` | public, own `google_key` |
| `GET /leads`, `GET /leads/:id`, `POST /leads` | `routes/leads/*` | protect |
| `GET /conversations`, `GET /conversations/:id`, `POST /conversations` | `routes/conversations/*` | protect |
| `GET /messages`, `GET /messages/:id`, `GET /conversations/:id/messages` | `routes/messages/*` | protect |
| `POST /conversations/:id/messages` | `create-messages.ts` | **remove** (D-2). Alt: dev-only + protect + `role: user` only + `expectedConversationId` |
| `GET /appointments`, `GET /appointments/:id`, `GET /appointments/availability`, `POST /appointments` | `routes/appointments/*` | protect |
| `GET /auth/google` | `auth-google.ts:50` | public but only with a valid one-time ticket |
| `GET /auth/google/callback` | `auth-google.ts:88` | public, hardened state + cookie |
| `POST /admin/google-calendar/connect-link` | new | protect |

## Steps

Each step: write the test, show it red, implement, show it green, then `npm run test:unit` + targeted DB tests + `tsc`. New unit test files go into `package.json` `test:unit`.

### Step 1 — `buildApp()` + route inventory
- Files: new `src/app.ts`; `src/server.ts` (keep `listen`/workers/shutdown, remove multipart if D-4 = yes, drop health log); new `src/tests/routes/route-inventory.test.ts` (unit).
- Test `buildApp registers exactly the expected routes`: given `buildApp()`, when collecting routes via `onRoute`, then the method+url set equals the table above (pre-removal list). Red: `src/app.ts` does not exist.
- Test `GET / returns ok`. Invariants: none touched; webhook tests unchanged must stay green.

### Step 2 — env + `safeEqual`
- Files: `src/env.ts` (`ADMIN_API_KEY` min 32, `APP_SIGNING_SECRET` min 32 and ≠ `ADMIN_API_KEY`, `TRUST_PROXY_HOPS` int ≥0 default 0); `src/tests/support/fake-external-env.ts`; `.env.example` (names only); new `src/lib/security/constant-time.ts`.
- Tests (`src/tests/env.test.ts`): missing / 31-char `ADMIN_API_KEY` rejected; equal secrets rejected; valid accepted. New `src/tests/security/constant-time.test.ts`: equal → true; different, different length, empty, unicode → false, never throws. Red: field/module absent.
- Risk: server refuses to boot without the new vars → Davi adds them to `.env` before deploy (Risk R1).

### Step 3 — admin scope, `requireAdmin`, failure limiter
- Files: `src/app.ts`, new `src/lib/security/admin-auth.ts`, `src/lib/security/auth-failure-limiter.ts`; new `src/tests/routes/admin-auth.test.ts` (unit).
- Tests (all red before):
  - `every non-public route returns 401 without credentials` (loops the inventory; handler never runs: a DB call would fail under the unit preload).
  - `wrong key / wrong scheme / shorter key / longer key → identical 401 body and headers`.
  - `401 carries WWW-Authenticate: Bearer and logs no key` (capture logger stream; assert the key string is absent).
  - `valid key on a stub route inside the admin scope → 200`.
  - `11th failure from one IP → 429 with Retry-After; another IP with valid key → 200; success resets`.
  - `webhooks are never 401/429 from the admin layer, even after an IP is locked`.
- DB test `src/tests/routes/admin-routes.test.ts`: valid key → `GET /leads` 200, `POST /conversations` 201 (uses `getOrCreateActiveConversation`, invariant 1 kept); no key → 401 and no row written.
- Timing: not measured by a test (flaky). Guaranteed by construction (fixed-length digest + `timingSafeEqual`) and checked in review.

### Step 4 — remove `POST /conversations/:id/messages` (D-2)
- Files: `src/app.ts` (unregister), delete `src/routes/messages/create-messages.ts`; inventory test updated. Keep `receive-customer-message.ts` (dead-code cleanup out of scope).
- Test `POST /conversations/:id/messages → 404 with and without key`. Red: route exists.
- Invariant gain: no HTTP path injects `system`/`assistant` rows or runs a turn without `expectedConversationId`.

### Step 5 — signed one-time OAuth connect ticket
- Files: `routes/google-calendar/auth-google.ts`, new `src/lib/security/signed-token.ts` (sign/verify with purpose + exp + nonce, consumed-nonce set), new `POST /admin/google-calendar/connect-link`; `src/lib/logger.ts` (add `ticket` to `SENSITIVE_QUERY_NAMES`).
- Tests (`src/tests/routes/google-oauth.test.ts`, unit where no DB; DB for consultant lookup): no key on connect-link → 401; valid key + unknown consultant → 404; valid → URL with `ticket`, no key in it; `/auth/google?consultantId=x` → 400; tampered / expired (injected clock) / wrong purpose / reused ticket → 400 and no redirect; valid → 302 to `accounts.google.com` + `Set-Cookie` with HttpOnly, SameSite=Lax, Path; logged URL shows `ticket=%5BRedacted%5D`.

### Step 6 — harden OAuth `state` and callback
- Files: `auth-google.ts`.
- Changes: state `{consultantId, nonce, iat}` signed with a key derived from `APP_SIGNING_SECRET`; `safeEqual`; 10-min max age; single use; cookie nonce must match; clear cookie; map `error` param to a fixed message (no echo); log `{event, name, code}` only; drop `setCredentials`.
- Tests: replayed state → 400; expired → 400; tampered → 400; missing / mismatched cookie → 400; `?error=<script>` → fixed body, no echo; valid (mock `googleOAuth2Client.getToken` with `t.mock.method`) → 200 and one `google_calendar_connections` row (DB test). Red: replay and cookie cases pass today.

### Step 7 — validate `GOOGLE_REDIRECT_URI`
- Files: `src/env.ts`. Rule: valid URL, path `/auth/google/callback`, `https:` required when `NODE_ENV=production`; `http://localhost` allowed otherwise.
- Tests (`env.test.ts`): `not-a-url`, wrong path, `http://` in production → rejected; ngrok https and localhost dev → accepted. Red.

### Step 8 — security headers, no CORS
- Files: `src/app.ts` (`onSend` hook).
- Headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`; `Cache-Control: no-store` on admin and `/auth/google*`. No HSTS now (D-6).
- Tests (`admin-auth.test.ts`): headers on `GET /`, on a 401, on `GET /webhooks/whatsapp` verify; `OPTIONS /leads` with `Origin` → no `Access-Control-Allow-Origin`; webhook status/body unchanged. Red.

### Step 9 — constant-time webhook secret compares (D-5)
- Files: `webhook-whatsapp.ts:262`, `webhook-meta-ads.ts:74`, `webhook-google-ads.ts:62` → `safeEqual`.
- Tests: existing `webhook-*.test.ts` and `webhook-verification-logs.test.ts` stay green; add wrong-length token/key → 403/401, no throw. Red: none expected (behavior-preserving); state so in progress.md.

### Step 10 — docs
- `docs/CODEMAP.md` (app.ts, security/*, route scopes), `.env.example` names. No test.

## Acceptance criteria

| AC | Criterion | Step / test |
|---|---|---|
| AC1 | Full route table is known and testable via `buildApp()` | 1 / route-inventory |
| AC2 | Every protected route → 401 without credentials | 3 / admin-auth |
| AC3 | Wrong/malformed/different-length key → same 401, constant-time compare | 2,3 / constant-time, admin-auth |
| AC4 | Valid key → 200/201 on real handlers | 3 / admin-routes (DB) |
| AC5 | 10 failures/IP/15 min → 429; webhooks never limited | 3 |
| AC6 | No key or ticket value appears in logs | 3,5 |
| AC7 | `POST /conversations/:id/messages` gone | 4 |
| AC8 | OAuth start needs a signed, expiring, one-time ticket; no raw key in URLs | 5 |
| AC9 | OAuth state: expiry, single use, cookie binding, no reflected error | 6 |
| AC10 | `GOOGLE_REDIRECT_URI` validated | 7 |
| AC11 | Security headers present; no CORS allow-origin | 8 |
| AC12 | All webhook tests green; WhatsApp behavior unchanged | 1–9 / webhook-*.test.ts, full `test:db` |
| AC13 | `npm run test:unit`, `test:db`, `tsc`, `build` green | every step |

## Out of scope
- Admin UI, users/sessions tables, roles enforcement beyond `admin` (needs migration → frozen).
- Pagination of `GET /leads` / `GET /messages`; removing `receive-customer-message.ts` / `message-debounce.ts`.
- `googleAccountEmail` source, binding host, any webhook logic, any invariant code path.

## Questions for the owner
- **Q1** Is the server reachable from the internet (ngrok in dev; prod host?). Rec: treat as public. Plan assumes yes; nothing blocked.
- **D-1** Who will use the admin UI (only Davi? consultants too? how many?). Rec: Davi = admin, consultants = `consultant` role later. Not blocking.
- **D-2** `POST /conversations/:id/messages`: remove (rec.) or keep dev-only? Step 4 BLOCKED until answered.
- **D-3** Does anything call these routes today (Postman, script, front)? It will start getting 401. Rec: switch it to the Bearer key.
- **D-4** Remove unused `@fastify/multipart`? Rec: yes (part of step 1).
- **D-5** Constant-time compare for webhook tokens (step 9)? Rec: yes.
- **D-6** HSTS: skip now (ngrok/dev) and add when the prod host is fixed? Rec: skip now.
- **D-7** Behind ngrok, set `TRUST_PROXY_HOPS=1`? Rec: yes; otherwise the limiter treats everyone as one IP.
- **D-8** No new npm dependency (limiter and headers in-house, ~100 lines). Rec: yes; alternative `@fastify/rate-limit` + `@fastify/helmet`.
