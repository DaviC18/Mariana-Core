Status: APPROVED by Davi — "eu aprovo as suas recomendações" (2026-10-27)

## Approval record
- Davi's full reply, verbatim, as relayed by the coordinator: "eu aprovo as suas recomendações, me mande um relatorio assim que terminar". He wants a report when the work is done.
- Q1: text A was approved: "Desculpe, tive um problema para consultar a agenda dos consultores agora. Me mande uma mensagem daqui a pouco que eu tento de novo." Step 2 is unblocked.
- Q2: `process_inbound_message` max attempts = 3.
- Q4: after the step 3 notice, the task ends `failed`.
- Q3: one Google connection per consultant was approved, following the recommendation. Davi did NOT explicitly confirm how the accounts are set up today (per consultant or one shared account). Step 4 is unblocked. Its AC must also cover a consultant with no connection row: that consultant is excluded from the draw and logged (`google_calendar_needs_reauth`, reason `not_connected`), never silently.
- Q5 (the `CLAUDE.md` fix about the pending offer) is still OPEN. It is not decided.


# 2026-10-27-scheduling-loop — plan

## Summary
- Goal: a Google Calendar or OAuth failure during the slot offer never leaves the customer in silence, never burns 5 Gemini calls, and always logs the real error.
- A consultant with a revoked token (`invalid_grant`) drops out of the draw. The offer continues with the other consultants.
- No schema change. The per-consultant "broken" mark is kept in memory until a migration baseline exists.

## Reproduction (local DB only)
- Script: `docs/work/2026-10-27-scheduling-loop/repro/scheduling-loop-v2.repro.ts`. Target printed: `localhost/mariana_test`. Gemini, Calendar and WhatsApp are mocked.
- v1 (`scheduling-loop.repro.ts`) never reached the offer. It inserted user rows at `now-30s`, so "sim por favor" sorted BEFORE the offer text and the pending offer was never detected. v2 fixes the timestamps and adds `REPRO_CALENDAR=fail_one`.
- Result with `REPRO_CALENDAR=fail` and with `fail_one` (only 1 of the seeded consultants throws), identical:
  - 5 `mariana_turn` traces, same turnId, `outcome=turn_error exec=none`, each one with `agent_action_started offer_meeting accepted_pending_offer`;
  - 5 Gemini calls for one customer message;
  - task `attempts=5 status=failed lastError=invalid_grant`;
  - 0 outbox rows for the turn, so the customer gets nothing;
  - 5 assistant rows that were never sent ("Ótimo! Vou procurar um horário.", then 4x "Vou ver os horários.");
  - lead left `qualified`, `interestedInConsultant=true`, no scheduling session;
  - 0 application log lines contain `invalid_grant`.
- This matches the incident exactly.

## Root causes
- **Trigger (known, not code):** a refresh token in `google_calendar_connections` is revoked or expired. Ops hint for Davi: if the Google OAuth app is in "Testing" publishing status, Google expires refresh tokens after 7 days.
- **RC-1 — one bad consultant kills the whole offer. CONFIRMED.**
  - `consultant-availability.ts:57-75` calls `getBusyPeriods` for each consultant in sequence, with no try/catch. The first throw aborts the offer.
  - `fail_one` reproduces this: one broken consultant means no offer for anyone.
- **RC-2 — the Calendar client ignores the consultant. CONFIRMED.**
  - `google-calendar-service.ts:41-47` reads `google_calendar_connections` with `.limit(1)` and no `where`. Every consultant's calendar is queried with whichever token comes first.
  - So one revoked row can break every consultant, even when the other tokens are fine.
  - The schema (`google-calendar-connections.ts:8-14`, `consultantId` unique) and the OAuth route (`auth-google.ts:153-166`, upsert per consultant) are per consultant. The route always stores `env.GOOGLE_ACCOUNT_EMAIL`, which suggests one shared Google account (see Q3).
