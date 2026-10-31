# 2026-10-27-scheduling-loop — test report

## Batch A (steps 1–2)

**Verdict: FAIL** — 2 blocking failures (F-A1, F-A2), 1 flaky new test (F-A3), 2 minor notes.

Plan status: `APPROVED by Davi` (Q1 text A, Q2, Q4). Diff touches only files the plan lists (`turn-trace.ts`, `generateMarianaResponse.ts`, `autonomous-task-executor.ts`, helper `src/lib/error-classification.ts`, `google-calendar-errors.ts`, `consultant-availability.ts`, `calendar-unavailable-notice.ts`, `package.json` test:unit, `docs/CODEMAP.md`). No unapproved change found.

### Criteria → tests → result

| Criterion | Test(s) | Result |
|---|---|---|
| Step 1: failure trace carries errorName/errorCode, digits masked | `turn-trace.test.ts` (+2); `turn-trace-integration.test.ts` "turno com erro de banco…" | PASS (flaky, F-A3) |
| Step 1: executor logs real error, no payload | `autonomous-task-executor.test.ts` "falha de handler loga…", "falha terminal…" | PASS |
| R-REL-07: log/trace never carries customer text, token, email | `error-classification-adversarial.test.ts` (new), `services/error-log-pii-db.test.ts` (new) | **FAIL** (F-A1, F-A2) — kept as `todo` |
| R-REL-05: real error appears in the logs (Calendar-unavailable path) | `calendar-failure-adversarial.test.ts` "erro não-OAuth: o erro real aparece no log" (new) | **FAIL** (F-A2b) — `todo` |
| Step 2 / Q1: text A word for word | `calendar-unavailable-notice.test.ts` | PASS |
| Text A does not arm `accepted_pending_offer`, no commitment pattern | same | PASS |
| R-REL-05 / S-17 analogue: reply on attempt 1, 1 Gemini call, no retry | `calendar-failure.test.ts` "Calendar invalid_grant…"; adversarial "uma chamada por consultor ativo, sem retry" (new) | PASS |
| Idempotent on redelivery (same runKey) | `calendar-failure.test.ts` "redelivery…" | PASS (see deviation D-2) |
| Step 28/37/40 guards: conversation closed during Calendar → no outbox | adversarial "conversa fechada durante o Calendar" (new) | PASS |
| Two messages in one debounce window → one notice, one model call | adversarial "duas mensagens na mesma janela" (new) | PASS |
| Tests are meaningful | mutation: catch disabled (`if (true)`) in `generateMarianaResponse.ts` → all 5 Calendar tests red; file restored, sha256 OK | PASS |
| Repro v2 `fail` | model calls 3 total (last turn 1); last task completed attempts=1; outbox text A once; no session; lead interested=true; 1 invalid_grant log line | matches progress.md |
| Repro v2 `fail_one` | model calls 7 (last turn 5); task attempts=5 failed; no outbox for the turn; 5 log lines `autonomous_task_*` with `google_invalid_grant`, no payload | matches progress.md (step 5 pending) |

### Suites
- `npm run test:unit`: 366 tests, 360 pass, 0 fail, 6 todo.
- `npm run test:db` (localhost/mariana_test) run 1: 718, 706 pass, **1 fail** (F-A3), 11 todo. Run 2: 718, 707 pass, 0 fail, 11 todo. Todo = 6 pre-existing + 5 new tester todos.
- `npx tsc --noEmit`: exit 0. `npm run build`: success. `git diff --check`: clean. biome on all changed and new files: clean.

### Failures

