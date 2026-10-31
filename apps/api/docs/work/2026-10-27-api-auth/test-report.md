# 2026-10-27-api-auth — test report

## Steps 1–3 (tester, 2026-10-28)

**Verdict: PASS** (steps 1–3). No blocking failure. Known open items D-3, D-4 and D-7 are confirmed below and are not counted as failures.

Env for every run: `TEST_DATABASE_URL` = localhost:5432/mariana_test (printed before each run; the shell default on localhost:5433 was not used), `DOTENV_CONFIG_PATH=/dev/null`, `RELIABILITY_WORKERS_ENABLED=false`. No Neon, no real external API, no git state change, no product code changed.

### Gate checks
- `plan.md`: `Status: APPROVED by Davi` present. The diff for steps 1–3 matches the approved plan and D-1..D-8. Recorded deviations: D-4 (dependency kept) and D-7 (not wired).
- Scope: every api-auth file has an mtime of 11:43 or later. Every scheduling-loop file (calendar services, `webhook-whatsapp.ts`, `autonomous-task-handlers.ts`, the reliability and calendar tests, the scheduling-loop docs) has an mtime of 11:41:38 or earlier. `git diff --word-diff package.json` adds only the 3 new unit test files. `docs/CODEMAP.md` is shared: the api-auth rows are the `app.ts` / HTTP API auth / route-table lines; the Google Calendar rows belong to scheduling-loop. Result: the api-auth work did not touch any scheduling-loop file.
- Files touched vs plan: all of them are listed in steps 1–3 or progress.md. Extra files: `test-env-isolation.test.ts` and `gemini-model-config-adversarial.test.ts`, which needed the new required env keys, and `docs/CODEMAP.md`. All are justified.

### Suites
| Command | Result |
|---|---|
| `npm run test:unit` | 402 tests, 396 pass, 0 fail, 6 todo (pre-existing E-12c etc.) |
| `npx tsc --noEmit` | exit 0 (also with the new tester file) |
| `npm run build` | success |
| `npm run test:db` run 1 | exit 0; 790 tests, 784 pass, 0 fail, 0 cancelled, 6 todo (includes 11 tester tests) |
| `npm run test:db` run 2 | exit 0; 790 tests, 784 pass, 0 fail, 0 cancelled, 6 todo |
| biome on 16 changed/new files | clean |
| `git diff --check` | clean |

### Criteria → tests
| Criterion (plan AC / task check) | Test(s) | Result |
|---|---|---|
| AC1 route table known via `buildApp()` | `route-inventory.test.ts` "buildApp registers exactly the expected routes" (real `onRoute` vs `route-table.ts`) | PASS |
| AC2 every protected route returns 401 without credentials | `admin-auth.test.ts` "every non-public route…"; tester: "real route table (incl. auto HEAD)…" (real `onRoute` table, HEAD included, not the static list) | PASS |
| Public set = webhooks, `/auth/google*`, `GET /` exactly | both tests above (`unprotected == PUBLIC_ROUTES` + prefix assertion) | PASS |
| AC3 malformed/wrong/prefix/longer/empty/case/whitespace/1 MB header return the same 401 | `admin-auth.test.ts` "wrong key / wrong scheme…"; tester: "Bearer parsing: every malformed variant…" (15 variants), "scheme is case-insensitive but the key is not" | PASS |
| AC3 constant-time compare | `constant-time.test.ts` (3); review: `safeEqual` = `timingSafeEqual(sha256, sha256)`, fixed 32 bytes, no length oracle, never throws | PASS (by construction) |
| AC4 valid key reaches the real handler | `admin-routes.test.ts` (DB): `GET /leads` 200, `POST /conversations` 201 then 200 with 1 row (invariant 1) | PASS |
| no key writes no row | `admin-routes.test.ts` "no key → 401 … no row written" | PASS |
| AC5 lockout 10/IP/15 min → 429 + Retry-After; success resets; window expiry | `admin-auth.test.ts` limiter test; tester: "a locked IP stays locked for the whole window…" | PASS |
| Forged X-Forwarded-For / X-Real-IP / Forwarded does not bypass | `admin-auth.test.ts` XFF test; tester: "forged X-Real-IP / Forwarded / X-Forwarded-For…" | PASS (because `trustProxy: false`) |
| Webhooks never blocked by the admin layer | `admin-auth.test.ts` "webhooks are never 401/429…" (GET verify + all public routes); tester: "POST webhooks from a locked IP…" | PASS |
| Limiter memory bounded | `admin-auth.test.ts` cap test; tester: "the limiter map stays bounded under a many-IP flood through the app" (300 IPs, cap 50) | PASS |
| Path variants (`/LEADS`, `/leads/`, `//leads`, `/./leads`, `%2F`) never reach a handler | tester: "path variants…" (401 or 404 only) | PASS |
| Env: key < 32, missing, equal secrets rejected; valid accepted | `env.test.ts` (6 new) | PASS |
| AC6 no secret in logs / errors | `admin-auth.test.ts` "401 carries WWW-Authenticate… logs no key"; tester: "no secret in logs…" (success, failure, lockout, Basic), "parseEnv errors… never echo the secret value" | PASS |
| `GET /` public | `route-inventory.test.ts`, tester "GET / is public and plain" | PASS |

