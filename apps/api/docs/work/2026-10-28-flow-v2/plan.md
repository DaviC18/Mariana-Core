Status: APPROVED by Davi — "aprovo" (2026-10-28)

Approval block: Davi answered "aprovo" to explicacao.md, which states that a plain approval accepts every recommendation: Q1 texts as in spec section 4 plus T-APPOINTMENT-INFO, T-STATUS-SLOT, T-STATUS-CONFIRM; Q2 profile name, never ask, never the phone; Q3 objective only; Q4 button on every AI answer except during scheduling and with a future appointment; Q5 whole-reply reject; Q6 `GEMINI_MODEL` from env; Q7 pending offer = last assistant text exactly T-SENSITIVE / T-AI-FALLBACK / T-ASK-OBJECTIVE, cleared after one turn (CLAUDE.md invariant updated only with Davi's explicit OK); Q8 full V3; Q9 estimated birth date written to `leads.birthDate` directly; Q10 flag default `v1`.
Later decisions (Davi, 2026-10-28): (1) AI in the background: closed-list intents are answered by automation before any AI call (step A4); (2) T-APPOINTMENT-INFO wording as in A4; (3) sessions: the 4h rotation stays exactly as today (R-SES-02 v1.4, R2), no change in v2.
**T-RESCHEDULE decided by Davi (option A, 2026-10-28):** "Tudo bem! Anotei seu pedido e o consultor entra em contato com você. Precisa de mais alguma coisa?" — one text for reschedule and cancel. Batch C ships it; no text condition blocks any step.

# Plan — 2026-10-28-flow-v2 (D-12: automation routes, AI reasons)

Spec: `docs/specs/2026-10-28-mariana-flow-v2.md`. Context and map corrections: `docs/work/2026-10-28-flow-v2/context.md` (section "Map corrections").

## Summary
- New turn engine `src/services/flow-v2/` behind `MARIANA_FLOW=v2`: a pure router picks exactly one responder per turn (automation fixed text/buttons, or one AI "understand" call whose reply is sent whole or replaced whole).
- v1 stays untouched behind `MARIANA_FLOW=v1`; v2 imports no v1-brain file (enforced by a test).
- Reuses webhook, dedup, debounce, task executor, outbox, scheduling services, rotation, stale taps, notices and trace.

## Root causes (why v2)
The spec is a redesign, not a bug fix. The v1 failures it cites, checked against code:
- **Confirmed** — retrieval can return 0 items for "como funciona?": v1 feeds the model only `retrieve.ts` hits; v2 sends all `clientAllowed` knowledge (≈ 8.3 KB, `knowledge/{ademicon,consorcio,products}.ts`).
- **Confirmed** — v1 rewrites model text in 11 layers (`turn-trace.ts:7-20`, `BACKEND_AUTHORED_LAYERS` `:111-118`; slot offer as L11 `generateMarianaResponse.ts:975-984`). v2 has no rewrite.
- **Confirmed (new, map fix)** — `resolveModelName`/`buildModelRequestConfig` sit in v1 `ai/agent.ts:52-76`; reusing them as-is would make v2 depend on a v1-brain file.
- **Confirmed (new)** — `updateLeadFromAgent` throws for a minor birth date (`update-lead-from-agent.ts:322-327`), so "I am 16" cannot be remembered through it (S-15/V-11). Needs Q9.
- **Confirmed (new)** — meeting facts (30 min, Google Meet) exist only in v1 `prompt.ts:182-184`; V-08/S-16 need them in the v2 prompt.

## Design
- **Switch point**: `handleProcessInboundMessage` (`autonomous-task-handlers.ts:319-330`). Inside the same `try`, `env.MARIANA_FLOW === "v2"` → `runFlowV2Turn(...)`; else today's call. The `catch` (`TurnSupersededError`, `ModelUnavailableError` → `MODEL_FAILURE_NOTICE`, last-attempt notice) is shared. v2 writes its own outbox row (key = `runKey`) in its tx, so the handler skips its payload/enqueue block (`:370-422`) for v2 and only marks the event processed. Reason: R-REL-06 (state + outbox in one tx); v1 path unchanged.
- **Tap** `consultor:falar`: new branch in `handleProcessButtonReply` (before `confirm:`, `:~728`), handled by v2 R8 whatever the flag (only v2 sends that button). Key = existing `button-reply:<conv>:<externalId>` runKey.
- **Turn order (run-turn.ts)**: `loadTurnState` (no lock) → `routeTurn` (pure) → optional `understand` call (outside tx) → optional Calendar call (outside tx) → one tx: lead `FOR UPDATE`, conversation still `active` else `TurnSupersededError`, merge lead fields, insert assistant row, `persistOffer({ executor: tx })` when slots, `enqueueOutboundMessage`, mark batch messages processed → emit one `mariana_turn` trace. Same lock order as `sendSlotUnavailableReoffer` (`:497-631`).
- **State (state.ts)**: lead (name, phone, objective, birthDate, status), conversation `optOutAt`, assistant row count, last assistant row content, "T-ASK-OBJECTIVE already sent in this conversation", active non-expired scheduling session + stage, future confirmed appointment (`CONFIRMED_APPOINTMENT_STATUSES`, `startAt > now`). Current conversation only (R-SES-03).
- **Pending offer (Q7, no migration)**: derived from the last assistant row of the current conversation: exact T-SENSITIVE or T-AI-FALLBACK body → `consultant_offer` (yes/no); exact T-ASK-OBJECTIVE → `objective_question`. Cleared automatically by the next assistant row.
- **Router (router.ts, pure)**, first match wins, as spec §3, with these precisions:
  - R1: `optOutAt` set → no reply, no AI call (outbox would block anyway).
  - R3 is handled by the tap branch, not by the text router.
  - R4/R5: closed normalized greeting list; anything extra → R7. R5 with an active session → T-GREETING-AGAIN + current stage buttons.
  - R6: `consultant_offer` pending and `isClearAffirmative` (reused, `pending-offer.ts:107`) → R8; closed negative list ("não", "agora não", "não, obrigado"…) → T-DECLINE. `objective_question` pending → R7; if `understand` returns an objective → R8 (V-04 "then slots").
  - R7a: `wants_consultant` → R8; `accept_offer` → R8 only with a backend pending marker, else treated as R7c (AI is never the authority on authorization).
  - R7c reply `null` or rejected → T-AI-FALLBACK + button.
  - R8: under 18 (backend `isAtLeast18` on stored/parsed birth date) → T-UNDER-18; future appointment → T-APPOINTMENT-INFO (V3; in batch A a minimal guard returns it without slots); active valid session → re-send current stage buttons (no Calendar call, no session churn); objective unknown and T-ASK-OBJECTIVE not yet sent → T-ASK-OBJECTIVE; else Calendar → ≤ 3 slots / single slot Confirmar-Não / no-slots text; every Calendar down → `CALENDAR_UNAVAILABLE_TEXT`, log `scheduling_calendar_unavailable`, route `R8-calendar-unavailable`.
- **AI ("understand")**: one Gemini call, own short prompt + all `clientAllowed` knowledge + meeting facts + a state hint (scheduling stage / appointment present) + last N messages of the current conversation (`MARIANA_HISTORY_MESSAGES`, default 10). Zod schema → JSON schema. `statedCreditValue` dropped from the schema (no column anywhere; not persisted).
- **Reply guard (pure)**: whole accept / whole reject: money, %, installment counts, contemplation promises, deadlines (number + dias/semanas/meses), internal/prompt words, slot/"agendado/confirmado" claims, > 3 sentences, > 1 question. Allows "18 anos", "30 minutos", "35 anos" (knowledge). Returns `{ ok } | { ok: false, reason }` (enum).
- **Buttons**: AI reply = one buttons message (body = reply, button `consultor:falar`), except during scheduling (R7e: current stage buttons) and with a future appointment (no button). Body ≤ 1024 chars is enforced by a hard character cap in the reply guard (the 3-sentence rule alone does not guarantee it; tester Batch B, B-4).
- **Trace**: optional fields on `TurnTrace` (`turn-trace.ts:64`): `flow`, `route`, `responder`, `intent`, `guardRejected`, `guardReason` (enums only, no free text); v2 `rewrites: []`. v1 traces unchanged.
- **Must NOT change**: any v1-brain file (except the A1 re-export in `agent.ts`), scheduling services' internals, webhook, rotation, outbox, executor, migrations/schema.

## Batches and steps
Token plan (Davi a–c): the coordinator keeps **one implementer agent** and continues it batch to batch (it keeps this plan and the code it read); **V0+V1 are merged into batch A**; the tester reviews `git diff` of the batch + this plan and still runs `test:unit`, `test:db`, `tsc`, `build` once per batch. Test hygiene: one test per scenario V-xx, in the module's own test file; no new `*-adversarial` files. New unit files are added to `package.json` `test:unit`.

Test files (new): unit `src/tests/services/flow-v2/{router,texts,reply-guard,understand}.test.ts`; DB `src/tests/services/flow-v2/{state,run-turn}.test.ts`. Harness: extend `src/tests/support/conversation-harness.ts` with a raw scripted-understand queue (`queueScriptedUnderstand(json | Error)`), no fork. New tests strip UUIDs before any digit regex.

### Batch A (V0 + V1) — flag, pure core, automation routes, R8, tap
**A1. Flag, model config, texts, router, trace type** (pure, unit)
- Files: `src/env.ts` (+ `buildEnvInput` `:167`), `.env.example`, `src/ai/model-config.ts` (new), `src/ai/agent.ts` (re-export only), `src/services/flow-v2/{texts,router}.ts` (new), `src/lib/turn-trace.ts` (optional fields), `package.json`.
- Change: `MARIANA_FLOW` enum `v1|v2` default `v1` (Q10); `MARIANA_HISTORY_MESSAGES` int 1–30 default 10. `model-config.ts`: `resolveModelName()` + `buildGeminiConfig({ systemInstruction, responseJsonSchema })`; `agent.ts` keeps its exported names by delegating. `texts.ts`: all fixed texts (Q1), `CONSULTANT_BUTTON = { id: "consultor:falar", title: "Falar com consultor" }`, deterministic variation pick (hash of conversationId), `firstNameForGreeting(name, phone)` (null if equal to phone / no letters / > 20 chars). `router.ts`: `routeTurn(state, input) → RouteDecision`, `isGreetingOnly`, `isClearNegative`.
- Acceptance (red first): `env.test.ts` "MARIANA_FLOW defaults to v1 and rejects other values"; `texts.test.ts` "button title ≤ 20", "greeting never uses the phone as name", "variation is deterministic"; `router.test.ts` one table test per rule R1, R4, R5, R6 yes/no, R7a–R7d mapping, R8 precedence, "unsure → AI", and "flow-v2 imports no v1-brain module" (walks relative imports of `src/services/flow-v2/**` transitively; forbidden list from the spec header + `ai/agent.ts`, `ai/schemas/mariana-response-schema.ts`). Existing `gemini-model-config*` tests stay green (proves re-export).
- Invariants: AI not authority (router is pure backend); v1 untouched (re-export only).

**A2. Turn state + current-stage buttons + R8 start-scheduling** (DB)
- Files: `src/services/flow-v2/{state,start-scheduling}.ts` (new); `src/services/conversations/stale-tap-reply.ts` (extract exported `buildCurrentStagePayload(tx, conversationId)` from `buildStaleTapPayload` `:79-148`; stale-tap output byte-identical).
- Change: `loadTurnState` as in Design. `prepareSchedulingOffer({ leadId, random, now })` → `{ kind: "slots", slots } | { kind: "none" } | { kind: "calendar_unavailable" }` (catches only `CalendarUnavailableError`, logs as `generateMarianaResponse.ts:967-981`). `writeSchedulingReply(tx, ...)` → assistant row + `persistOffer({ executor: tx })` + payload (multi = `buildWhatsAppSchedulingOffer`, single = `buildSingleSlotConfirmationMessage`).
- Acceptance: `state.test.ts` "pending offer only from exact fixed text of the current conversation", "past appointment is not future (S-11)", "rotated conversation inherits no pending offer". Existing `stale-tap-reply` / refused-tap tests green unchanged (red not required: refactor; tester checks output equality).
- Invariants: lead lock first; new conversation inherits nothing; Calendar outside the tx.

**A3. run-turn, switch point, `consultor:falar` tap, trace**
- Files: `src/services/flow-v2/run-turn.ts` (new); `autonomous-task-handlers.ts` (switch `:319`, skip v1 enqueue for v2, tap branch `:~728`).
- Change: `runFlowV2Turn({ conversationId, leadId, currentMessages, messageIds, runKey, eventId, traceTurnId, deps })` and `runFlowV2Tap(...)`. `deps.understand` default in batch A throws `ModelUnavailableError` (replaced in B3; flag default is v1, so no customer impact). One tx as in Design; one trace per turn.
- Acceptance (`run-turn.test.ts`, red first): **V-01** "oi" → T-WELCOME only, 0 Gemini calls; **V-04** tap with objective → slot buttons; objective unknown → T-ASK-OBJECTIVE, then answer with objective → slots; **V-10** pending T-SENSITIVE + "não" → T-DECLINE, + "sim" → slots; **V-18** all Calendars down → text A once, task `completed` attempt 1; one consultant down → slots only from healthy ones; **S-23-v2** conversation closed before the write → nothing sent, `conversation_not_active`; **V-16** flag v1 → inbound goes through `generateMarianaResponse` (scripted v1 Gemini consumed) and no v2 trace.
- Invariants: one active conversation, no duplicate processing (runKey + `button-reply` key), outbox never back to pending (no new outbox code), `selectedSlotId` rule untouched (booking path reused).

**A4. Closed-list intents before the AI + appointment text** (Davi, 2026-10-28: "a IA fica em segundo plano"; added after A1–A3, tester re-checks A4)
- Files: `src/services/flow-v2/{router,texts}.ts` (+ a small `intent-lists.ts` if cleaner), `run-turn.ts`, their tests.
- Change: before R7 (the AI call), the pure router matches the normalized text (lowercase, no accents, no punctuation/emoji) against **closed phrase lists**. Only a whole-message match or a listed phrase with nothing else of substance counts; anything else goes to the AI (spec safety rule: when unsure, AI).
  - consultant / scheduling ("quero falar com consultor", "quero marcar", "agendar", "marcar reunião", …) → R8.
  - sensitive ("quanto é a parcela", "qual a taxa", "lance", "simulação", "valor da parcela", …) → T-SENSITIVE + button.
  - status / thanks **with a future appointment** ("está confirmada?", "tá marcado?", "quando é a reunião?", "obrigado", "obrigada", "valeu", …) → **T-APPOINTMENT-INFO**.
  - status **during an open scheduling session** ("está confirmada?", "tá marcado?") → T-STATUS-SLOT or T-STATUS-CONFIRM + the current stage's buttons.
  - reschedule ("remarcar", "mudar o horário", "trocar o horário", "cancelar a reunião", …) → R7d with the approved T-RESCHEDULE (option A, see the top of this plan).
- T-APPOINTMENT-INFO (approved wording, replaces the plan's earlier one): "Sua reunião com {consultor} está marcada para {dia da semana}, {data}, às {hora}, pelo Google Meet (30 minutos). Obrigada pela confiança! Precisa de mais alguma coisa?"
- Acceptance (red first): `router.test.ts` one table row per list, plus "oi, quero saber como funciona" and "quanto tempo dura a reunião?" do NOT match a list (go to AI); `texts.test.ts` T-APPOINTMENT-INFO formatting (weekday/date/time pt-BR, consultant name); `run-turn.test.ts` each list path makes **0 Gemini calls**.
- Invariants: router stays pure; AI is never asked when a list matched; lists are closed constants (no fuzzy match); batch C keeps only the AI-classified versions of these intents.

### Batch B (V2) — AI understand + reply guard
**B1. reply-guard.ts** (pure, unit)
- Acceptance (`reply-guard.test.ts`, red): one test per reject reason; "> 3 sentences", "> 1 question"; **"every clientAllowed knowledge sentence passes"** (false-positive check); **V-07** "R$ / contemplado em 3 meses → whole reject, reason set".
**B2. understand.ts** (unit, injected `generateContent`)
- Change: prompt (≤ 6,000 chars of rules ≈ 1.5k tokens; R-ID-01, R-SEC-01/02, R-INF-01…06, R-TONE, 3 sentences, 1 question, never offer slots or say "agendado"), `clientAllowed` knowledge only, meeting facts, state hint, history N; zod schema; invalid JSON / empty / transport → `ModelUnavailableError` (kinds as `agent.ts:247-376`).
- Acceptance (`understand.test.ts`, red): "prompt holds every clientAllowed item and no clientAllowed:false item", "rules ≤ 6,000 chars", "history = last N of current conversation only", "unknown intent → ModelUnavailableError(invalid_json)".
**B3. Wire R7 + lead fields**
- Files: `run-turn.ts`, `src/services/flow-v2/lead-fields.ts` (new), harness extension.
- Change: `mergeLeadFields(tx, lead, fields)`: objective, consortiumType, currentSituation, motivation → `painPoint`, status new→qualifying, qualified on R8 by the A2 rule (objective known), not `isLeadQualified` (a customer asked the objective once without answering would make the slot lookup throw; accepted by the tester, Batch B); `interestedInConsultant = true` on R8; `ageOrBirthDate` parsed by backend ("16", "16 anos", dd/mm/aaaa) per Q9; name never overwritten (Q2).
- Acceptance (`run-turn.test.ts`, red): **V-02**, **V-03** (reply uses knowledge, no "encaminhe ao consultor" default: assert prompt contains the consórcio items and reply sent whole + button), **V-05**, **V-06** (no digit outside UUID-stripped payload), **V-07** end-to-end (`guardRejected: true` in trace), **V-11**, **V-13**, **V-14** (notice once, task completes).
- Invariants: AI never authority (fields validated, age parsed by backend, accept_offer needs marker); new conversation inherits nothing (fields reset by rotation `session-rotation.ts:225-237`).

### Batch C (V3) — scheduling interplay (Q8; full version shown, simple version below)
**C1. R7e + schedule_status**: AI reply body + current stage buttons, no consultant button; `schedule_status` → T-STATUS-SLOT / T-STATUS-CONFIRM + buttons. Tests: **V-08**, **V-09** (S-09).
**C2. Future appointment (R-SES-05)**: R8 and `schedule_status` → T-APPOINTMENT-INFO (date, time, consultant); AI answers carry no button; `reschedule_or_cancel` → T-RESCHEDULE + log `mariana_reschedule_request` (leadId, appointmentId; no text). Tests: **V-12**, **S-10-v2**.
- Simple alternative (if Q8 = simple): only C1 without `schedule_status`, plus the batch-A guard (future appointment → T-APPOINTMENT-INFO, no slots). Deferred: V-09, V-12, S-10.

**C-MEET. Meet room + customer contact on the Calendar event** (Davi, 2026-10-28: "coloque isso no plano")
- Why: the texts promise "Google Meet (30 minutos)", but `google-calendar-service.ts` `createEvent` (`:264`) creates no Meet room, and the event only says "Agendamento da Mariana para o lead {uuid}" (`appointment-service.ts:275`), so the consultant cannot reach the customer.
- Files: `google-calendar-service.ts` (`events.insert` with `conferenceData.createRequest` (`hangoutsMeet`, `requestId` = appointment idempotency key) and `conferenceDataVersion: 1`; return `hangoutLink`), `appointment-service.ts` (event description), the final-confirmation text builder and T-APPOINTMENT-INFO (append the Meet link), tests.
- Event description (approved by Davi, PII visible in the consultant's calendar): customer name, phone as `https://wa.me/55…` link, objective, consortium type. Never in logs.
- Meet link: no new column (migration freeze). Read it back from the event (`events.get` by the stored Google event id) when T-APPOINTMENT-INFO is sent; if Google does not return a link, send the text without it and log `calendar_meet_link_missing` (no customer data).
- Reschedule request (R7d): append a dated line "Cliente pediu remarcação pelo WhatsApp" to the event description (`events.patch`), so the consultant is notified by the calendar itself; then send T-RESCHEDULE. **T-RESCHEDULE is approved (option A, see the top of this plan): "Tudo bem! Anotei seu pedido e o consultor entra em contato com você. Precisa de mais alguma coisa?"**
- Acceptance (red first, Google mocked): insert carries `conferenceData` + `conferenceDataVersion: 1`; description has name, wa.me link, objective; confirmation and T-APPOINTMENT-INFO carry the Meet link; missing link → text without link + log; R7d patches the event once per request (runKey) and never on redelivery; no phone or name in any log.
- Invariants: tokens only read; Calendar call outside the DB tx; booking compensation unchanged; `selectedSlotId` rule unchanged.

### Batch D (V4) — end-to-end, trace, docs
**D1.** Through the task handler: **V-15** (two messages in the debounce window → one turn, one outbox row, one trace), **V-17** (each route emits exactly one `mariana_turn` with `flow: "v2"`, `route`, `responder`).
**D2.** `scripts/simulate-conversation.ts` accepts `--flow v2` (mocked by default; real Gemini only with Davi's explicit permission, Q6).
**D3.** Docs: `docs/CODEMAP.md` (flow-v2 rows), `MARIANA_BEHAVIOR_SPEC.md` v1.5 (spec §7), `CLAUDE.md` pending-offer invariant text (only after Davi approves Q7), WhatsApp checklist for V5. Stop before V5.

## Next plan after v2 (Davi, 2026-10-28)
- **Appointment reminders**: WhatsApp reminder to the customer (e.g. 24h and 1h before) with the Meet link. Needs a Meta-approved WhatsApp **template** (outside the 24h window only templates are allowed); Davi registers it in WhatsApp Manager now. Code: template send support in the WhatsApp client/outbox + a scheduled task per appointment, cancelled on reschedule/cancel. Separate plan, separate approval.

## Out of scope
Migrations/schema; deleting v1 (separate cleanup plan); scheduling services' internals; storing taps as user messages (R-SCH-03 gap); consultant notification for reschedule; merging `*-adversarial` files; flaky UUID tests; real Gemini/WhatsApp/Calendar; Neon.

## Questions for the owner (detail in explicacao.md)
- Q1 fixed texts (+ new: T-APPOINTMENT-INFO, T-STATUS-SLOT, T-STATUS-CONFIRM; T-RESCHEDULE promises a notice nobody sends) — blocks A1 texts only (implementer can use spec wording and swap later).
- Q2 name from WhatsApp profile, never ask (rec.).
- Q3 objective only (rec.).
- Q4 button on every AI answer (rec.).
- Q5 whole-reject guard (rec.).
- Q6 `GEMINI_MODEL` from env; A2 comparison on v2 (rec.).
- Q7 pending offer from exact fixed text, plus T-AI-FALLBACK (rec.).
- Q8 V3 full (rec.) vs simple.
- Q9 minor age stored as derived `birthDate` (rec.).
- Q10 flag default `v1` until V5 (rec.).