**F-A1 — real Drizzle errors leak customer data into logs and traces (R-REL-07). Owner: implementer.**
- Command: `npx tsx --import ./src/tests/support/db-test-preload.ts --test src/tests/services/error-log-pii-db.test.ts` (remove the `todo`).
- Actual `errorMessage` from a real local query: `Failed query: update "leads" set "name" = $1, "status" = $2 where "leads"."id" = $3\nparams: Fulana Sigilosa,bogus,98a5ad44-…`.
- Expected: no customer name or text. Drizzle 1.0 `DrizzleQueryError` (`node_modules/drizzle-orm/errors.js:15`) embeds `params:` in `message`. `maskErrorMessage` masks only digit runs of 8+. Short queries, such as the lead update from `updateLeadFromAgent`, put name, objective or pain point within the 200-char limit. This reaches `mariana_turn` (`emitFailureTrace`) and `autonomous_task_failed`/`retry_scheduled`.
- Suggested fix: for `DrizzleQueryError` (or any message with `\nparams:`), drop everything from `\nparams:` on. Prefer `cause.message` plus the SQLSTATE.

**F-A2 — masking ignores tokens, emails and API keys (plan: "never a token or an email"). Owner: implementer, low severity.**
- Command: `npx tsx --import ./src/tests/support/unit-test-preload.ts --test src/tests/error-classification-adversarial.test.ts` (remove the `todo`s).
- Actual: `1//0g…` refresh token, `ya29.…` access token, `…@example.com` and `AIza…` key pass through unchanged. Today's gaxios `invalid_grant` message is just `invalid_grant`, so real exposure is unlikely. There is no defence in depth, though.

**F-A2b — the Calendar-unavailable path loses the real error (R-REL-05). Owner: planner (design said only "failure count"), then implementer.**
- Command: `npx tsx --import ./src/tests/support/db-test-preload.ts --test src/tests/reliability/calendar-failure-adversarial.test.ts` (remove the `todo`).
- Actual, for `getaddrinfo ENOTFOUND` on every consultant: `{"errorCodes":["unknown","unknown","unknown"],"event":"scheduling_calendar_unavailable","failureCount":3,…}`. The task completes, so no executor line is written. The trace is `replied` with no error fields. Any non-`invalid_grant` cause (403, quota, DNS, timeout) is invisible.
- Expected: each failure's `describeError` (name and masked message) in the log.

**F-A3 — new integration test is flaky. Owner: implementer.**
- `turn-trace-integration.test.ts:391` `assert.equal(ELEVEN_DIGITS.test(line), false)` failed in test:db run 1 (`true !== false`) and passed in run 2.
- Suspected cause: the trace line holds the random `leadId`/`conversationId` UUIDs. A UUID's last 12-hex group is all digits for 11 or more chars with about 1% chance per UUID. Assert on `phone` (already done) or strip UUIDs before the regex. Several older tests use the same pattern with the same risk.