### Known open items: facts confirmed
- **D-7**: `node_modules/fastify` is version 5.12.1. In `lib/request.js:51-55`, a numeric `trustProxy` returns `function () { return false }` with the comment "Fail closed". `app.ts` passes `trustProxy: false`, and `TRUST_PROXY_HOPS` is parsed in `env.ts` but read nowhere else. Consequence: behind ngrok every client is the same IP, so 10 bad requests from anyone lock the admin API for 15 min, and the lockout can be repeated. A valid key during lockout also gets 429 (`admin-auth.ts`: `check` runs before the key compare). WhatsApp and the webhooks are not affected (tested).
- **D-3**: still unknown. `progress.md` records it as open. Any existing caller now gets 401.
- **D-4**: `@fastify/multipart` is not registered anywhere in `src/` (`grep` finds no reference). It is still listed in `package.json:24` dependencies.

### Failures
None.

### New tests added (tester)
- `src/tests/routes/admin-auth-adversarial.test.ts`, 11 tests, unit-safe and green under the unit preload. It is **not** in the `package.json` `test:unit` list, because the tester may not edit `package.json`. It runs under `test:db` (glob). Implementer: add it to `test:unit`.

### Non-blocking notes and risks not covered
- N1: `ADMIN_API_KEY` is `z.string().min(32)` with no trim and no charset rule. 32 spaces are accepted. A key that contains whitespace can never match, because the Bearer regex is `[^\s]+`, so the admin would be locked out. Suggestion: reject whitespace in the key.
- N2: the lockout uses a fixed window from the first failure, and failures during the lockout do not extend it. This is acceptable. Eviction is insertion-order: an attacker with more than 10 000 source IPs can evict a locked entry. This is low risk.
- N3: an unknown path answers 404 and an admin path answers 401 without a key, which reveals that the route exists. This is low risk and expected.
- N4: timing is not measured by any test (flaky by nature). It is guaranteed by construction and checked in review.
- N5: the real `server.ts` logger (`loggerConfig`, pino-pretty transport) is not exercised by the log-leak tests. They use `baseLoggerOptions` with the same `redact` and `serializers`.
- Steps 4–10 (OAuth ticket/state, headers, webhook constant-time, `POST /conversations/:id/messages` removal) are not implemented yet. AC7–AC11 are not verified.

### Manual checklist for Davi (after adding ADMIN_API_KEY and APP_SIGNING_SECRET to `.env`)
1. `curl -i http://localhost:3252/` returns 200 `ok`.
2. `curl -i http://localhost:3252/leads` returns 401 `{"error":"unauthorized"}` with `WWW-Authenticate: Bearer`.
3. `curl -i -H "Authorization: Bearer <ADMIN_API_KEY>" http://localhost:3252/leads` returns 200.
4. Send "Oi" from your WhatsApp test number. Mariana replies as before, and the server log shows no 401 or 429 on `/webhooks/whatsapp`.
5. Behind ngrok (D-7): 11 bad curl calls through the ngrok URL lock out even a correct key for 15 min. Expect this until D-7 is decided.

