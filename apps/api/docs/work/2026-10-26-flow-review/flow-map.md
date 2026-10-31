# Flow map — `develop` @ `03afdc2`

Rules: `docs/specs/MARIANA_BEHAVIOR_SPEC.md` v1.2. Paths are relative to `src/`. ⚠ = silent exit (the customer gets nothing). Finding IDs (F2-xx) are in `findings.md`; F-xx are from `docs/work/2026-10-22-audit/audit-report.md` §4.

Abbreviations: `WH` = `routes/whatsapp/webhook-whatsapp.ts`, `TH` = `services/conversations/autonomous-task-handlers.ts`, `EX` = `services/conversations/autonomous-task-executor.ts`, `SCS` = `services/conversations/session-choice-store.ts`, `OB` = `services/messaging/outbound-messages.ts`, `GMR` = `services/conversations/generateMarianaResponse.ts`.

## 0. Common webhook prefix (every inbound)
1. `WH:286` `recoverStaleProcessingWebhookEvents`: `processing` events with an expired lease become `failed` (terminal; F-20). ⚠ No retry, no notice.
2. `WH:296` HMAC check. Failure → 401 (correct: not a customer).
3. `WH:308` non-WABA payload → 200 `ignored`.
4. `WH:322` change with no `messages` (statuses) → skip (correct).
5. `WH:335` ⚠ **any type other than text or button_reply** (audio, image, document, sticker, location, list_reply) → `continue`. No event row, no message, no reply (F2-08).
6. `WH:345` `claimWhatsAppWebhookEvent` (insert-or-reclaim by `externalId`). Duplicate → skip (R-REL-02, correct).
7. `WH:361` lead ingestion. `WH:371` `getOrCreateActiveConversation` in **its own** transaction (lead lock released when it commits; F2-20).
8. `WH:380-390` read the previous `lastCustomerMessageAt` **outside** any later transaction, before it is written (H2: read-before-write holds on both branches).
9. Any throw in steps 7–11 → `WH:617-637`: event `failed`, HTTP 200. ⚠ Meta does not redeliver after a 200, so nothing retries it (F2-10 / F-20).

## 1. Inbound text (`WH:498-615`)
Inside one transaction: read pending choice (`SCS:108`) → compute gap (`session-choice-policy.ts:7`) → insert message (`WH:509`) → write `lastCustomerMessageAt`/`optOutAt` (`WH:530`).
- **Pending choice** → task `remind_session_choice` (`WH:545`). The message stays `processedAt = null` (held).
  - `TH:1327` remind: pending → assistant row + reminder buttons → reply (R-SES-02, S-20).
  - `TH:1333` ⚠ no pending any more (the choice was resolved meanwhile) → `skipped`; the held message may never be answered (F2-14). Event not marked processed (F2-28).
  - Two messages in one burst after 4h → question **and** reminder (F2-07, S-18).
- **Gap and a previous timestamp** → `openSessionChoice` (`SCS:92`, `ON CONFLICT DO NOTHING` on `session-choice-state:<conversationId>`).
  - Opened → supersede pending tasks (`SCS:210`) → task `ask_session_choice` → `TH:1248` question with `Continuar` / `Nova conversa` (R-SES-02, S-18).
  - ⚠ **Not opened** (`WH:568` `if (opened)` false → `return`): the message is stored with **no task**. This happens on **every gap after a first `Continuar`**, because the resolved row keeps the unique key forever (F2-01). Also on a concurrent opener (harmless there: the message is replayed on the choice).
  - Opt-out text after 4h also opens the gate (F2-21; the approved design said the normal flow).
- **Otherwise** → `process_inbound_message` with an 8 s cutoff (`WH:588-614`), extending open batches (R-REL-01, S-12).
  - Executor claim `EX:65` → `TH:295` batch (`inbound-message-batch.ts:35`) → `GMR` (Gemini, stage, guardrails, `logTurnTrace` at `GMR:386`) → outbox → reply.
  - `TH:346/353` empty batch → `skipped` (justified: another task in the same batch answered).
  - `TH:369` existing `runKey` → dedup (justified, R-REL-02).
  - `TH:396-407` `ModelUnavailableError` → `MODEL_FAILURE_NOTICE` with the same `runKey` → reply (R-REL-05, S-17).
  - `TH:396-398` any other throw (guardrail L2/L4, DB) → retry, then `failed` (`EX:205-264`). ⚠ No notice (F2-11 / F-08).

## 2. Scheduling button tap (`WH:392-497`, not `sessao:`)
Same transaction pattern. The tap is **never** stored in `messages` (F-12, R-SCH-03).
- Pending choice → `process_session_choice` kind `invalid` → `TH:1474-1512` reminder buttons → reply (S-20).
- Gap → gate opened with `discardButtonId`; the tap itself is dropped (H3). After `Continuar` it is **not** replayed (F2-03).
- Otherwise → by prefix: `pref:` → `TH:733`, `consultant:` → `TH:951`, `confirm:`/`cancel:` → `TH:452`, UUID → `TH:1106`, anything else (including a stale `sessao:*`) → `TH:452`.
- Each handler first re-checks the pending choice (`TH:98-168`) → reminder → reply.
- Silent exits (F-03, package B; still present):
  - `TH:452` button reply: `confirm` not ok `TH:522-540` ⚠, `cancel` not ok `TH:551-581` ⚠, choice not ok `TH:590-605` ⚠ — this last one also catches a stale `sessao:*` tap (F2-06).
  - `TH:733` preference: invalid id → permanent failure `TH:749` ⚠; `TH:804`, `TH:809` ⚠.
  - `TH:951` consultant: `TH:966` ⚠ (permanent failure); `TH:1021`, `TH:1026`, `TH:1038`, `TH:1055` ⚠.
  - `TH:1106` slot: `TH:1167`, `TH:1179`, `TH:1241` ⚠.
  - `TH:624` preference question (internal, F-02 legacy path): `TH:659`, `TH:664` (no customer input; justified). It has **no** pending-choice guard (F2-15).
