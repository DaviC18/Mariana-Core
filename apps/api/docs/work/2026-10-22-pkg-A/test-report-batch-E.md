# Test report — Package A, Batch E (steps 12–14)

Context: task 2026-10-26-flow-review (R0). Tester run 2026-10-26.
Plan: `plan.md:1` `Status: APPROVED by Davi — 2026-10-22`. Steps 12–14 at `plan.md:268-287`.
DB target for every DB run: `localhost:5432/mariana_test` (container `mariana-postgres`). Port 5433 not used.

## Batch E final summary (tester, 2026-10-27) — overall verdict: PASS (E-16 and E-16b closed)

Steps 12–21 PASS. The E-16 fix inside step 14 left E-16b open; the E-16b fix closes it (see "E-16b fix verification" at the end). 0 suite failures caused by the diff. Open items are listed below the table. Details: "E-R3b + final" at the end of this file. Lines refer to the working tree on 2026-10-27. The older section "Verdict: FAIL (batch not closed)" below is historical; this table replaces it.

| Step | Finding closed | Test(s) file:line | Verdict |
|---|---|---|---|
| 12 — remove `vitest` | RC-5 (unused runner with no preload or guard) | no test: `grep -rIl vitest` outside `node_modules`/lock/docs → none; `node_modules/.bin/vitest` absent (re-checked 2026-10-27) | PASS |
| 13 (revised) — setup never holds Neon | RC "setup-test-db keeps `.env` URL" | `src/tests/test-database-guard.test.ts:107`, `:239`, `:248`, `:261`, `:280`, `:293`; `src/tests/test-database-guard-adversarial.test.ts:121`, `:194` | PASS |
| 14 — local-host allowlist | remote non-neon host accepted | `test-database-guard.test.ts:130`, `:142`, `:155`, `:187`; adversarial `:40`, `:62`, `:75`, `:794`, `:813`, `:930`, `:969`, `:1022`, `:1072`, `:1103` | PASS (E-16, E-16b closed) |
| 14a — query allowlist | E-1 | `test-database-guard.test.ts:200`, `:221`; adversarial `:134`, `:170` | PASS |
| 14b — loopback aliases | E-2 | adversarial `:146`, `:157`; `test-database-guard.test.ts:142` | PASS |
| 14c — one URL, one host | E-4 | `test-database-guard.test.ts:303`, `:331`; adversarial `:256`, `:323`, `:348`, `:388` | PASS |
| 14d — explicit port and database | E-5 | `test-database-guard.test.ts:365`; adversarial `:268`, `:362` | PASS |
| 15 (revised) — `.env` never overrides preloads | RC "`.env` replaces fakes"; E-13 | `src/tests/test-env-isolation.test.ts:131`, `:143`, `:156`, `:172`, `:186`, `:190` | PASS |
| 16 (amended) — `connections.ts` refuses non-local DB in a test process | RC "DB tests could open Neon" | `test-database-guard.test.ts:398`, `:423`, `:437`, `:443`, `:509`; adversarial `:502`, `:514`, `:600`, `:617` | PASS |
| 17 — network egress guard | RC "tests can reach real APIs"; E-10 | `src/tests/test-network-egress-guard.test.ts:42`, `:59`, `:72`, `:82`, `:95`, `:108`; `src/tests/test-network-egress-guard-adversarial.test.ts:61`–`:187` | PASS |
| 18a — egress gaps in `Socket#connect`, DNS, dgram | E-6, E-7, E-8 | egress adversarial `:193`, `:208`, `:219`, `:276` | PASS |
| 18 — a swallowed blocked egress fails the file | RC "try/catch hides a leak" | `test-network-egress-guard.test.ts:143`, `:157`, `:164`; egress adversarial `:371`, `:382` | PASS |
| 19 — mock the two leaking DB tests | E-10 leaks (WhatsApp send, Gemini) | `src/tests/routes/webhook-whatsapp.test.ts:1831`; `src/tests/reliability/session-choice-invalid-replies.test.ts:475` | PASS |
| 20 — a test file run directly is a test process | E-12; E-14 (fixed in the same batch) | `test-database-guard.test.ts:466`, `:472`, `:481`, `:504`; adversarial `:531`, `:610`, `:637`, `:653`; egress adversarial `:276`, `:324` | PASS |
| 21 — refuse URL forms the drivers read differently | E-11 | `test-database-guard.test.ts:331`, `:342`; adversarial `:461`, `:479`, `:695`, `:717`, `:732` | PASS (see E-11b) |

### Open items (Batch E)

| Item | Severity | Owner | Pinned as |
|---|---|---|---|
| E-9 — `worker_threads` get unguarded `net`/`fetch` | low, latent | planner (listed, no step) | `todo` egress adversarial `:245` |
| E-9b — a child `node` process does not inherit the egress guard | low, latent | planner (listed, no step) | `todo` egress adversarial `:260` |
| E-12b — a direct run of a test file that never imports `connections.ts` has real `.env` credentials and no egress guard | medium, latent | planner (Davi: list only) | none (needs a product-code check) |
| E-12c — a symlinked test file with a non-test name, and `*.spec.*`, evade D-8 | low | planner | `todo` adversarial `:667` |
| E-12d — false positive when the deploy path has `src/tests` above the repo root | low | planner | `todo` adversarial `:673` |
| E-15 — `dns.lookupService` is not wrapped by the egress guard | low | planner | `todo` egress adversarial `:394` |
| Credential-regex blind spots (step 15): `*_TOKEN_V2`, `API_KEYS`, `*_SECRET_2`, `*_PASSWORD`, `*_DSN`, `*_JSON` not matched | low (future keys only) | planner | none |
| `--test` argument in prod: a production process started with a literal `--test` refuses Neon and stops at start-up | low (loud) | planner (listed) | none |
| Flaky `src/tests/reliability/autonomous-task-executor.test.ts:275` (`result.recovered >= 1`) | low (test only) | planner (noted, no step) | none; did not fail in the 2 final DB runs |
| **E-11b (new)** — non-ASCII characters in the database name (zero-width, C1 such as U+0085, accented letters, `"`) pass D-9; WHATWG and postgres.js keep them percent-encoded, `pg` decodes them, so `pg` reads another database. The host is still `localhost` | low | planner (D-9 design gap) | `todo` adversarial `:769` |
| **E-16 (new)** — a URL without `//` after the scheme (`postgresql:user:pw@host:5432/db`) makes the "non-local host" refusal print the password: WHATWG reads an empty host and puts the userinfo in the path, and `databaseIdentity` prints the path | low–medium (password in terminal or CI log on a typo; the URL is still refused) | implementer (breaks "messages never print the value") | **closed** by the E-16 fix; tests adversarial `:794`, `:813`, `:971` |
| **E-16b (new)** — a password with a raw `/` or `?` whose part before it is all digits (`u:1234/rest@host…`, `u:1234?rest@…`) is read by WHATWG as host `u`, port `1234`, and the rest in path or query. The "non-local host" message, the ALLOW_REMOTE_TEST_DB=1 warning, the query-key message and `describeDatabaseHost` print `rest` | low (needs an unencoded password of that shape) | implementer (same class as E-16) | `todo` adversarial `:930` |
| **E-17 (new)** — flaky `src/tests/services/generate-mariana-response.test.ts:936` (`/\d{11}/` on a trace line with random UUIDs; failed once in 2 DB runs, 0 of 6 reruns). File not in the diff | low (test only) | implementer (test quality) | none |

## Verdict: FAIL (batch not closed)

| Step | Verdict | Cause |
|---|---|---|
| 12 — remove vitest | PASS | — |
| 13 — setup-test-db must not hold Neon | ~~BLOCKED~~ → **PASS** (Revision 1, step 13 revised) | — |
| 14 — guard allowlist | PASS on plan criteria; E-1 **closed** by 14a (Revision 1) | — |
| 14a — query allowlist (E-1) | **PASS** (Revision 1) | — |
| 14b — loopback aliases (E-2) | **PASS** (Revision 1); E-2 **closed** | — |
| New findings (Revision 1) | E-4 **closed** by 14c, E-5 **closed** by 14d (E-R2a, PASS) | — |
| 14c — one URL, one host (E-4) | **PASS** (E-R2a) | — |
| 14d — explicit port and database (E-5) | **PASS** (E-R2a) | — |
| New finding (E-R2a) | E-11 open (low): guard and `pg` disagree on 3 accepted forms | planner: design gap |
| 15 (revised) — `.env` never overrides preloads | **PASS** (E-R2b); E-13 (low) open | E-13: implementer (test quality) |
| 16 (amended) — `connections.ts` refuses non-local DB in test process | **PASS** (E-R2b); E-12 (medium) open | E-12: planner (design gap in D-4) |

Revision 1 update (2026-10-26): see "Revision 1" at the end. Batch E steps 12–14b: PASS. Steps 15–17 not started.

`MARIANA_BEHAVIOR_SPEC.md` has no criteria on test safety (grep for vitest / TEST_DATABASE / neon / "banco de teste" returns nothing). The criteria below come from the plan.

## Criteria → tests → result

