# Progress — 2026-10-28-flow-v2

Implementer notes, kept across batches (plan rule (a)).

## Batch A

### A1 — flag, model config, texts, router, trace type
- Files: `src/env.ts` (`MARIANA_FLOW` v1|v2 default v1; `MARIANA_HISTORY_MESSAGES` 1–30 default 10; blank = default, like the Gemini vars), `.env.example`, `src/ai/model-config.ts` (new), `src/services/flow-v2/{texts,router}.ts` (new), `src/lib/turn-trace.ts` (optional `flow/route/responder/intent/guardRejected/guardReason`, enum types `TurnRoute/TurnResponder/TurnIntent/TurnGuardReason`), `package.json` (`test:unit` + router/texts tests).
- Tests: `env.test.ts` "MARIANA_FLOW defaults to v1 and rejects other values", "MARIANA_HISTORY_MESSAGES defaults to 10…"; `agent-model-config.test.ts` "model-config.ts builds the same Gemini config as agent.ts"; `flow-v2/texts.test.ts` (4); `flow-v2/router.test.ts` (R1, R4, R5, R6 yes, R6 no, unsure → AI, R7a–R7d, R8 precedence, imports no v1-brain).
- Red: env `undefined !== 'v1'`; model-config / texts / router `Cannot find module`. Import test proven able to fail with a temporary probe (`zz-probe.ts → ai/agent.ts`: "flow-v2 reaches a v1-brain file"), probe deleted.
- Green: all affected files pass; `test:unit` 460 tests, 454 pass, 0 fail, 6 todo; `tsc` clean; biome clean on changed files.
- Deviation 1: `agent.ts` NOT changed (no re-export). `gemini-model-config-adversarial.test.ts:144-156` and `agent-model-config.test.ts:44` read `agent.ts` source and require `env.GEMINI_*` reads there; a pure delegation would turn them red. `model-config.ts` repeats the 10-line builder; a parity test pins both to the same output. v1 is byte-identical.
- Deviation 2 (texts): spec allows 2–3 variants of T-WELCOME / T-DECLINE but only one text of each is approved; `pickVariant` is in place with one variant each (no invented text). T-RESCHEDULE not added (text still open).
- Own new test tweaked before green: `" "` removed from invalid `MARIANA_HISTORY_MESSAGES` values (blank means unset, same rule as `GEMINI_TEMPERATURE`).

### A2 — turn state, current-stage buttons, R8 start-scheduling
- Files: `src/services/flow-v2/state.ts` (`loadTurnState`, `detectV2PendingOffer`), `src/services/flow-v2/start-scheduling.ts` (`markLeadReadyForScheduling`, `prepareSchedulingOffer`, `writeSchedulingReply`, `insertAssistantRow`), `src/services/conversations/stale-tap-reply.ts` (exported `buildCurrentStagePayload`; `buildStaleTapPayload` now prefixes the notice to it — same strings, same key order).
- Tests: `flow-v2/state.test.ts` "pending offer only from exact fixed text of the current conversation", "past appointment is not future (S-11)", "rotated conversation inherits no pending offer".
- Red: `Cannot find module '../../../services/flow-v2/state'`. Green: 3/3 (3 runs). Stale-tap refactor: 7 files that cover taps (webhook, phase3, tap-redelivery, lock-order, session-rotation, handler-partial-failure, no-consultant-choice) 113/113 unchanged.
- Deviation 3: `markLeadReadyForScheduling` commits `interestedInConsultant = true`, `status = qualified` (only from new/qualifying, never under 18) and an AI objective only if the lead has none, **before** the Calendar call. Reason: `SchedulingAvailabilityService.getAvailableSlots` throws `lead_not_qualified` unless the stored status is `qualified` (`scheduling-availability.ts:64`); v1 also commits the turn before the offer. Lead locked first; closed conversation → `TurnSupersededError`. This is the minimal R8 part of B3's `mergeLeadFields`; B3 still owns the other fields and age parsing.
- Multi-slot assistant row content = WhatsApp offer body (v1 stored a numbered list; v2 has no v1 formatter).