## Steps 4–10 (tester, 2026-10-28)

**Verdict: PASS** (steps 4–10 and the two follow-ups from steps 1–3). No blocking failure. The known items (step 9 WhatsApp `===`, D-7, D-3, D-4, the step 5 shared limiter) are confirmed below and are not counted as failures.

Env for every run: `TEST_DATABASE_URL` = localhost:5432/mariana_test (printed before each run; the shell default on localhost:5433 was not used), `DOTENV_CONFIG_PATH=/dev/null`, `RELIABILITY_WORKERS_ENABLED=false`. No Neon, no real Google/Gemini/WhatsApp (`getToken` mocked), no git state change, no product code changed.

### Gate checks
- `plan.md`: `Status: APPROVED by Davi` present. Steps 4–10 match the plan and D-1..D-8. Deviations are recorded in `progress.md`: step 9 (WhatsApp), D-4 and D-7.
- Scope: every scheduling-loop file (`webhook-whatsapp.ts`, `autonomous-task-handlers.ts`, `services/calendar/*`, `integrations/google-calendar/*`, the scheduling-loop docs) has an mtime of 11:41:38 or earlier. Every api-auth file for steps 4–10 has an mtime between 12:52 and 12:57. The api-auth work did not touch scheduling-loop. `docs/specs/2026-10-28-mariana-flow-v2.md` (13:00) and `docs/work/2026-10-28-flow-v2/` (13:03) were changed after the api-auth work and contain no api-auth term (grep `ADMIN_API_KEY|ticket|connect-link|requireAdmin` finds 0 matches). Those changes are the coordinator's.
- Files vs plan: all listed in steps 4–10 or in `progress.md`. `test-env-isolation.test.ts` needed a valid callback URL for the canary (step 7), which is justified.
- Removed route: `grep -rn "create-messages\|createMessages" src docs/CODEMAP.md` finds nothing. `POST /conversations/:id/messages` returns 404 with and without the key, for every role.