- **(a) Real error never logged. CONFIRMED.**
  - `TurnTrace` (`turn-trace.ts:59+`) has no error field. `emitFailureTrace` (`generateMarianaResponse.ts:369-400`) drops the error.
  - The executor (`autonomous-task-executor.ts:187-245`) writes `lastError` to the DB only. The worker logs only when `runOnce` itself throws (`polling-worker.ts:76-81`), and handler errors never reach it.
  - Breaks R-REL-05 ("o erro aparece nos logs") and R-REL-07.
- **(b) Every retry re-calls Gemini. CONFIRMED.**
  - The model call (`generateMarianaResponse.ts:640`) runs before the Calendar call (`:932-947`). A retry re-runs the whole turn.
  - `maxAttempts` defaults to 5 (`autonomous-tasks.ts:51`), and `enqueueTask` (`webhook-whatsapp.ts:138`) never overrides it.
- **(c) Terminal failure leaves no reply. CONFIRMED.**
  - The handler catch (`autonomous-task-handlers.ts:315-336`) sends a notice only for `ModelUnavailableError`. Any other error is rethrown on every attempt, including the last one.
  - Breaks R-REL-05.
- **(d) Calendar failure is retried instead of answered. CONFIRMED.**
  - Nothing in the offer block (`generateMarianaResponse.ts:932-1000`) catches Calendar errors. Retrying cannot fix a revoked token.
- **(f) New finding: unsent assistant rows. CONFIRMED.**
  - Each attempt commits the lead update and an assistant message in the turn tx (`generateMarianaResponse.ts:~760-915`), and only then calls Calendar.
  - On retry, the history cutoff (`:110-135`, `lt/lte messageCutoff`) hides the earlier rows. The same pending offer is detected again, and another row is inserted.
  - Those rows are never sent, but the customer's NEXT turn sees them in its history. Step 2 removes this for Calendar failures. The general case is follow-up F-2.
- **Did 2026-10-26-flow-review make it worse? REFUTED.**
  - Step 30 (`b7b7070`) changed only how the consultant is picked (`drawConsultant`). The per-consultant Calendar loop with no isolation already existed (`d7554a2`), and so did the `.limit(1)` client (`7fbb1c2`).
  - Step 30 inherited the all-or-nothing loop and did not add isolation. It did not cause the failure.
  - The P-4 trace work (`595db13`) made the failure visible as `turn_error`. Before that, it left no trace line at all.
  - No step removed a catch around Calendar (checked the last 8 commits of `generateMarianaResponse.ts`).
- **Why `accepted_pending_offer` fired. CONFIRMED: `CLAUDE.md` is stale.**
  - The marker is not a DB column. It is the exact backend text `CONSULTANT_OFFER_TEXT` found in the previous assistant message (`pending-offer.ts:22-45`, `generateMarianaResponse.ts:569-573`). The acceptance check runs at `:697-700`, and the result is passed to `executeNextAction` at `:809`.
  - The backend appended that text to reply 2, so "sim por favor" matched `isClearAffirmative`. This path has been live since `2a2d657`/`e402b13`.
  - The `CLAUDE.md` line "the marker is not persisted yet … not active in production" is wrong. Davi has to fix it, because agents must not edit `CLAUDE.md` (Q5).

## Design
- **New errors** in a new file `src/integrations/google-calendar/google-calendar-errors.ts`:
  - `isInvalidGrantError(e)`: gaxios `response.data.error === "invalid_grant"` or `message === "invalid_grant"`;
  - `CalendarAuthError` (consultantId, reason `invalid_grant | not_connected`);
  - `CalendarUnavailableError` (no consultant answered; keeps the failures as `cause`).
- **Availability is isolated per consultant:**
  - an auth failure drops that consultant and marks the connection broken;
  - any other Calendar error drops the consultant for this offer only;
  - zero consultants answering → `CalendarUnavailableError`;
  - consultants that answered but have no free time → the existing no-slot text.