### A3 — run-turn, switch point, `consultor:falar` tap, trace
- Files: `src/services/flow-v2/run-turn.ts` (`runFlowV2Turn`, `runFlowV2Tap`, `FlowV2Deps`, `UnderstandResult`; default `understand` rejects with `ModelUnavailableError(transport)` until B3), `src/services/conversations/autonomous-task-handlers.ts` (v2 switch in `handleProcessInboundMessage`; tap branch before `confirm:`), `src/lib/turn-trace.ts` (`TurnOutcome` + `no_reply`), `docs/CODEMAP.md`.
- Tests (`flow-v2/run-turn.test.ts`, through the real executor/handlers unless noted): V-01, V-04 (tap with objective under flag v1; tap without objective → T-ASK-OBJECTIVE, then direct turn with scripted understand → slots), V-10, V-18 (all down → text A, attempt 1, queue idle; one down → only healthy consultants), S-23-v2 (closed during Calendar → `conversation_not_active`, empty outbox, trace `superseded`), V-16 (flag v1 → scripted v1 Gemini consumed once, trace has no `flow`/`route`).
- Red: `Cannot find module '../../../services/flow-v2/run-turn'` (all 6). Two test-harness fixes on the way (my own new test): v1 fake needed `leadUpdate.status`; test timestamps now never behind DB `now()`. Green: 6/6, 3 consecutive runs.
- Handler: v1 `catch` body moved verbatim into a local `handleTurnFailure` shared by v1 and v2 (same returns/throws). v2 writes its own assistant row + outbox (`runKey`) + processed messages in one tx; handler only marks the event.
- Deviation 4: R7d (`reschedule_or_cancel`) sends the AI reply (or T-AI-FALLBACK) until T-RESCHEDULE is approved; R7c always carries the consultant button (R7e / future-appointment exceptions are batch C).
- Deviation 5: `TurnOutcome` gains `no_reply` (R1 opt-out, or replay whose `runKey` is already in the outbox).
- Risk: a lead with status `scheduled` and no future appointment cannot get slots (`lead_not_qualified` throw → retries → final notice). Same as v1 today; not changed.

### Batch A — full suites (once, at the end)
- Target printed: `localhost:5432/mariana_test` (`DOTENV_CONFIG_PATH=/dev/null`, `RELIABILITY_WORKERS_ENABLED=false`).
- `npm run test:unit`: 460 tests, 454 pass, 0 fail, 6 todo.
- `npx tsc --noEmit`: clean. `npm run build`: success.
- `npm run test:db`: 855 tests, 849 pass, 0 fail, 6 todo (3 active consultants seeded).
- biome: clean on all changed files.