### Deviations (judged)
- D-1 `google-calendar-errors.ts` was created in step 1, and `CalendarAuthError` is deferred to step 4/5. Acceptable: there is no consumer yet.
- D-2 The redelivery test resets the completed task to `pending`. Acceptable: it exercises the real guard (the handler's `existingOutbound` runKey check, `autonomous-task-handlers.ts:284-293`). The webhook-level duplicate (`externalId` unique) is a separate, pre-existing layer. The test does not cover a crash between the assistant-row update and the outbox insert: that path creates a new assistant row on retry (follow-up F-2).
- D-3 Partial failure rethrows the first error (`consultant-availability.ts:97-99`). This matches the plan (isolation is step 5). `fail_one` still burns 5 Gemini calls until step 5.

### Notes (not blocking)
- N-1 The notice's assistant row update (`db.update`, outside a tx, `generateMarianaResponse.ts` no-slot branch) and the outbox insert (handler tx with lead lock and active check) are NOT in one transaction. This is the same pre-existing pattern as the no-slot text, and the plan chose it. Lock order (lead first) and the active re-check are kept. Strictly, R-REL-06 is not met for this pair.
- N-2 `postgresCode` regex `^[0-9A-Z]{5}$` also matches 5-letter Node codes (`EPIPE`, `EPERM`), so it logs `pg_EPIPE`. This is a misclassification only.
- N-3 The superseded trace now carries `errorName=TurnSupersededError`, `errorCode=unknown`. Harmless.

### New tests added by the tester
- `src/tests/error-classification-adversarial.test.ts`: 5 tests (1 pass, 4 `todo` = F-A1/F-A2). Runs in `test:db`/`npm test` (glob). It is not in `test:unit`, because the tester may not edit `package.json`.
- `src/tests/services/error-log-pii-db.test.ts`: 1 `todo` (F-A1, real local query).
- `src/tests/reliability/calendar-failure-adversarial.test.ts`: 3 pass (closed conversation, debounce window, one call per consultant and no retry) and 1 `todo` (F-A2b).
- Remove each `todo` when its fix lands. Each must then pass.

### Risks not covered
- A crash between the turn commit and the outbox insert leaves an unsent assistant row (F-2).
- After text A, `interestedInConsultant=true` persists. The next turn may try the offer again and fail again. It answers text A each time (intended), but there is no alert to ops.
- Real gaxios/Google error shapes are not exercised. Only fakes are used.

### Manual WhatsApp checklist (owner, local or staging only, never with Neon writes from tests)
1. Revoke the Google refresh token of every consultant (or point to a bad one). Restart.
2. Send "oi". Expect the greeting and the objective question.
3. Answer the qualification until Mariana asks "Você quer que eu procure um horário para conversar com um consultor?".
4. Send "sim por favor". Expect exactly once: "Desculpe, tive um problema para consultar a agenda dos consultores agora. Me mande uma mensagem daqui a pouco que eu tento de novo."
5. Check the logs: one `scheduling_calendar_unavailable` line with `google_invalid_grant`, and no phone, token or email in it. Check the task: `completed`, attempts=1.
6. Send nothing for 1 minute. Expect no second message and no retry.
7. Send "oi, tenta de novo". Expect text A again (Calendar still broken), and no time-slot buttons.

## Batch A re-check (F-A1, F-A2, F-A2b, F-A3)

**Verdict: PASS.** 0 blocking failures. 1 non-blocking failure (F-R1, an older flaky test that Batch A did not cause). Low-severity masking gaps are listed in N-4.

Plan: `APPROVED by Davi`. The diff touches only planned files and test files. D-4: the `scheduling_calendar_unavailable` field `errorCodes` was replaced by `failures[]` = `{consultantId, errorCode, errorName, errorMessage?}`. This is the F-A2b fix that the report asked for, and nothing else consumes `errorCodes`. Customer text A is unchanged: `calendar-unavailable-notice.ts` has no diff vs HEAD and matches plan Q1 word for word.

### Criteria → tests → result
| Criterion | Test(s) / evidence | Result |
|---|---|---|
| F-A1: Drizzle query and params never logged | `error-log-pii-db.test.ts` (real 22P02); new `error-log-pii-adversarial-db.test.ts` "unique violation real (23505)…" | PASS |
| R-REL-07 via real executor (`autonomous_task_failed`): unicode name, email, phone, pain point, sourceLeadId | new file: 23505 (params), 23503 FK (jsonb payload in params, no `Key (`), wrapped `cause` (pg_22P02 from chain, top message only) | PASS |
| Non-Error throws: string with email and phone; object with PII | new file: string (masked), object (`[object Object]`) | PASS |
| Postgres `Key (phone)=(…)` / DETAIL inline / quoted values | probe + `error-classification.test.ts` | PASS: `=(***)`, `: "***"` |
| F-A2: Bearer, `ya29.`, `1//`, `AIza`, ASCII email, `*_token=`, `client_secret:`, `Authorization: Basic`, PG URL password | `error-classification(-adversarial).test.ts` + probe | PASS (masked, or `errorMessage` omitted) |
| F-A2b: 403, timeout and DNS codes, using real gaxios 7.3.1 `GaxiosError` (fake `fetchImplementation`, no network) | probe: 403 → `google_forbidden` (email in the message masked); `timeout: 20` → `google_timeout`; `TypeError fetch failed`+`ENOTFOUND` cause → `network_dns`; invalid_grant → `google_invalid_grant` | PASS |
| F-A2b: real error per consultant in the log | `calendar-failure.test.ts` "o log … traz o erro mascarado"; adversarial ENOTFOUND (todo removed) | PASS |
| F-A3 at `turn-trace-integration.test.ts:402` | 30 isolated runs | PASS 30/30 |
| Same risk at `:295` (L11 test) | 30 isolated runs | **FAIL 1/30** (F-R1) |
| Tests are meaningful | HEAD `error-classification.ts` swapped in temporarily: the new 23505 and string-throw tests went red; file restored (sha256 OK) | PASS |

### Suites (TEST_DATABASE_URL host=localhost, db=mariana_test; RELIABILITY_WORKERS_ENABLED=false; DOTENV_CONFIG_PATH=/dev/null)
- `test:unit`: 377 tests, 0 fail, 6 todo. `tsc --noEmit`: 0. `build`: 0. `git diff --check`: clean. biome on changed and new files: clean.
- `test:db` run 1: 731 tests, 725 pass, 0 fail, 6 todo. Run 2: the same.

### Failures
**F-R1: `turn-trace-integration.test.ts:295` is flaky (the F-A3 risk is confirmed). Owner: implementer. Non-blocking, older test.**
- Command (30 times): `npx tsx --import ./src/tests/support/db-test-preload.ts --test --test-reporter=dot --test-name-pattern="L11 é registrada e encadeada|turno com erro de banco" src/tests/services/turn-trace-integration.test.ts`
- Result: 1 of 30 failed at `:295` with `true !== false`. `:402` passed 30/30.
- Cause: `ELEVEN_DIGITS.test(line)` runs on the raw line, which holds random UUIDs and 12-hex hashes. Fix: `withoutIds(line)`, as at `:402`. The same unguarded pattern exists at `generate-mariana-response.test.ts:934`. `turn-trace.test.ts:123,230` may have it too, if those IDs are random.

### Notes
- N-2 is still open and reproduced: `{code:"EPIPE"}` gives `pg_EPIPE`. 5-letter Node codes (`EPIPE`, `EPERM`, `EBUSY`) match `^[0-9A-Z]{5}$`. Suggestion: require a digit, or check `error.severity` / `instanceof DatabaseError`.
- N-4: masking gaps, low severity. None of these shapes appears in the real Drizzle, pg or gaxios errors probed:
  - an IDN email `josé@exemplo.com` is not masked at all;
  - `joão.silva@x.com` becomes `joã***@***`, a partial leak;
  - a URL-encoded email `joao%40gmail.com` is not masked;
  - formatted phones `(21) 98765-4321`, `+55 21 98765-4321` and `9876-5432` are not masked;
  - single-quoted values `'Fulana'` and a formatted CPF `123.456.789-00` are not masked;
  - a name in a free-text message, a thrown string or a custom `toString()` passes through, and no regex can catch that.
- N-5: classification is too broad. Any `AbortError` (a manual abort, from any library) gives `google_timeout`. Any status 403 (WhatsApp, for example) gives `google_forbidden`. The cause chain is capped at 4: a DNS error 5 levels deep gives `unknown`.
- N-7 (pre-existing, outside the log scope): `autonomous_tasks.lastError` (`autonomous-task-executor.ts:199`) still stores the raw `error.message`. Drizzle params with customer data are persisted in the DB.

### New tests added by the tester (re-check)
- `src/tests/services/error-log-pii-adversarial-db.test.ts` (5 DB tests, all pass). It runs through the `test:db` glob.

### Manual checklist delta
- Step 5: the log line now has `failures[]` with `consultantId` and `errorCode` per consultant (no top-level `errorCodes`). Expect `google_invalid_grant` per consultant, and no phone, token or email in it.

## Batch B — step 3 (bound retries, last-attempt notice)

**Verdict: PASS** (0 blocking failures). Plan `Status: APPROVED by Davi`; Q2 = 3 and Q4 = `failed` are both implemented as approved.

### Scope
- Product diff touches only the plan's files: `src/routes/whatsapp/webhook-whatsapp.ts` (enqueueTask), `src/services/conversations/autonomous-task-handlers.ts` (constant, notice helper, inbound catch). Tests: `handler-partial-failure.test.ts` (plan file) and the tester's new file. No unapproved change.

### Criteria → tests → result
| Criterion | Test(s) | Result |
|---|---|---|
| Non-model error on last attempt: notice once, task `failed`, error visible | handler-partial-failure "erro não-modelo na última tentativa…" | PASS |
| Intermediate attempt sends nothing, retries | handler-partial-failure "erro em tentativa intermediária…" | PASS |
| `process_inbound_message` born with maxAttempts = 3 (Q2) | handler-partial-failure "task de entrada nasce com maxAttempts = N" | PASS |
| Other task types keep default 5 | final-attempt-adversarial "só process_inbound_message nasce com maxAttempts = 3…" | PASS (new) |
| Closed conversation on last attempt: no notice | handler-partial-failure "conversa fechada na última tentativa…" | PASS |
| Lead locked first; conversation re-read as active under the lock | final-attempt-adversarial "o aviso da última tentativa espera o lock do lead…" (holder tx locks lead, closes conversation while notice waits; pg_blocking_pids proves the wait) | PASS (new) |
| Same runKey re-run / redelivery: no second notice | handler-partial-failure (same task re-run); final-attempt-adversarial "redelivery do webhook depois da task falhar…" (enqueueTask onConflictDoUpdate resets attempts=0; 4 more runs; 1 Gemini call, 1 notice) | PASS (new) |
| Model error on last attempt unchanged (completed, 1 notice) | final-attempt-adversarial "falha do modelo na última tentativa…"; model-failure.test.ts (unchanged) | PASS (new) |
| TurnSupersededError on last attempt unchanged (completed, no notice) | final-attempt-adversarial "turno superado na última tentativa…" | PASS (new) |
| Batch A text A on last attempt: completed, no last-attempt notice | final-attempt-adversarial "Calendar fora na última tentativa…" | PASS (new) |
| Outbound possibly accepted by Meta never back to `pending` | final-attempt-adversarial "outbound da runKey já em `unknown`…" (row stays `unknown`, payload unchanged) | PASS (new) |
| Notice cannot arm accepted_pending_offer | model-failure-notice.test.ts `detectPendingOffer(MODEL_FAILURE_NOTICE) === null` (same text reused) | PASS |
| No PII/secrets in new log | review: `mariana_final_attempt_notice` logs attempts, conversationId, leadId only (same fields as `mariana_model_failure`) | PASS |

### Suites (host=localhost:5432, db=mariana_test; RELIABILITY_WORKERS_ENABLED=false; DOTENV_CONFIG_PATH=/dev/null)
- `test:unit`: 377 tests, 0 fail, 6 todo. `tsc --noEmit`: ok. `build`: ok.
- `test:db` x2: 742 tests, 736 pass, 0 fail, 6 todo, both runs (735 + 7 new).
- biome on the 4 files: clean (after formatting the tester's new file). `git diff --check`: clean.

### Implementer choices (judged)
- Reusing `MODEL_FAILURE_NOTICE`: accepted. It is owner-approved, pinned by an exact-text test, has no offer marker and no scheduling promise, and "pode me enviar de novo" stays true because nothing retries after the last attempt. Nit: its doc comment in `model-failure-notice.ts` says "a task é concluída"; on this path the task ends `failed`. The claim "nada vai tentar de novo" still holds. Doc wording only.
- Closed conversation on last attempt ends `failed`: accepted. It matches Q4 (error stays visible) and the plan says only "não envia aviso". It differs from the model path (`completed`/skipped). That is acceptable because here the root error is not caused by the closure. Note: messages are not marked processed on this path. That is harmless: the conversation is closed, and the task cannot be re-claimed.

### Non-blocking notes
- N-B1: The cap covers only errors thrown by `generateMarianaResponse`. An error after the turn (outbox transaction in the handler, `autonomous-task-handlers.ts` after the catch) on attempt 3 still ends `failed` with no notice. Plan scope is `:315-336`, so this is not a deviation.
- N-B2: If the process dies during attempt 3, `recoverStaleAutonomousTasks` marks it `failed` with no notice (attempts = max). This is a rare path.
- N-B3: If an outbound with the same runKey appears during the turn, the notice still inserts an orphan assistant `messages` row (the outbox stays correct). This is pre-existing, shared with the model-failure path.
- N-B4: A non-model error after `generateMarianaResponse` committed its action transaction (e.g. the post-commit `isConversationActive` read fails) would add the notice next to an already-persisted assistant reply. This is pre-existing, and retries already duplicated the turn before this change.
- N-B5: `onConflictDoUpdate` in `enqueueTask` does not reset `maxAttempts`, so tasks created before deploy keep 5. That is fine.
- N-B6: The new JSDoc block sits between the old JSDoc and `sendModelFailureNotice`, so the older block is detached from the function (style only).

### New tests added by the tester
- `src/tests/reliability/final-attempt-adversarial.test.ts` (7 DB tests, all pass; picked up by the `test:db` glob).

### Manual WhatsApp checklist delta (local/staging only)
- Force a guardrail error on every attempt, e.g. a local stub that makes the model reply "Somos a Ademicon". Send "quero fazer um consórcio". Expect no reply on attempts 1-2. After attempt 3, expect exactly one "Desculpe, tive uma falha técnica aqui e não consegui processar sua mensagem agora. Pode me enviar de novo em alguns instantes?". The task row should be `failed`, attempts=3, and `lastError` should hold the guardrail message.
- Re-send the same webhook payload (same wamid). Expect no second message.
- Then send "oi" normally (stub removed). Expect a normal reply. The notice does not arm a consultant offer.

## Batch C — steps 4–5 (per-consultant token, broken consultants out of the draw)

**Verdict: PASS** (0 blocking failures). Plan `Status: APPROVED by Davi`; Q3 = one connection per consultant.

### Criteria → tests → result
| Criterion | Test(s) | Result |
|---|---|---|
| getBusyPeriods uses the asked consultant's token, not the first row | DB `integrations/google-calendar-service.test.ts` "getBusyPeriods usa a conexão do consultor pedido…" | PASS |
| createEvent / deleteEvent use the asked consultant's token | tester `services/calendar-per-consultant-adversarial.test.ts` "createEvent e deleteEvent usam o token…" | PASS |
| Booking/cancel pass the slot's consultantId (check, create, compensation) | DB `appointment-service.test.ts` "reserva passa o consultantId do slot…"; orchestrator passes `confirmationResult.slot.consultantId` (`scheduling-confirmation-orchestrator.ts:171`) | PASS |
| No row → `not_connected`, out of draw, 1 log line per offer, no token | DB `google-calendar-service.test.ts` (2nd); unit `consultant-availability-draw.test.ts` "consultor sem linha…" | PASS |
| invalid_grant → only that connection marked | draw "invalid_grant sai do sorteio…"; tester "invalid_grant de um consultor não marca a conexão do outro" | PASS |
| Marked consultant gets no further Google call (offer and booking) | draw "consultor marcado não recebe nova chamada"; tester "consultor marcado não recebe createEvent nem deleteEvent" | PASS |
| Re-auth (new updatedAt) restores without restart | draw "reautorização (updatedAt novo)…"; `auth-google.ts:158-163` upsert sets `updatedAt` | PASS |
| Non-invalid_grant error: skip this offer only, logged, not marked | tester "erro que não é invalid_grant não marca…" | PASS |
| Reauth log: consultantId, never token | draw "log de reauth…"; tester "erro de auth e logs nunca trazem o token" (also `JSON.stringify(error)`) | PASS |
| Partial failure: offer only from healthy, 1 model call, attempts=1 | DB `calendar-failure.test.ts` "2 consultores, 1 com invalid_grant…"; repro `fail_one` | PASS |
| Only verified-free slots offered | tester "falha parcial com o saudável ocupado → nenhum horário" | PASS |
| All failed → Batch A text A | draw "todos quebrados → CalendarUnavailableError"; repro `fail` | PASS |
| selectedSlotId confirm rule unchanged | no diff in `scheduling-{choice,confirmation}-service.ts`; existing DB suite green | PASS |
| No write to tokens/`consultants`; no drizzle change | `git diff src` has no DB write in product files; `git status drizzle src/db` empty | PASS |
| Marks cannot leak across tests | each test calls `resetForTests()`; DB files run in separate processes; health keyed by connection UUID | PASS |

### Suites (host=localhost:5432, db=mariana_test; RELIABILITY_WORKERS_ENABLED=false; DOTENV_CONFIG_PATH=/dev/null)
- `test:unit`: 383 tests, 377 pass, 0 fail, 6 todo (x2).
- `tsc --noEmit` ok; `build` ok; biome clean on 14 changed/new files; `git diff --check` clean.
- `test:db` run 1: 758, 751 pass, **1 fail** (flake, see below). Run 2: 758, 752 pass, 0 fail, 6 todo.
- Repro `fail_one` (broken = Carlos Oliveira): 3 model calls / 3 turns, all tasks attempts=1 completed, 1 active session, offered `["João Silva","Maria Souza"]`. Repro `fail`: no session, text A sent once.
- Leftover fixtures after the runs: 0 `Consultor GCS%` rows, 0 connection rows.

### Failures
- None attributable to Batch C.
- Pre-existing flake (not in diff): `generate-mariana-response.test.ts:934` `ELEVEN_DIGITS_IN_LINE.test(line)` `true !== false`. The trace line carries random UUIDs; a 12-hex segment with 11 digits in a row matches `/\d{11}/` (~1% per UUID). Fix owner: tester/test author (strip UUIDs before the digit check). Not blocking.

### Deviations (judged)
1. Isolation of `CalendarAuthError` already in step 4: ACCEPTED (needed for the step-4 AC).
2. Broken-skip in `GoogleCalendarService`, `scheduling-availability.ts` untouched: ACCEPTED. Keeps "all broken → CalendarUnavailableError (text A)" instead of the no-slot text, and also blocks booking calls.
3. New log `scheduling_consultant_calendar_skipped` (masked via `describeError`): ACCEPTED; satisfies "never silently".
4. DB fixtures insert inactive consultants + connections: ACCEPTED; inactive (not in other draws), cascade cleanup, 0 leftovers verified.
5. Not listed in plan: `google-calendar-errors.ts` (+`CalendarAuthError`). Minor, ACCEPTED.

### Non-blocking notes / risks not covered
- **Deploy risk (Q3 not confirmed):** the seed has 0 connection rows; production behaviour depends on Neon having one row per active consultant. If today it is one shared row, every other consultant leaves the draw (`not_connected`) after deploy. Davi should run the read-only count check (plan Q3) before deploying.
- `consultantName` is logged in `google_calendar_needs_reauth` (staff name, not lead PII). OK, noted.
- Broken mark is in-memory per process (F-3): multi-instance deploy re-probes once per instance; a token fixed by direct SQL without touching `updatedAt` stays broken until restart.
- `not_connected` logs once per offer per unconnected consultant (log volume, by design).
- The repros and the DB `fail_one` test patch `getBusyPeriods` on the prototype, so they exercise the draw isolation, not the per-consultant loader/marking (those are covered by unit tests with injected loader/client).
- F-4 unchanged: `invalid_grant` at confirm → `appointment_failed` reply.

### New tests added by the tester
- `src/tests/services/calendar-per-consultant-adversarial.test.ts` (6, no DB/network; runs under `test:db` glob, not in the `test:unit` list).

### Manual WhatsApp checklist delta (local/staging only, never Neon)
1. Staging with 2 consultants connected; revoke one Google grant. Send "quero falar com um consultor" → reply offers buttons only with the healthy consultant; one `google_calendar_needs_reauth` line (reason `invalid_grant`, no token).
2. Send another message that triggers an offer → same healthy-only offer; no new reauth line.
3. Re-authorize via `/auth/google` for the revoked consultant, trigger an offer again → that consultant can appear again without restart.
4. Revoke both → "Desculpe, tive um problema para consultar a agenda dos consultores agora. Me mande uma mensagem daqui a pouco que eu tento de novo."
