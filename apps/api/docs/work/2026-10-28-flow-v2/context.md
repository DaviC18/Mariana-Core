# flow-v2 — context pack for planner / implementer / tester

Read this with `docs/specs/2026-10-28-mariana-flow-v2.md` and `docs/CODEMAP.md`. It points at the code v2 reuses, so nobody re-explores the tree. Line numbers are from 2026-10-28 (working tree with scheduling-loop + api-auth uncommitted); re-check with `grep` before editing.

## Status
- Spec corrected 2026-10-28 (no session choice; behavior spec v1.4 → v1.5; V-18; Q7). Davi approved the to-do list; **implementation waits for Davi's explicit approval of the plan**.
- Delivery decision: the customer gets v2; v1 stays behind `MARIANA_FLOW=v1` until Davi approves v2 on WhatsApp; then a separate plan deletes the v1 brain (list in the spec header) and the flag. v2 must not depend on any v1-brain file, so that deletion is safe.
- Preconditions: flow-review PASS (`docs/work/2026-10-26-flow-review/test-report.md:922`); scheduling-loop PASS (A/B/C); api-auth must finish with all suites green.

## Switch point (the only place v1/v2 diverge)
- `src/services/conversations/autonomous-task-handlers.ts:321` — `handleProcessInboundMessage` calls `generateMarianaResponse({ currentMessages, expectedConversationId, leadId, messageCutoff, messageIds, persistUserMessage: false, traceTurnId })`.
- Keep around it, unchanged for both flows: runKey dedup (`:300-310`, outbox `idempotencyKey = runKey`), `TurnSupersededError` → skipped, `ModelUnavailableError` → `MODEL_FAILURE_NOTICE`, last-attempt notice (`INBOUND_TASK_MAX_ATTEMPTS = 3`, ends `failed`; scheduling-loop step 3).
- Outbound payload is built at `:372-378` (`schedulingOffer` → `buildWhatsAppSchedulingOffer` or single-slot confirmation; else text). v2 `run-turn` should return the same shape (`finalReply` + optional `schedulingOffer`) so this code is reused, or the plan states why not.

## Reuse map
| v2 need | Reuse | Where |
|---|---|---|
| Debounce / batch | `selectInboundMessageBatch`, `buildInboundReplyIdempotencyKey` | `inbound-message-batch.ts:35,69` |
| Outbox | `enqueueOutboundMessage({ conversationId, executor, idempotencyKey, leadId, messageId, payload })`; type `OutboundMessagePayload` | `services/messaging/outbound-messages.ts:20,52` |
| Buttons (≤ 3, title ≤ 20) | `buildWhatsAppSchedulingOffer`; button-reply type | `scheduling-offer-service.ts:44`; `integrations/whatsapp/whatsapp-types.ts:27` |
| Slots (R8) | `SchedulingAvailabilityService.getAvailableSlots` → `SchedulingOfferService.persistOffer({ conversationId, executor: tx, finalReply, leadId, messageId, ... })` | v1 call sites: `generateMarianaResponse.ts:956,1009`; second example `autonomous-task-handlers.ts:570` |
| Calendar down (V-18) | catch `CalendarUnavailableError` only → `CALENDAR_UNAVAILABLE_TEXT`, log `scheduling_calendar_unavailable` | `google-calendar-errors.ts`; `calendar-unavailable-notice.ts`; v1 catch `generateMarianaResponse.ts:956-990` |
| Per-consultant tokens / broken consultants | already inside `GoogleCalendarService` + `consultant-availability.ts` | nothing to do in v2 |
| Slot tap / Confirmar / booking | existing button handlers (`process_button_reply`, `send_confirmation_request`) | `autonomous-task-handlers.ts`; `services/calendar/scheduling-{choice,confirmation}-service.ts` |
| Stale taps (old `sessao:*`, `pref:*`, `consultant:*`) | `replyToStaleTap` | `stale-tap-reply.ts` |
| 4h rotation (R2) | `resolveConversationForInbound` (runs in the webhook, before the task) | `session-rotation.ts` |
| Opt-out / 24h window (R1) | existing | `whatsapp-compliance.ts` |
| Lead field merge | `updateLeadFromAgent` (check whether its input fits the v2 `fields`; else a thin adapter) | `services/leads/update-lead-from-agent.ts:276` |
| Pending offer (Q7) | today `detectPendingOffer` looks for `CONSULTANT_OFFER_MARKERS` in the previous assistant text; `isClearAffirmative`; `acceptsPendingOffer` | `pending-offer.ts:24,107,136` |
| Knowledge (all of it, no retrieval) | `MARIANA_KNOWLEDGE` | `src/ai/knowledge/index.ts:6` |
| Gemini client + model config | `ai` client, `resolveModelName`, `buildModelRequestConfig` | `src/ai/client.ts`, `src/ai/agent.ts` |
| Model failure | `ModelUnavailableError`, `MODEL_FAILURE_NOTICE` | `src/ai/model-errors.ts`, `model-failure-notice.ts` |
| Trace | `logTurnTrace`, `hashText`; add `flow/route/responder/intent/guardRejected` | `src/lib/turn-trace.ts:132,199` |
| Error logging | `describeError` | `src/lib/error-classification.ts` |
| WhatsApp profile name (Q2) | webhook already reads `contact.profile.name` | `webhook-whatsapp.ts:367` |

