# Baseline report — 2026-10-26-flow-review

- Mode: BASELINE. No plan exists, so no tests were added and no product code was touched.
- Tree: `develop` @ `03afdc2`, untouched. The only untracked files are `docs/specs/MARIANA_BEHAVIOR_SPEC.md` and `mariana_spec.md`.
- Date: 2026-10-26.

## Verdict: PASS (baseline green, 0 failures)

## Suites

| Command | Result | Tests | Pass | Fail |
|---|---|---|---|---|
| `npm run test:unit -- --test-reporter=dot` | exit 0 | 253 | 253 | 0 |
| `npx tsc --noEmit` | exit 0, no output | n/a | n/a | 0 errors |
| `npm run build` (tsup) | exit 0, `dist/server.js 1.43 MB` | n/a | n/a | n/a |
| `npm run test:db -- --test-reporter=dot`, run 1 | exit 0 (13.3 s) | 510 | 510 | 0 |
| `npm run test:db -- --test-reporter=dot`, run 2 | exit 0 (12.9 s) | 510 | 510 | 0 |

- Failing tests: none.
- The DB log contains expected noise from failure-path tests (`[WhatsAppClient] Error sending message`, `Send timed out after 50ms`, `{"error":"Unauthorized"}`). These come from mocked transport errors. They are not failures.

## DB safety checks

- Target: host `localhost:5432`, database `mariana_test`. This is the disposable DB on the Docker container `mariana-postgres` (default Docker context). The password was not printed.
- The target is not on `neon.tech`. It is not equal to `DATABASE_URL`, which is the Neon pooler host `ep-red-glade-...neon.tech/neondb`.
- `RELIABILITY_WORKERS_ENABLED=false` was exported for both runs.
- No `npm run dev` / `tsx watch src/server.ts` process was running (checked with `pgrep`).
- The `mariana` database on the same container was not used.

## K4 — test files not covered by the suites

- `src/tests/` has 74 `*.test.ts` files plus `src/tests/support/drizzle.test.config.ts`. That file is a Drizzle config, not a test.
- `test:db` runs the glob `src/tests/**/*.test.ts`. That glob covers all 74 test files.
- **No test file is uncovered by both suites.**
- No `*.test.*` or `*.spec.*` files exist outside `src/tests/`, in either `src/` or `scripts/`.
- No entry in the explicit `test:unit` list is missing on disk.
- 39 test files run only in `test:db` because the `test:unit` list does not include them:
  - `commercial-identity`, `lead-persistence`, `session-inactivity-regression`, `urgency-schema`
  - `reliability/`: `active-conversation`, `autonomous-task-executor`, `handler-partial-failure`, `inbound-batch-claim`, `model-failure`, `outbound-messages`, `outbound-persistence-failure`, `session-choice-{adversarial,concurrency,continue,gate,handlers,invalid-replies,isolation,new,store}`
  - `routes/`: `webhook-google-ads`, `webhook-meta-ads`, `webhook-whatsapp`
  - `services/`: `appointment-service`, `calendar-availability`, `consultant-availability`, `conversation-simulator`, `generate-mariana-response`, `lead-ingestion`, `objective-flow-matrix`, `objective-flow`, `phase3-scheduling-workflow`, `qualification-fallback-loop`, `scheduling-{cancellation-service,choice-service,confirmation-orchestrator,confirmation-service,session}`, `turn-trace-integration`
- Risk: the `test:unit` list is maintained by hand. A new DB-free test file that nobody adds to the list runs only in `test:db`. This baseline did not check whether any of the 39 files is actually DB-free.

## Not run

- Biome / `git diff --check`: there is no diff to check.
- `npm run sim:conversation`: forbidden (it calls the real Gemini API).
- Manual WhatsApp checklist: not applicable in baseline mode.
