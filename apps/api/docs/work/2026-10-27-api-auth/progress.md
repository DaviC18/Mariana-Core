# 2026-10-27-api-auth — progress

Runs: `DOTENV_CONFIG_PATH=/dev/null RELIABILITY_WORKERS_ENABLED=false TEST_DATABASE_URL=postgresql://…@localhost:5432/mariana_test` (the shell's default `localhost:5433` belongs to another project and was not used). No Neon, no real Google/Gemini/WhatsApp, no migration.

## Steps 1–2 — verification of the earlier implementer's work in the tree (implementer)
- Files (already in the tree, reviewed): `src/app.ts` (`buildApp`, no `listen`); `src/server.ts` (listen/workers/shutdown only, `@fastify/multipart` registration and the `"something"` log removed); `src/lib/security/constant-time.ts` (`safeEqual` = `timingSafeEqual` over SHA-256 digests, non-string → false); `src/env.ts` (`ADMIN_API_KEY` ≥32, `APP_SIGNING_SECRET` ≥32 and ≠ `ADMIN_API_KEY` via `superRefine`, `TRUST_PROXY_HOPS` int ≥0 default 0); `.env.example`; `fake-external-env.ts`, `test-env-isolation.test.ts` (canary padded to 32 chars), `gemini-model-config-adversarial.test.ts` (VALID_SOURCE + new keys); `package.json` `test:unit`.
- Red shown by moving the implementation aside (files copied to /tmp and restored byte-identical, `cmp` ok; no git command):
  - `route-inventory.test.ts`: red `Cannot find module '../../app'` → green 2/2.
  - `constant-time.test.ts`: red `Cannot find module '../../lib/security/constant-time'` → green 3/3.
  - `env.test.ts` with `src/env.ts` at HEAD: 6 new tests red (`parseEnv recusa ADMIN_API_KEY ausente`, …, `TRUST_PROXY_HOPS inteiro >= 0`) → green.
- Change: the route list moved from `route-inventory.test.ts` to `src/tests/support/route-table.ts` (`PUBLIC_ROUTES`, `ADMIN_ROUTES`, `EXPECTED_ROUTES`), so the admin test reuses it without importing (and re-running) another test file.
- Deviation (D-4): `@fastify/multipart` is no longer registered, but it is still in `package.json` `dependencies`. Removing it means `npm uninstall` + a lockfile change, which is not in the step-1 file list. Left for Davi.

## Step 3 — admin scope, `requireAdmin`, failure limiter (implementer)
- Files: new `src/lib/security/admin-auth.ts` (`createRequireAdmin`; Bearer scheme case-insensitive; `safeEqual`; same 401 `{error:"unauthorized"}` + `WWW-Authenticate: Bearer` for missing/malformed/invalid; log `admin_auth_failed` {ip, method, route pattern, reason}, never the header; `request.principal = {role:"admin", via:"api_key"}`); new `src/lib/security/auth-failure-limiter.ts` (fixed window 10 failures / 15 min per IP, then 429 `{error:"too_many_requests"}` + `Retry-After`; success resets; cap 10 000 IPs, oldest evicted); `src/app.ts` (public scope: webhooks, `/auth/google*`, `GET /`; admin scope plugin with `onRequest: requireAdmin` for every other route; test-only options `adminApiKey`, `authFailureLimiter`, `registerAdminRoutes`); `package.json` (`test:unit` + `admin-auth.test.ts`); `docs/CODEMAP.md`.
- Tests: unit `src/tests/routes/admin-auth.test.ts` (8): red 1 = `Cannot find module '../../lib/security/auth-failure-limiter'`; red 2 (limiter + requireAdmin written, `app.ts` not wired yet) = 6/7 fail (no 401, stub route 404; limiter cap test passes: it tests the new module only) → green 8/8. DB `src/tests/routes/admin-routes.test.ts` (2): green; red with `admin.addHook("onRequest", requireAdmin)` commented out = "no key → 401 … no row written" fails → restored, green.
- Extra test "a spoofed X-Forwarded-For does not escape the failure limiter": red with a mutation `trustProxy: true` (`401 !== 429`), green with the shipped `trustProxy: false`.
- A test bug was found during green: the 401 loop sent 14 failures from one IP, so the limiter rightly answered 429 → one IP per route in that loop.

### Deviation / blocker for D-7 (`TRUST_PROXY_HOPS`)
- Fastify 5.12.1 ignores a numeric `trustProxy` on purpose (`node_modules/fastify/lib/request.js:51-55`: "Hop-count-only trust cannot validate the immediate peer. Fail closed"), and its types no longer accept `number` (tsc TS2769). Proven: with `trustProxy: 1`, `request.ips` = `["10.9.9.9"]`, `X-Forwarded-For` ignored.
- So `TRUST_PROXY_HOPS` is parsed (step 2) but not wired: `app.ts` passes `trustProxy: false`. Behind ngrok every client shares one IP in the limiter → a brute-forcer can lock Davi out of the admin API for 15 min (WhatsApp and webhooks unaffected). Same risk the plan already named.
- Fix needs a decision (not a redesign done here): trust by address, e.g. `trustProxy: "loopback"` when the ngrok agent runs on the same host, or the prod proxy's address list. A hop count would let a direct client spoof `X-Forwarded-For` and escape the limiter. `.env.example` comment updated to say the var has no effect yet.

### D-3 (open)
- Unknown whether any script, Postman collection or front end calls these routes. Any such caller now gets 401 and must send `Authorization: Bearer <ADMIN_API_KEY>`.

### Fix after the first full `test:db` (773 pass, 2 file-level fails)
- `route-inventory.test.ts` (earlier implementer's file): `buildApp()` with the default logger starts the `pino-pretty` worker, which re-runs `db-test-preload` and is refused by the guard ("TEST_DATABASE_URL points at the same database as DATABASE_URL") → `uncaughtException`, file exit 1. Fix: `logger: false` in both `buildApp` calls.
- `admin-auth.test.ts`: under the DB preload the public routes reach the real test DB and open the pool → file never exits (killed after 20 min; `timeout 60` → exit 124). Fix: `test.after(closeDatabase)`.
- Red = those runs; green = both files exit 0 under the DB preload and the unit preload.
- Note: `server.ts` in dev still uses `loggerConfig` (pino-pretty), unchanged.

### Suites (after steps 1–3)
- `test:unit` 402 tests, 396 pass, 0 fail, 6 todo (pre-existing). `tsc --noEmit` ok. `build` ok. biome clean on every changed file.
- `test:db` (localhost:5432/mariana_test, reset + seed) 779 tests, 773 pass, 0 fail, 6 todo (pre-existing, e.g. E-12c), exit 0.
- Not done: steps 4–10 (not assigned).

## Step 4 — remove `POST /conversations/:id/messages` (verification of earlier work)
- Files (already in the tree): `src/routes/messages/create-messages.ts` deleted; not registered in `src/app.ts`; test `route-inventory.test.ts` "POST /conversations/:id/messages → 404 with and without key (D-2)".
- Red: old file recreated from `git show HEAD:` + registered in `app.ts` → 2 fail ("buildApp registers exactly…", "…→ 404 … (D-2)"). Restored: `app.ts` `cmp` identical, file removed → green 3/3.

## Step 5 — signed one-time OAuth connect ticket (verification of earlier work)
- Files (already in the tree): `src/lib/security/signed-token.ts`, `src/routes/google-calendar/connect-link.ts`, `auth-google.ts` (`GET /auth/google?ticket=`), `src/lib/logger.ts` (`ticket` masked), `src/app.ts`; tests `google-oauth.test.ts` (unit), `google-oauth-db.test.ts` (connect-link 404 / valid URL used once).
- Red (files copied to /tmp, restored, `cmp` identical for all 5): (a) implementation aside → `Cannot find module './routes/google-calendar/connect-link'`; (b) logger without `ticket` → "the ticket value never appears in the logs" fails; (c) nonce consume disabled → "tampered / expired / wrong-purpose / reused ticket" fails. Green: 8/8 step-5 unit tests, 2/2 DB connect-link tests.
- `google-oauth.test.ts` added to `test:unit` (no DB access).
- Side effect found in step 8: `admin-auth.test.ts` "webhooks are never 401/429…" expected no 429 on every public route, but the plan puts the ticket route behind the same limiter → test now asserts 429 for `GET /auth/google` only.

## Tester follow-ups (steps 1–3 report)
- N1 whitespace: already in `env.ts` (`NO_WHITESPACE`) + `env.test.ts`. Red by weakening the regex to `/^[\s\S]+$/` → "…com espaço em branco" fails (19/1); restored (`cmp`) → 20/0.
- `admin-auth-adversarial.test.ts` was already in `test:unit`; passes under the unit preload.

## Step 6 — harden OAuth `state` and callback
- Files: `src/routes/google-calendar/auth-google.ts` (cookie always cleared on callback; fixed text "Autorização Google recusada."; `consumeState`: signed state ≤10 min + cookie nonce `safeEqual` + single use via `ConsumedNonces`, all before DB/Google; error log `{event: google_oauth_callback_failed, name, code}` only; `setCredentials` removed); `google-oauth-db.test.ts` (destructuring lint fix), both oauth tests formatted by biome.
- Red: unit 8 pass / 2 fail (cookie mismatch, `?error=<script>`); DB 2 pass / 2 fail (cookie not cleared, raw error logged). Green: unit 10/10, DB 4/4.

## Step 7 — validate `GOOGLE_REDIRECT_URI`
- Files: `src/env.ts` (`googleRedirectUriError` in `refinedEnvSchema`: valid URL, path `/auth/google/callback`, `https:`; `http:` only for localhost/127.0.0.1/[::1] outside production); `env.test.ts` (2 tests); `test-env-isolation.test.ts` (canary for `*_URI` is now a valid callback URL, else the probe child fails on parse).
- Red: "parseEnv recusa GOOGLE_REDIRECT_URI inválida" → `Missing expected exception: development not-a-url`. Green 22/22.
- Interpretation: "http://localhost allowed otherwise" read strictly: non-production http is accepted for localhost only, not for any host.

## Step 8 — security headers, no CORS
- Files: `src/app.ts` (root `onSend`: CSP `default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `nosniff`, `X-Frame-Options: DENY`; `Cache-Control: no-store` for `/auth/google*` and via an admin-scope `onSend`; no HSTS); `admin-auth.test.ts` (3 tests).
- Red: "security headers…" (`GET /: content-security-policy`), "Cache-Control: no-store…" fail; "no CORS…" passes already (no CORS plugin). Green: 41/41 across the route tests.

## Step 9 — constant-time webhook secret compares (D-5)
- Files: `webhook-meta-ads.ts` (verify token), `webhook-google-ads.ts` (`google_key`) → `safeEqual`; `webhook-verification-logs.test.ts` (3 tests: shorter, longer, unicode, 4 KB token/key → 403/401, never 500).
- Red: none, as the plan predicted (behavior-preserving): 9/9 before and after.
- Deviation: `webhook-whatsapp.ts` (`token === env.WHATSAPP_VERIFY_TOKEN`) NOT changed. The file carries the uncommitted scheduling-loop diff and the brief forbids touching that task's files. One-line follow-up once scheduling-loop is committed; its new wrong-length test already covers it.

## Step 10 — docs
- `docs/CODEMAP.md`: app.ts row (headers), HTTP API auth row (`signed-token.ts`, `safeEqual` users), new "Google Calendar connect (OAuth)" row, test list. `.env.example`: no-whitespace note, `GOOGLE_REDIRECT_URI` rule + Google Console note.

## Suites (after steps 4–10)
- `test:unit` 433 tests, 427 pass, 0 fail, 6 todo. `tsc --noEmit` exit 0. `build` success. biome clean on 27 files; `git diff --check` clean.
- `test:db` (localhost:5432/mariana_test) run 1: 814 tests, 807 pass, 1 fail = "L11 é registrada e encadeada…" (`turn-trace-integration.test.ts`, untouched; known flake F-R1 in scheduling-loop test-report, 1/30); isolated 3/3 pass. Run 2: exit 0, 808 pass, 0 fail, 6 todo.
- Unchanged: D-7 (`trustProxy: false`), D-3 open, D-4 (`@fastify/multipart` stays in `package.json`).