- **The offer path catches `CalendarUnavailableError`** and replies with a fixed text on attempt 1. The task completes, so there is no retry and one Gemini call.
- **Generic turn errors** (DB and others) keep retrying, but `process_inbound_message` is capped (Q2). On the last attempt the customer gets a fixed notice.
- **Logs:**
  - one JSON line per task failure or retry;
  - failure traces carry `errorName`, `errorCode` and `errorMessage`. `errorMessage` is truncated to 200 chars, with digit runs of 8 or more masked, because Postgres messages can embed a phone number;
  - one `google_calendar_needs_reauth` line per newly marked consultant (consultantId, consultant name, connectionId). It never contains a token or an email.
- **Broken mark without migration:**
  - an in-memory `Map<connectionId, updatedAtMs>`. A connection counts as broken only while its row's `updatedAt` equals the stored value;
  - re-auth upserts `updatedAt` (`auth-google.ts:161-163`), so a re-authorized consultant comes back with no restart;
  - after a restart, each broken consultant costs one failing Calendar call, and is then marked again. Each instance learns on its own.
  - **A persistent flag needs a column** (`google_calendar_connections.broken_at` + `last_error_code`), so it needs a migration and waits for the approved baseline. The in-memory map is the interim.
- **Must NOT change:**
  - `drizzle/`, the schema files, and the tokens (no update or delete of `google_calendar_connections`);
  - `consultants.active`;
  - prompts and knowledge;
  - `MODEL_FAILURE_NOTICE`;
  - the confirm/booking flow and its compensation (`appointment-service.ts:240-388`, except the consultantId argument in step 4);
  - `persistOffer`, outbox and runKeys;
  - `selectedSlotId` rules;
  - the pending-offer detection itself.

## Steps (batches of 1–3)

### Batch A — steps 1–2
1. **Log the real error** (a; R-REL-05, R-REL-07).
   - Files: `src/lib/turn-trace.ts` (optional `errorName`, `errorCode`, `errorMessage` on `TurnTrace`, only on failure outcomes); `generateMarianaResponse.ts:369-400` (`emitFailureTrace` fills them); `autonomous-task-executor.ts:187-245` (`markFailedOrRetry` emits `console.error` JSON `autonomous_task_retry_scheduled` / `autonomous_task_failed` with taskId, taskType, conversationId, attempts, maxAttempts, errorName, errorCode, masked errorMessage; never the payload); a small `classifyError`/`maskErrorMessage` helper next to `turn-trace.ts`.
   - Tests:
     - unit `src/tests/turn-trace.test.ts`, "rastro de falha traz errorName/errorCode e mascara dígitos". Given a trace with a `turn_error` built from `Error("... (5511987654321)")`. Then `errorMessage` contains no run of 8 digits, and `errorCode` is set. **Red.**
     - DB `src/tests/reliability/autonomous-task-executor.test.ts`, "falha de handler loga o erro real sem payload". Given a handler that throws `invalid_grant`. When the task is executed once. Then one log line `autonomous_task_retry_scheduled` with `errorCode=google_invalid_grant`, and no payload keys. **Red** (no line today).
     - DB `src/tests/services/turn-trace-integration.test.ts`, "turno com Calendar invalid_grant emite turn_error com errorCode". **Red.** After step 2 this case no longer throws, so the test then switches to a DB error injected after the model call.
   - Invariants: R-REL-07 says no customer text. The message is masked and truncated, and the trace never carries the payload or the phone.