### Suites
| Command | Result |
|---|---|
| `npm run test:unit` | 433 tests, 427 pass, 0 fail, 6 todo (pre-existing E-12c/E-12d etc.) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | success |
| `npm run test:db` run 1 | exit 0; 830 tests, 824 pass, 0 fail, 0 cancelled, 6 todo (includes 16 new tester tests) |
| `npm run test:db` run 2 | exit 0; 830 tests, 824 pass, 0 fail, 0 cancelled, 6 todo |
| biome on the 2 new tester files | clean (the implementer's files were already clean per progress.md) |
| `git diff --check` | clean |

### Follow-ups from steps 1–3
| Item | Evidence | Result |
|---|---|---|
| N1: whitespace in `ADMIN_API_KEY` / `APP_SIGNING_SECRET` | `env.ts` `NO_WHITESPACE`; `env.test.ts` "…com espaço em branco" | PASS |
| `admin-auth-adversarial.test.ts` in `test:unit` | present in `package.json` `test:unit` | PASS |

### Criteria → tests
| Criterion | Test(s) | Result |
|---|---|---|
| AC7 `POST /conversations/:id/messages` gone, nothing imports it | `route-inventory.test.ts` "…→ 404 … (D-2)"; tester "removed POST … 404 for every role" | PASS |
| AC8 ticket signed and 10-min TTL; no raw key in the URL | `google-oauth.test.ts` "signed token…", "valid ticket → 302…"; `google-oauth-db.test.ts` "connect-link: valid → URL…" (TTL between 9 and 10 min, no key and no consultantId in the URL) | PASS |
| Ticket tampered / expired / wrong purpose / reused | `google-oauth.test.ts` "tampered / expired / wrong-purpose / reused…"; tester "expiry boundary" (valid 2 s before, rejected at 10 min, future `iat` rejected) | PASS |
| Ticket signed with the wrong key (other secret, the state key, `ADMIN_API_KEY`) | tester "ticket signed with a different APP_SIGNING_SECRET…" | PASS |
| Ticket re-pointed at another consultant (body edited, signature kept) is rejected, and the genuine ticket is not burned | tester "ticket re-pointed at another consultant…" | PASS |
| Old link `/auth/google?consultantId=` → 400 (also with an empty ticket, duplicate params, array syntax, an oversized ticket); never 500 | `google-oauth.test.ts` "old open link"; tester "old link variants and duplicated params" | PASS |
| Ticket never in logs | `google-oauth.test.ts` "the ticket value never appears in the logs"; tester "ticket, state and code never appear in logs (reject, reuse, 429 and callback paths)" | PASS |
| AC9 state: expiry, tampering, wrong purpose, replay | `google-oauth.test.ts` "callback: expired / tampered / wrong-purpose…"; `google-oauth-db.test.ts` "…replay → 400" (`getToken` called once) | PASS |
| State bound to the browser (login-CSRF): missing or mismatched cookie, state from browser A with the cookie from browser B | `google-oauth.test.ts` "missing or mismatched browser cookie"; tester unit "state from browser A with the cookie of browser B"; tester DB "…another browser's cookie is refused and does not burn the legitimate state" | PASS |
| No reflected error; callback leaks no token or code (body and log) | `google-oauth.test.ts` "`?error=<script>`"; `google-oauth-db.test.ts` "a Google error is logged with safe fields only"; tester DB "callback success: no token or code in the body or the logs" | PASS |
| Tokens written only for the consultant bound in the ticket; none without a `refresh_token`; none for a deleted consultant | tester DB "tokens are written only for the consultant bound in the ticket", "no refresh_token → 400…; consultant deleted → 404…"; no `setCredentials` (`google-oauth-db.test.ts`) | PASS |
| connect-link: admin key, uuid body validation | `google-oauth.test.ts` "without key → 401"; `google-oauth-db.test.ts` 404; tester "connect-link: body validation and admin key" | PASS |
| AC10 `GOOGLE_REDIRECT_URI`: https required in production; http only for localhost outside production; garbage rejected | `env.test.ts` (2 tests); tester "GOOGLE_REDIRECT_URI: look-alike hosts…" (`localhost.evil.example`, `127.0.0.1.nip.io`, `0.0.0.0`, private IP, `javascript:`, `data:`, relative, blank, wrong-case path, `ws:`, prod loopback) | PASS |
| AC11 security headers on public, admin, 401, 404, the OAuth 302 and the 429; no CORS; no HSTS | `admin-auth.test.ts` (3 tests); tester "security headers and no-store on the OAuth 302 and on the ticket 429" | PASS |
| D-5 constant-time compare for Meta Ads and Google Ads, wrong lengths, no log leak | `webhook-verification-logs.test.ts` (3 new tests); tester "webhook secrets of any length … never leak to logs"; review: `safeEqual` at `webhook-meta-ads.ts:75` and `webhook-google-ads.ts:63` | PASS |
| AC12 webhook behaviour unchanged | full `test:db` ×2 green (all `webhook-*.test.ts`) | PASS |
| AC13 suites green | table above | PASS |

### Known items: facts confirmed
- **Step 9 deviation**: `webhook-whatsapp.ts:268` is still `token === env.WHATSAPP_VERIFY_TOKEN`. The wrong-length test in `webhook-verification-logs.test.ts` already covers it, and it passes, because `===` is functionally correct (it only leaks timing).
- **D-7**: `app.ts:67` `trustProxy: false`. `TRUST_PROXY_HOPS` is not read anywhere.
- **D-3**: still open (`progress.md`).
- **D-4**: `@fastify/multipart` is still in `package.json` dependencies and is not registered.
- **Step 5 side effect**: `GET /auth/google` uses the same `limiter` instance as the admin scope (`app.ts:106`, `auth-google.ts:111`). Ten bad tickets from one IP also lock that IP out of the admin API, and the reverse is true too. Behind ngrok (D-7) everyone shares one IP.

### Failures
None. (One failure during my own work was a bug in my test: `mockTokens(t, undefined)` hit the default parameter. I fixed the test. It was not a product failure.)

### New tests added (tester)
- `src/tests/routes/google-oauth-adversarial.test.ts`: 11 tests. They are unit-safe and green under the unit preload. The file is **not** in `test:unit`, because the tester may not edit `package.json`. It runs under `test:db` (glob). Implementer: add it to `test:unit`.
- `src/tests/routes/google-oauth-db-adversarial.test.ts`: 5 DB tests.
- Meaningfulness: these tests assert behaviour that did not exist at HEAD. At HEAD, `/auth/google?consultantId=` redirected, there was no ticket and no cookie binding, `?error=` was echoed, and `===` was used. I ran no mutation tests, because the tester does not touch product code. The implementer recorded red runs for steps 4–8 in `progress.md`.

### Non-blocking notes and risks not covered
- **R-A (planner)**: any automatic GET or HEAD of the connect link burns the one-time ticket. This includes a WhatsApp/Slack/e-mail link preview and an antivirus URL scanner. Probe: `HEAD /auth/google?ticket=<valid>` returned 302, then `GET` with the same ticket returned 400. If Davi sends the link through a messenger with previews, the consultant may get `invalid_ticket`. The workaround is to generate a new link. A possible fix (a design decision) is an interstitial page that consumes the ticket only on POST, or ignoring HEAD.
- **R-B**: consumed nonces live in memory. After a restart, an unexpired ticket or state could be replayed once within 10 min, and a multi-instance deploy would not share the set. The impact is low: replaying a state still needs the victim's cookie and Google's `code`.
- **R-C**: `GOOGLE_REDIRECT_URI` validation checks only the scheme, host class and path. Userinfo or a query string (`https://u:p@host/auth/google/callback?x=1`) would pass. This was found by review, not by a test. Google rejects any redirect URI that is not registered, so the risk is low.
- **R-D**: an expired or reused ticket counts as an auth failure. A consultant who clicks an old link many times can lock their own IP for 15 min, and behind ngrok the lock hits everyone.
- **R-E**: the success body of the callback returns the consultant's name and two booleans, and no token. This is fine. `googleAccountEmail` still comes from env (out of scope, plan side finding).

### Manual checklist for Davi (after adding ADMIN_API_KEY, APP_SIGNING_SECRET and a valid GOOGLE_REDIRECT_URI to `.env`)
1. Start the server. It must boot. If it does not, the error names the bad variable without echoing its value.
2. `curl -i http://localhost:3252/` returns 200 `ok` with `X-Frame-Options: DENY` and `Content-Security-Policy`.
3. `curl -i "http://localhost:3252/auth/google?consultantId=<id>"` returns 400 `{"error":"invalid_ticket"}`.
4. `curl -s -X POST -H "Authorization: Bearer <ADMIN_API_KEY>" -H "Content-Type: application/json" -d '{"consultantId":"<id>"}' http://localhost:3252/admin/google-calendar/connect-link` returns `{url, expiresAt}`. The URL has `?ticket=` and contains neither the key nor the id.
5. Open that URL in a browser (do not paste it in WhatsApp first: R-A). It redirects to Google. Complete the consent. The callback shows "Google Calendar autorizado e conexão salva."
6. Open the same connect URL again. You get 400 `invalid_ticket`. Reload the callback page. You get 400 "State OAuth inválido.".
7. In the server log, the `/auth/google` lines show `ticket=%5BRedacted%5D` and the callback lines show `code=%5BRedacted%5D&state=%5BRedacted%5D`.
8. On WhatsApp, send "Oi" from the test number. Mariana replies as before, and the log shows no 401 or 429 on `/webhooks/whatsapp`. Ask for a time and check that the offered slots come from the connected consultant's calendar.