### A4 — closed-list intents before the AI + appointment text (+ tester N1, N2, N3)
- Files: `src/services/flow-v2/intent-lists.ts` (new: normalization, closed lists, `coreOf` strips a leading greeting and "por favor"/"Mariana" only), `router.ts` (`RouterState` + `hasActiveSession`/`hasFutureAppointment`; routes `list-*`; `isClearYes`; order R1 → R6 (N1) → R4/R5 → lists → R7), `texts.ts` (approved T-APPOINTMENT-INFO wording with pt-BR weekday), `run-turn.ts` (`planClosedList`; R7d traced as `R7d`, N3), `src/lib/turn-trace.ts` (`TurnRoute` + `R7e-status`, `R7-appointment-info`), `docs/CODEMAP.md`.
- Routes: consultant list → R8 (final R8-* route); sensitive → `R7b` T-SENSITIVE + button; status/thanks with a future appointment → `R7-appointment-info`; status during a session → `R7e-status` (slot stage: T-STATUS-SLOT; confirm stage: T-STATUS-CONFIRM + "\n" + confirmation body) + stage buttons; reschedule → `R7d` with the batch-A fixed text (T-AI-FALLBACK + button, no AI call, since "AI is never asked when a list matched" and T-RESCHEDULE is open).
- Tests: `router.test.ts` N1, N2, one row per list (5), "lists stay closed"; `texts.test.ts` T-APPOINTMENT-INFO (replaces the A1 test of the superseded wording); `run-turn.test.ts` "A4: every closed-list path … 0 Gemini calls", "N3: R7d from the AI is traced as R7d".
- Red: 8 router/texts failures (missing routes, old wording); run-turn `Error: understand must not run` and `'R7c' !== 'R7d'`. Green: router 21/21, texts 4/4, flow-v2 DB 20/20 (run-turn 3 runs).
- Changed existing pins that contradict approved A4/N2 (tester's batch-A tests + mine): "Oi! Quanto custa?" now `list-sensitive` (was R7); `isClearNegative("não, agora não")` now true (N2); my "unsure → AI" case became "bom dia, tudo bem? quanto custa? e como funciona?".
- Not done (per coordinator): N4 (batch D), N5 (batch B), N6 (same as v1).
- Full suites: `test:unit` 472 tests, 466 pass, 0 fail, 6 todo; `tsc` clean; `build` ok; `test:db` (localhost:5432/mariana_test) 878 tests, 872 pass, 0 fail, 6 todo; biome clean.

## Batch B

### B1 — reply-guard.ts
- Files: `src/services/flow-v2/reply-guard.ts` (`checkReply` → `{ ok } | { ok: false, reason }`), `src/lib/turn-trace.ts` (`TurnGuardReason` + `fixed_offer_text`), `package.json`.
- Rules (normalized text, first match wins): fixed offer text (N5: the full T-SENSITIVE / T-AI-FALLBACK / T-ASK-OBJECTIVE, or one of their offer questions as a whole sentence), internal content, scheduling claim (agendado/confirmado/times), money, percentage, installment counts, contemplation promise (negated "não garante contemplação" allowed), deadline (number + dias/semanas/meses; "anos"/"minutos" allowed), > 3 sentences, > 1 question.
- Tests (`reply-guard.test.ts`, 13): one per reason, N5, allowed facts, "every clientAllowed knowledge sentence passes", V-07. Red: `Cannot find module`; green 13/13.

### B2 — understand.ts
- Files: `src/services/flow-v2/understand.ts` (`UNDERSTAND_RULES` ≈ 3.3k chars, `buildUnderstandSystemPrompt`, `buildUnderstandContents`, `loadUnderstandHistory`, `callUnderstand`, `runUnderstand`, `understandSchema`).
- The prompt carries only `clientAllowed` knowledge, plus the meeting facts (30 min, Google Meet) and a state hint: first name only (`firstNameForGreeting`), whether the objective is known, the scheduling stage and whether there is a future appointment. Never the phone.
- History holds the last N messages of the current conversation, excluding the current batch, which is appended. Transport errors → `ModelUnavailableError(transport)`; an empty reply → `empty_response`; bad JSON or a schema failure (including an unknown intent) → `invalid_json`. `statedCreditValue` is dropped.
- Fields are lenient on purpose: an empty or long field never fails the turn; blanks are dropped and values cut at 300 chars. Red proof: the strict variant fails "valid JSON …" with "Gemini response failed the schema".
- Tests (`understand.test.ts`, 7): the plan's 4, plus the state hint, the valid parse and empty/transport. Red: `Cannot find module`; green 7/7.

### B3 — wire R7 + lead fields
- Files: `src/services/flow-v2/lead-fields.ts` (`parseAgeOrBirthDate`, `statesMinor`, `mergeLeadFields`), `run-turn.ts` (default `understand` = real call; the guard on every AI reply including R7d; fields merged in the turn tx under the lead lock; an age stated as minor in the same turn blocks R8; trace `intent/guardRejected/guardReason/modelVersionReturned/usage/finishReason`), `src/tests/support/conversation-harness.ts` (`queueScriptedUnderstand(object | raw string | Error)`, `scriptedUnderstandRequests`, `pendingScriptedUnderstand`, `resetScriptedUnderstand`; served before the v1 queue by the same `installScriptedGemini`, not forked), `package.json`, `docs/CODEMAP.md`.
- Merge rules: fill empty only (objective, consortiumType, currentSituation, motivation → painPoint). The name is never written. `new → qualifying` when any field came. `birthDate` is written when empty, or when the new value says minor and the stored one says adult (the stricter one wins). No `updateLeadFromAgent`.
- Tests: `lead-fields.test.ts` (unit, 2: accepted forms, rejected forms). `run-turn.test.ts`: V-02, V-03, V-05 (list + AI), V-06, V-07, V-11 (incl. age in the same turn as the consultant request), V-13, V-14 (transport + invalid JSON).
- Red: lead-fields `Cannot find module`; run-turn 8/8 red ("scripted understand results left unused", outbox mismatch). Green: flow-v2 DB 31/31, 3 runs.
- Changed assertions: (a) V-06 strips the approved "30 minutos" from T-SENSITIVE before the digit check — the plan's "no digit" is unsatisfiable with the approved text; (b) the tester's "v2 free text in batch A → … no Gemini" now expects 1 Gemini call (the real `understand` runs; the mock rejects → same notice).
- Deviation: R8 still qualifies through `markLeadReadyForScheduling` (A2 rule: new/qualifying → qualified, adult), not `isLeadQualified`, so slots still come after T-ASK-OBJECTIVE was asked once without an answer (plan A2 "else Calendar"); `isLeadQualified` would make that path throw `lead_not_qualified`.
- Not done (per coordinator): A4-N1..N3 (batch C), N4 (batch D). T-RESCHEDULE still open.

### Batch B — full suites (once)
- `test:unit`: 499 tests, 493 pass, 0 fail, 6 todo. `tsc` clean. `build` ok.
- `test:db` (localhost:5432/mariana_test, workers off): 916 tests, 910 pass, 0 fail, 6 todo. biome clean on changed files.

### Batch B fix (tester FAIL B-1..B-4, B-N1, B-N3)
- Red: removed `todo` from the tester's 4 cases → 4 fail. Added my own reason-specific cases (B-1 number/money/pct, B-2, B-3, B-4 cap), an env test, the understand timeout and cutoff unit tests, and a DB cutoff test → all red. The hung-call test hung before the fix, so it now has its own 3 s test timeout. DB cutoff red proof: without `cutoff`, "próximo lote" reaches the prompt.
- `reply-guard.ts`:
  - **B-1:** any digit other than the approved "18 anos" / "35 anos" / "30 minutos" → new reason `number`. Money also covers spaced `R $`, `$`, "meio milhão", milhão/bilhão, a number word + mil, and a money emoji with an amount. `pct` → percentage.
  - **B-2:** "contemplação (…) garantida" / "garantida a contemplação", and "contemplado/a" with a time or speed word in the same sentence (em até, anos, meses, logo, rápido, breve…). "cotas já contempladas" from the knowledge still passes.
  - **B-3:** "ficou/está/foi/será marcado/a", "reservado/a", "14 horas", "14h", "às duas horas".
  - **B-4:** `MAX_REPLY_CHARS = 600`, new reason `too_long`. T-AI-FALLBACK (95 chars) fits with the button. Line breaks count as sentence separators.
- `turn-trace.ts`: `TurnGuardReason` + `number`, `too_long`.
- `understand.ts` (B-N1): `callUnderstand` races the call against `MARIANA_UNDERSTAND_TIMEOUT_MS` (new env var, default 20000, range 1000–45000, below the 60 s task lease; documented in `.env.example`) and aborts it through `config.abortSignal`. A timeout → `ModelUnavailableError(transport)` → model-failure notice.
- History (B-N3): `buildUnderstandContents` and `loadUnderstandHistory` drop user rows newer than the turn's `messageCutoff`. The handler passes `messageCutoff` to `runFlowV2Turn`, which passes it to `understand`.
- False-positive check still green: every clientAllowed sentence passes, and the approved facts pass.
- Plan-text notes for the coordinator:
  - (a) The plan claim "body ≤ 1024 is guaranteed by the 3-sentence rule" is false. The guard's 600-char cap is now the guarantee.
  - (b) B3's "qualified on R8 when `isLeadQualified`" should read like the A2 rule actually used (`markLeadReadyForScheduling`: new/qualifying → qualified for an adult, before the Calendar call).
- Not changed: B-N2 (stricter age wins), as Q9 decided.
- Suites: `test:unit` 515 tests, 509 pass, 0 fail, 6 todo. `tsc` clean. `build` ok. `test:db` (localhost:5432/mariana_test) 937 tests, 931 pass, 0 fail, 6 todo. biome clean. flow-v2 DB 36/36, 2 runs.

## Batch C

### C1 — R7e + `schedule_status`
- Files: `src/services/flow-v2/{router,run-turn}.ts`, `src/lib/turn-trace.ts` (`TurnRoute` + `R7e`), `src/tests/services/flow-v2/{router,run-turn}.test.ts`, `docs/CODEMAP.md`.
- Router: `routeUnderstood` accepts `hasActiveSession`; `schedule_status` with an active session → `R7e-status` (no AI text; the backend states the stage). Without a session the behaviour is unchanged (AI reply or `R7c-fallback`), so old callers stay valid.
- `run-turn.ts`: `R7e-status` → `T_STATUS_SLOT`, or `T_STATUS_CONFIRM` + confirmation body, with the current stage buttons; R7c AI reply during a session → reply sent whole + stage buttons, no consultant button, route `R7e`, responder `ai`, no Calendar call. Extracted `withStageOrConsultant`, `planStatusReply`, `passGuard` to keep `planUnderstood` under the complexity limit.
- Tests: V-08 (AI "é online?" → answer + the same offer buttons, session unchanged, 0 extra Calendar calls, 1 understand call); V-09 slot stage (status phrase the closed list misses → `schedule_status` → `T_STATUS_SLOT` + buttons); V-09 confirmation stage (→ `T_STATUS_CONFIRM` + confirmation body + Confirmar/Não). Router: `schedule_status` with/without session.
- Red: router `'R7c-fallback' !== 'R7e-status'`; run-turn 3 failures (`T-AI-FALLBACK` instead of `T_STATUS_SLOT`; `R7c-fallback` instead of `R7e-status`). Green: router 25/25, run-turn 36/36.
- Ruling: the R7e button exception also covers `R7c-fallback` and R7b/`list-sensitive` during an active session (Q4: no consultant button during scheduling; closes A4-N3's session part). R7d left as batch A until T-RESCHEDULE is approved.
- Not done: C2 (blocked on the T-RESCHEDULE text), C-MEET.
- Full suites: `test:unit` 515 tests, 509 pass, 0 fail, 6 todo; `tsc` clean; `build` ok; `test:db` (localhost:5432/mariana_test) 940 tests, 934 pass, 0 fail, 6 todo; biome clean.

### C2 — future appointment (R-SES-05) + T-RESCHEDULE
- Decision (Davi, 2026-10-28): T-RESCHEDULE = option A — "Tudo bem! Anotei seu pedido e o consultor entra em contato com você. Precisa de mais alguma coisa?" — one text for reschedule **and** cancel.
- Files: `src/services/flow-v2/{texts,state,router,run-turn}.ts`, `src/tests/services/flow-v2/{texts,state,router,run-turn}.test.ts`, `docs/CODEMAP.md`.
- `texts.ts`: `T_RESCHEDULE` added; stale header note ("text not approved yet") removed.
- `state.ts`: `futureAppointment` now carries `id` (needed by the request log). Only the lead's earliest confirmed/scheduled appointment in the future, unchanged otherwise.
- `router.ts`: `routeUnderstood` accepts `hasFutureAppointment`; `schedule_status` with a future appointment → `R7-appointment-info`, **before** the session check (the meeting wins). `reschedule_or_cancel` → `R7d` unchanged.
- `run-turn.ts`:
  - `R7-appointment-info` → `T-APPOINTMENT-INFO` (date, time, consultant), no buttons, no AI text.
  - `R7c`/`R7b`/`R7c-fallback` with a future appointment → text only, no button (Q4); implemented once in `withStageOrConsultant`, also used by `list-sensitive`.
  - `R7d` (AI intent or closed list) → fixed `T_RESCHEDULE`, automation, no button, no Calendar; the AI reply is discarded. `reschedulePlan` carries `rescheduleAppointmentId`.
  - `mariana_reschedule_request` logged with `console.info` only after a successful, non-deduplicated write: `{ appointmentId, event, flow: "v2", leadId }`. Never message text or phone. `appointmentId` is `null` when there is no future appointment.
- Tests: texts exact wording; state `futureAppointment.id`; router future appointment over session; V-12 ("quero remarcar" with a future appointment → one text, request logged once, 0 Gemini/Calendar, session/slots untouched, no text/phone in the log); S-10-v2 (AI answer without button; `schedule_status` → `T-APPOINTMENT-INFO`). Updated A4 (R7d → text, not fallback+button) and N3 (R7d responder `automation`).
- Red: texts `undefined !== T_RESCHEDULE`; router `'R7c-fallback' !== 'R7-appointment-info'`; state deepEqual missing `id`; S-10-v2 got `buttons` instead of `kind: "text"`; V-12 outbox/route mismatch. Green: router 25/25 (+texts 6/6), flow-v2 DB 41/41 (state + run-turn).
- Ruling: with a future appointment, every automated answer is text-only (no consultant button) — covers the `R7c-fallback` and `list-sensitive` paths too, not only the AI reply named in the plan.
- Not done: C-MEET (`conferenceData`, Meet link in T-APPOINTMENT-INFO/confirmation, event description, `events.patch` on reschedule, `calendar_meet_link_missing`); Batch D (V-15/V-17, simulator `--flow v2`, docs).
- Full suites: `test:unit` 516 tests, 510 pass, 0 fail, 6 todo; `tsc` clean; `build` ok; `test:db` (localhost:5432/mariana_test) 943 tests, 937 pass, 0 fail, 6 todo; biome clean.

### C-MEET — Meet room, link in the texts, event description, reschedule note
- Files: `src/integrations/google-calendar/google-calendar-service.ts` (`CreateCalendarEventInput.requestId`, `CreatedCalendarEvent.hangoutLink`, `CalendarEventRef`; `createEvent` inserts `conferenceData.createRequest` + `conferenceDataVersion: 1` and defaults `requestId` to a UUID when the caller has no key; new `getMeetLink`, `appendEventDescription` (get + patch inside one `withCalendarClient`)), `src/services/calendar/appointment-service.ts` (event description), `src/services/flow-v2/{texts,state,run-turn}.ts`, `src/services/conversations/autonomous-task-handlers.ts` (confirmation text), `src/tests/integrations/google-calendar-meet.test.ts` (new), `src/tests/services/{appointment-service,flow-v2/{texts,state,run-turn}}.test.ts`, `src/tests/routes/webhook-whatsapp.test.ts`, `package.json`, `docs/CODEMAP.md`.
- `texts.ts`: `withMeetLink` appends `"\n\nLink do Google Meet: <link>"` only for a non-blank link; `buildAppointmentInfoText` accepts `meetLink`; new `buildBookingConfirmationText` uses `formatSlotDate` and the same append rule.
- Event description: name, `WhatsApp: https://wa.me/55…` (prefix `55` when absent, digits only), objective and consortium type; empty fields omitted; no lead UUID. `requestId` = `input.idempotencyKey` when present.
- `state.ts`: `futureAppointment` also carries `calendarId`, `consultantId`, `externalEventId` (needed to read/patch the event).
- `run-turn.ts`: `FlowV2Deps.meetLink` / `notifyReschedule` (defaults on one `GoogleCalendarService`); `appointmentInfoPlan` reads the link outside the tx, sends the text with it, and on `null` or a read failure sends the text without it and logs `calendar_meet_link_missing` (`{ appointmentId, event, flow }`). `reschedulePlan` carries `rescheduleEvent`; `runPlanned` logs `mariana_reschedule_request` first, then patches the event once with `Cliente pediu remarcação pelo WhatsApp em DD/MM/AAAA` (São Paulo), never on a deduplicated write; a patch failure logs `calendar_reschedule_note_failed` without customer data and does not fail the queued turn.
- Confirmation (button flow): `buildBookingConfirmationText` with `appointment.calendarEvent.hangoutLink`.
- Tests: texts link append/omission + confirmation builder; calendar `conferenceData`/`conferenceDataVersion`/`hangoutLink`, `getMeetLink` fallbacks, `appendEventDescription` (existing/no description); appointment-service `requestId` + description contents; state extra ids; run-turn V-12 patch assertions, S-10-v2/V-12 now inject `meetLink`/`notifyReschedule`, link present, link missing (+ log without name/phone), redelivery patches once; webhook confirmation text now carries the link.
- Red: texts `buildBookingConfirmationText` missing and no link appended; calendar `getMeetLink`/`appendEventDescription` not functions and `conferenceData` absent; appointment-service no `requestId`; state deepEqual missing ids; S-10-v2 outbox without link; V-12 no patch.
- Green: texts 8/8, calendar meet 4/4, appointment-service 16/16, state 3/3, run-turn 41/41 (flow-v2 DB), webhook file 14/14.
- Ruling: the Meet link and the reschedule note are best-effort after the durable write. A missing room or a Calendar failure never blocks the customer reply; the logs carry only `appointmentId`/`event`/`flow`.
- Not done: Batch D (V-15/V-17, simulator `--flow v2`, spec/`CLAUDE.md` docs), tester re-validation.
- Full suites: `test:unit` 522 tests, 516 pass, 0 fail, 6 todo; `tsc` clean; `build` ok; `test:db` (localhost:5432/mariana_test, workers off) 953 tests, 947 pass, 0 fail, 6 todo; biome clean on changed files.


## Batch D

### D1 — V-15 (one turn per debounce batch) + V-17 (one trace per turn)
- Files: `src/services/flow-v2/run-turn.ts`, `src/tests/services/flow-v2/run-turn.test.ts`.
- `runPlanned`: a deduplicated write is not a turn and no longer emits `mariana_turn` (N4). The redelivery still returns `{ status: "deduplicated" }`, writes nothing and patches nothing.
- Test harness: `seedInboundBatch` seeds N messages + N tasks sharing one `batchCutoffAt` inside the anchor window; `seedInbound` delegates to it. `runTask` now returns the task `id`.
- V-15: two greetings in the same window → first task answers once (T-WELCOME, 1 outbox, 1 assistant row, 1 trace `R4`/automation), second task `{ skipped: true }`, 0 Gemini, both user messages `processedAt` set.
- V-17: through the handler, six routes (`R5`, `R6-decline`, `R7c`, `R7d`, `R8-slots`, `R1`) → exactly one `mariana_turn` per task id, each with `flow: "v2"`, `route` and `responder`; total 6.
- Concurrent same-`runKey` test now also asserts one trace (was the N4 red: `2 !== 1`).
- Red: dedup trace `2 !== 1`; V-17 AI route `undefined !== 'R7c'` (test counted Gemini, which replaced the scripted `understand`; fixed the test, not the code).
- Green: flow-v2 DB file 43/43.
- Full suites: `test:unit` 522 tests, 516 pass, 0 fail, 6 todo; `tsc` clean; `build` ok; `test:db` (localhost:5432/mariana_test, workers off) 955 tests, 949 pass, 0 fail, 6 todo; biome clean on changed files.

### D2 — simulator `--flow v2` (mocked Gemini by default)
- Files: `scripts/simulate-conversation.ts`, `src/tests/support/simulation-args.ts` (new, pure `parseSimulatorArgs`), `src/tests/support/conversation-simulator.ts` (`V2_SIMULATION_SCENARIOS`, `runV2Scenario`, `formatSimulationReport(..., flow)`), `src/tests/support/simulation-checks.ts` (`SimulatedTurn.route`), `src/tests/services/conversation-simulator.test.ts`.
- CLI: `--flow v1|v2`, `--real-gemini`; unknown flag or flow exits with an error. v1 still requires `--real-gemini`; v2 runs with a canned `understand` unless `--real-gemini` is passed, and only then requires `GEMINI_API_KEY`. Other external credentials stay fake (WhatsApp stub, Calendar blocked).
- v2 path: real DB + `runFlowV2Turn` + fake availability, **one user row per turn** (`user.join("\n")`, with a single `messageIds` id; intentional — the simulator does not split a batch into one row per message), outbox reply read per turn, `offered` = route `R8-slots`. Debounce grouping across separate message rows is covered by V-15 in the DB tests.
- Scenarios: `v2-1` (oi → consultor com objetivo → oferta, 2 turns), `v2-2` (single debounce batch oi + consultor + carro → one offer reply).
- Red: `parseSimulatorArgs is not a function`; `V2_SIMULATION_SCENARIOS` undefined; first v2-2 shape did not offer (objective alone does not start scheduling — needs `wants_consultant` or the objective question pending).
- Green: simulator test 3/3; `npm run sim:conversation -- --flow v2` runs both scenarios PASS (mocked Gemini, local test DB) and writes/removes `docs/sim-report.md`.

### D3 — docs (CODEMAP, spec v1.5, CLAUDE.md invariant, WhatsApp checklist)
- `docs/CODEMAP.md`: flow-v2 row adds D1 dedup (no trace on deduplicated write); simulator row now documents `--flow v2` mocked default and the flag parser.
- `docs/specs/MARIANA_BEHAVIOR_SPEC.md` v1.5: R-FLOW-01/03/10/12, R-SES-05 and R-REL-07 updated for v2; change list appended.
- `docs/specs/2026-10-28-mariana-flow-v2.md` §7 marked applied as v1.5.
- `CLAUDE.md`: pending-offer invariant now names the v2 marker (`T_SENSITIVE`/`T_AI_FALLBACK`/`T_ASK_OBJECTIVE`, `detectV2PendingOffer`) and keeps the v1 migration caveat.
- `docs/work/2026-10-28-flow-v2/whatsapp-checklist.md` (new): owner's V5 staging checklist and rollback.
- Final Batch D suites: `test:unit` 522 tests, 516 pass, 0 fail, 6 todo; `tsc` clean; `build` ok; `test:db` (localhost:5432/mariana_test, workers off) 957 tests, 951 pass, 0 fail, 6 todo; biome clean on changed files. Simulator: `--flow v2` both scenarios PASS (mocked); v1 without `--real-gemini` still refuses (exit 2).