2. **Fixed reply when no Calendar answers** (d, plus b and c for this cause; R-REL-05). **BLOCKED on Q1 (text).**
   - Files: new `google-calendar-errors.ts`; `consultant-availability.ts:57-75` (wrap: if every consultant call fails → throw `CalendarUnavailableError`; partial isolation comes in step 5); `generateMarianaResponse.ts:932-1000` (catch `CalendarUnavailableError` only → `finalReply = CALENDAR_UNAVAILABLE_TEXT`, update the assistant row the same way as the no-slot branch `:983-996`, push an L11 rewrite record, log `scheduling_calendar_unavailable` with the failure count); new constant in `src/services/conversations/calendar-unavailable-notice.ts`.
   - Tests:
     - unit (new, added to `test:unit`) `src/tests/services/calendar-unavailable-notice.test.ts`, "texto exato; detectPendingOffer devolve null; não casa SCHEDULING_COMMITMENT_PATTERNS". **Red** (the file is missing).
     - DB new `src/tests/reliability/calendar-failure.test.ts`, "Calendar invalid_grant na oferta responde texto fixo na 1ª tentativa". Given a lead after the offer text and the user turn "sim por favor", with a Calendar fake that throws `invalid_grant` for everyone. When one `executeNextAutonomousTask` runs. Then the task is `completed` with attempts=1; there is 1 model call; there is 1 outbox row with the exact text; there is 1 assistant row; there is no scheduling session; the lead has `interestedInConsultant=true`. **Red** today: `retry_scheduled`, 0 outbox rows.
     - Same file, "redelivery do mesmo turno não duplica o aviso" (R-REL-02).
   - Invariants:
     - one reply per inbound (runKey unchanged);
     - the text carries no offer marker, so it cannot arm `accepted_pending_offer`;
     - the AI is not the authority on availability (fixed backend text).

### Batch B — step 3
3. **Bound retries and answer on the last attempt** (b, c; R-REL-05).
   - Files:
     - `webhook-whatsapp.ts:138-160` (`enqueueTask` sets `maxAttempts = INBOUND_TASK_MAX_ATTEMPTS` for `process_inbound_message`; the value is Q2);
     - `autonomous-task-handlers.ts:315-336`: when the error is not a model error and not superseded, and `task.attempts >= task.maxAttempts`, send a fixed notice. Reuse `sendModelFailureNotice` (`:127-200`), generalized for a non-model error: the lead lock stays, the active check stays, the key stays `runKey`. Then throw `PermanentAutonomousTaskError` with `cause`, so the task stays `failed` and visible (Q4).
   - Tests (DB, `src/tests/reliability/handler-partial-failure.test.ts`):
     - "erro não-modelo na última tentativa envia aviso fixo uma vez e a task fica failed". **Red** (no outbox today).
     - "erro em tentativa intermediária não envia aviso" (regression).
     - "task de entrada nasce com maxAttempts = N". **Red.**
     - "conversa fechada na última tentativa não envia aviso" (superseded rule).
   - Invariants:
     - a duplicate inbound is never answered twice (same runKey);
     - lock order is lead first;
     - the conversation is re-checked as active under the lock.

### Batch C — steps 4–5
4. **Use each consultant's own token** (RC-2). **BLOCKED on Q3.**
   - Files: `google-calendar-service.ts:40-67` (`getCalendarClient(consultantId)` selects by `consultantId`; no row → `CalendarAuthError('not_connected')`); `getBusyPeriods`, `createEvent` and `deleteEvent` take a `consultantId`; callers `consultant-availability.ts:59`, `appointment-service.ts:248,271,377` pass the slot's consultantId.
   - Tests: DB `src/tests/services/calendar-availability.test.ts` (or a new `google-calendar-service.test.ts` with a mocked `calendar()`), "getBusyPeriods usa a conexão do consultor pedido, não a primeira". Given 2 connections. Then the token of the asked consultant is used. **Red.** Plus a regression check that booking passes the slot's consultantId.
   - Test (unit `consultant-availability-draw.test.ts` or DB), "consultor sem linha de conexão sai do sorteio e é logado". Given 2 active consultants, and only one of them has a `google_calendar_connections` row. Then the offer has only the connected consultant, and there is exactly one `google_calendar_needs_reauth` log line with reason `not_connected` and the consultantId. There is no silent skip and no token in the log. **Red** (today the `.limit(1)` token is used for everyone).
   - Invariants: tokens are only read, never written.