- Rules: R-SCH-01…05, S-07, S-08, S-09.

## 3. Session-choice tap (`sessao:*`)
- Routed to `process_session_choice` **only while a choice is pending** (`WH:411-426`). After the choice is resolved, a `sessao:*` tap goes to `process_button_reply` → `TH:590` ⚠ (F2-06).
- `TH:1437` handler:
  - No pending → "Sua escolha já foi registrada" text (`TH:1444-1471`); no assistant row (F2-16).
  - `sessao:<anything except nova>` → treated as `continue` (`TH:1517`, F2-22).
  - `claimSessionChoice` (`TH:1515`) runs **outside** the transaction that applies the effects (`TH:1550`, `TH:1582`). If the effects fail, the retry sees "already recorded" (F2-02). ⚠
  - **Continuar** `TH:1549-1579`: one `process_inbound_message` per held message, with the same cutoff (`TH:1400-1435`) → one combined reply in order (H1 ok for held text). Picks **every** unprocessed user message of the conversation, including old ones (F2-13). ⚠ **No held message (gate opened by a tap) → nothing is sent** (F2-03).
  - **Nova conversa** `TH:1581-1747`, one transaction: lock A and the lead; snapshot into the state row; reset the commercial fields; close A; expire the active scheduling session; create B (`active-conversation.ts`); copy `optOutAt` and `lastCustomerMessageAt`; move the held messages to B and enqueue them; set the status by appointment date (`TH:1707-1731`, R-SES-04, step 9 **is implemented**); enqueue the confirmation text with no assistant row (F2-16, F2-17).
- Rules: R-SES-02, R-SES-04, S-18, S-19, S-20.

## 4. Outbox send and retry (`OB`)
- Claim with lease (`OB:~110-137`) → compliance (`whatsapp-compliance.ts:23-56`): opt-out or closed 24h window → `failed` ⚠ (F-23, logged decision only).
- Send → `sent`; accepted but persisting `sent` failed → `unknown` (`OB:290-346`, R-REL-03, never resent: justified by the invariant).
- Network failure before connecting → retry up to `maxAttempts` (5), then `failed` ⚠ (`OB:246-282`).
- Expired lease → `unknown`, no resend (`OB:383-400`).
- Rules: R-REL-03, R-REL-04, R-REL-05.

## 5. Model failure
- `ai/agent.ts` wraps transport, empty and invalid-JSON errors in `ModelUnavailableError` (`ai/model-errors.ts`).
- `TH:396-407` → `sendModelFailureNotice` (`TH:244-293`): assistant row, outbox with the existing `runKey`, messages and event marked processed, `mariana_model_failure` log; `GMR` emits `mariana_turn` `outcome: model_error`.
- Inside gate flows (H7): the ask, remind and choice handlers never call the model. After Continuar/Nova the held messages go through the same `TH:295` path, so a failure gives exactly one notice. After Nova the customer gets the confirmation **and** the notice (2 bubbles, acceptable).
- Not covered: guardrail throws (F-08) → silent `failed` (F2-11).
- Rules: R-REL-05, S-17.

## 6. Task lease expiry
- The worker (`services/reliability/background-workers.ts:43-58`) calls `executeNextAutonomousTask({ handlers })` **without** `conversationId`, so the pending-choice claim filter (`EX:79-99`) **never runs in production** (F2-15).
- An idle poll → `recoverStaleAutonomousTasks` (`EX:354-386`): `processing` with an expired lease → `pending` (retried) or `failed` when attempts are exhausted ⚠ (no notice).
- Handler idempotency: every reply uses a `runKey`, so a re-run after a lease loss dedups (R-REL-02/03).
- The `session_choice_state` row is `completed`. No code path in `src/` deletes, reclaims, supersedes or leases `completed` rows: `markSupersededTasks` filters `pending` and excludes the type (`SCS:227-232`); recovery filters `processing`; no `delete(autonomousTasks)` exists outside the tests (H6).

## 7. Other entry points (not WhatsApp)
- `POST /conversations/:id/messages` (`routes/messages/create-messages.ts:6` → `receive-customer-message.ts:20-161`): legacy in-memory debounce, calls Gemini **without** the session gate, accepts `role: assistant|system`, no auth (F2-05).
- `GET /leads`, `/messages`, `POST /appointments`, `POST /leads`, `POST /conversations`: registered in `server.ts:56-74` with no auth hook (F2-05).

## 8. Turn trace coverage (H8)
- `logTurnTrace` has one call site: `GMR:386`. The gate question, reminders, choice replies, scheduling buttons and confirmations emit **no** `mariana_turn` line; `pureBackendText` only exists on model turns (F2-19, R-REL-07).