| Criterion (plan) | Evidence / test | Result |
|---|---|---|
| 12: no `vitest` reference outside node_modules and lock | `grep -rn vitest --include=*.ts,js,mjs,json . \| grep -v node_modules \| grep -v package-lock` → no hits | PASS |
| 12: `node_modules/.bin/vitest` absent | `ls` → "Arquivo ou diretório inexistente" | PASS |
| 12: lock churn has no upgrades | JSON diff of `packages` HEAD vs working tree: 0 added, 52 removed (vitest, vite, rolldown, lightningcss, chai, @vitest/*, postcss, nanoid, tinybench, std-env, why-is-node-running, etc.), 0 changes to `version`/`resolved`/`integrity`. 40 entries gained `dev: true` (esbuild, tsx, @jridgewell/*, tinyglobby, jiti...), because they were only in the prod tree through vitest. Root deps diff: only `vitest`. lockfileVersion 3 → 3 | PASS |
| 12: build / tsc / test:unit still pass | see "Suites" | PASS |
| 13: `applyTestDatabaseEnv` rewrites DATABASE_URL, NODE_ENV, RELIABILITY_WORKERS_ENABLED | `test-database-guard.test.ts` "o setup de banco de teste reescreve DATABASE_URL antes de qualquer statement" — red vs HEAD guard (✖), green now | PASS (helper only) |
| 13: `setup-test-db.ts` calls it before the pool / DROP | `git diff src/tests/support/setup-test-db.ts` empty; line 19 still `resolveTestDatabaseEnv(process.env)`, so `process.env.DATABASE_URL` still holds the `.env` (Neon) value for the whole setup run and the spawned push | NOT MET — BLOCKED |
| 14: remote non-neon host refused | "recusa um host remoto que não é neon.tech" — red vs HEAD (✖), green now | PASS |
| 14: localhost / 127.0.0.1 / ::1 accepted | "aceita localhost, 127.0.0.1 e ::1" — green before and after | PASS |
| 14: remote only with `ALLOW_REMOTE_TEST_DB=1`, loud warning, no password | "permite host remoto só com ALLOW_REMOTE_TEST_DB=1" — red vs HEAD (✖), green now; checks `undefined`, `""`, `"0"`, `"true"` refused and the warning omits `secret` | PASS |
| 14: explicit neon.tech message kept | "ALLOW_REMOTE_TEST_DB=1 não libera neon.tech" + existing neon tests | PASS |

Red check method: HEAD `test-database-guard.ts` copied to `/tmp/redcheck/support/`, current test file run against it: 4 ✖ (two step 13 tests, two red-first step 14 tests), the rest ✔.

## Step 13 blocker — confirmed

Command (non-destructive, only loads the config; no connection opened):

```
DATABASE_URL=$U TEST_DATABASE_URL=$U NODE_ENV=test RELIABILITY_WORKERS_ENABLED=false \
  npx tsx -e 'require("./src/tests/support/drizzle.test.config.ts")'      # U = local mariana_test
UnsafeTestDatabaseError: TEST_DATABASE_URL points at the same database as DATABASE_URL (localhost:5432/mariana_test). Refusing to run DB tests.
```

- Expected (plan `plan.md:276`): after `Object.assign(process.env, resolved)`, the spawned `drizzle-kit push` is "also hardened".
- Actual: the child inherits `env: process.env` (`setup-test-db.ts:39`). It loads `drizzle.test.config.ts:11`, which calls `resolveTestDatabaseEnv(process.env)` again. That env now has `DATABASE_URL === TEST_DATABASE_URL`, so the same-DB check (`test-database-guard.ts:72-82`) throws. `dotenv/config` in the child does not override, so `.env` does not restore the dev URL.
- Pinned by the todo test "resolveTestDatabaseEnv aceita um ambiente já aplicado (necessário para ligar o passo 13)", which fails with exactly that message.
- Cause: **planner**. The plan lists only `setup-test-db.ts:19` as the file, and its claim about the child is wrong. Every fix touches a file or rule outside step 13: the child env, `drizzle.test.config.ts`, or a guard rule for an env that is already applied. The implementer correctly stopped and reverted the wiring.
- Who fixes: planner, with Davi's decision.

## Findings

**E-1 (medium, pre-existing class, planner).** The guard checks the URL's `hostname`, but `drizzle-kit push` uses the `pg` driver (`drizzle-kit/bin.cjs:150736`, `checkPackage("pg")` first). `pg-connection-string` lets a `?host=` query parameter override the host:
```
parse("postgresql://u:p@localhost:5432/db?host=ep-x.sa-east-1.aws.neon.tech").host → "ep-x.sa-east-1.aws.neon.tech"
```
So `TEST_DATABASE_URL=postgresql://…@localhost/mariana_test?host=<remote>` passes the guard, including the neon check. `setup-test-db.ts` (postgres.js ignores `?host=`) then drops the local schema, and `drizzle-kit push --force` runs against the remote host. You have to craft that URL on purpose, so it is not an accident path. It does defeat the step 14 goal ("host must be local"). Fix idea: refuse any `host`/`hostaddr` query param, or refuse any query string except `sslmode`. Pinned by the todo test "recusa ?host= remoto escondido atrás de localhost". I did not connect anywhere remote.

**E-2 (low, pre-existing).** The same-DB identity compares text, so `127.0.0.1:5432/x` and `localhost:5432/x` count as different databases. Pinned by a todo test.

**E-3 (low, observation).** Before step 14, the existing test "recusa quando … aponta para o mesmo banco" only reached the neon check (the implementer flagged this too). The same-DB branch had no direct test. I added one on a local host.

**Flake (pre-existing, unrelated to this diff).** In `test:db` run 2, 1 test failed: `src/tests/reliability/autonomous-task-executor.test.ts:275` `assert.ok(result.recovered >= 1)` ("recupera tarefas com lease expirado…"). In isolation it passed 4/4, and full run 3 was green. Likely cause: another test file running in parallel recovers or claims the same expired task globally. The diff touches no reliability code. Owner: tester backlog (test isolation).

## Suites

| Command | Result |
|---|---|
| `npm run test:unit` | 259 pass / 0 fail |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | Build success |
| `npm run test:db` run 1 | 525 tests: 522 pass / 0 fail / 3 todo |
| `npm run test:db` run 2 | 521 pass / **1 fail** (flake above) / 3 todo |
| `npm run test:db` run 3 | 522 pass / 0 fail / 3 todo |
| biome on 3 changed `.ts` + package.json | no errors |
| `git diff --check` | clean |

## Diff scope

- In the plan: `package.json`, `package-lock.json` (step 12); `src/tests/support/test-database-guard.ts`, `src/tests/test-database-guard.test.ts` (steps 13/14); `progress.md`.
- `applyTestDatabaseEnv` lives in `test-database-guard.ts`, a file step 13 did not list. The plan's acceptance test does call for "the new exported helper", so this is accepted.
- No product code (`src/` outside `src/tests/`) changed. Untracked `docs/specs/MARIANA_BEHAVIOR_SPEC.md`, `mariana_spec.md` and `docs/work/2026-10-26-flow-review/` predate this batch and are not implementer output.

## New tests (tester)

`src/tests/test-database-guard-adversarial.test.ts`. It is not in the `test:unit` list (package.json not edited), so it runs under `test:db` / `npm test` only. Planner: consider adding it to `test:unit`.
- passing (6): same-DB refused on a local host; look-alike hosts refused (`localhost.evil.com`, `127.0.0.1.nip.io`, `127.0.0.2`, `0.0.0.0`, `localhost.`, multihost `localhost,db.example.com`, `[::ffff:127.0.0.1]`); `localhost` in the user or db name is not fooled; multihost with neon is refused even with the hatch; the hatch does not unlock workers=true; after apply, no value in `source` contains `neon.tech`.
- todo (3, failing by design): the step 13 blocker, E-1, and E-2.

## Risks not covered

- Until step 13 is wired, `setup-test-db.ts` still keeps the Neon `DATABASE_URL` in `process.env` and passes it to the `drizzle-kit` child. Only the guard and the explicit `testUrl` keep it from being used.
- E-1 stays open.
- Steps 15–17 (preload assertion, `connections.ts` predicate, egress guard) are not started. Today an ad-hoc `npx tsx --test` on a DB file still reaches whatever `DATABASE_URL` is set.

## Manual WhatsApp checklist

Not applicable. Batch E only changes test tooling and dependencies, with no runtime behaviour. Optional smoke test after deploy: send "oi" and expect Mariana's normal greeting. This confirms that removing vitest broke nothing at runtime (`start` is `node dist/server.js`, and the build passed).

---

## Revision 1 (tester, 2026-10-26) — steps 14a, 14b, 13 (revised)

Plan: `plan.md:1` `Status: APPROVED by Davi — "aprovo" (2026-10-26, Batch E revision 1)`; decisions 1–4 at `plan.md:3-7`; steps at `plan.md:398-424`. DB target: `localhost:5432/mariana_test` (`mariana-postgres`), `RELIABILITY_WORKERS_ENABLED=false`. Port 5433 (`zapresponse-postgres-test`) not used.

### Verdict: PASS (steps 14a, 14b, 13 revised) — 0 failures; 2 new open findings (E-4, E-5) for the planner

### Criteria → tests → result

| Criterion (plan Revision 1) | Evidence / test | Result |
|---|---|---|
| 14a: only `sslmode` allowed in the query; other key refused, message names key not value | `test-database-guard.test.ts` "recusa ?hostaddr= e qualquer parâmetro…"; adversarial "recusa ?host= remoto…"; tester "a allowlist da query não se engana com caixa alta, percent-encoding ou chave vazia" (`HOST`, `ho%73t`, `sslmode&host`, empty key, `options`) | PASS |
| 14a: `?sslmode=disable` accepted | "aceita ?sslmode=disable" | PASS |
| 14a: neon check runs first | guard `checkTestDatabaseUrl`: neon check before the query loop; "ALLOW_REMOTE_TEST_DB=1 não libera neon.tech" | PASS |
| 14a: adversarial file registered in `test:unit` | `package.json` `test:unit` lists it; `test:unit` 280 tests (was 259 before Revision 1) | PASS |
| 14b: `localhost` / `127.0.0.1` / `[::1]` one identity for same-DB only | adversarial "…localhost e 127.0.0.1", "…[::1] e localhost"; "aceita localhost, 127.0.0.1 e ::1" still green; `describeDatabaseHost` unchanged (setup prints `localhost:5432/mariana_test`) | PASS |
| 13: `assertAppliedTestDatabaseEnv` accepts env written by `applyTestDatabaseEnv` | "assertAppliedTestDatabaseEnv aceita o ambiente gravado…"; rewritten adversarial test (below) | PASS |
| 13: refuses non-applied env, NODE_ENV≠test, workers≠"false", same host rules | 4 tests in `test-database-guard.test.ts`; tester "assertAppliedTestDatabaseEnv recusa valores vazios e ambiente aplicado em neon, mesmo com a válvula" | PASS |
| 13: `resolveTestDatabaseEnv` still refuses same DB (option C stays rejected) | "resolveTestDatabaseEnv continua recusando…" | PASS |
| 13: `applyTestDatabaseEnv` before `postgres(` and `DROP SCHEMA` | `grep -n`: `setup-test-db.ts:21` apply, `:26` `postgres(`, `:29` DROP. Only import before it is `dotenv/config` and the guard/seed modules; `test-seed.ts` imports only `type Sql`, `bootstrap-schema.ts` nothing | PASS |
| 13: config refuses non-applied / Neon env (integration, non-destructive config load) | see table below | PASS |
| 13: `test:db` green, setup prints target | 2 runs, both `target localhost:5432/mariana_test` | PASS |

Config load (`npx tsx -e 'require("./src/tests/support/drizzle.test.config.ts")'`, no connection opened):

| Env | Result |
|---|---|
| applied local (`DATABASE_URL=TEST_DATABASE_URL=local`, test, false) | `LOADED localhost:5432/mariana_test` |
| `DATABASE_URL` Neon-like, `TEST_DATABASE_URL` local | `UnsafeTestDatabaseError: DATABASE_URL is not the applied TEST_DATABASE_URL` |
| `DATABASE_URL` unset (so `dotenv` loads the real `.env` URL) | same refusal |
| applied Neon-like + `ALLOW_REMOTE_TEST_DB=1` | `… points at neon` |
| both empty | `… TEST_DATABASE_URL is required` |
| `NODE_ENV` unset (`.env` supplies a non-test value) / `NODE_ENV=TEST` | `NODE_ENV must be test…` |
| workers unset | `RELIABILITY_WORKERS_ENABLED must be false…` |
| applied URL with `?host=evil` | `… has a "host" query parameter` |

Red / meaningfulness:
- Red vs HEAD guard (HEAD file in `/tmp/redcheck/support/`, plus a throwing `assertAppliedTestDatabaseEnv` stub): 9 ✖ — every Revision 1 acceptance test, 22 ✔.
- Mutation run (one mutant at a time, both guard test files): removing the applied check, the NODE_ENV check, the workers check, or the shared URL rules in `assertAppliedTestDatabaseEnv`; turning the allowlist into a `host` denylist; dropping the loopback identity; leaking the value in the message. **All 7 mutants killed** (1–5 tests fail each).
- Rewritten todo at `test-database-guard-adversarial.test.ts:105-119` (decision 3, recorded in `progress.md`): it now asserts `assertAppliedTestDatabaseEnv(applied) === localTestUrl` **and** `resolveTestDatabaseEnv(applied)` throws "same database". It fails against HEAD and kills the loopback mutant. It still pins real behaviour: the child accepts, and option C cannot slip in.

### Bypass attempts (guard vs real driver parse, `postgres(url).options` and `pg-connection-string`/`pg.Client`, no connection)

| Input | Guard | Drivers | Verdict |
|---|---|---|---|
| `?HOST=`, `?ho%73t=`, `?sslmode=…&host=`, `?=x`, `?options=` | refused | `pg` honours decoded `host` | closed by 14a |
| `#?host=evil` (fragment) | accepted | both ignore the fragment | safe |
| `user@evil@localhost` (userinfo `@`) | accepted | both: localhost | safe |
| `localhost:5432,evil:5432` (plain multihost) | refused (invalid URL) | postgres.js would use both | safe |
| `LOCALHOST`, `[0:0:0:0:0:0:0:1]` | accepted | local | safe |
| `[::ffff:127.0.0.1]`, `0x7f000001`, `localhost.`, `127.0.0.1.`, `%2Fvar%2Frun%2Fpostgresql` (unix socket), `postgresql:///db` (empty host, PGHOST) | refused | — | safe (stricter) |
| `PGHOST=evil` with a host in the URL | — | both use the URL host | safe |
| **`user:secret@x,ep-…neon.tech:5432@localhost:5432/neondb`** | **accepted** | **postgres.js: hosts `["x","ep-…neon.tech"]`, password kept**; pg: localhost | **E-4 — bypass** |
| **`localhost/mariana_test` (no port) or `localhost:5432/` (no db) with `PGPORT=5433` / `PGDATABASE=neondb`** | accepted, identity assumes `5432` / `postgres` | both drivers use `PGPORT` → 5433, `PGDATABASE` → neondb | **E-5 — target differs** |

### New findings

**E-4 (medium, pre-existing, planner).** WHATWG `URL` splits the userinfo at the **last** `@`. postgres.js (`setup-test-db.ts:26`, which runs `DROP SCHEMA public CASCADE`) splits at the **first** `@`, and then reads a comma list of hosts. So `TEST_DATABASE_URL=postgresql://user:secret@x,<neon-host>:5432@localhost:5432/neondb` passes the guard as "localhost". It also passes the neon check, which reads only `hostname`. postgres.js then tries `x` (DNS fail) and the Neon host, with the password. The DROP runs there. You must craft this URL on purpose. Still, it reopens the 14/14a goal ("the real host must be local") for the most destructive statement in the suite. Fix idea for the planner: refuse `@` or `,` inside the userinfo/authority of `TEST_DATABASE_URL`. A stronger option: compare the guard's host with `postgres(url).options.host` and with `pg-connection-string`'s `parse(url).host`, and require that both are local. Pinned by todo "recusa lista de hosts escondida no userinfo (postgres.js conectaria no neon)". Step 16 (`isForbiddenTestConnection` reuses this helper) inherits the same gap.

**E-5 (low, pre-existing, planner).** When the URL has no port or no database, the guard assumes `5432` / `postgres`. `pg` and postgres.js take `PGPORT` / `PGDATABASE` from the environment instead. With `PGPORT=5433` exported, a port-less `localhost/mariana_test` resets `zapresponse-postgres-test`, another project's DB. The host is still local, so it is not a Neon risk. Fix idea: require an explicit port and database name in `TEST_DATABASE_URL`. Pinned by todo "exige porta e banco explícitos no TEST_DATABASE_URL…".

**Observation (no step).** postgres.js parses `[::1]` as host `"["` (`options.host = ["["]`). An IPv6 loopback `TEST_DATABASE_URL` passes the guard, then fails to connect in `setup-test-db.ts`. It fails safe.

### Suites (Revision 1)

| Command | Result |
|---|---|
| `npm run test:unit` | 280 tests: 278 pass / 0 fail / 2 todo (E-4, E-5) |
| `npm run test:db` run 1 (`localhost:5432/mariana_test`) | 537: 535 pass / 0 fail / 2 todo; exit 0 |
| `npm run test:db` run 2 | 537: 535 pass / 0 fail / 2 todo; exit 0 (flake `autonomous-task-executor.test.ts:275` did not occur) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | Build success |
| biome on the 6 changed code files | no errors |
| `git diff --check` | clean |

### Diff scope (Revision 1)

The plan lists exactly these files: `test-database-guard.ts`, `drizzle.test.config.ts`, `setup-test-db.ts`, `test-database-guard.test.ts`, the adversarial file and `package.json` (`test:unit` only, one entry added). `plan.md` changes only in its status and decisions header. `progress.md` gains its Revision 1 entry. No product code changed. Nothing unapproved.

### New tests (tester, Revision 1) — `src/tests/test-database-guard-adversarial.test.ts`

- pass: "a allowlist da query não se engana com caixa alta, percent-encoding ou chave vazia"; "assertAppliedTestDatabaseEnv recusa valores vazios e ambiente aplicado em neon, mesmo com a válvula".
- todo (they fail by design, since the guard accepts the input today): E-4, E-5.

### Risks not covered

- E-4 and E-5 stay open until the planner decides on them.
- The guard checks the URL text and does not resolve DNS. A custom name that resolves to a remote host still needs `ALLOW_REMOTE_TEST_DB=1`, so it is refused by default.
- Steps 15–17 have not started. An ad-hoc `npx tsx --test` on a DB file is still not guarded by the preload assertion.

### Manual WhatsApp checklist

Not applicable. Revision 1 changes only the test tooling. Runtime behaviour does not change.

---

## Step 17 — network egress guard (tester, 2026-10-26)

**Verdict: PASS.** The plan's acceptance criteria are met, and no test reaches the network any more. There are 0 failures. Five gaps sit outside the plan's API list (E-6 to E-9b). They are recorded as `todo`. One new leak was found in a test (E-10, medium). The guard blocks it now, but the test still needs a mock.

Plan status: `Status: APPROVED by Davi — "aprovo" (2026-10-26, Batch E revision 1)`. Step 17 has been approved since 2026-10-22. DB target: `localhost:5432/mariana_test` (`mariana-postgres`), `RELIABILITY_WORKERS_ENABLED=false`. `MARIANA_BEHAVIOR_SPEC.md` has no test-safety criterion. The criteria below come from `plan.md` step 17.

### Criteria

| Criterion (plan step 17) | Test(s) | Result |
|---|---|---|
| A non-loopback host is refused, and the error names the host | `test-network-egress-guard.test.ts` "recusa um host fora do loopback…" | pass |
| `127.0.0.1`, `localhost` and `::1` are allowed | same file, "permite 127.0.0.1, localhost e ::1"; adversarial "o loopback continua acessível" (real loopback server) | pass |
| `ALLOW_TEST_NETWORK=1` permits everything and logs a loud warning | same file, "ALLOW_TEST_NETWORK=1 permite tudo…"; adversarial "só ALLOW_TEST_NETWORK=1 exato" (`" 1"`, `"1 "`, `"01"`, `"1\n"`, `yes`, `TRUE`, `on`, `2` all stay blocked); a hatch run printed the WARNING once per file, with 15 skipped and 0 fail | pass |
| `net.connect`, `dns.lookup`, `http.request`, `https.request` and `fetch` are blocked at preload time | wiring test (`net.connect`, `http.request`); adversarial: `tls.connect`, `http2.connect`, ESM `import { request } from "node:https"`, ESM `dns/promises.lookup`, `http.request(url localhost, {hostname: remote})`, `fetch(Request/URL/toString object)`, and a loopback 302 redirect to a remote host (blocked in the socket) | pass |
| Raw IPs, `0.0.0.0` and IPv4-mapped IPv6 are refused | adversarial: `192.0.2.1`, `0.0.0.0`, `::ffff:192.0.2.1`, `::ffff:127.0.0.1`, `127.0.0.2`, `0:0:0:0:0:0:0:1` | pass (conservative: only the 4 literal loopback spellings pass) |
| The full suites stay green with egress blocked and 0 attempts | tracing preload (`/tmp`, wraps every guarded API and logs each `TestNetworkEgressError`) over both suites | unit: 0 hits outside the guard's own tests. DB: 2 leaking tests, listed below |

**Deviation (`Socket#connect` instead of `net.connect`): equivalent and stronger.** `net.connect` and `net.createConnection` call `Socket.prototype.connect`. So do `tls.connect`, `http2.connect`, the HTTP agents and undici's connector, so one patch covers all of them. Evidence: the `tls`, `http2` and fetch-redirect tests pass, and the redirect is refused at socket level after fetch's URL check had already passed. One weakness is E-6, below.

### Tests that hit the guard (DB suite trace)

- **Confirmed:** `src/tests/routes/webhook-whatsapp.test.ts:1830` ("mensagem com 4h exatas pergunta antes de processar"). It does not mock the WhatsApp send of the session-choice question. That send goes through `fetch` at `src/integrations/whatsapp/whatsapp-client.ts:140` to `graph.facebook.com` (URL at `:53`). One attempt per run. It is visible as `[WhatsAppClient] Network error when sending message: TestNetworkEgressError…`. Isolated with `--test-name-pattern="mensagem com 4h exatas"`.
- **E-10 (new, medium), silent:** `src/tests/reliability/session-choice-invalid-replies.test.ts:473` ("toque sessao:desconhecido não consome a escolha: toque valido ainda decide"). After the valid tap, `drainConversationWork` (`:500`) runs a Mariana turn with no `generateContent` mock. That makes **3 attempts** to `generativelanguage.googleapis.com`. The model-failure path absorbs them, nothing is logged, and the test still passes. Before step 17, these were 3 real HTTPS requests to Gemini on every DB run (fake key, so they were rejected). This is the B-2 class again. The implementer's note names only the WhatsApp leak. **Owner: implementer.** Mock `ai.models.generateContent` or inject a sender stub in that test. Consider also asserting there is no `model_error`.
- No other test hit the guard (DB run with trace: exit 0).

### Bypasses found (recorded as `todo` in the adversarial file, low severity, outside the plan's list)

| Id | Bypass | Proof (no egress) | Owner |
|---|---|---|---|
| E-6 | `net.connect({ hostname: "localhost", host: remote })`. `hostFromOptions` prefers `hostname`, but `net` only uses `host`, so the guard checks the wrong field. (HTTP is unaffected: `ClientRequest` copies `hostname` into `host` before the agent connects.) | the fake lookup is reached with `egress-probe.invalid` | implementer (one-line fix: the `Socket#connect` path should read `host`) |
| E-7 | `dns.resolve*`, `dns.Resolver` and `dns.promises.Resolver` are not patched. A UDP query leaves through the system resolver, which leaks the hostname. | `Resolver` with servers `127.0.0.1:1` returns `ECONNREFUSED`, not `TestNetworkEgressError` | planner (scope) |
| E-8 | `dgram` (UDP) is not patched | `send` reaches the fake lookup | planner |
| E-9 | `worker_threads`: a Worker gets unguarded `net` and `fetch` (`fetch.name === "fetch"`) | Worker eval | planner |
| E-9b | a child `node` process does not inherit the guard. `NODE_OPTIONS` has no `--import`, and `curl` or any spawned tool is unguarded too. | `spawnSync(process.execPath, …)` | planner (or declare it out of scope) |
| — | Accepted limit: a custom `lookup` option can map `localhost` to any IP, because the guard checks the name, not the resolved address. Not tested, because a test would need a real address. | — | risk |

No repo code uses Worker, dgram or `dns.resolve`. The only `child_process` use is `src/tests/support/setup-test-db.ts`, which runs local drizzle-kit and seed steps before the preload exists. So all of these gaps are latent.

### Suites

| Command | Result |
|---|---|
| `npm run test:unit` | 286 tests, 284 pass / 0 fail / 2 todo (E-4, E-5) |
| `npm run test:db` run 1 | `target localhost:5432/mariana_test`; 543 tests, 541 pass / 0 fail / 2 todo |
| `npm run test:db` run 2 | 543 tests, 541 pass / 0 fail / 2 todo (the flake at `autonomous-task-executor.test.ts:275` did not occur in either run) |
| new adversarial file, unit preload / DB preload | 16 tests, 11 pass / 0 fail / 5 todo, the same under both preloads |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| biome (guard, its test, both preloads, adversarial file) | clean |
| `git diff --check` | clean |

The DB runs above predate the adversarial file. That file was run on its own under both preloads afterwards.

### Diff scope

The guard module, its test and both preloads are as the plan lists. `package.json` registers the new test in `test:unit`. `docs/CODEMAP.md` gets a one-line support note. Both are bookkeeping in line with the plan. No product code changed. Nothing unapproved.

### New tests (tester) — `src/tests/test-network-egress-guard-adversarial.test.ts`

- 11 pass: tls, http2, ESM https, URL+hostname override, ESM dns/promises, IP literals and mapped addresses, three fetch input types, fetch redirect, loopback reachable, exact hatch value, fake env does not set the hatch.
- 5 todo: E-6, E-7, E-8, E-9, E-9b.
- Not in the `test:unit` list. It runs under `test:db` (glob). If it should also run in `test:unit`, the implementer must register it in `package.json`.
- Not shown red, because removing the guard would let the fetch cases send DNS for `.invalid`. They follow the same pattern as the implementer's wiring test, which was shown red.

### Risks not covered

- E-10 stays open until the test is mocked.
- E-6 to E-9b are latent.
- The guard only protects processes started with one of the two preloads. An IDE runner or a plain `node --test` without `--import` is unguarded (the same class as step 16).

### Manual WhatsApp checklist

Not applicable. Step 17 is test tooling only.

## E-R2a (tester, 2026-10-26) — steps 14c and 14d

Plan line 1: `Status: APPROVED by Davi — "aprovo" (2026-10-26, Batch E revision 2)`; decisions 2 and 3 cover 14c/14d. DB target `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`.

### Verdict: PASS (14c, 14d) — 0 failures; E-4 and E-5 closed; 1 new low finding (E-11, planner)

### Criteria → tests → result

| Criterion (plan Revision 2) | Test(s) | Result |
|---|---|---|
| 14c: E-4 URL refused (todo removed, red first) | adversarial "recusa lista de hosts escondida no userinfo…" | PASS; red against `HEAD` guard |
| 14c: extra `@`, comma list, `%2C` host refused; no userinfo in message | "recusa @ a mais, vírgula ou host codificado na autoridade" | PASS; red against `HEAD` |
| 14c: `%40` password accepted | "aceita senha com %40 codificado" | PASS (green before and after) |
| 14c: accepted host == postgres.js host, local | adversarial "o host aceito pelo guard é o mesmo que o postgres.js usaria" | PASS; red against `HEAD` |
| 14c: guard stays pure (no driver import) | read `test-database-guard.ts` diff | PASS |
| 14c: neon/query checks keep order and messages | diff read; old tests green | PASS |
| 14d: E-5 todo removed (red first) | adversarial "exige porta e banco explícitos…" | PASS; red against `HEAD` |
| 14d: message names port/database, no password | "a mensagem de porta ou banco ausente nomeia o que falta" | PASS; red against `HEAD` |
| Changed fixture still tests the workers rule | tester "o fixture remoto com porta é recusado só pela regra dos workers" | PASS (same URL without workers is accepted; with workers the message is the workers one) |
| Messages never show userinfo | tester "mensagens de recusa nunca mostram o userinfo" (16 forms, local and `ALLOW_REMOTE_TEST_DB=1`) | PASS |
| Guard, postgres.js and pg agree on host, port and database | tester "guard, postgres.js e pg leem o mesmo host, porta e banco" (12 accepted forms) | PASS; 3 exceptions = E-11 (todo) |

Red evidence: the 5 acceptance tests were run against `git show HEAD:src/tests/support/test-database-guard.ts` in a temp copy (`/tmp`, removed after). All 5 failed, plus 2 tester tests.

### Bypass attempts (guard vs `postgres(url).options` vs `pg-connection-string.parse`, `PGHOST/PGPORT/PGDATABASE` set to decoys, no connection)

| Input form | Guard | Drivers | Note |
|---|---|---|---|
| `postgres://`, `POSTGRESQL://`, `LocalHost` | accepted | both localhost:5432/mariana_test | agree |
| `%40`, `%3A`, `%2C`, `%2F`, raw `:` or `,` in password; `%40<neon>` in user | accepted | both localhost | agree |
| raw `@` in password, `x@localhost`, comma list, `%2C`/`%2c` list, `%40` in host | refused | postgres.js would read a list or another host | closed |
| `localhost:5432#,<neon>:5432/neondb` (local and remote hatch) | refused by 14d (empty path) | postgres.js `["localhost", <neon>]` | guard ends the authority at `#`, postgres.js does not; safe only through 14d. Pinned by a tester test |
| `#` in password (`u:p#x@…`) | refused (invalid URL) | both invalid | — |
| `local%68ost`, `%2Fvar%2Frun…` socket host, `localhost%3A5432`, `neon%2Etech`, tab inside host, `postgresql:/\t/` | refused (host read differently) | pg decodes, postgres.js does not | closed |
| `?host=` socket or host | refused (14a) | pg would use the query host | — |
| `[::1]` | accepted | postgres.js `"["`, pg `[::1]` | known, out of scope (fails safe) |
| `[0::1]`, `[0:0:0:0:0:0:0:1]` | refused (raw host != `URL.hostname`) | — | stricter than before |
| `localhost.`, `127.1`, `2130706433`, `[::ffff:…]` | refused (non-local) | — | — |
| `<NEON>` uppercase, `<neon>.` trailing dot, hatch on | refused (neon) | — | — |
| no port, `:` empty port, no db, `/`, `/a/b`, trailing `/` | refused (14d) | drivers would use `PGPORT`/`PGDATABASE` | closed |
| **leading space** | **accepted** | postgres.js localhost; **pg host `base`** (encodeURI, then resolved relative to `postgres://base`) | **E-11** |
| **trailing space** | **accepted** | postgres.js `mariana_test`; **pg `mariana_test `** | **E-11** |
| **`%xx` in the database** (`mariana%5Ftest`) | **accepted** | postgres.js `mariana%5Ftest`; **pg `mariana_test`** | **E-11** |

### New finding

**E-11 (low, planner: design gap).** D-2/D-3 compare the guard only with postgres.js. `pg` (drizzle-kit push, `setup-test-db.ts:35`) reads 3 accepted forms differently: a leading space sends pg to host `base`; a trailing space or a `%xx` in the path gives pg a different database name than postgres.js. All are local or unresolvable, and the reset (postgres.js, `setup-test-db.ts:26`) runs on the guard's target first, so today this fails safe: push errors or writes a wrong local database. It still breaks "one URL, one target". Fix idea: refuse whitespace or control characters anywhere in `TEST_DATABASE_URL`, and `%` in the path. Pinned by todo "tester E-R2a: guard recusa URL que o pg lê com outro host ou banco".

### Notes (no FAIL)

- Fixture edit (adversarial workers test, `db.example.com/t` → `db.example.com:5432/t`): plan 14d says refused fixtures stay unless a message changes. The edit is needed: without it the URL is refused by the port rule and the test no longer reaches the workers rule (checked: old URL gives "must name its port explicitly"). Listed in `progress.md`. That test still checks only the error class; the tester test above pins the message.
- Check order changed: non-local refusal now runs before port/database, so the remote warning is printed only after every check passes. Not in the plan text, no criterion affected.
- `#` asymmetry: the guard's `AUTHORITY_END` includes `#`, postgres.js splits only on `/` and `?`. Safe today because 14d requires a path, and after `#` there is none.

### Suites (E-R2a)

| Command | Result |
|---|---|
| `npm run test:unit` | 295 tests: 294 pass / 0 fail / 1 todo (E-11) |
| `npm run test:db` run 1 (`[setup-test-db] target localhost:5432/mariana_test`) | 568 tests: 562 pass / 0 fail / 6 todo (E-6/E-7/E-8 egress, E-11) |
| `npm run test:db` run 2 | 568: 562 pass / 0 fail / 6 todo; flake did not occur |
| `npx tsc --noEmit` / `npm run build` | exit 0 / exit 0 |
| biome (3 changed files) / `git diff --check` | clean / clean |

### Diff scope (E-R2a)

Only `test-database-guard.ts`, `test-database-guard.test.ts` and `test-database-guard-adversarial.test.ts`, as listed in 14c/14d. `progress.md` gains the batch entry. `plan.md`'s header edit is not part of the batch. No product code touched.

### New tests (tester, E-R2a) — `src/tests/test-database-guard-adversarial.test.ts`

- "tester E-R2a: lista de hosts depois de # antes do caminho é recusada"
- "tester E-R2a: o fixture remoto com porta é recusado só pela regra dos workers"
- "tester E-R2a: mensagens de recusa nunca mostram o userinfo"
- "tester E-R2a: guard, postgres.js e pg leem o mesmo host, porta e banco"
- todo "tester E-R2a: guard recusa URL que o pg lê com outro host ou banco" (E-11)
- Imports `pg-connection-string`. It comes in through `pg`; it is not a direct dependency.

### Risks not covered

- E-11 (above).
- Davi's `.env` `TEST_DATABASE_URL` must now name its port and database. The runs above used the explicit URL. A `.env` value without a port now gets a clear refusal before any statement.
- Step 16 is not done yet, so these rules do not cover `connections.ts` (batch E-R2b).

### Manual WhatsApp checklist

Not applicable: test harness only, no runtime behaviour changed.

## E-R2b — steps 15 (revised) and 16 (amended) (tester, 2026-10-26)

Plan: `plan.md:1` `Status: APPROVED by Davi — "aprovo" (2026-10-26, Batch E revision 2)`; decisions 1 (D-1) and 4 (D-4). DB target `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`. Probes ran from temp cwds with `env -i` and fake `.env`; the real `.env` was never read by a probe. Skill tool not available; verification done by hand. `MARIANA_BEHAVIOR_SPEC.md`: no criteria on test infra (unchanged).

### Verdict: PASS (15, 16) — 0 failures; 2 new findings (E-12 medium, planner; E-13 low, implementer)

### Criteria → tests → result

| Criterion (plan) | Test(s) | Result |
|---|---|---|
| 15: unit preload, `.env` does not replace `DATABASE_URL` or fakes | `test-env-isolation.test.ts` "com o preload unitário…" | PASS. **Red proven** in a temp copy of `src/` with `env.ts:1` doctored to re-read `DATABASE_URL`/`GEMINI_API_KEY` from cwd `.env`: `actual: { canaryKeys: [ 'GEMINI_API_KEY' ], envDatabaseUrlMatches: false, processDatabaseUrlMatches: false }`. Repo `src/env.ts` diff empty |
| 15: DB preload, same | "com o preload de banco…" | PASS; same red as above |
| 15: control (override after import detected) | "o harness detecta um dotenv com override" | PASS |
| 15: every `envSchema` credential has a fake | "toda credencial do envSchema…" + control "…nomeia uma credencial sem valor falso" | PASS. Anchored regex matches 12 schema keys; unanchored plan regex matches the same 12 plus `GEMINI_MAX_OUTPUT_TOKENS` only. No current credential escapes (non-matched keys: URLs, versions, timers, `NODE_ENV`, `PORT`, model config, `GOOGLE_REDIRECT_URI` which is faked anyway) |
| 15: child never reads the real `.env` | code read: cwd = `mkdtemp`, env = `PATH` (+ probe `TEST_DATABASE_URL`), no `DOTENV_CONFIG_PATH`, script prints only key names and booleans | PASS |
| 16: refuses Neon in a runner child | "…recusa Neon em um filho do test runner" + tester "NODE_TEST_CONTEXT 'child' e --test-isolation=none…" | PASS |
| 16: E-4 URL and port-less URL refused | "…recusa a URL do E-4 e uma URL sem porta"; tester "com ALLOW_REMOTE_TEST_DB=1 ainda recusa host escondido e ?host=" | PASS |
| 16: sentinel and local DB accepted | "…aceita o sentinela unitário…" | PASS |
| 16: production unchanged | "…não interfere fora de testes"; tester wiring "connections.ts não interfere fora de um processo de teste" | PASS |
| 16: hatch frees remote, never neon | "…ALLOW_REMOTE_TEST_DB=1 libera host remoto, nunca neon.tech" | PASS |
| 16: real wiring in `connections.ts` | tester "connections.ts recusa um DATABASE_URL neon num filho do test runner, sem imprimir a URL" | PASS. **Red proven**: with `HEAD`'s `connections.ts` in a temp copy, `actual: { outcome: 'imported', leaked: false }` |
| 16: error never prints the URL | same wiring test (regex `/neon|segredo|u:/` over message + stack) | PASS. The guard's own message (with host) is swallowed by `isForbiddenTestConnection`; `connections.ts` throws a constant text |
| Production bundle | `npm run build` → `dist/server.js` inlines the guard (tsup bundle); no runtime `require` of `src/tests/` | PASS |

### Runner probes (temp cwd, fake `.env` with `ep-fake.neon.tech`, `env -i`)

| How the file runs | Result |
|---|---|
| `node --import tsx --test f.test.mjs` | `UnsafeTestDatabaseError` |
| `tsx --test f.test.mjs` | `UnsafeTestDatabaseError` |
| `node --test --test-isolation=none` | `UnsafeTestDatabaseError` (`--test` in parent `execArgv`) |
| **`tsx f.test.mjs` (direct run; IDE "Run/Debug file")** | **imported — evaded (E-12)** |
| plain `node` import, `NODE_TEST_CONTEXT=""` | imported (correct: not a test) |
| production process with `--test` as an app argument | `UnsafeTestDatabaseError` (false fire; no repo script passes `--test`; low) |

### Findings

- **E-12 (medium, planner — design gap in D-4).** A test file run directly (`npx tsx src/tests/x.test.ts`, IDE "Run file"/debug that does not add `--test`) runs `node:test` in-process with no `--test` and no `NODE_TEST_CONTEXT`, and without a preload. `connections.ts` then opens the `.env` `DATABASE_URL` (Neon). Plan step 16 text claims "an IDE runner" is made safe; that is true only for runners that pass `--test`. Pinned as `todo` "E-12: um arquivo .test.ts executado direto também é processo de teste" (`test-database-guard-adversarial.test.ts`). Options for the planner: treat `argv[1]` ending in `.test.ts`/`.test.js` as a test process, or detect that `node:test` was loaded.
- **E-13 (low, implementer — test quality).** The canary `canary-GOOGLE_ACCOUNT_EMAIL` is not a valid email. With a real `override: true` in `env.ts:1`, the two main step 15 tests still go red, but via the child crashing on `GOOGLE_ACCOUNT_EMAIL: Invalid email address` ("probe child failed"), not via the canary assertion. Red holds; the diagnostic misleads. Fix: an email-shaped canary for `*_EMAIL` keys.
- **Regex deviation (accepted).** End anchor is correct today. Escapes it adds versus the plan regex: suffixed names (`X_TOKEN_V2`, `API_KEYS`, `JWT_SECRET_2`). Both regexes miss `*_PASSWORD`, `*_DSN`, `*_JSON`. Risk only for future keys; an explicit non-credential allowlist would be stricter.
- Note: with the hatch on, the remote-DB warning ("DB tests will RESET…") also prints when `connections.ts` loads (implementer noted; cosmetic).

### Scope

Diff matches the plan (15: new test file, `package.json` `test:unit`, `CODEMAP.md`, preload comments; 16: `connections.ts`, guard helper extraction, guard tests). The adversarial-file changes before this section are E-R2a (14c/14d). No product file other than `connections.ts`. `src/env.ts`, `fake-external-env.ts` unchanged. No test or helper loads the real `.env` in a child: the only other spawns are `setup-test-db.ts` (drizzle-kit, by design) and the egress adversarial E-9b `node -e` (no dotenv).

### New tests (tester) — `src/tests/test-database-guard-adversarial.test.ts`

- "isForbiddenTestConnection: NODE_TEST_CONTEXT 'child' e --test-isolation=none também são processo de teste"
- "isForbiddenTestConnection: com ALLOW_REMOTE_TEST_DB=1 ainda recusa host escondido e ?host="
- "E-12: um arquivo .test.ts executado direto também é processo de teste" (`todo`)
- "connections.ts recusa um DATABASE_URL neon num filho do test runner, sem imprimir a URL" (child process, temp cwd, fake `.env`, no connection: postgres.js is lazy)
- "connections.ts não interfere fora de um processo de teste (produção inalterada)"

### Suites

- `npm run test:unit`: 310 tests, 308 pass / 0 fail / 2 todo (E-11, E-12). Before tester tests: 305 / 304 / 0 / 1.
- `npm run test:db` (`[setup-test-db] target localhost:5432/mariana_test (seed v1)`): run 1 and 2 (before tester tests) 578 / 572 pass / 0 fail / 6 todo; run 3 (with tester tests) 583 / 576 / 0 / 7. Flake `autonomous-task-executor.test.ts:275` did not occur.
- `npx tsc --noEmit`: exit 0. `npm run build`: success. Biome on 7 changed code files: clean. `git diff --check`: clean.

### Risks not covered

- E-12 (above). Also any runner that spawns node without `--test` and without `NODE_TEST_CONTEXT` (e.g. a custom script that imports `node:test`).
- The step 16 guard only fires at `connections.ts` import; a test that builds its own `postgres(...)` client bypasses it (none in the repo today).

### Manual check for Davi (no WhatsApp needed)

- Run `npm run test:unit` and `npm run test:db` as usual: both green.
- Do **not** run a test file directly with `npx tsx <file>` until E-12 is decided: that path still reaches the `.env` database.

## E-R2c (tester, 2026-10-26) — E-13, steps 18a, 18, 19

DB target: `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`. Probes ran from temp cwds with `env -i PATH`, guard on, c-ares pointed at `127.0.0.1:1`, fake `lookup` for dgram. No real request or DNS query was made by the tester.

### Verdict: PASS (E-13, 18a, 18, 19) — 0 failures; 2 new low findings (E-14 implementer, E-15 planner)

### Criteria → tests → result

| Criterion | Test(s) | Result |
|---|---|---|
| E-13: control fails on the canary, not on email validation | `test-env-isolation.test.ts` "o harness detecta um override antes do parse do env.ts pelo canário" (asserts both URL checks false and `canaryKeys` = all 16 keys; `*_EMAIL` canary is `canary-<KEY>@example.test`) | PASS. The test crashes into "probe child failed" only if the canary is not schema-valid. Tester did not edit `env.ts` (product code). |
| 18a E-6: `Socket#connect` reads `host` | adversarial "buraco E-6" (todo removed) | PASS |
| 18a E-7: module `dns.resolve*`, `dns.Resolver`, `dns.promises(.Resolver)`, `reverse` | adversarial "buraco E-7" + "E-7/E-8: dns.resolve* do módulo…"; tester probe | PASS. Blocked: `dns.promises.Resolver#resolve4/resolveAny/reverse`, ESM named `resolveAny` from `node:dns/promises` and `resolve4` from `node:dns`, `dns.resolveAny` callback, a `dns.Resolver` subclass. `dns.promises === require("node:dns/promises")` is true. Not covered: `lookupService` (E-15). |
| 18a E-8: `dgram` send/connect | adversarial "buraco E-8" + new test; tester probe | PASS. `send(msg,port,host)`, `send(msg,off,len,port,host)` and `send(msg,port,IP)` without connect are blocked. A hex IP string (`"0xC0000201"`) skips the send check, but the default lookup still blocks it. It passes only with a custom `lookup`, which is the accepted limit. |
| 18a size rule (D-5) | `test-network-egress-guard.ts` | PASS: one generic DNS wrapper over a method list and two small dgram wrappers. |
| 18a registration in `test:unit` | `package.json` | PASS (file runs under both preloads: 20 tests, 17 pass, 3 todo, including the tester tests) |
| 18: a swallowed blocked egress fails the file | "uma tentativa bloqueada e engolida por try/catch faz o arquivo falhar" | PASS |
| 18: the counter is not escaped by an `after` hook, a timer after the last test, a top-level call or `process.exit(0)` | tester probes; tester tests "bloqueio engolido num hook after…" and "bloqueio num timer que dispara depois do último teste…" | PASS. Each case: exit 1 and a `[test-network-guard] FAIL` line. In a multi-file run, the runner reports each such file as failed ("fail 2"). |
| 18: a child process | probe | Escapes, as already listed (E-9b): the child's `Socket#connect` is the original. D-5 lists E-9/E-9b with no step. Not a FAIL. |
| 18: no blocked attempt means exit 0; the hatch counts nothing | "sem tentativa bloqueada o arquivo passa", "com ALLOW_TEST_NETWORK=1 nada é contado" | PASS |
| 19 `:1830`: only the transport is mocked; the 4h boundary is still tested | `webhook-whatsapp.test.ts` "mensagem com 4h exatas pergunta antes de processar" | PASS. The `lastCustomerMessageAt = now − 4h` setup and the assertions (session choice `pending`, ask task present, no pending inbound task) are unchanged. New assertions: `sentTo` = `[testPhone]` (exactly one send) and zero blocked egress. |
| 19 `:473`: Gemini is mocked; the invalid-reply path is still tested | `session-choice-invalid-replies.test.ts` "toque sessao:desconhecido não consome a escolha…" | PASS. The invalid tap followed by a valid tap still has to leave A active with exactly 1 inbound task: that is the "invalid tap did not consume the choice" proof. The `model_error` and mock-call checks are added to it; they do not replace it. |
| 19: the existing assertions on events and outbound rows are unchanged | diff read | PASS |
| Red evidence for 18 and 19 | implementer: fixture exit 0 before; `test:db` "fail 2" naming exactly the two files | Accepted (matches the R2-7 list). |

### Deviations judged

- **`guardTestEgress` export**: accepted. It is the counting variant used by every wrapper. `assertTestEgressAllowed` still does not count. It weakens nothing: a caller can already drain the counter through `takeBlockedEgressAttempts`.
- **One real DNS query for `egress-probe.invalid` in the E-7 red run**: noted. That one query did happen. **E-14**: it can happen again. The new test "E-7/E-8: dns.resolve* do módulo…" calls `dns.promises.resolve4`, `dns.resolve4`, `dns.resolve` and `dns.promises.reverse("192.0.2.1")` on the **system** resolver. If one of those wrappers regresses, any future red run sends real A and PTR queries. Only the `Resolver` case sets `127.0.0.1:1`. `dgram.connect(9, PROBE_HOST)` has a second layer of protection (the guarded `dns.lookup`). Fix (implementer, low): `dns.setServers(["127.0.0.1:1"])` / `dns.promises.setServers` at the start of the test, restored in `finally`. The step 18 fixture's `fetch("https://example.invalid/")` reaches DNS only if both the fetch guard and the lookup guard regress.

### New findings

- **E-14 (low, implementer):** see above.
- **E-15 (low, planner — outside D-5's list):** `dns.lookupService` and `dns.promises.lookupService` (getnameinfo, a PTR query through the system resolver) are not wrapped. Pinned as a `todo` (identity check only; the probe never calls the function). No code in the repo uses it.
- Note: `session-choice-invalid-replies.test.ts` also reorders 2 schema imports (biome sort). This is cosmetic and inside a file the plan lists.
- Biome: 2 old `noAwaitInLoops` errors at `session-choice-invalid-replies.test.ts:156,279` (lines not touched). Noted only.

### Scope

The E-R2c changes touch only the files the plan lists: `test-network-egress-guard.ts`, `test-network-egress-guard.test.ts`, the adversarial egress file, `package.json` (`test:unit`), `webhook-whatsapp.test.ts`, `session-choice-invalid-replies.test.ts` and `test-env-isolation.test.ts` (E-13). No product code was changed in this batch.

### New tests (tester) — `src/tests/test-network-egress-guard-adversarial.test.ts`

- "tester E-R2c: bloqueio engolido num hook after falha o arquivo"
- "tester E-R2c: bloqueio num timer que dispara depois do último teste falha o arquivo"
- "buraco E-15: dns.lookupService … não é bloqueado" (`todo`)
- Red not shown for the first two: that would need removing the step 18 exit hook. Their pre-step-18 behavior (exit 0) is the same as the implementer's red fixture.

### Suites

- `npm run test:unit`: exit 0. Before the tester tests: 331 tests, 327 pass, 0 fail, 4 todo. After: 334 tests, 329 pass, 0 fail, 5 todo.
- `npm run test:db` (`[setup-test-db] target localhost:5432/mariana_test (seed v1)`):
  - run 1: exit 0; 588 tests, 584 pass, 0 fail, 4 todo; no blocked-egress line.
  - run 2: exit 1; 1 fail, the known flake `autonomous-task-executor.test.ts:275` (`result.recovered >= 1`). A rerun of that file alone: exit 0.
  - The tester tests also pass in the adversarial file under the DB preload (20 tests, 17 pass, 3 todo).
- `npx tsc --noEmit`: exit 0. `npm run build`: success. `git diff --check`: clean.
- Biome on the 7 changed files: only the 2 old errors above. The adversarial file is clean after the tester edits.

### Risks not covered

- E-9 (Workers) and E-9b (child processes) are still open, by design.
- E-15 (`lookupService`) and E-14 (a regression run sends real DNS queries).
- Any test can call `takeBlockedEgressAttempts()` and drain the counter. The adversarial file's `afterEach` drain would also hide an accidental leak in that file.

### Manual check for Davi (no WhatsApp needed)

- Run `npm run test:unit` and `npm run test:db`. Both should be green and print no `[test-network-guard] FAIL` line. If `autonomous-task-executor.test.ts:275` fails, rerun it: it is the known flake.

## E-R3a (tester, 2026-10-27) — step 20 (E-12) + E-14

### Verdict: PASS — 0 failures; 2 new low findings (E-12c, E-12d, both planner)

Gate: plan line 1 `Status: APPROVED by Davi — "ok eu aprovo" (2026-10-27, Batch E revision 3)`, decisions 1–4. Implementation matches D-8 (decision 1: `.test.*` or `src/tests`; no `NODE_ENV=test`).

### Criteria → tests → result

| Criterion (plan Rev 3, step 20 / E-14) | Test(s) | Result |
|---|---|---|
| E-12 adversarial `todo` removed, red first | adversarial "E-12: um arquivo .test.ts executado direto…" | PASS; red confirmed by running the cases against `git show HEAD:` guard (all `false`) |
| `.test.*` entry forbidden (POSIX + Windows) | "isForbiddenTestConnection trata um arquivo .test.*…" + tester "todas as extensões .test.*…" | PASS |
| `src/tests/` entry forbidden (POSIX + Windows) | "… trata uma entrada em src/tests/…" | PASS |
| Production entries unaffected | "… não interfere com as entradas de produção" + tester "nomes parecidos com teste não disparam" | PASS |
| Test entry + local DB allowed | "… entrada de teste com banco local passa" | PASS |
| Wiring: `tsx f.test.mjs` → `UnsafeTestDatabaseError`, URL not printed | adversarial "connections.ts recusa … .test.mjs roda direto com tsx…" | PASS |
| `connections.ts` comment only | diff | PASS |
| E-14: DNS probes use a dead resolver | E-7/E-8 test asserts `getServers()` = `127.0.0.1:1` for `dns` and `dns.promises` | PASS |
| E-14: servers restored, also on throw | "E-14: o teste E-7/E-8 restaura…" + 2 mutation runs | PASS |

### Probes (child processes, temp cwd, fake `.env` `ep-fake-1…neon.tech`, env = `PATH` only, no connection)

| Launch | Outcome |
|---|---|
| `tsx f.test.ts`; `node --import tsx f.test.ts`; `node --require tsx/cjs --import tsx/esm f.test.ts`; `NODE_OPTIONS=--import tsx node f.test.ts` (VS Code/JetBrains debug shape); `tsx watch f.test.ts`; relative `./f.test.ts` and `../d/f.test.ts` (Node resolves `argv[1]`); `d/src/tests/helper.ts`; symlink `link.test.ts → plain.ts` | refused, `leaked:false` |
| `node --loader tsx` | tsx itself refuses `--loader` (n/a) |
| symlink `run.ts → f.test.ts` (Node keeps the link name in `argv[1]`) | **imported** (E-12c) |
| `f.spec.ts` | **imported** (E-12c; repo has no `.spec.*` today) |
| wrapper `scripts/run.ts` importing a test file; `node -e "import(…)"` | imported — known false negatives listed in D-8 |
| `f.Test.ts` (case) | allowed by predicate; Linux tsx cannot run `.TS` anyway |

IDE "Run file": VS Code js-debug and JetBrains run the file as `argv[1]` with a preload via `NODE_OPTIONS`/`--import` (shape probed above); their node:test runners pass `--test` (step 16). Code Runner `npx tsx file` = row 1. Not run in a real IDE.

False positives: real entries `dist/server.js`, `src/server.ts`, `src/db/seed.ts`, `scripts/simulate-conversation.ts`, `drizzle-kit/bin.cjs`, pm2 `ProcessContainerFork.js` → allowed. No pm2/Procfile/Dockerfile for the app in the repo (`docker-compose.yaml` is Postgres only). **E-12d:** `/srv/src/tests/mariana/dist/server.js` (and `C:\…\src\tests\mariana\…`) → forbidden: the `src`,`tests` segment pair is matched anywhere in the path, not relative to the repo. Effect: the bot would refuse Neon at start-up (loud). Only if deployed under such a parent dir.

E-14 extra: strace of the four module DNS calls + `reverse` with `setServers(["127.0.0.1:1"])` and no guard: every packet went to `127.0.0.1:1` only (12 sends, all `ECONNREFUSED`), so a regressed wrapper cannot reach the system resolver. Residual (known): `dgram.connect(host)` uses `dns.lookup` → getaddrinfo, which ignores `setServers`; reached only if the dgram **and** lookup guards both regress. `new dns.Resolver()` does not inherit `setServers` (probed); the test sets it explicitly.

Mutations (temp copies under `src/tests/`, deleted): throw inside `probeModuleDnsAndDgram` → E-7 fails, E-14 restore test passes (finally works); remove the restore line → E-14 fails `actual ['127.0.0.1:1'] expected ['127.0.0.53']`.

### New findings
- **E-12c (low, planner):** symlinked test file with a non-test name, and `*.spec.*`, evade D-8. Pinned `todo` (spec case).
- **E-12d (low, planner):** false positive when the deploy path has `src/tests` above the repo root. Pinned `todo`. Option: match only relative to the repo root (`path.relative(repoRoot, argv[1])`).

### Scope
Diff = plan step 20 files + E-14 file (`test-network-egress-guard-adversarial.test.ts`, allowed by "Listed only": E-14) + plan/progress. Implementer also changed the existing `probe.cjs` script to `import("node:url")` (needed for the `.mjs` run; existing wiring tests still green). Nothing outside the plan.

### New tests (tester) — `src/tests/test-database-guard-adversarial.test.ts` (end of file)
- "tester E-R3a: todas as extensões .test.* que o tsx executa contam como entrada de teste" (green)
- "tester E-R3a: nomes parecidos com teste não disparam (sem falso positivo)" (green)
- "E-12c: .spec.ts executado direto…" (`todo`), "E-12d: produção num diretório pai que tem src/tests…" (`todo`)

### Suites
- `npm run test:unit` (after tester tests): 344 tests, 338 pass, 0 fail, 6 todo. Before: 340/336/0/4.
- `npm run test:db` (localhost:5432/mariana_test, workers off), twice: 597 tests, 593 pass, 0 fail, 4 todo, exit 0 both; no egress block; flaky `:275` did not fail. (Ran before the tester tests were added; they are pure unit tests.)
- `npx tsc --noEmit`: exit 0 (re-run after tester tests). `npm run build`: success. Biome on the 5 changed files: clean. `git diff --check`: clean.

### Risks not covered
- E-12b, wrapper entry, `node -e`/REPL (listed). E-12c, E-12d (above). Real IDE runs not executed.

### Manual check for Davi (no WhatsApp needed)
1. `npm run dev` still starts and connects normally (entry `src/server.ts`, outside the rule).
2. After deploy, `npm start` (`dist/server.js`) starts normally. If the deploy path contains `.../src/tests/...` above the repo, expect `UnsafeTestDatabaseError` at start-up (E-12d).

## E-R3b + final (tester, 2026-10-27) — step 21 (E-11) and the final Batch E check

### Verdict: step 21 PASS — 0 failures; Batch E overall PASS; 2 new findings (E-11b low, planner; E-16 low–medium, implementer)

Gate: plan line 1 `Status: APPROVED by Davi — "ok eu aprovo" (2026-10-27, Batch E revision 3)`, decision 2 (step 21 now). The implementation matches D-9: a raw-text check before `new URL`, refusing whitespace and control characters anywhere, and `%` in the host or path. `%` stays allowed in the userinfo.

### Criteria → tests → result (step 21)

| Criterion (plan Rev 3, step 21) | Test(s) | Result |
|---|---|---|
| E-11 adversarial `todo` removed, red first | adversarial `:479` "guard recusa URL que o pg lê com outro host ou banco" | PASS. Red confirmed: the 3 URLs are accepted by the `git show HEAD:` guard (temp copy in `/tmp`) |
| Leading/trailing space, tab in host, `\n`, `%5F` in db, `%68` in host refused; no `mariana:mariana` in message | `test-database-guard.test.ts:342` | PASS. Against HEAD: 4 of 6 accepted (red); tab-in-host and `local%68ost` were already refused by 14c (known deviation, harmless) |
| `%40` password still accepted | `test-database-guard.test.ts:331` | PASS |
| Three-way agreement (guard, postgres.js, `pg`), no exceptions | adversarial `:461` (no exception list now) | PASS |
| Stricter only; messages never print the value | diff read; tester `:695`, `:717` | PASS for D-9's own messages (see E-16 for an older message) |
| Fixtures | none changed (`progress.md`) | PASS |

Deviation judged: biome `noControlCharactersInRegex` refuses `/[\s\x00-\x1f\x7f]/`. The implementer wrote `/\s/` plus a code check (`<= 0x1f || === 0x7f`). This is the same set. JS `\s` already covers NBSP, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. Accepted.

### Probes (guard vs WHATWG vs `postgres(url).options` vs `pg-connection-string.parse`, no connection unless noted)

| Input | Guard | Drivers | Verdict |
|---|---|---|---|
| NBSP at end / in host / in password; U+2028 at end; U+2029 in db; BOM at start; U+3000 in password | refused | pg reads a different db or host (`base` for BOM) | OK |
| ZWSP/ZWJ/U+2060 in db name or at end; U+0085, U+009B (C1); U+00AD; U+202E; `é`; `"` in db | **accepted** | WHATWG and postgres.js keep `%E2%80%8B…`; pg decodes to the raw char, so a different database name | **E-11b** (host is still localhost) |
| ZWSP in host | refused (14c host-decode check) | — | OK |
| `%` in port (`54%332`, `%35432`) | refused | all three throw `Invalid URL` | OK |
| `%` in user (`mari%61na`, `u%40x`) | accepted | all three read `mariana` / `u@x` | OK |
| `%25` in password (`p%25w`, `p%2540w`) | accepted | all three read `p%w` / `p%40w` | OK |
| `%25` in host or db | refused | — | OK |
| `%` in query value/key (`dis%61ble`, `ssl%6Dode`), in fragment | accepted | all three agree (localhost:5432/mariana_test) | OK |
| malformed `%` in password (`pa%zz`, `pa%`) | accepted | postgres.js throws `URI malformed`; pg keeps the raw text | fails loudly at connect; risk only |
| `postgresql:mariana:PW@localhost:5432/db` (no `//`) | refused, **message contains the password** | — | **E-16** |
| `/`, `#`, `?` raw in password | refused (`Invalid URL`) | — | OK |

Real connection with a `%40` password (local `mariana-postgres`, `localhost:5432/mariana_test`; temporary role `e11_probe`, password `pa@ss%w`, dropped after):

| URL password part | Guard | postgres.js | pg |
|---|---|---|---|
| `pa%40ss%25w` | accepted | connects as `e11_probe/mariana_test` | connects as `e11_probe/mariana_test` |
| `pa@ss%25w` (raw `@`) | refused (14c) | connects | connects |
| `pa%40ss%w` (lone `%`) | accepted | `URI malformed` | connects |

### New findings

- **E-11b (low, planner).** D-9 checks only for a raw `%`. WHATWG adds the `%` itself when it encodes non-ASCII and some ASCII (`"`) in the path. `pg` decodes it, while postgres.js does not. Effect: `drizzle-kit push` (pg) and the reset (postgres.js) name different local databases. Fail-safe today, same as E-11. Possible fix: refuse any code point above 0x7e in the raw text outside the userinfo, or refuse when `url.pathname` contains `%`. Pinned `todo` adversarial `:769`.
- **E-16 (low–medium, implementer).** Without `//`, WHATWG gives an empty host and the whole `user:pw@host:port/db` lands in `pathname`. The "non-local host (…)" message (since step 14, `a853c3b`) prints `databaseIdentity`, which includes the password. With `ALLOW_REMOTE_TEST_DB=1` the port rule refuses first, and its message does not print the value. It does not apply to `connections.ts`, which throws a constant text. `assertNoAmbiguousCharacters` returns early when `://` is missing. Cheap fix: refuse a URL without `://` before building any message. Pinned `todo` adversarial `:792`. The tester test "mensagens de recusa nunca mostram o userinfo" (`:388`) missed this form.

### Scope
The step 21 diff touches `test-database-guard.ts` (new `assertNoAmbiguousCharacters` + one call), `test-database-guard.test.ts` (1 test) and the adversarial file (E-11 `todo` removed). These are the plan's files. `connections.ts` (comment) and `test-network-egress-guard-adversarial.test.ts` belong to E-R3a (step 20 + E-14), still uncommitted. Nothing outside the plan. `git diff --check`: clean.

### New tests (tester, E-R3b) — `src/tests/test-database-guard-adversarial.test.ts`
- `:695` "tester E-R3b: espaço Unicode (NBSP, U+2028, U+2029, BOM, U+3000) é recusado em qualquer parte" (green; red against HEAD for NBSP)
- `:717` "tester E-R3b: % na porta, %25 no host e %25 no banco são recusados" (green)
- `:732` "tester E-R3b: % no usuário e %25/%40 na senha passam e os três leem o mesmo usuário e senha" (green)
- `:769` "E-11b: …" (`todo`, fails today), `:792` "E-16: …" (`todo`, fails today)

### Suites (final, after the tester tests)
- `npm run test:unit`: exit 0. 350 tests, 343 pass, 0 fail, 7 todo (E-9, E-9b, E-12c, E-12d, E-15, E-11b, E-16).
- `npm run test:db` (`TEST_DATABASE_URL` host `localhost:5432`, db `mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`), twice: exit 0 both times. 607 tests, 600 pass, 0 fail, 7 todo. No blocked-egress line. Flaky `:275` did not fail.
- `npx tsc --noEmit`: exit 0. `npm run build`: success (`dist/server.js`). Biome on the 5 changed `src/` files: clean.

### Risks not covered
- E-11b and E-16 (above). A malformed `%` in the password is accepted, and postgres.js throws at connect (loud).
- The open items in the summary table at the top.

### Manual check for Davi (no WhatsApp needed)
1. If your `.env` `TEST_DATABASE_URL` is quoted with a trailing space, `npm run test:db` now stops with "contains whitespace or a control character". Remove the space.
2. `npm run dev` and `npm start` start normally (step 21 changes only the test guard).

## E-16 fix verification (tester, 2026-10-27)

Gate: `plan.md:1` `Status: APPROVED by Davi — "ok eu aprovo" (2026-10-27, Batch E revision 3)`. The fix is a defect fix inside step 14.

### Verdict: FAIL — 1 finding (E-16b, low, implementer). E-16 as reported is closed.

### Criteria → tests → result

| Criterion | Evidence / test | Result |
|---|---|---|
| No `//` after scheme (`postgresql:u:pw@…`, `postgresql:/…`) refused without the password | adversarial `:794`, `:813`; probe | PASS |
| Empty host (`postgresql:///u:pw@…`, `postgresql:////…`, `postgresql://u:pw@`, `@:5432/db`) refused clean | adversarial `:813`, `:971`; probe | PASS |
| `new URL` TypeError `cause.input` cleared; `inspect(err, {depth:10})`, `err.stack`, `cause.stack` clean | adversarial `:813`, `:971` (`ho^st`, `[::1`, port 99999) | PASS |
| `JSON.stringify(err)` clean | adversarial `:971` (gives `{"name":"UnsafeTestDatabaseError"}`) | PASS |
| Invalid percent-encoding (`%zz` in host, path) refused clean; in password accepted (as before) | adversarial `:971`; probe | PASS |
| IPv6 (`[::1]`, `[2001:db8::1]`, unclosed `[::1`) | adversarial `:813`, `:971` | PASS |
| Password with `@` (refused, 14c), `:` (accepted), `/` non-numeric prefix (refused clean), `#` (refused clean) | adversarial `:971` | PASS |
| Password with `/` or `?` after a digits-only prefix | adversarial `:930` (`todo`, fails) | **FAIL — E-16b** |
| `console.warn` with ALLOW_REMOTE_TEST_DB=1 never prints the password | adversarial `:813` (normal form); `:930` (E-16b form leaks) | **FAIL — E-16b** |
| `describeDatabaseHost` (used by `setup-test-db.ts:23`, `:47`) never prints the password | probe: `postgresql://u:1234/x…@localhost:5432/db` → `u:1234/x…@localhost:5432/db` | **FAIL — E-16b** |
| Scope | E-16 hunks only in `test-database-guard.ts` (`parsePostgresUrl`: `SCHEME_WITH_AUTHORITY`, `input` clear, empty `hostname`) and the guard test files. Other diff hunks (`connections.ts` comment, egress adversarial, `isTestEntryScript`, `assertNoAmbiguousCharacters`) are E-R3a/E-R3b, already verified. The two extras (empty host, `cause.input`) are the same defect class inside step 14 | PASS |

### Failure: E-16b
- Command: `npx tsx --import ./src/tests/support/unit-test-preload.ts --test --test-name-pattern="E-16b" src/tests/test-database-guard-adversarial.test.ts`
- Output: `AssertionError: TEST_DATABASE_URL points at a non-local host (u:1234/C4n4ryPw9x@localhost:5432/db). …`
- Other outputs (probe): ALLOW_REMOTE_TEST_DB=1 + `postgresql://u:1234/x<C>@db` is **accepted** and warns `…RESET the remote database u:1234/x<C>@db.`; `postgresql://u:1234?x<C>@localhost:5432/db` → `has a "x<C>@localhost:5432/db" query parameter`.
- Expected: no output contains any part of the password. Actual: the part after `/` or `?` is printed.
- Cause: WHATWG ends the authority at the first `/`, `?` or `#`. With a digits-only prefix, `u:1234` parses as host `u` and port `1234`, so the userinfo moves into the path or query. `assertDriverReadsSameHost` agrees (raw authority is also `u:1234`), so nothing refuses before `databaseIdentity` or the query-key message.
- Suggested fix (implementer): before any message, refuse a raw value with an `@` after the authority end (in path, query or fragment), with a constant message. A database name or query key never needs `@`.

### Other finding: E-17 (not caused by the diff)
- `npm run test:db` run 2: `✖ um turno emite exatamente uma linha mariana_turn…` at `src/tests/services/generate-mariana-response.test.ts:936` (`assert.equal(ELEVEN_DIGITS_IN_LINE.test(line), false)`, `true !== false`). The file is not in the diff; 6 isolated reruns passed. Likely an 11-digit run inside a random UUID in the trace line. Low, test only.

### New tests (tester) — `src/tests/test-database-guard-adversarial.test.ts`
- `:930` "E-16b: senha com / ou ? sem codificar não aparece em nenhuma saída" (`todo`, fails today)
- `:971` "E-16: mensagem, stack, inspect e JSON do erro não mostram a senha" (green; the no-`//` and `////` cases leak against HEAD per the implementer red)

### Suites
- `npm run test:unit`: exit 0. 353 tests, 346 pass, 0 fail, 7 todo.
- `npm run test:db` (host `localhost:5432`, db `mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`): run 1 exit 0 (610 tests, 603 pass, 0 fail, 7 todo); run 2 exit 1 (602 pass, 1 fail = E-17). Flaky `:275` did not fail.
- `npx tsc --noEmit`: exit 0. `npm run build`: success. Biome on the 3 guard files: clean. `git diff --check`: clean.

### Risks not covered
- E-16b until fixed. A password with `%zz` is still accepted, and postgres.js throws at connect (loud, older note).
- The postgres.js / drizzle-kit error output on a connect failure is outside the guard. `setup-test-db.ts:47` redacts only the exact `testUrl`.

### Manual check for Davi (no WhatsApp needed)
1. `TEST_DATABASE_URL=postgresql:mariana:mariana@localhost:5432/mariana_test npm run test:db` stops with "must be a postgresql:// URL" and does not print `mariana:mariana`.
2. `npm run dev` / `npm start` start normally (the fix only touches the test guard).

## E-16b fix verification (tester, 2026-10-27)

Gate: `plan.md:1` `Status: APPROVED by Davi — "ok eu aprovo" (2026-10-27, Batch E revision 3)`. Defect fix inside step 14.

### Verdict: PASS — 0 failures; no new findings

### Criteria → tests → result

| Criterion | Evidence / test | Result |
|---|---|---|
| E-16b forms (`u:1234/<pw>@localhost`, `u:1234/<pw>@db`, `u:1234?<pw>@localhost`), with and without ALLOW_REMOTE_TEST_DB=1, plus `describeDatabaseHost` | adversarial `:930` (no longer `todo`); probe | PASS |
| Raw `/`, `?`, `#` in the password, numeric or non-numeric prefix, empty prefix (`u:/pw@`), trailing (`u:pw/@`), IPv6 host, `postgres:` and uppercase scheme | adversarial `:1022` (constant `"@" after its host` message; message, `inspect`, `console.warn`, `describeDatabaseHost` clean); probe | PASS |
| Red without the fix | temp copy of the guard with the E-16b block removed (outside the repo): `u:1234/<C>@localhost`, `u:1234?<C>@…` (both ALLOW values), `u:1234/<C>@[::1]`, `u:5432/<C>@localhost` print the canary | PASS (test is meaningful) |
| Raw `\` in the password | probe: accepted; guard, postgres.js and pg read the same password (`postgresql:` is a non-special scheme, so `\` is not a delimiter); `:1072` | PASS |
| Password `1234`, `12%2F34`, `%2F`, `%3F`, `%40`, `%23`, `%5C` on `localhost` / `127.0.0.1` accepted; guard (WHATWG), `postgres(url).options` and `pg-connection-string.parse` read the same password, host, port and database | adversarial `:1072`; probe (also `[::1]`: same password, postgres.js host `[`, known since 14b, fails safe) | PASS |
| Userinfo without a password (`u@`, `u:@`) accepted | adversarial `:1103` | PASS |
| `:pw@` (empty user) | probe: accepted; postgres.js falls back to the OS user, pg to `""` (pg then uses `USER`). Not a leak; the guard never cites userinfo | PASS (note) |
| Scope | E-16b hunk only in `parsePostgresUrl` (`test-database-guard.ts`) and the removed `todo` at adversarial `:930` | PASS |

### Probe notes (not findings)
- A URL with no `@` at all (`postgresql://u:1234/<x>`, `?<x>`) prints `<x>` as the database name or query key. Every parser reads it as host `u`, port 1234, database `<x>`; there is no userinfo, so no password. With ALLOW_REMOTE_TEST_DB=1 it is accepted as remote host `u` (warning shown).
- `describeDatabaseHost` does not run the E-11 `%` check, so `u:1234/<x>%40localhost:5432/db` returns `u:1234/<x>%40localhost…`. Same reason: no raw `@`, so `<x>` is a path for every parser. `assertSafeTestDatabaseUrl` refuses it.

### New tests (tester) — `src/tests/test-database-guard-adversarial.test.ts`
- `:1022` "tester E-16b: senha com /, ? ou # cru é recusada sem mostrar a senha"
- `:1072` "tester E-16b: senha com %40, %2F, %3F ou só dígitos passa e os três leem igual"
- `:1103` "tester E-16b: userinfo sem senha é aceito"

### Suites
- `npm run test:unit`: exit 0. 356 tests, 350 pass, 0 fail, 6 todo.
- `npm run test:db` (host `localhost:5432`, db `mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`): run 1 exit 0, run 2 exit 0 (each 613 tests, 607 pass, 0 fail, 6 todo). Flaky `:275` and `:936` did not fail.
- `npx tsc --noEmit`: exit 0. `npm run build`: exit 0. Biome on the 3 guard files: clean. `git diff --check`: clean.

### Risks not covered
- Unchanged from "E-16 fix verification": driver error output on connect failure is outside the guard; a `%zz` password is accepted and postgres.js throws at connect (loud).
- The new rule refuses a legitimate `@` in a database name or query value. No current URL needs one (stricter only).

### Manual check for Davi (no WhatsApp needed)
1. `TEST_DATABASE_URL='postgresql://mariana:1234/x@localhost:5432/mariana_test' npm run test:db` stops with `has an "@" after its host` and prints neither `1234/x` nor `x@localhost`.
2. `npm run test:db` with the normal `postgresql://mariana:mariana@localhost:5432/mariana_test` runs as before.