5. **Drop broken consultants from the draw** (e).
   - Files: new `src/integrations/google-calendar/calendar-connection-health.ts` (`markBroken`, `isBroken`, `resetForTests`); `google-calendar-service.ts` (an `invalid_grant` → `markBroken`, one `google_calendar_needs_reauth` log line, throw `CalendarAuthError`); `scheduling-availability.ts:79-111` and `consultant-availability.ts:57-75` (skip broken consultants before any Calendar call; per-consultant try/catch: auth → skip, other error → skip this offer; zero answered → `CalendarUnavailableError`); `docs/CODEMAP.md` (new files).
   - Tests (unit `src/tests/services/consultant-availability-draw.test.ts`):
     - "consultor com invalid_grant sai do sorteio; os outros seguem". **Red.**
     - "todos quebrados → CalendarUnavailableError". **Red.**
     - "consultor marcado não recebe nova chamada ao Calendar". **Red.**
     - "reautorização (updatedAt novo) devolve o consultor ao sorteio". **Red.**
     - "log de reauth traz consultantId e nunca token". **Red.**
   - Test (DB, `calendar-failure.test.ts`), "2 consultores, 1 com invalid_grant: oferta só com o saudável, 1 chamada ao modelo". **Red** (the `fail_one` repro shows it).
   - Invariants:
     - the draw stays among consultants that are verified free;
     - the slot's consultant is persisted before Confirmar, so the `selectedSlotId` rule is unchanged;
     - no write to `consultants` or to the tokens.

## Out of scope / follow-up
- F-1: an admin UI with consultant CRUD, a "Conectar Google Calendar" button, and connection status (needs F2-05 auth).
- F-2: the general unsent assistant rows on a retried turn (f) for non-Calendar errors. This needs the turn to be idempotent per task, or the model call moved out of the committed tx.
- F-3: a persistent `broken_at`/`last_error_code` column, after the migration baseline.
- F-4: `invalid_grant` at confirm time (`appointment-service.ts`). Today it is the `appointment_failed` path. Step 5 marks the connection broken, but the customer-facing reply there is not changed.
- F-5: the `CLAUDE.md` invariant text about the pending offer (Davi edits it).
- F-6: step 3 implementer choices, kept as-is for delivery (Davi, 2026-10-28: "depois resolveremos"): the last-attempt notice reuses `MODEL_FAILURE_NOTICE`; a closed conversation on the last attempt sends no notice but the task ends `failed`.
- Not touched: the tokens, `auth-google.ts`, prompts, `drizzle/`.

## Questions for the owner
- **Q1 (blocks step 2) — text when no Calendar answers.**
  - Recommended (A): "Desculpe, tive um problema para consultar a agenda dos consultores agora. Me mande uma mensagem daqui a pouco que eu tento de novo."
  - (B): "Desculpe, não consegui consultar a agenda agora. Um consultor vai falar com você por aqui." Only choose B if someone really gets alerted and follows up; today nobody does.
  - Both texts are checked: no offer marker, no commitment pattern.
- **Q2 — `process_inbound_message` max attempts.** Recommended: 3 (at most 3 Gemini calls). The alternative is 2. Today it is 5.
- **Q3 (blocks step 4) — is each consultant's Calendar read with that consultant's own connection row?**
  - Or is it one shared Google account that sees every calendar? The route stores `env.GOOGLE_ACCOUNT_EMAIL` for every row.
  - Recommended: per consultant, with no row meaning "not connected".
  - Read-only check for Davi: compare the count of `google_calendar_connections` rows to the count of active consultants.
  - If the account is shared, step 4 is dropped. Step 5 then marks the shared connection, and the case of every consultant failing goes to the Q1 text.
- **Q4 — after the step 3 notice, does the task end `failed` (recommended: still visible to your SELECT) or `completed` with a flag (like the model-failure path)?**
- **Q5 — will you fix the `CLAUDE.md` invariant line?** The pending-offer path IS active in production via the text marker.