## Do not reuse in v2 (v1 brain)
`ai/prompt.ts`, `ai/agent.ts` `generateMarianaReply` + `STAGE_GUIDANCE`, `ai/knowledge/retrieve.ts`, `validate-response.ts`, `mariana-safety.ts` sanitizers, `conversation-stage.ts`, `execute-next-action.ts`, rewrite layers L0–L11. v2 must not import them (a test can assert this).

## Tests
- Gemini mock: `src/tests/support/conversation-harness.ts` (`installScriptedGemini`, `ScriptedTurn`, `runScriptedConversation`, `createConversationFixture`, `cleanupConversationFixture`, `buildFakeAvailabilityService`). v2 needs a scripted `understand` JSON response; extend the harness, do not fork it.
- Unit tests: add each new file to the explicit list in `package.json` `test:unit`.
- DB: `TEST_DATABASE_URL=postgresql://mariana:mariana@localhost:5432/mariana_test DOTENV_CONFIG_PATH=/dev/null RELIABILITY_WORKERS_ENABLED=false`. The shell's own `TEST_DATABASE_URL` (localhost:5433) belongs to another project; never use it.
- Known flaky (UUID digits): `generate-mariana-response.test.ts:934-936`, `turn-trace-integration.test.ts:288`. New v2 tests must strip UUIDs before any phone-digit regex.
- Simulator with real Gemini (`npm run sim:conversation`): only with Davi's explicit permission.

## Token budget rules for this task
- Planner: start from the spec, this file and the line ranges above instead of exploring the tree. Always read the code you plan to change or reuse; if this map is wrong or missing something, read what is needed and fix the map.
- Never trade quality for tokens: TDD red → green, tester per batch, full suites per batch and Davi's approval gates stay as in `CLAUDE.md`.
- One batch = 1–3 steps; implementer runs only affected tests while iterating; full suites once per batch.
- Subagent replies ≤ 20 lines; details go in `progress.md` / `test-report.md`.

## Test hygiene during v2 (Davi, 2026-10-28)
- The tester adds cases to the module's own test file; no new `*-adversarial.test.ts` file per verification.
- One test per scenario (V-01…V-18); do not repeat a scenario across files.

## After v2 (Davi, 2026-10-28): system cleanup, one plan, after the WhatsApp approval (V5)
1. Delete the v1 brain and the `MARIANA_FLOW` flag (list in the spec header), with its ~21 test files (~6.7k lines).
2. Merge the 13 `*-adversarial.test.ts` files into their module test files, without losing cases.
3. Fix the flaky UUID-digit tests (`generate-mariana-response`, `turn-trace-integration`, `autonomous-task-executor:275` timing).
4. Fold in the open items of `docs/work/2026-10-27-hygiene/plan.md` (DRAFT, Q1–Q3 unanswered) and the loop/login follow-ups (F-6, N-B*, D-7, D-4 `@fastify/multipart`, `webhook-whatsapp.ts` constant-time verify token).
5. Update `docs/CODEMAP.md` and `CLAUDE.md` to the v2-only system.

## Map corrections (planner, 2026-10-28)
- `resolveModelName` / `buildModelRequestConfig` live in `src/ai/agent.ts`, a v1-brain file, and the config builder is bound to the v1 schema (`agent.ts:52-76`). v2 must not import `agent.ts`: plan step A1 moves both to `src/ai/model-config.ts`; `agent.ts` re-exports them (behavior unchanged).
- `updateLeadFromAgent` throws `"Lead must be at least 18 years old"` when the merged `birthDate` is under 18 (`update-lead-from-agent.ts:322-327`), and every later call throws too if the minor date is passed as `existingLead.birthDate`. v2 needs a thin adapter (plan step B3, question Q9).
- Lead name fallback is the phone number (`lead-ingestion.ts:91`). T-WELCOME must never use a name equal to the phone or without letters.
- Meeting facts (30 min, Google Meet) are only in `src/ai/prompt.ts:182-184` (v1), not in the knowledge files. v2 puts them in its own prompt.
- `MARIANA_KNOWLEDGE` contains `clientAllowed: false` items (`knowledge/index.ts:20+`). v2 sends only `clientAllowed: true` content to the model.
- `OutboundMessagePayload` already supports `{ kind: "buttons", body, buttons }` (`outbound-messages.ts:20-22`); an AI reply + "Falar com consultor" is one buttons message. No new payload kind.
- The current-stage buttons builder is private: `buildStaleTapPayload` (`stale-tap-reply.ts:79-148`). Plan step A2 extracts the stage part for reuse (R7e, R5 during scheduling).
- `consultor:falar` taps already reach `handleProcessButtonReply` (`webhook-whatsapp.ts:501-523`, default task type); the new branch goes there (`autonomous-task-handlers.ts:~728`, before `confirm:`).
- R8 template: `sendSlotUnavailableReoffer` (`autonomous-task-handlers.ts:497-631`): Calendar outside the tx, then lead lock + active check + assistant row + `persistOffer({ executor: tx })` + outbox in one tx. It does not catch `CalendarUnavailableError`; v2 R8 must (V-18).
- Opt-out is stored on the inbound (`webhook-whatsapp.ts:588`, `conversations.optOutAt`); the outbox blocks sends after it. Taps are not stored as user messages (existing gap vs R-SCH-03; out of scope).
- No `statedCreditValue` column or code exists anywhere; v1 never stored it.
