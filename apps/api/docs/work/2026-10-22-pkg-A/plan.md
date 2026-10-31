Status: APPROVED by Davi — "ok eu aprovo" (2026-10-27, Batch E revision 3)

Revision 3 decisions, approved by Davi's "ok eu aprovo" (2026-10-27) in reply to `explicacao-batch-E-rev3.md`. The reply was relayed word for word by the coordinator, who had told Davi that a plain approval accepts the planner's 4 recommendations:
1. E-12 trigger (step 20): the entry script `argv[1]` is `*.test.*` **or** a path under `src/tests/`. `NODE_ENV=test` is not used.
2. E-11: step 21 is done now.
3. E-12b: listed only, no step.
4. Order: step 20 (batch E-R3a) first, then step 21 (batch E-R3b), with the tester checking each batch.

Revision 3 (Batch E, steps 20–21) was written as DRAFT on 2026-10-26 (previous status line: `Status: DRAFT`). It does not change any done step (12, 13, 14, 14a–14d, 15, 16, 17, 18a, 18, 19). History: previous status line was `Status: APPROVED by Davi — "aprovo" (2026-10-26, Batch E revision 2)`; that approval still covers Revision 2 as written, including the E-R2c batch the tester is verifying now.


Revision 2 decisions, approved by Davi's "aprovo" (2026-10-26) in reply to `explicacao-batch-E-rev2.md`. The reply was relayed word for word by the coordinator; the planner did not receive it directly. The coordinator had told Davi that a plain "aprovo" accepts the planner's 6 recommendations and runs the batches in order E-R2a → E-R2b → E-R2c, with the tester checking each one:
1. Step 15 (revised): child-process unit test with a fake `.env` in a temp folder. No check inside `src/env.ts`.
2. E-4 (step 14c): pure structural rule in the guard, plus a test that compares it with postgres.js. The guard does not call the driver's parser.
3. E-5 (step 14d): `TEST_DATABASE_URL` must name its port and database explicitly. `PG*` variables are not refused.
4. Step 16 trigger: `NODE_TEST_CONTEXT` is set **or** `--test` is in `execArgv`/`argv`. This replaces the approved "`--test` condition" property; the pure predicate and the `ALLOW_REMOTE_TEST_DB=1` hatch stay.
5. Egress: steps 18a, 18 and 19 now (fail the file on a blocked egress, then mock the leaks).
6. E-7/E-8: closed in step 18a under its size rule; otherwise left as `todo` and reported. E-9/E-9b listed only.

History: previous status line was `Status: DRAFT — Batch E revision 2 waiting for Davi's approval (2026-10-26)`. Before that it was `Status: APPROVED by Davi — "aprovo" (2026-10-26, Batch E revision 1)`. That approval still covers steps 12, 13 (revised), 14, 14a, 14b and 17, which are done (17 PASS in `test-report-batch-E.md` "Step 17"). Revision 2 (bottom of this file) replaces step 15, amends step 16 and adds steps 14c, 14d, 18a, 18 and 19.

Revision 1 decisions, approved by Davi's "aprovo" (2026-10-26). The coordinator had told him that a plain "aprovo" accepts the planner's 4 recommendations:
1. Step 13: option B — new `assertAppliedTestDatabaseEnv` used by `drizzle.test.config.ts`; `setup-test-db.ts` calls `applyTestDatabaseEnv`. Options A and C rejected.
2. Step 14a: `TEST_DATABASE_URL` may carry only the `sslmode` query parameter (allowlist).
3. The implementer may rewrite the tester's todo test at `src/tests/test-database-guard-adversarial.test.ts:105-119` to target the new export, and records the change in `progress.md`.
4. Flaky `src/tests/reliability/autonomous-task-executor.test.ts:275`: noted only, no step.

History: previous status line was `Status: APPROVED by Davi — 2026-10-22.` That approval covers Batches A–D and steps 12, 14, 15–17 as originally written. Revision 1 (bottom of this file) changes step 13 and adds steps 14a/14b; it needs a new approval before the implementer resumes Batch E.

Approved on these explicit terms, after Davi was shown that condition 1 did not hold: decisions 2–7 are applied below; item 1 is **unresolved**, because the wording of `R-REL-07` and `S-17` was not found in any copy of the spec (see "Open blocker"), so the three acceptance criteria at steps 2, 7 and 11 stay marked as derived from Davi's brief, and **final acceptance against the spec remains open**. Davi chose to start Batch A anyway. Execution order: implementer per batch A → E, tester after each batch. Nothing is ever placed in version control without Davi's explicit word.

# Package A — "Enxergar e proteger" (turn trace, model config, honest model failure, test safety)

Task id: `2026-10-22-pkg-A` · Roadmap row **A** (`docs/specs/ROADMAP-2026-10-22.md:24`) · Audit **WP-0** (`docs/work/2026-10-22-audit/audit-report.md:658`) · Findings **F-15**, **F-06**, parts of **F-20** · Snapshot **N6**.

## Summary

Three observability/configuration changes plus one safety change, with **no conversation-behaviour change**: (1) one structured log line per turn that says what the model produced and which of the eleven rewriting layers altered it; (2) model id, temperature, thinking level and output cap move to `.env` with validated defaults; (3) a Gemini failure after retries sends the client a short honest message instead of leaving him silent; (4) the four cheap test-isolation holes from the coverage report are closed, starting with the unused `vitest` dependency and `setup-test-db.ts`.

Everything here is schema-free. The migration freeze (`CLAUDE.md`) is respected: no step needs a migration, so no step is BLOCKED on it.

## Open blocker (re-verified 2026-10-22, after Davi's item 1)

Davi's item 1 states that spec v1.1 was restored at `docs/specs/MARIANA_BEHAVIOR_SPEC.md` and asks the planner to read `R-REL-05`, `R-REL-07` and `S-17` there and replace the pending markers. That file was searched for again and **the restore did not land**. Evidence:

| Check | Result |
|---|---|
| `ls docs/specs/` | only `2026-10-17-scheduling-and-session-flow.md` and `ROADMAP-2026-10-22.md` |
| name search across the repo, excluding `node_modules` | no file with "BEHAVIOR" in its name |
| tracked-file listing and path history | the path has never existed in version control, so there is no blob to restore |
| search outside the repo | one copy found: `~/Downloads/mariana-agent-team-1/docs/specs/MARIANA_BEHAVIOR_SPEC.md`, 9182 bytes, mtime 2026-10-21 17:58 |

That copy is **v1.0**, not v1.1: its header reads `Versão: 1.0 (2026-10-21) · Dono: Davi`, its §6 reliability table stops at `R-REL-06`, and its §8 scenario table stops at `S-15`. So:

- **`R-REL-05` wording is now available** and is quoted verbatim below. It was never one of the pending markers in this plan, so no marker changes on its account.
  > `R-REL-05` — *"Nenhuma falha deixa o cliente sem resposta indefinidamente; erros relevantes aparecem nos logs."*
  Read against item 3 of this package, the criterion holds: a `ModelUnavailableError` stops being silence (the client gets the approved notice) and starts being a logged event (`mariana_model_failure` plus the turn trace). The acceptance criteria of steps 9–11 already match this rule and need no change.
- **`R-REL-07` and `S-17` do not exist in any copy that can be found.** They appear in the repository only as bare ids in the roadmap table (`docs/specs/ROADMAP-2026-10-22.md:24`). Their wording is still lost, so the three markers at steps 2, 7 and 11 **stay as they are** (the planner first wrote "steps 4, 7 and 11"; the tester caught it — the markers are at plan body steps 2, 7 and 11, and step 4 never had one). No spec prose is invented, no spec file is written by the planner, and the `~/Downloads` v1.0 copy is not moved into the repository without Davi's word — it would be filed as the v1.1 restore while being v1.0.

Consequence: every acceptance criterion that would quote `R-REL-07` or `S-17` remains written from Davi's brief and marked
**"redação de R-REL-07/S-17 não disponível — critério derivado do brief, pendente de confirmação"**.
This does **not** block implementing Package A; it blocks declaring the package accepted against the spec.

## Root causes

| # | Claim | Status | Evidence |
|---|---|---|---|
| RC-1 | Nothing in the decision path logs anything about the model turn, so "did she reason badly or did we delete her reasoning?" is unanswerable | **confirmed** | `src/ai/agent.ts:250` parses `rawText` and drops it; `agent.ts:284-290` returns `metadata {latencyMs, model, usage}`; the only caller, `generateMarianaResponse.ts:700`, returns it upward and `autonomous-task-handlers.ts:190-196` ignores it. No `console.*` and no logger import in `src/ai/` or `generateMarianaResponse.ts`. Audit §2.3.3 |
| RC-2 | Eleven layers can rewrite or replace the reply and none of them is observable | **confirmed** | Enumerated with file:line in audit §2.3 (L0 `agent.ts:198-213` … L11 `generateMarianaResponse.ts:654`). `composeStageReply` (`conversation-stage.ts:381-425`) returns a bare `string`, so L6–L9 leave no trace at all |
| RC-3 | The model is called with no temperature, no thinking configuration and no output cap, at the cheapest tier, from a hard-coded constant | **confirmed** | `src/ai/agent.ts:36` `const MODEL = "gemini-3.5-flash-lite"`; `agent.ts:240-248` `config` has only `responseJsonSchema`, `responseMimeType`, `systemInstruction`. Audit §2.1 |
| RC-4 | A wrong model id silences clients: the id is a source constant, 404 is (correctly) not retried, and a task failure sends nothing | **confirmed** | `src/ai/client.ts:4-11` retries only 408/429/500/502/503/504; `agent.ts:36` constant; `autonomous-task-handlers.ts:190` has no try/catch around `generateMarianaResponse`, so the throw propagates to the executor, which retries and then marks the task `failed` (`autonomous-task-executor.ts:200-243`) with no outbound message. N6: 19 `process_inbound_message` failures on Oct 13–14 (`docs/NEON_SNAPSHOT_2026-10-22.md`, audit §2.1.1) |
| RC-5 | `vitest ^5.0.4` is an unused runtime dependency that would run the whole DB suite with no preload, no guard and real credentials | **confirmed** | `package.json:33`, no `vitest.config.*`/`vite.config.*`, no script uses it, `grep -rn vitest` outside `node_modules` hits only that line (verified by the caller and by coverage report §4.3 hole 1) |
| RC-6 | `setup-test-db.ts` keeps `DATABASE_URL` = Neon in a process whose next statement is `DROP SCHEMA public CASCADE` | **confirmed** | `src/tests/support/setup-test-db.ts:7` `import "dotenv/config"`; line 19 destructures `resolveTestDatabaseEnv(process.env)` into a local and never assigns `process.env`; line 24 opens the pool on the (correct) test URL, line 26 drops the schema, line 39 passes `env: process.env` to `drizzle-kit push`. Safe today only because `drizzle.test.config.ts:11` re-resolves the URL itself. Coverage report §4.3 hole 4 |
| RC-7 | The guard is a one-vendor hostname denylist, not a "disposable local database" allowlist | **confirmed** | `src/tests/support/test-database-guard.ts:53` `hostname.includes("neon.tech")`. Coverage report §4.3 hole 3 |
| RC-8 | `unit-test-preload.ts` is correct only because dotenv does not override | **confirmed** | `unit-test-preload.ts` has no `import "dotenv/config"` (unlike `db-test-preload.ts:5`); correctness rests on dotenv's default `override: false`. Coverage report §4.3 hole 5 |
| — | "A startup check that the configured model exists would prevent N6" | **unclear, moved out of scope** | Verifying existence requires a live `models.get`/`models.list` call. I may not call the API, and a boot-time network call is a new failure mode. Env-level *shape* validation (step 1) catches typos; item 3 makes the remaining case non-silent. A live probe is listed in "Out of scope" with a question for Davi |

## Design

### Item 1 — turn trace

New module `src/lib/turn-trace.ts`:

- `export type RewriteRecord = { layer: RewriteLayer; lengthBefore: number; lengthAfter: number; hashBefore: string; hashAfter: string; detail?: Record<string, number | string> }`
- `export type RewriteLayer = "L0_level3_short_circuit" | "L1_identity_sanitizer" | "L2_evidence_invalid_id" | "L3_evidence_handoff" | "L4_safety_assertion" | "L5_request_consultant_override" | "L6_dropped_questions" | "L7_dropped_greeting" | "L8_sentence_cap" | "L9_neutral_fallback" | "L10_unauthorized_scheduling" | "L11_slot_offer_replaced"` — exactly the eleven layers of audit §2.3 (L0…L11, twelve ids because the audit numbers from L0).
- `export function hashText(text: string): string` — `createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)` from `node:crypto`.
- `export function logTurnTrace(trace: TurnTrace): void` — emits exactly one line: `console.info(JSON.stringify({ event: "mariana_turn", ...trace }))`.

Why `JSON.stringify` and not the existing `console.info({...})` style of `execute-next-action.ts:205`: `console.info(object)` goes through `util.inspect`, which truncates nested objects beyond depth 2 and wraps wide objects over several lines. The trace has a nested `usage` object and an array of rewrite records, so the inspect form would silently lose fields and break "one line per turn". A single `JSON.stringify` line is greppable (`grep '"event":"mariana_turn"'`) and `jq`-able. Pino is not used directly because `src/lib/logger.ts` only exports Fastify logger *options*, not an instance, and the turn runs in a background worker with no request context.

**Log line shape.** One JSON object, flat except `usage` and `rewrites`.

| Field | Type | Source |
|---|---|---|
| `event` | `"mariana_turn"` (literal) | constant |
| `turnId` | string (uuid) | the anchor task id — `task.id` in `handleProcessInboundMessage`, threaded into `generateMarianaResponse` as a new optional `traceTurnId` param |
| `conversationId` | string (uuid) | `activeConversation.id` |
| `leadId` | string (uuid) | `leadId` param |
| `outcome` | `"replied" \| "model_error" \| "guardrail_throw"` | `"replied"` on the success path; `"model_error"` from step 9's catch; `"guardrail_throw"` when L2/L4 throw (F-08's path, unchanged behaviour, now visible) |
| `model` | string | `env.GEMINI_MODEL` on the request side |
| `modelVersionReturned` | string \| null | `response.modelVersion` (`agent.ts:288`) |
| `temperature` | number | `env.GEMINI_TEMPERATURE` |
| `thinkingLevel` | string | `env.GEMINI_THINKING_LEVEL` |
| `maxOutputTokens` | number | `env.GEMINI_MAX_OUTPUT_TOKENS` |
| `latencyMs` | number | existing `Date.now() - startedAt` (`agent.ts:286`) |
| `usage.promptTokens` | number \| null | `response.usageMetadata.promptTokenCount` |
| `usage.candidatesTokens` | number \| null | `…candidatesTokenCount` |
| `usage.thoughtsTokens` | number \| null | `…thoughtsTokenCount` (confirms the thinking level took effect) |
| `usage.totalTokens` | number \| null | `…totalTokenCount` |
| `finishReason` | string \| null | `response.candidates?.[0]?.finishReason` — detects `MAX_TOKENS` truncation |
| `stage` | string | `turnStage.stage` (pre-turn) |
| `postTurnStage` | string | `postTurnStage.stage` |
| `questionKey` | string \| null | `postTurnStage.questionKey` (null when the backend adds no question) |
| `requestedNextAction` | string | `response.result.nextAction` — what the model asked for |
| `executedAction` | string | `nextActionResult.action` / `.status` — what the gate executed |
| `actionBlockedReason` | string \| null | from `executeNextAction`'s blocked branch, when present |
| `commercialAccessLevel` | 1 \| 2 \| 3 | `commercialAccess.level`, returned in metadata by `agent.ts` |
| `rawReplyLength` | number | `.length` of the model's `reply` **before** any layer |
| `rawReplyHash` | string (12 hex) | `hashText(rawReply)` |
| `sentReplyLength` | number | `.length` of the text actually enqueued |
| `sentReplyHash` | string (12 hex) | `hashText(sentReply)` |
| `pureBackendText` | boolean | `true` when no model sentence survived: computed as `rewrites` containing any of `L0`, `L3`, `L5`, `L9`, `L10`, `L11` *and* the final text sharing no sentence with the raw reply. Implemented as a pure helper `isPureBackendText(rawReply, sentReply, rewrites)` in `turn-trace.ts`, unit-tested |
| `rewrites` | `RewriteRecord[]` | one entry per layer that **changed** the text; layers that ran and changed nothing emit nothing |

`RewriteRecord.detail` carries counts where they are known: `{ questionsDropped: 2 }` (L6), `{ greetingsDropped: 1 }` (L7), `{ sentencesTruncated: 1, cap: 2 }` (L8), `{ fallbackText: "neutral_1" }` (L9 — the label, never the client-visible string... the fallback text is backend-authored, so the label suffices).

**Privacy rule, mechanical.** The `TurnTrace` type contains **no field whose type allows free text written by the client or by the model**: every text is reduced to `number` (length) and a 12-hex-char `hashText` at the call site. The phone number is never passed in — only `leadId`. Therefore no client message, no reply body, no system prompt, no knowledge content and no phone can appear in the line even by accident; a future field that would carry text requires changing the exported type, which the review will catch. Client text is never even hashed: only Mariana's own (model or backend) reply text is hashed.

**Hash and truncation choice.** SHA-256, hex, first 12 characters (48 bits). SHA-256 because it is in `node:crypto` with no dependency; 12 characters because the only questions asked of the hash are "is the sent text the same string as the raw reply?" and "is this the same boilerplate as in that other turn?", for which 48 bits over a corpus of at most a few hundred thousand turns has negligible collision probability (birthday bound ≈ 1 in 10⁵ at 10⁶ turns), while a full 64-character digest would triple the line size. No salt: the hashed strings are Mariana's own replies, never the client's words, so dictionary inversion of her own boilerplate reveals nothing private — and cross-deploy comparability is worth more than resistance to inverting a text we also store in `messages`.

**Example line (fake data):**

```
{"event":"mariana_turn","turnId":"0f3c5a21-0000-4000-8000-000000000001","conversationId":"0f3c5a21-0000-4000-8000-000000000002","leadId":"0f3c5a21-0000-4000-8000-000000000003","outcome":"replied","model":"gemini-3.5-flash-lite","modelVersionReturned":"gemini-3.5-flash-lite","temperature":0.3,"thinkingLevel":"LOW","maxOutputTokens":1024,"latencyMs":1432,"usage":{"promptTokens":5871,"candidatesTokens":96,"thoughtsTokens":212,"totalTokens":6179},"finishReason":"STOP","stage":"info","postTurnStage":"consultant_offer","questionKey":"consultantOffer","requestedNextAction":"continue_qualification","executedAction":"continue_qualification","actionBlockedReason":null,"commercialAccessLevel":1,"rawReplyLength":268,"rawReplyHash":"9f2b7c41ad03","sentReplyLength":191,"sentReplyHash":"41d8ee0b7c92","pureBackendText":false,"rewrites":[{"layer":"L6_dropped_questions","lengthBefore":268,"lengthAfter":214,"hashBefore":"9f2b7c41ad03","hashAfter":"b70c1a9e4452","detail":{"questionsDropped":1}},{"layer":"L8_sentence_cap","lengthBefore":214,"lengthAfter":129,"hashBefore":"b70c1a9e4452","hashAfter":"5c3390ba1e77","detail":{"sentencesTruncated":1,"cap":2}}]}
```

**Where it is called.** Once per turn, at the end of `generateMarianaResponse` (after the scheduling-offer block, i.e. after `generateMarianaResponse.ts:694`), so it sees both ends including L11; and once in the model-failure catch of step 9. To keep the layers reportable without restructuring, instrumentation is additive:
- `agent.ts` returns the L0–L4 records plus the raw reply hash/length in `metadata` (new fields, existing fields untouched);
- `conversation-stage.ts` gains `composeStageReplyWithTrace(input): { reply, rewrites }` and `composeStageReply` becomes a one-line wrapper returning `.reply`, so no existing caller or test changes;
- `persistAuthorizedAssistantReply` adds `rewrites` to its returned object (L5, L10);
- the L11 record is produced inline in `generateMarianaResponse` where `finalReply` is replaced.

### Item 2 — model config in `.env`

Field names verified in the installed SDK typings, `node_modules/@google/genai/dist/genai.d.ts`:
- `GenerateContentConfig` (declared at line 6121) has `temperature` (line ~6143), `maxOutputTokens` (~6161), `thinkingConfig?: ThinkingConfig` (~6266), and also `abortSignal` and `topP`/`topK`.
- `ThinkingConfig` (line 15888) has `includeThoughts`, `thinkingBudget` ("0 is DISABLED, -1 is AUTOMATIC… model dependent") and `thinkingLevel?: ThinkingLevel`.
- `ThinkingLevel` (line 15902) = `THINKING_LEVEL_UNSPECIFIED | MINIMAL | LOW | MEDIUM | HIGH`.
- The same file, line 13753, states the governing fact: **"Starting from Gemini 3.5 models, the old thinking_budget will no longer be supported and will result in a user error if set. Instead, users should use the thinking_level parameter to control the maximum thinking depth."**
- Usage counters: `GenerateContentResponseUsageMetadata` has `promptTokenCount` (6485), `candidatesTokenCount` (6481), `thoughtsTokenCount` (6489), `totalTokenCount` (6495).

So Davi's `GEMINI_THINKING_BUDGET` becomes **`GEMINI_THINKING_LEVEL`** ("or the SDK's equivalent setting", per the brief): a token budget on a 3.5 model is an error, not a setting.

| Variable | Type / validation in `env.ts` | Default | Why |
|---|---|---|---|
| `GEMINI_MODEL` | `z.string().min(1).regex(/^gemini-[0-9]+(?:\.[0-9]+)?-(?:flash|flash-lite|pro)(?:-[a-z0-9.-]+)?$/)` | `gemini-3.5-flash-lite` | Roadmap D-02 keeps lite until Package A2 decides. The regex rejects the typo class that caused N6 (`gemini-3.6-flash-lite` still matches the shape, so this is a partial guard only — see the honest note in "Risks") |
| `GEMINI_TEMPERATURE` | `z.coerce.number().min(0).max(2)` | `0.3` | Brief; audit §2.1.3 option B. Low temperature is what makes the greeting rule (F-27) obeyable |
| `GEMINI_THINKING_LEVEL` | `z.enum(["MINIMAL","LOW","MEDIUM","HIGH"])` | `LOW` | **Decided by Davi (item 3): default `LOW`.** See `explicacao.md`; reasoning summarised below |
| `GEMINI_MAX_OUTPUT_TOKENS` | `z.coerce.number().int().min(128).max(8192)` | `1024` | **Decided by Davi (item 4): default `1024`.** The response is JSON (reply + `leadUpdate` + `evidenceUsed`), and on this SDK thought tokens are billed as output. The audit suggested 400; 400 risks `finishReason: MAX_TOKENS` → truncated JSON → `JSON.parse` throw (`agent.ts:264`) → silent client. 1024 keeps a wide margin; the trace's `finishReason` and `usage.candidatesTokens` tell us whether it can be lowered later |

Thinking-level default **`LOW`**, not `MINIMAL` and not `MEDIUM`: a `*-flash-lite` tier left unset runs at its minimum reasoning depth (audit §2.1), which is the proximate cause of "ela não raciocina"; `LOW` is the smallest explicit step above that, costs roughly 1.5–3× option A with +0.5–2 s latency (audit §2.1.3), and that latency is invisible against the ~20 s end-to-end budget of audit §1.1 dominated by the 15 s debounce. `MEDIUM`/`HIGH` are left for Davi to try in `.env` without a deploy, which is exactly what Package A2's comparison needs.

`env.ts` keeps its two-part style: an entry in `envSchema` **and** an entry in `buildEnvInput` (the function is the real input list; a schema-only addition would never be read). Numeric vars pass the raw string through so an invalid value fails validation instead of silently falling back, following the `WHATSAPP_SEND_TIMEOUT_MS` comment at `env.ts:100-101`.

### Item 3 — model failure reaches the client

New `export class ModelUnavailableError extends Error` in `src/ai/agent.ts` (or `src/ai/model-errors.ts`), wrapping *only* the `ai.models.generateContent` rejection and the empty/invalid-JSON responses at `agent.ts:250-266`, with `cause` preserved and a `kind` field (`"transport" | "empty_response" | "invalid_json"`). Guardrail throws (L2 `validate-response.ts:76-80`, L4 `mariana-safety.ts:117-130`) are **not** wrapped and keep their current behaviour.

`handleProcessInboundMessage` (`autonomous-task-handlers.ts:190`) wraps the `generateMarianaResponse` call in `try/catch`. On `ModelUnavailableError`:
1. insert one assistant `messages` row with the notice text (the conversation record stays honest);
2. `enqueueOutboundMessage({ conversationId, eventId, idempotencyKey: runKey, leadId, messageId, payload: { kind: "text", text: MODEL_FAILURE_NOTICE } })` — **the same `runKey`** already computed at `autonomous-task-handlers.ts:167`, so a retry can never double-send;
3. `markMessagesProcessed(messageIds)` and `markEventProcessed(eventId)`;
4. `logTurnTrace({ outcome: "model_error", … })` plus a `console.error({ event: "mariana_model_failure", kind, model, conversationId, leadId })`;
5. return `{ modelFailureNotice: true, outboundQueued: true }` — the handler **completes**, so the task is not retried into `failed` and the client is not silent.

Client text — **approved by Davi exactly as written (item 2)**. It is pinned by an exact-text test in step 10, so any future edit needs a new approval:

> **"Desculpe, tive uma falha técnica aqui e não consegui processar sua mensagem agora. Pode me enviar de novo em alguns instantes?"**

Properties checked against the code, deliberately:
- contains no `CONSULTANT_OFFER_MARKERS` and no `CONSULTANT_REASON_QUESTION`, so `detectPendingOffer` (`pending-offer.ts:24-44`) returns `null` on the next turn — the "clear affirmative" invariant of `CLAUDE.md` cannot be armed by it;
- matches none of the six `SCHEDULING_COMMITMENT_PATTERNS` (`generateMarianaResponse.ts:188-195`), so it carries no scheduling promise;
- asks the client to resend, which is the only true statement available: the task is completed, so nothing will retry on its own.

Coverage, stated plainly:
- **covers** RC-4 / N6 (wrong model id, 404, transport failure after the three retries of `client.ts:4-11`), empty response, invalid JSON — the three ways `agent.ts` currently throws for a model reason, on the inbound-message path;
- **does not cover** F-08's throwing guardrails (L2 invented `evidenceUsed` id; L4 `FORBIDDEN_PATTERNS`): those are a content problem whose fix is "drop the offending sentence", which **changes conversation behaviour** and belongs to Package C2/WP-7. They stay out of scope here, but step 7 makes them *visible* (`outcome: "guardrail_throw"`), which is the Package A promise;
- **does not cover** the other silent paths of F-03/F-20 (unanswered button taps, lease-expired events): Packages B and E;
- **does not add** a request deadline. There is no `abortSignal`/timeout on the Gemini call (audit §2.1); a hung call still ends as a lease expiry, not as a `ModelUnavailableError`. Out of scope, flagged for Package E.

### Item 4 — test-safety hardening

Order: `vitest` removal (highest risk, zero behaviour), `setup-test-db.ts` assignment (one line), guard allowlist, preload assertion. Hole 6 (`RELIABILITY_WORKERS_ENABLED` defaulting to `"true"` in `env.ts:43`) is **deliberately left for later**: it is only exploitable through holes 1 and 2, and changing a production default belongs with Package E's reliability work.

## Steps

### Batch A — model config (steps 1–3)

**Step 1 — `env.ts`: the four Gemini variables.**
- Files: `src/env.ts` (`envSchema` 19-64, `buildEnvInput` 68-105).
- Change: add `GEMINI_MODEL`, `GEMINI_TEMPERATURE`, `GEMINI_THINKING_LEVEL`, `GEMINI_MAX_OUTPUT_TOKENS` with the validations and defaults in the Design table, keeping alphabetical order; pass raw strings (`source.X || undefined`) for the three constrained ones so a bad value fails validation.
- Acceptance tests — `src/tests/env.test.ts` (unit, already in `test:unit`):
  - `"parseEnv aplica os defaults do Gemini"` — given `VALID_SOURCE` with no Gemini tuning vars; when `parseEnv`; then `GEMINI_MODEL === "gemini-3.5-flash-lite"`, `GEMINI_TEMPERATURE === 0.3`, `GEMINI_THINKING_LEVEL === "LOW"`, `GEMINI_MAX_OUTPUT_TOKENS === 1024`. **Red first** (fields do not exist).
  - `"parseEnv recusa um nome de modelo fora do formato"` — given `GEMINI_MODEL: "gpt-4o"`; when `parseEnv`; then it throws matching `/GEMINI_MODEL/`. **Red first.**
  - `"parseEnv recusa temperatura e nível de raciocínio inválidos"` — given `GEMINI_TEMPERATURE: "3"` / `GEMINI_THINKING_LEVEL: "ULTRA"` / `GEMINI_MAX_OUTPUT_TOKENS: "10"`; then throws naming each variable. **Red first.**
- Invariants: none at risk. A missing variable must *default*, never fail boot, or production stops on deploy.

**Step 2 — `agent.ts`: use the configuration.**
- Files: `src/ai/agent.ts:36` (remove the constant, read `env.GEMINI_MODEL`), `agent.ts:240-248` (the call).
- Change: extract a pure `export function buildModelRequestConfig({ systemInstruction }): GenerateContentConfig` returning `{ responseJsonSchema, responseMimeType, systemInstruction, temperature: env.GEMINI_TEMPERATURE, maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: env.GEMINI_THINKING_LEVEL } }`, and have the call site use it. The pure function is the test seam — `ai` stays a module-level singleton and **no API call happens in any test**.
- Acceptance tests — new unit file `src/tests/agent-model-config.test.ts`, added to the `test:unit` list in `package.json:21` and to `docs/CODEMAP.md`:
  - `"buildModelRequestConfig envia modelo, temperatura, nível de raciocínio e limite de saída"` — given the env defaults; when called; then the config has `temperature: 0.3`, `maxOutputTokens: 1024`, `thinkingConfig.thinkingLevel === "LOW"`, and `responseMimeType`/`responseJsonSchema` unchanged. **Red first** (the function does not exist; today the config has three keys).
  - `"o modelo vem do ambiente, não de uma constante"` — assert `MODEL`-style hard-coding is gone by asserting the resolved model equals `env.GEMINI_MODEL`. **Red first.**
- Invariants: "the AI is never the authority on IDs, availability or authorization" — untouched; this step changes only sampling parameters.
- *(criterion derived from Davi's brief — redação de R-REL-07 não disponível, pendente de confirmação.)*

**Step 3 — document the variables in `.env.example`.**
- Files: `.env.example` (the "AI - Google Gemini" block, line 23-26).
- Change: four commented entries with the defaults and a note that `GEMINI_THINKING_LEVEL` replaces a token budget because Gemini 3.5 rejects `thinkingBudget`.
- Acceptance test: none automated (documentation). Proof: `grep -c GEMINI_ .env.example` ≥ 5 and the names match `envSchema`. `.env` itself is **not** touched by the implementer — Davi sets the real values.

### Batch B — the trace module and the layer records (steps 4–6)

**Step 4 — `src/lib/turn-trace.ts`.**
- Files: new `src/lib/turn-trace.ts`.
- Change: the types, `hashText`, `isPureBackendText`, `logTurnTrace` exactly as in the Design section. No imports beyond `node:crypto`.
- Acceptance tests — new unit file `src/tests/turn-trace.test.ts` (add to `test:unit` and CODEMAP):
  - `"logTurnTrace emite uma única linha JSON com event mariana_turn"` — given a full trace object; when `logTurnTrace` with `console.info` stubbed; then exactly one call, its argument is a string, `JSON.parse` succeeds, `event === "mariana_turn"`, and the string contains no `\n`. **Red first.**
  - `"o rastro nunca contém texto do cliente nem telefone"` — given a trace built from a turn whose client text is `"meu telefone é 5531999999999"` and whose reply is `"Oi, Davi"`; then the serialised line contains neither substring and no 11-digit sequence. **Red first.**
  - `"hashText é estável, hexadecimal e de 12 caracteres"`; `"isPureBackendText detecta resposta 100% do backend"` with the L9/L11 cases of audit §2.3.1. **Red first.**
- Invariants: privacy (`R-SEC-03` family, wording unavailable). Protected by the type plus the second test.

**Step 5 — `agent.ts` reports L0–L4 and the raw reply.**
- Files: `src/ai/agent.ts` (`GenerateMarianaReplyResult.metadata` 75-82; the L0 short-circuit 198-213; L1 at 268; L3 inside `validateMarianaEvidence`; the throws at L2/L4).
- Change: add to `metadata`: `rawReplyLength`, `rawReplyHash`, `finishReason`, `commercialAccessLevel`, `requestedNextAction`, `usage` kept as is, plus `rewrites: RewriteRecord[]` holding L0 (short-circuit, raw = `""`), L1 (when `sanitizeCommercialIdentity` changed the string) and L3 (when `validateMarianaEvidence` replaced the reply — compare before/after). For L2/L4 the function still throws; it attaches the partial records to the error (`error.turnRewrites`) so step 7 can log them.
- Acceptance tests — `src/tests/agent-model-config.test.ts` for the pure parts, plus `src/tests/knowledge-response.test.ts`/`src/tests/commercial-policy.test.ts` style helpers where the layer functions are already unit-testable:
  - `"metadata traz hash e comprimento da resposta crua"` — given a fake `generateContent` result injected through a new optional `generateContentFn` param on `generateMarianaReply` (default = the real `ai`), reply `"Texto A. Texto B?"`; then `metadata.rawReplyLength === 17` and `metadata.rawReplyHash === hashText("Texto A. Texto B?")`. **Red first.**
  - `"o curto-circuito de nível 3 é registrado como L0"` — given a level-3 message (`"qual o valor da carta?"`); then `metadata.rewrites[0].layer === "L0_level3_short_circuit"` and no model call happened. **Red first.**
- Invariants: none changed; the function's behaviour is identical, only the returned metadata grows. Risk: the new optional `generateContentFn` param must default to the real client so production is unchanged — asserted by a test that the default is `ai.models.generateContent`.

**Step 6 — `composeStageReplyWithTrace` (L6–L9).**
- Files: `src/services/conversations/conversation-stage.ts:381-425`.
- Change: rename the body to `composeStageReplyWithTrace(input): { reply: string; rewrites: RewriteRecord[] }`, recording L6 (`questionsDropped`), L7 (`greetingsDropped`), L8 (`sentencesTruncated`, `cap`) and L9 (`fallbackText` label). `export function composeStageReply(input): string { return composeStageReplyWithTrace(input).reply; }` so every existing caller and test is untouched.
- Acceptance tests — `src/tests/services/conversation-stage.test.ts` (unit, already in `test:unit`):
  - `"composeStageReplyWithTrace registra as perguntas removidas"` — given `modelReply` = the three-sentence example of audit §2.3.1 with a trailing question and `question: null`; then `rewrites` contains `L6_dropped_questions` with `detail.questionsDropped === 1` and matching `lengthBefore`/`lengthAfter`. **Red first.**
  - `"registra o corte de frases e o fallback neutro"` — the two other §2.3.1 cases (3rd fact dropped to fit the offer → `L8_sentence_cap`; question-only reply → `L9_neutral_fallback`). **Red first.**
  - `"composeStageReply continua devolvendo a mesma string"` — a regression guard over three existing fixtures. Green before and after (that is the point).
- Invariants: none. Text output must be byte-identical; the wrapper test enforces it.

### Batch C — assemble and emit (steps 7–8)

**Step 7 — `generateMarianaResponse` assembles and logs the turn.**
- Files: `src/services/conversations/generateMarianaResponse.ts` (`persistAuthorizedAssistantReply` 217-264 → add `rewrites` for L5 and L10; the compose calls 589-599 → use `composeStageReplyWithTrace`; the L11 replacement at ~648-655; the return at 695-706; the params interface at 58-68 → optional `traceTurnId?: string`), and a `try/catch` around the whole turn that logs `outcome: "guardrail_throw"` and rethrows.
- Change: collect the records, compute `pureBackendText`, call `logTurnTrace(...)` exactly once before the `return`, and include the new fields in `GenerateMarianaResponseResult.metadata`.
- Acceptance tests:
  - `src/tests/services/generate-mariana-response-authorization.test.ts` (unit, already in `test:unit`): `"persistAuthorizedAssistantReply registra L5 e L10"` — given a resolved action `request_consultant` / an unauthorised scheduling request; then the result's `rewrites` name `L5_request_consultant_override` / `L10_unauthorized_scheduling` with before/after lengths. **Red first.**
  - `src/tests/services/generate-mariana-response.test.ts` (DB suite): `"um turno emite exatamente uma linha mariana_turn com as camadas que alteraram o texto"` — given a seeded lead/conversation and a stubbed `generateMarianaReplyFn` returning a reply with a question and three sentences; when `generateMarianaResponse` runs with `console.info` captured; then exactly one captured line has `event === "mariana_turn"`, `turnId` equals the passed id, `requestedNextAction` and `executedAction` are both present, `rewrites` contains `L6`, and the line contains neither the client's text nor the lead's phone. **Red first.**
  - Same file: `"uma exceção de guardrail ainda é registrada como guardrail_throw"` — given a stub whose reply trips `assertSafeMarianaReply`; then the call still rejects (behaviour unchanged) **and** one `mariana_turn` line with `outcome: "guardrail_throw"` was emitted. **Red first.**
- Invariants at risk: **"a duplicate inbound event is never processed twice"** and the message-persistence path. Protected because the step adds no DB write and no early return — the logging call sits after every existing write, and the `catch` rethrows unchanged.
- *(criterion derived from Davi's brief — redação de R-REL-07 não disponível, pendente de confirmação.)*

**Step 8 — thread `turnId` from the task.**
- Files: `src/services/conversations/autonomous-task-handlers.ts:190-196` (pass `traceTurnId: task.id`).
- Acceptance test: `src/tests/reliability/` DB test (the existing inbound-task test file, name to be confirmed by the implementer from `src/tests/reliability/`): `"o rastro do turno usa o id da task âncora"` — given one inbound task; then the emitted `mariana_turn` line's `turnId` equals the task id. **Red first.**

### Batch D — honest model failure (steps 9–11)

**Step 9 — `ModelUnavailableError`.**
- Files: new `src/ai/model-errors.ts`; `src/ai/agent.ts:240-266` (wrap the call, the empty response and the JSON parse).
- Acceptance tests — new unit file `src/tests/model-failure-notice.test.ts` (add to `test:unit` and CODEMAP):
  - `"um erro de transporte do Gemini vira ModelUnavailableError"` — given `generateContentFn` rejecting with `{ status: 404, message: "models/gemini-3.6-flash-lite not found" }` (the N6 error); then `generateMarianaReply` rejects with `ModelUnavailableError`, `kind === "transport"`, `cause` preserved. **Red first.**
  - `"resposta vazia e JSON inválido também viram ModelUnavailableError"` with `kind` `"empty_response"` / `"invalid_json"`. **Red first.**
  - `"um erro de guardrail NÃO vira ModelUnavailableError"` — given a reply tripping `FORBIDDEN_PATTERNS`; then the rejection is the existing error type. **Red first** (guards the scope line against F-08).

**Step 10 — the notice text constant.**
- Files: new `MODEL_FAILURE_NOTICE` constant (in `src/services/conversations/model-failure-notice.ts` or beside `DEFAULT_FALLBACK_REPLY` in `qualification-gaps.ts` — implementer's choice, one place).
- Acceptance tests — `src/tests/model-failure-notice.test.ts`:
  - `"o aviso de falha não arma oferta pendente"` — given `detectPendingOffer(MODEL_FAILURE_NOTICE)`; then `null`. **Red first.**
  - `"o aviso de falha não promete agendamento"` — given the notice; then `hasSchedulingCommitment`-equivalent assertion is false (export the helper or assert via `persistAuthorizedAssistantReply`). **Red first.**
  - `"o aviso é curto e em português"` — length ≤ 160 chars (one WhatsApp bubble) and exact-text pin, so a future edit is a conscious decision Davi re-approves. **Red first.**
- Invariants: the pending-offer invariant of `CLAUDE.md` — protected by the first test.

**Step 11 — the handler completes instead of failing.**
- Files: `src/services/conversations/autonomous-task-handlers.ts:190-232`.
- Change: the `try/catch` of the Design section (persist assistant message → `enqueueOutboundMessage` with the existing `runKey` → mark processed → log → return).
- Acceptance tests — DB suite, `src/tests/reliability/` (new test in the existing inbound-task file, or a new `src/tests/reliability/model-failure.test.ts`):
  - `"falha do modelo enfileira o aviso e conclui a task"` — given a seeded lead/conversation and an inbound task, with `generateMarianaResponse` stubbed to throw `ModelUnavailableError`; when the handler runs; then (a) exactly one `outbound_messages` row with `idempotencyKey === runKey` and `payload.text === MODEL_FAILURE_NOTICE`, (b) one assistant `messages` row with that text, (c) the task result is not a throw, (d) the inbound messages are `processedAt`-marked and the webhook event is `processed`. **Red first** (today the handler throws and nothing is enqueued).
  - `"o aviso de falha nunca é enviado duas vezes"` — given the same task executed twice; then still exactly one `outbound_messages` row (the `runKey` dedup at lines 172-182 already covers it). **Red first** for the first assertion, green by construction for the second.
  - `"uma falha que não é do modelo continua falhando a task"` — given the stub throwing a plain `Error`; then the handler rejects and nothing is enqueued. **Red first** (guards against swallowing every error).
- Invariants at risk: **"an outbound message that may have been accepted by Meta never goes back to `pending`"** and **"a duplicate inbound event is never processed twice"**. Protected by reusing `runKey` (no new idempotency key) and by marking the messages/event processed exactly as the success path does.
- *(criterion derived from Davi's brief — redação de S-17 não disponível, pendente de confirmação.)*

### Batch E — test safety (steps 12–17, all mandatory)

> Revision 1 note: step 13 below is **superseded** by "Step 13 (revised)" in Revision 1, and steps 14a/14b are added there. Steps 12 and 14 are DONE and PASS (`test-report-batch-E.md`). Steps 15 and 17 are unchanged; step 16 gets one added constraint (see Revision 1).
>
> Revision 2 note: step 15 below is **superseded** by "Step 15 (revised)" in Revision 2; step 16 is **amended** there; steps 14c, 14d, 18a, 18 and 19 are added there. Steps 12, 13 (revised), 14, 14a, 14b and 17 are done and keep their text.

**Step 12 — remove `vitest`.**
- Files: `package.json:33`, `package-lock.json` (regenerated by `npm install`, not hand-edited).
- Change: delete the `vitest` line from `dependencies`; run `npm install` to update the lock; do **not** run any test runner other than the project's scripts.
- What proves it closed: `grep -rn "vitest" --include='*.ts' --include='*.js' --include='*.mjs' --include='*.json' . | grep -v node_modules | grep -v package-lock` → no hits; `ls node_modules/.bin/vitest` → absent after install; `npm run build`, `npx tsc --noEmit` and `npm run test:unit` still pass. No test asserts the absence (a test cannot usefully assert a missing dependency); the proof is the grep in `progress.md`, which the tester repeats.
- Invariants: none. Risk: the lockfile churn must contain no unrelated upgrades — `git diff --stat package-lock.json` is reported to Davi, who commits.

**Step 13 — `setup-test-db.ts` must not hold Neon in `process.env`.** *(superseded by Revision 1 — kept for history)*
- Files: `src/tests/support/setup-test-db.ts:19`.
- Change: `const { DATABASE_URL: testUrl } = Object.assign(process.env, resolveTestDatabaseEnv(process.env));` — or, clearer, resolve into a const and then `Object.assign(process.env, resolved)` before the pool is opened at line 24 and before the `DROP SCHEMA` at line 26. `NODE_ENV=test` and `RELIABILITY_WORKERS_ENABLED=false` come along with it, which also hardens the spawned `drizzle-kit push` at line 39.
- Acceptance test — `src/tests/test-database-guard.test.ts` (unit, already in `test:unit`): `"o setup de banco de teste reescreve DATABASE_URL antes de qualquer statement"` — given a fake `source` with `DATABASE_URL` on a Neon-like host and a valid local `TEST_DATABASE_URL`; when the new exported helper `applyTestDatabaseEnv(source)` runs; then `source.DATABASE_URL` equals the test URL, `source.NODE_ENV === "test"`, `source.RELIABILITY_WORKERS_ENABLED === "false"`. **Red first** (the helper does not exist). The helper is what `setup-test-db.ts` calls, so the regression is caught by a unit test that never opens a connection.
- Invariants: the `CLAUDE.md` safety rule "never write to Neon". This step is the only one that touches the destructive script; it must not change what it drops or seeds.

**Step 14 — guard: allowlist instead of a one-vendor denylist.**
- Files: `src/tests/support/test-database-guard.ts:52-57`.
- Change: keep the explicit `neon.tech` message, and add: the host must be `localhost`, `127.0.0.1` or `::1`, unless `ALLOW_REMOTE_TEST_DB === "1"` is set, in which case log a loud warning naming host and database (never the password, per `CLAUDE.md`).
- Acceptance tests — `src/tests/test-database-guard.test.ts`:
  - `"recusa um host remoto que não é neon.tech"` — given `TEST_DATABASE_URL` on `db.example.com`; then `UnsafeTestDatabaseError`. **Red first** (today it is accepted).
  - `"aceita localhost e 127.0.0.1"` — green before and after.
  - `"permite host remoto só com ALLOW_REMOTE_TEST_DB=1"`. **Red first.**
- Risk: this can break a legitimate workflow if `TEST_DATABASE_URL` ever points at a non-local Docker host. **Answered by Davi (item 7): no remote test DB, local Docker only.** The `ALLOW_REMOTE_TEST_DB=1` escape hatch still ships (it is what step 16 relies on), but no workflow of Davi's needs it.

**Step 15 — `unit-test-preload.ts`: assert the invariant instead of relying on dotenv's default.** *(superseded by Revision 2 — kept for history; the assertion below can never fail)*
- Files: `src/tests/support/unit-test-preload.ts`.
- Change: after the `Object.assign`, import `src/env.ts` is *not* forced; instead add an explicit assertion executed at preload time — if `process.env.DATABASE_URL` does not equal the unreachable sentinel, throw — plus a comment stating the dependency on dotenv `override: false`.
- What proves it closed: a unit test cannot easily re-run a preload; the proof is `npm run test:unit` passing (sentinel intact) plus a deliberate manual counter-check the tester can run: `DATABASE_URL=postgresql://x@127.0.0.1:1/none npm run test:unit` still passes, and a doctored `override: true` would now abort. I accept this as the weakest proof in the batch and say so.

**Step 16 (APPROVED by Davi, item 5 — mandatory) — close holes 1 and 2 at the source.** *(amended by Revision 1 and Revision 2)*
- Files: `src/db/connections.ts`.
- Change: at module load, refuse a non-local `DATABASE_URL` when the process is a test runner (`process.execArgv.includes("--test") || process.argv.includes("--test")`), unless `ALLOW_REMOTE_TEST_DB === "1"`. This is what makes `npx vitest`, `npx tsx --test file.ts` and an IDE runner safe, not just the three blessed npm scripts.
- Acceptance test — new unit test in `src/tests/test-database-guard.test.ts` over an extracted pure predicate `isForbiddenTestConnection({ url, argv, execArgv, allowRemote })`, so no connection is opened. **Red first.**
- Why it was raised as optional, and why it is in: it puts a guard in a **production** module. Davi approved it on exactly that design (item 5): the predicate is pure, it only fires under `--test`, and `ALLOW_REMOTE_TEST_DB=1` is the escape hatch. The implementer must keep all three properties — a pure exported predicate, the `--test` condition, and the escape hatch — or the step is out of its approval.

**Step 17 (APPROVED by Davi 2026-10-22, added during execution) — a test-time network egress guard.**
- Origin: tester finding B-2 (medium), `test-report-batch-B.md`. During step 5's **red** run, before the `generateContentFn` seam existed, a test fell through to the real client and **one request actually left the machine** to the Gemini API, rejected with `API key not valid`. No real credential and no quota: `src/tests/support/fake-external-env.ts` overrides `GEMINI_API_KEY` with `test-gemini-api-key`, and both preloads apply it before `src/env.ts` reads `.env`. The problem is what that implies — the protection is a fake credential plus hand-written `mock.method` traps, **not an inability to call out**. `src/ai/client.ts` builds a live client at import, so an invalid key makes a call *fail*, not *not happen*, and the next red run of a not-yet-mocked path calls out again. `CLAUDE.md` forbids calling real Gemini or Google APIs.
- Files: `src/tests/support/unit-test-preload.ts` and `src/tests/support/db-test-preload.ts`, plus a new pure predicate module beside them.
- Change: at preload time, block outbound network egress — `net.connect`, `dns.lookup`, `http.request`, `https.request` and `fetch` — so that an un-mocked call **throws locally** and names the host it tried to reach, instead of leaving the machine. Behind a pure exported predicate, in the same style Davi approved for step 16, with an `ALLOW_TEST_NETWORK=1` escape hatch (Davi chose to keep the hatch). Loopback must stay reachable, or every DB test breaks.
- Acceptance tests — over the pure predicate, so no socket is opened by the test itself: a non-loopback host is refused and the error names the host; `127.0.0.1`, `localhost` and `::1` are allowed; `ALLOW_TEST_NETWORK=1` permits everything and logs a loud warning. **Red first.**
- What proves it closed: the whole `test:unit` list runs green with egress blocked and zero network attempts. The tester already demonstrated exactly this with its own trap: `# tests 237  # pass 237  # fail 0`, zero attempts, across all 32 files. The implementer's job is to make that the permanent default rather than a one-off harness.
- Risk: a guard that is too broad breaks the DB suite, which legitimately opens a loopback socket. The predicate is the seam, and loopback is explicitly allowed.


## Out of scope (deliberately)

- Any conversation-behaviour change: F-08 (guardrails dropping a sentence instead of throwing), F-14 (stop deleting questions, raise the cap, prepend instead of replace), F-27 (greeting filter), F-09, F-11, F-13 → Packages C1/C2.
- The model choice itself. The default stays `gemini-3.5-flash-lite` per D-02; the lite-vs-flash comparison is Package A2's simulator run, with Davi's permission for real API calls. I run no simulator and no API call.
- A live startup probe that the configured model exists (`models.get`). Needs a real API call; question for Davi; would belong to A2.
- A request deadline / `abortSignal` on the Gemini call (audit §2.1 "Timeout: none") → Package E.
- `TURN_TRACE_VERBOSE` (full raw reply and sent text at `debug`), proposed in audit §2.3.3. **Decided by Davi (item 6): not in this package, deferred to Package A2.** It is the only part of the trace that would touch message text.
- Persisting the trace in a table: would need a migration → **frozen**, out of scope.
- Hole 6 (`RELIABILITY_WORKERS_ENABLED` defaults to `"true"` in `env.ts:43`) → with Package E.
- The false-confidence tests F1–F7 of coverage report §3: they are test-correctness problems owned by the tester and tied to behaviour packages B/C.
- `docs/specs/MARIANA_BEHAVIOR_SPEC.md`: I do not write or reconstruct it. Davi restores and commits it (F-01, WP-15).

## Owner decisions (Davi, 2026-10-22)

| # | Decision | Where it lands |
|---|---|---|
| 2 | Failure message approved **exactly as written**, and pinned in a test | Design item 3; step 10 exact-text test |
| 3 | `GEMINI_THINKING_LEVEL` default = `LOW` | Design env table; step 1 test |
| 4 | `GEMINI_MAX_OUTPUT_TOKENS` default = `1024` | Design env table; step 1 test |
| 5 | Step 16 is **in**, on the pure-predicate / `--test`-only / `ALLOW_REMOTE_TEST_DB=1` design | Batch E, step 16 (now mandatory) |
| 6 | `TURN_TRACE_VERBOSE` deferred to Package A2 | Out of scope |
| 7 | No remote test DB; local Docker only | Step 14 |

Items 3 and 4 confirm the defaults the plan already proposed, so no step changed on their account. Items 2, 5, 6 and 7 are recorded above at their steps. The step count is now **17 mandatory steps, none optional** (was 15 + 1 optional). Step 17 was added during execution, on Davi's approval of 2026-10-22, after the tester found that nothing actually prevents a test from reaching the network — see question 4 below and the step itself.

## Planner decisions taken during execution

These three came out of the Batch A and Batch B test reports (`test-report-batch-A.md`, `test-report-batch-B.md`). They are recorded here so the implementer of Batch C has a written rule, and so Davi can overrule any of them.

**P-1 — a guardrail throw must say *which* guardrail threw** (tester finding B-3, raised against the planner). Design item 1 promised that L2 and L4 become *visible* through `outcome: "guardrail_throw"`, but visible is not the same as attributable: an invented `evidenceUsed` id (L2, `validate-response.ts:76-80`) and a forbidden identity claim (L4, `mariana-safety.ts:117-130`) are different failures with different fixes, and one shared outcome value cannot tell them apart. **Decision: step 7 adds a `guardrailLayer` field to the trace**, set to the `RewriteLayer` id of the throwing layer and `null` on every other outcome. The error objects already carry `turnRewrites`, so the throwing layer attaches its own id on the way out; nothing about the throw itself changes. This is observability only — no conversation-behaviour change, which keeps it inside Package A's promise. F-08's actual fix (drop the offending sentence instead of throwing) stays out of scope in C2/WP-7.

**P-2 — "no layer rewrote her" must not be confused with "nobody told us"** (tester's judgement on Batch B deviation 1). Step 5 shipped the new `metadata` fields optional, because three DB test files hand-build `GenerateMarianaReplyResult` and required fields would have broken `tsc` outside that step's scope. The sink type `TurnTrace` keeps every field required, so an emitted line cannot lose a field — but a plain `metadata.rewrites ?? []` in step 7 would silently turn a non-reporting producer into "she was not rewritten", which is the single most load-bearing claim in the whole trace. **Decision: step 7 must distinguish the two explicitly** — a missing `rewrites` is reported as such (for example a `rewritesReported: false` field, or a `null` that the log line preserves), never flattened to an empty list. Step 7 may touch the three DB test files to do it, so making the six fields required is also acceptable if the implementer prefers that route; either way `npx tsc --noEmit` must stay at exit 0.

**P-3 — B-1's broken hash chain is a Batch C fix, not a Batch B re-open.** `recordRewrite` hashes `sentences.join(" ").trim()`, so with ordinary double spaces the stage's `L6 hashBefore` does not equal the raw reply hash and the before/after chain implied by this plan's own example line is broken. It was hidden because the implementer's fixture has no double spaces. It is fixed in Batch C, before step 7 assembles the line, since an unchained trace would be wrong in the very first field step 7 writes. The tester also notes the two copies of `recordRewrite` are not twins (one takes strings, one takes string arrays), which is where the defect lives — so Batch C shares one helper when it adds L5, L10 and L11.


**P-4 — a turn that throws anywhere must still emit its line** (tester finding C-1, medium, raised against the planner). Step 7 narrowed the catch from this plan's "try/catch around the whole turn" to the model call only, and did not declare the narrowing. The tester measured the consequence with a probe: a calendar failure *after* a successful model call yields `PROBE_LINES=0` — no trace line at all. The same hole swallows the three "Assistant message not found" throws, "Conversation not found", and any transaction failure. A package whose entire promise is "one structured log line per turn" cannot have a class of turns that emit nothing, and that class is exactly the one we most need to see. The tester correctly declined to write a red test, because the fix is a design call rather than a bug fix: `guardrail_throw` would be a lie for a calendar failure, and `TurnOutcome` has no honest value for it. **Decision: restore the whole-turn catch and add a fourth `TurnOutcome` value, `turn_error`**, for a throw that is neither a model failure nor a guardrail. The catch re-throws unchanged, exactly as the guardrail catch already does, so no conversation behaviour changes and the task still fails as it does today — only the silence ends. `guardrailLayer` stays `null` on this outcome, and the model-failure path of Batch D keeps its own `model_error` outcome.

**P-5 — `actionBlockedReason` must carry the reason that already exists** (tester finding C-4, medium-low, raised against the planner). Step 7 ships `actionBlockedReason` hard-wired to `null`, on the stated grounds that `ExecuteNextActionResult` has no blocked branch. That reason is **inaccurate**: `src/services/agent/execute-next-action.ts:245,260,289` do have blocked branches, and they already log `reason: "no_current_scheduling_intent" | "lead_not_qualified"` before downgrading the action. So the field is not merely empty — it discards information the code has in hand. **Decision: thread the real reason through.** `ExecuteNextActionResult` gains an optional reason field, the three branches set it, and step 7 reports it instead of a constant `null`. This is additive and observability-only: no branch changes which action it downgrades to, and the `CLAUDE.md` pending-offer invariant around `acceptedPendingOffer` is untouched. If the implementer finds any branch where threading the reason would change control flow, it must stop and report rather than adjust the flow.

**Two low-severity trace-honesty fixes go with them** (tester findings C-2 and C-3, implementer scope, no design call needed). C-2: `latencyMs ?? 0` fabricates a latency of 0 on the guardrail path, and `modelVersionReturned` reports the *configured* model when the API omits `modelVersion` — both must be `null` instead, matching the `| null` principle the same step already adopted for five other fields. C-3: when the producer is silent, `rawReplyHash` falls back to hashing the post-L1/L3 text while still calling it raw, so a reader comparing it with `sentReplyHash` could conclude "nothing rewrote her"; today only `rewritesReported: false` discloses that. Null it rather than rename it — an absent hash cannot mislead, and `rewritesReported` already carries the disclosure.

## Questions still open

1. **The spec v1.1 (item 1 — unresolved).** `docs/specs/MARIANA_BEHAVIOR_SPEC.md` is still absent; see "Open blocker" for the re-verification. The only copy anywhere is `~/Downloads/mariana-agent-team-1/docs/specs/MARIANA_BEHAVIOR_SPEC.md`, and it is **v1.0** — it has no `R-REL-07` and no `S-17`. Two things are needed, and they are separate: (a) the wording of `R-REL-07` and `S-17`, which exists in no file that can be found, so it has to come from Davi; (b) permission to put a spec file into `docs/specs/`, which is Davi's call — the planner will not file a v1.0 copy as the v1.1 restore.
2. ~~**Local test database target.**~~ **Answered: Davi chose `mariana-test-pg` on `localhost:5433`, user `postgres`.** That container was started and verified reachable. Two consequences are still outstanding. First, `CLAUDE.md:24` still documents `postgresql://mariana:mariana@localhost:5432/<disposable_db>`, which now contradicts the chosen target; the planner did **not** edit `CLAUDE.md`, since it is Davi's own instruction file — it needs a one-line change Davi approves. Second, Batch C's DB run happened before the implementer was told the answer, so it ran against the `5432` container, where it created a **brand-new** database `mariana_pkg_a_trace_test` and pointed `TEST_DATABASE_URL` at that. Nothing existing was reset: the dev database `mariana` is intact (verified by listing `pg_database` on both containers), Neon was never contacted, and no migration command ran. Davi can drop `mariana_pkg_a_trace_test` at will. Every DB run from Batch D onwards targets `5433`.
   - **Superseded 2026-10-26 (Revision 1).** `localhost:5433` is now `zapresponse-postgres-test`, another project's container: **never target it**. Every DB run from Batch E on targets `localhost:5432/mariana_test` on `mariana-postgres`. That matches `CLAUDE.md:24` again, so the `CLAUDE.md` edit mentioned above is no longer needed.
3. ~~**Whether to start Batch A now.**~~ Answered: Davi chose to start, and Batch A and Batch B are done and verified.
4. ~~**A new step 17: a test-time network egress guard**~~ — **answered: Davi approved it on 2026-10-22, with the `ALLOW_TEST_NETWORK=1` hatch kept.** It is now written up as step 17 in Batch E. Original finding, for the record (tester finding B-2, medium): During step 5's *red* run, before the `generateContentFn` seam existed, a test fell through to the real client and **one request actually left the machine** to the Gemini API. It was rejected with `API key not valid`, and no real credential or quota was involved: `src/tests/support/fake-external-env.ts` overrides `GEMINI_API_KEY` with `test-gemini-api-key` and both preloads apply it before `src/env.ts` reads `.env`. But that is the point — what protects us today is a **fake credential plus hand-written `mock.method` traps, not an inability to call out**. `src/ai/client.ts` builds a live client at import, so an invalid key makes a call *fail*, not *not happen*, and the next red run of a not-yet-mocked path will call out again. `CLAUDE.md` says never to call real Gemini or Google APIs. Proposed fix, in Batch E and in the exact style Davi already approved for step 16: a preload-level egress guard behind a pure predicate, test-only, with an `ALLOW_TEST_NETWORK=1` escape hatch. The tester has already proved the approach works — it ran the whole 32-file `test:unit` list with egress blocked: `# tests 237 # pass 237 # fail 0`, zero network attempts. Davi decides whether step 17 is in.

No step is BLOCKED on the migration freeze. Nothing is implemented and nothing is committed.

---

## Revision 1 — Batch E (2026-10-26, after `test-report-batch-E.md` FAIL)

Context: task `2026-10-26-flow-review` treats Batch E as R0. `MARIANA_BEHAVIOR_SPEC.md` has no test-safety criteria, so every criterion below is derived from this plan and from the tester's findings. DB target for every run: `localhost:5432/mariana_test` (`mariana-postgres`). `RELIABILITY_WORKERS_ENABLED=false` in every run.

### Root causes (Revision 1)

| # | Claim | Status | Evidence |
|---|---|---|---|
| RE-1 | Original step 13 (plan line "Step 13", "also hardens the spawned push") is wrong: applying the env makes the `drizzle-kit push` child refuse | **confirmed** (planner error) | `setup-test-db.ts:39` passes `env: process.env`; the child loads `drizzle.test.config.ts:11`, which calls `resolveTestDatabaseEnv` again; that env now has `DATABASE_URL === TEST_DATABASE_URL`, so `test-database-guard.ts:72-82` throws "same database". The child's `import "dotenv/config"` (`drizzle.test.config.ts:4`) does not override. Reproduced by the tester (non-destructive config load) |
| RE-2 | `db-test-preload.ts:13` has the same shape, so it would hit the same refusal | **refuted** | Probe: a `data:` `--import` that exits 7 when `NODE_TEST_CONTEXT` is absent, run with `tsx --test` on a unit file → exit 0, so the runner parent does not run the preload. Each test-file child resolves from the inherited, un-applied env. `test:db` runs setup and tests as two separate processes (`package.json:20`) |
| RE-3 | E-1: the guard trusts `URL.hostname`; `pg` honours `?host=`, so a crafted URL bypasses the local and neon checks | **confirmed** (tester evidence) | `test-database-guard.ts:54-70` reads only `parsedTestUrl.hostname`; query string never inspected. `pg-connection-string` parse result quoted in `test-report-batch-E.md` "Findings" |
| RE-4 | E-2: `localhost` and `127.0.0.1` count as different databases | **confirmed** | `databaseIdentity` (`test-database-guard.ts:32-36`) compares the raw lower-cased hostname |
| RE-5 | Flake `autonomous-task-executor.test.ts:275` is caused by this diff | **refuted / unclear** | The diff touches no reliability code; 1 fail in 3 full runs, 4/4 alone. Likely cross-file contention on global expired-lease recovery. Root cause not investigated (see "Findings listed, no step") |

### Design decision for step 13 — option B, a strict "already applied" check in the test config

Three options were weighed:
- **A. Child env** (strip or blank `DATABASE_URL` for the child) — rejected. Deleting it lets the child's `dotenv/config` reload the Neon URL from `.env`, which is the exact thing step 13 removes. Setting it to `""` works only because `if (devUrl)` treats `""` as absent: a silent trick, easy to break.
- **C. Relax `resolveTestDatabaseEnv`** (accept `DATABASE_URL === TEST_DATABASE_URL` when `NODE_ENV=test`) — rejected. It weakens the one rule that stops a dev who put the same local DB in both variables from resetting his dev DB, for every caller (preload, setup, config).
- **B. Chosen.** A new guard export, `assertAppliedTestDatabaseEnv(source): string`, used only by `drizzle.test.config.ts`. It runs the same `TEST_DATABASE_URL` checks as `resolveTestDatabaseEnv` (shared helper, so 14a's query rule applies to both), then **requires** `DATABASE_URL === TEST_DATABASE_URL`, `NODE_ENV === "test"` and `RELIABILITY_WORKERS_ENABLED === "false"`, and returns the test URL. `resolveTestDatabaseEnv` and its same-DB rule are unchanged. Side effect, intended: running the test config by hand with the `.env` Neon `DATABASE_URL` is now refused (today it is accepted). The config only works inside `setup-test-db.ts`.

### Revised step order for the rest of Batch E

14a → 14b → 13 (revised) → 15 → 16 → 17. 14a/14b come first because 13's new export reuses the URL-check helper they touch.

**Step 14a — E-1: refuse connection overrides in the query string, and register the adversarial file.**
- Files: `src/tests/support/test-database-guard.ts` (`parsePostgresUrl` 17-30 or a new `assertTestUrlIsLocal` helper called from `resolveTestDatabaseEnv` 54-70); `src/tests/test-database-guard-adversarial.test.ts:120-133`; `package.json:21` (`test:unit` list).
- Change: `TEST_DATABASE_URL` may carry only the `sslmode` query parameter. Any other key (`host`, `hostaddr`, `port`, `dbname`, `user`, `options`, …) throws `UnsafeTestDatabaseError` naming the key, never the value. Allowlist, not a `host`/`hostaddr` denylist: `pg-connection-string` honours several keys, and an allowlist matches step 14. Add `src/tests/test-database-guard-adversarial.test.ts` to `test:unit` (it imports only `node:assert`, `node:test` and the guard: pure, no DB).
- Acceptance tests:
  - adversarial file, `"recusa ?host= remoto escondido atrás de localhost"`: remove the `todo` marker. **Red first** (today it fails as a todo).
  - `test-database-guard.test.ts`, `"recusa ?hostaddr= e qualquer parâmetro de conexão na query"` — given `…localhost:5432/mariana_test?hostaddr=10.0.0.5` and `?port=6543`; then `UnsafeTestDatabaseError` whose message names the key and not `10.0.0.5`. **Red first.**
  - same file, `"aceita ?sslmode=disable"` — green before and after.
  - Proof of registration: `npm run test:unit` count rises by the adversarial file's tests.
- Invariants: "never write to Neon". The neon check keeps running first, so its message is unchanged.

**Step 14b — E-2: one identity for loopback aliases (trivial).**
- Files: `src/tests/support/test-database-guard.ts:32-36`; adversarial file `:136-148`.
- Change: in the identity used for the same-DB comparison only, map `localhost`, `127.0.0.1` and `[::1]` to one token. `describeDatabaseHost` output stays as typed (logs keep showing what the user wrote). DNS aliases (`host.docker.internal`, custom names) are not resolved: out of scope.
- Acceptance tests: adversarial `"recusa o mesmo banco escrito como localhost e 127.0.0.1"`: remove `todo`. **Red first.** Plus `"recusa o mesmo banco escrito como [::1] e localhost"` in the same file. **Red first.** Existing "aceita localhost, 127.0.0.1 e ::1" stays green.
- Invariants: none at risk; the check only gets stricter.

**Step 13 (revised) — `setup-test-db.ts` stops holding Neon; the push child accepts the applied env.**
- Files: `src/tests/support/test-database-guard.ts` (new export `assertAppliedTestDatabaseEnv`, beside `applyTestDatabaseEnv` 102-108); `src/tests/support/drizzle.test.config.ts:8,11` (call the new export); `src/tests/support/setup-test-db.ts:12-19` (call `applyTestDatabaseEnv(process.env)` instead of `resolveTestDatabaseEnv`, before `postgres(` at 24 and the `DROP SCHEMA` at 26; line 39 keeps `env: process.env`, now applied); `src/tests/test-database-guard.test.ts`; adversarial file `:105-119`.
- Change: as in the design decision above. Drop/seed statements and the push arguments stay byte-identical.
- Acceptance tests (unit, no connection):
  - `test-database-guard.test.ts`, `"assertAppliedTestDatabaseEnv aceita o ambiente gravado por applyTestDatabaseEnv"` — given Neon-like `DATABASE_URL` + local `TEST_DATABASE_URL`; when `applyTestDatabaseEnv(source)` then `assertAppliedTestDatabaseEnv(source)`; then it returns the local test URL. **Red first** (export missing). Replaces the adversarial todo at `:105-119`, whose assertion (`resolveTestDatabaseEnv` accepts an applied env) contradicts option B. It is rewritten, not just unmarked; the change to the tester's file is recorded in `progress.md`.
  - `"assertAppliedTestDatabaseEnv recusa um ambiente não aplicado"` — given `DATABASE_URL` = Neon-like, `TEST_DATABASE_URL` local, `NODE_ENV=test`; then `UnsafeTestDatabaseError`. **Red first.**
  - `"assertAppliedTestDatabaseEnv recusa NODE_ENV diferente de test ou workers ligados"`. **Red first.**
  - `"assertAppliedTestDatabaseEnv aplica as mesmas regras de host"` — given an applied env on `db.example.com`, and one with `?host=` (14a); then both refused. **Red first.**
  - `"resolveTestDatabaseEnv continua recusando DATABASE_URL igual a TEST_DATABASE_URL"` — local URL in both. Green before and after (protects RE-1's rejected option C).
- Integration proof (tester, non-destructive): the config-load command of `test-report-batch-E.md` with an applied env now loads with no error; the same command with a Neon-like `DATABASE_URL` is refused; `npm run test:db` green, setup printing `target localhost:5432/mariana_test`; `grep -n` shows `applyTestDatabaseEnv` before `postgres(` in `setup-test-db.ts`.
- Invariants: "never write to Neon". After this step no process in `test:db` holds the Neon URL in `process.env` past its first statement.

**Step 16 — one added constraint (no other change).** `isForbiddenTestConnection` must reuse the guard's URL-check helper from 14a/14b, so a `?host=` override cannot reopen E-1 in `connections.ts`.

### Findings listed, no step

- **Flake `src/tests/reliability/autonomous-task-executor.test.ts:275`** (`assert.ok(result.recovered >= 1)`, "recupera tarefas com lease expirado…"): 1 fail in 3 `test:db` runs, 4/4 alone. Not caused by Batch E. Not cheap: it needs an investigation of global expired-lease recovery across parallel test files (isolation per test, or `--test-concurrency=1` for reliability files). Owner: tester backlog, test-isolation work with Package E. Until then, a single red on this test in a full run is re-run once and reported, not treated as a Batch E regression.
- **E-3** (same-DB branch had no direct test): closed by the tester's new adversarial test, registered in 14a.

### Questions for Davi (Revision 1)

1. Step 13 fix: option B (recommended), A or C?
2. 14a query rule: allow only `sslmode` (recommended), or deny only `host`/`hostaddr`?
3. May the implementer rewrite the tester's todo test at `test-database-guard-adversarial.test.ts:105-119` to target the new export? (Recommended: yes.)
4. Flake: list only (recommended), or add a step now?

---

## Revision 2 — Batch E (2026-10-26, after step 15 stop, E-4/E-5, the step 17 test report and the egress leaks)

Context: task `2026-10-26-flow-review`, R0. Inputs: `test-report-batch-E.md` "Revision 1" (E-4, E-5) and "Step 17" (PASS; E-6 to E-10), `progress.md` "Batch E — steps 15 and 17" (step 15 stopped, step 17 done). DB target unchanged: `localhost:5432/mariana_test`; `RELIABILITY_WORKERS_ENABLED=false`. Done and not reopened: 12, 13 (revised), 14, 14a, 14b, 17.

### Root causes (Revision 2)

| # | Claim | Status | Evidence |
|---|---|---|---|
| R2-1 | Step 15's preload assertion is a tautology | **confirmed** (planner error) | `unit-test-preload.ts:7-11` sets the sentinel; an assertion right after it is always true. `.env` is read later, by `src/env.ts:1` (`import "dotenv/config"`), when a test file imports `env`. Implementer probe (`progress.md` step 15): a later `dotenv.config({override:true})` replaced the sentinel with a fake URL and nothing aborted |
| R2-2 | The same hazard exists in the DB preload, where it would put the `.env` `DATABASE_URL` (Neon) back over the test URL | **confirmed by reading** (not probed) | `db-test-preload.ts:5` loads `.env` (no override), `:14-15` assigns the test URL; a doctored `override: true` in `env.ts:1` would restore the `.env` value. Step 16 is the runtime backstop; the revised step 15 test covers both preloads |
| R2-3 | Coordinator claim: "neither preload sets `GEMINI_API_KEY` or `WHATSAPP_ACCESS_TOKEN`, so the un-mocked calls went out with the real credentials" | **refuted** for the current code and for `HEAD` | Both preloads apply `FAKE_EXTERNAL_ENV` before any test file imports `env.ts`: `unit-test-preload.ts:7`, `db-test-preload.ts:15` (same at `HEAD`, `git show HEAD:` both files). `src/tests/support/fake-external-env.ts` sets every external credential `envSchema` reads: `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`/`_SECRET`/`_REDIRECT_URI`/`_ACCOUNT_EMAIL`, `GOOGLE_ADS_WEBHOOK_KEY`, `META_ADS_*`, `WHATSAPP_ACCESS_TOKEN`/`_APP_SECRET`/`_PHONE_NUMBER_ID`/`_VERIFY_TOKEN`/`_WABA_ID`/`_GRAPH_API_VERSION`. `env.ts:1` loads `.env` with `override: false`, so the fake values win. The only other `process.env` reads in product code are `COMPANY_*` (`src/ai/business-profile.ts:9-12`), not credentials. Tester evidence agrees: the Gemini rejections were "fake key" (`test-report-batch-E.md` E-10; B-2 `API key not valid`). **What is true:** the requests did leave the machine before step 17, with fake keys and test payloads. **What is missing:** a test that proves the fake values win after `env.ts` loads, and a check that `FAKE_EXTERNAL_ENV` keeps covering every credential key `envSchema` adds later. Step 15 (revised) adds both. Not checked: which values `.env` holds (never read, per `CLAUDE.md`) |
| R2-4 | E-4: guard and postgres.js read different hosts from one URL | **confirmed** | Guard: WHATWG `new URL` (`test-database-guard.ts:24`), host = `hostname` (`:70`, `:83`), userinfo split at the **last** `@`. postgres.js `parseUrl` (`node_modules/postgres/src/index.js:541-545`): authority = text after `://` up to the first `?` or `/`; host = text after the **first** `@`, then percent-decoded; a `,` makes a multihost list (`:557`) used as the host at `:438`. So `user:secret@x,<neon>:5432@localhost:5432/neondb` is `localhost` to the guard and `["x", <neon>]` to postgres.js |
| R2-5 | E-5: an omitted port or database is filled from `PGPORT`/`PGDATABASE` by the drivers, not from the guard's defaults | **confirmed** | Guard defaults `5432`/`postgres` (`test-database-guard.ts:37-38`, `:46-47`). postgres.js: port `:439` `url.port || env.PGPORT`; database `:469` `pathname || env.PGDATABASE || user`. `pg` the same per tester |
| R2-6 | Step 16's approved trigger (`--test` in `execArgv`/`argv`) never fires in the process that imports `connections.ts` | **confirmed** (new; planner error in step 16) | Node v24.22.1 test runner strips `--test` from each child's `execArgv` (`kFilterArgs`: `--test`, `--experimental-test-coverage`, `--test-randomize`, `--watch`, …; `filterExecArgv`) and sets `NODE_TEST_CONTEXT` (`'child-v8'` or `'child'`) in the child env. Each test file runs in such a child (also RE-2's probe). The runner parent, which does see `--test`, never imports `connections.ts`. Read from the node binary's embedded sources; no test run |
| R2-7 | Un-mocked external calls in DB tests stay green | **confirmed** | `src/tests/routes/webhook-whatsapp.test.ts:1830` ("mensagem com 4h exatas pergunta antes de processar"): the session-choice question send is not mocked → `fetch` at `whatsapp-client.ts:140` (`graph.facebook.com`, `:53`); the client catches and logs the error. E-10 `src/tests/reliability/session-choice-invalid-replies.test.ts:473` ("toque sessao:desconhecido não consome a escolha: toque valido ainda decide"): `drainConversationWork` at `:500` runs a Mariana turn without a `generateContent` mock → 3 attempts to `generativelanguage.googleapis.com`; the model-failure path absorbs them silently. Before step 17 these were real HTTPS requests on every DB run (fake keys, rejected) |
| R2-8 | The egress guard turns a leak into a log line, not a failure | **confirmed** | Same evidence as R2-7: both tests pass with the guard on. Without a fail-closed rule, every future leak behind a `try/catch` hides the same way |
| R2-9 | E-6: the socket check reads the wrong field | **confirmed** | `test-network-egress-guard.ts:68-76` `hostFromOptions` prefers `hostname`; `net` connects to `host`. `net.connect({ hostname: "localhost", host: <remote> })` passes the check (tester proof with fake lookup). HTTP is unaffected (tester) |
| R2-10 | E-7 (`dns.resolve*`, `dns.Resolver`, `dns.promises.Resolver`), E-8 (`dgram`), E-9 (`worker_threads`), E-9b (child processes) are unguarded | **confirmed**, all latent | Tester table, `test-report-batch-E.md` "Bypasses found". No repo code uses Worker, dgram or `dns.resolve`; the only `child_process` use is `setup-test-db.ts`, before any preload |
| R2-11 | `src/tests/test-network-egress-guard-adversarial.test.ts` runs only under `test:db` | **confirmed** | Not in `package.json:21`; pure (tester: same results under both preloads) |

### Design (Revision 2)

**D-1 — where the "dotenv never overrides" and "fake credentials win" invariants are checked (replaces step 15).** Both must be checked *after* `env.ts` has loaded `.env`, with a `.env` the test controls, and the real `.env` must never be read. So: a unit test that spawns a child process.
- child cwd = a fresh temp dir with a fake `.env`: `DATABASE_URL=postgresql://doctored@127.0.0.1:2/override` and, for every key of `FAKE_EXTERNAL_ENV`, a canary value `canary-<KEY>` (never a real value);
- child = `process.execPath` with `--import <absolute tsx loader>` and `--import <absolute preload>` (absolute, because `--import` resolves from the cwd), running a short script that imports `src/env.ts` by absolute path and prints a JSON report: whether `process.env.DATABASE_URL` / `env.DATABASE_URL` equal the expected URL, and the **list of key names** whose `process.env` or `env` value equals its canary. It never prints a credential value;
- child env = minimal (`PATH`; plus `TEST_DATABASE_URL=postgresql://mariana:mariana@localhost:5432/env_isolation_probe` for the DB case); the parent's `DATABASE_URL` and credentials are not passed;
- the child never imports `src/db/connections.ts` (no connection); the step 17 guard stays active in it.
Why a temp cwd and not `DOTENV_CONFIG_PATH`: a doctored `env.ts` with `dotenv.config({ override: true })` and no path reads `.env` from the cwd; with the repo as cwd, the real `.env` would enter the child. The temp cwd makes that impossible.
Coverage check (no child): every `envSchema` key that names a credential or account id (`/KEY|TOKEN|SECRET|CLIENT_ID|EMAIL|PHONE_NUMBER_ID|WABA_ID/`) is present in `FAKE_EXTERNAL_ENV`. A future credential added to `env.ts` without a fake turns this red.
The old step 15 preload assertion is **not** added (it cannot fail). A preload comment states the dependency on `override: false`. `src/env.ts` and `fake-external-env.ts` are not changed (R2-3: the fakes already cover every credential).

**D-2 — E-4: one URL, one host (guard).** In the shared URL check (`checkTestDatabaseUrl`, `test-database-guard.ts:58-94`), after the protocol check and before the local-host check:
- read the authority the way postgres.js does (after `://`, up to the first `/`, `?` or `#`);
- refuse more than one raw `@` (a password `@` must be written `%40`);
- refuse a host part (after the `@`, percent-decoded) that contains `,` or `@`;
- refuse when that driver-style host (port removed, lower-cased) differs from `URL.hostname` (lower-cased).
Messages name the rule and never print the userinfo. The guard stays pure (no driver import). Agreement with the real driver is proved in tests with `postgres(url).options` (lazy, no connection), as the tester did. Rejected: make the guard call postgres.js's parser — couples the guard to one driver, while `pg-connection-string` (drizzle-kit push) is a second parser.

**D-3 — E-5: the URL must name its port and database.** Same helper: refuse a `TEST_DATABASE_URL` with an empty `port`, or whose path is not exactly one non-empty segment. With host, port and database explicit, both drivers ignore `PGHOST`/`PGPORT`/`PGDATABASE` (postgres.js `:438-439`, `:469`). `PG*` variables are **not** refused: `PGUSER`/`PGPASSWORD` do not change the target. `CLAUDE.md:24`'s documented URL already has both.

**D-4 — step 16 amended.** Two changes, both needed for it to work:
1. Trigger: a test process is one where `NODE_TEST_CONTEXT` is set **or** `--test` is in `execArgv`/`argv` (R2-6). This changes one of the three properties Davi approved ("the `--test` condition"): question 4. The predicate stays pure (it receives `env`, `argv`, `execArgv`); the `ALLOW_REMOTE_TEST_DB=1` hatch stays.
2. URL rules: the predicate reuses the full shared URL check (14a, 14b, 14c, 14d, local host) through one exported pure helper extracted from `checkTestDatabaseUrl`, taking the variable name.
Production is unaffected: `NODE_TEST_CONTEXT` is never set by `npm start`/`npm run dev`.

**D-5 — close the cheap egress gaps; list the rest.** E-6: the `Socket#connect` path reads `host` (one line). E-7: patch `Resolver.prototype.resolve*`/`reverse` (both `dns` and `dns.promises`) and the module-level `dns.resolve*` functions, which are bound to a default resolver, so patching the prototype alone is not enough. E-8: patch `dgram.Socket.prototype.send` and `connect` with the same predicate. Size rule: if E-7 or E-8 needs more than one small wrapper per API, leave its `todo` and report; do not grow the guard. E-9 (Workers) and E-9b (child processes) are **listed, no step**: no repo code uses Workers, the only child process is `setup-test-db.ts` (before the preload), and guarding them needs `--import` propagation through `NODE_OPTIONS`/Worker `execArgv`, which also reaches drizzle-kit — a larger change for a latent risk. Register the tester's adversarial file in `test:unit`.

**D-6 — a blocked egress fails the test file.** The guard counts each blocked attempt (host only). At process exit, if the count is above zero and the hatch is off, the preload prints one line per host and sets a non-zero exit code; the node test runner reports that child as a failed file. An exported `takeBlockedEgressAttempts()` drains the counter, so the guard's own tests that trigger a block on purpose can clear it. With `ALLOW_TEST_NETWORK=1` nothing is blocked, so nothing is counted.

**D-7 — mock every leak D-6 reports.** Starting list: `webhook-whatsapp.test.ts:1830` (WhatsApp send) and `session-choice-invalid-replies.test.ts:473` (E-10, Gemini). Each gets a mock at the seam its file already uses (`WhatsAppService.prototype.*` with restore, `t.mock.method(ai.models, "generateContent", …)`). Where the scenario expects a send, the test asserts the mock was called; for E-10, the test also asserts the turn did not end as `model_error`. No product code changes. If a leak needs a product seam, stop and report.

### Revised step order for the rest of Batch E

Batch E-R2a: 14c → 14d. Batch E-R2b: 15 (revised) → 16 (amended). Batch E-R2c: 18a → 18 → 19. Tester after each batch. 16 depends on 14c/14d (shared helper). 19 depends on 18 (18 produces the red).

**Step 14c — E-4: refuse URLs that postgres.js reads differently.**
- Files: `src/tests/support/test-database-guard.ts` (`checkTestDatabaseUrl` 58-94; new private helper beside `parsePostgresUrl` 21-34); `src/tests/test-database-guard-adversarial.test.ts:244-257` (E-4 todo); `src/tests/test-database-guard.test.ts`.
- Change: D-2.
- Acceptance tests (unit, no connection):
  - adversarial `"recusa lista de hosts escondida no userinfo (postgres.js conectaria no neon)"`: remove `todo`. **Red first.**
  - `test-database-guard.test.ts`, `"recusa @ a mais, vírgula ou host codificado na autoridade"` — `u:p@x@localhost:5432/db`, a comma host list that `new URL` accepts, `u:p@x%2Cevil@localhost:5432/db` → `UnsafeTestDatabaseError`; the message has no userinfo. **Red first** for the inputs accepted today.
  - `"aceita senha com %40 codificado"` — `u:p%40ss@localhost:5432/mariana_test` accepted. Green before and after.
  - adversarial `"o host aceito pelo guard é o mesmo que o postgres.js usaria"` — for every URL of the tester's bypass corpus that the guard accepts, `postgres(url).options.host` is a one-element list, equal to the guard's host, and local. **Red first** (E-4 URL). No `sql` call is made.
- Invariants: "never write to Neon". The neon and query checks keep their order and messages.

**Step 14d — E-5: require explicit port and database.**
- Files: same helper; adversarial file `:259-270` (E-5 todo); fixtures that must be *accepted* and have no port (for example adversarial `:26` `LOCALHOST/mariana_test`).
- Change: D-3. Accepted fixtures gain `:5432`; refused fixtures stay unless a test pins a message that changes. Every fixture edit is listed in `progress.md`.
- Acceptance tests:
  - adversarial `"exige porta e banco explícitos no TEST_DATABASE_URL (PGPORT/PGDATABASE não decidem o alvo)"`: remove `todo`. **Red first.**
  - `test-database-guard.test.ts`, `"a mensagem de porta ou banco ausente nomeia o que falta"`, without the password. **Red first.**
- Invariants: stricter only. Risk: Davi's `.env` `TEST_DATABASE_URL` must name its port. `setup-test-db.ts` logs `describeDatabaseHost`, which fills in `5432`, so the log cannot tell; the first `npm run test:db` after this step answers it (clear refusal, nothing dropped).

**Step 15 (revised) — prove that `.env` never overrides the preload's `DATABASE_URL` or fake credentials.**
- Files: new `src/tests/test-env-isolation.test.ts` (in `package.json` `test:unit` and `docs/CODEMAP.md`); comments only in `unit-test-preload.ts` and `db-test-preload.ts`.
- Change: D-1.
- Acceptance tests (unit; child processes; no DB, no network):
  - `"com o preload unitário, o .env não troca DATABASE_URL nem credenciais"` — both URL checks true; canary key list empty.
  - `"com o preload de banco, o .env não troca DATABASE_URL nem credenciais"` — URL equals the child's `TEST_DATABASE_URL`; canary list empty.
  - `"toda credencial do envSchema tem valor falso em FAKE_EXTERNAL_ENV"` — the coverage check of D-1.
  - Control `"o harness detecta um dotenv com override"` — same harness, the child script calls `dotenv.config({ override: true })` after importing `env.ts`; then the URL check is false and the canary list names every fake key. This is the red evidence: the two tests above would fail if `env.ts` overrode, without editing `env.ts`. Control for the coverage check: run it against a copy of the fake map with `GEMINI_API_KEY` removed → it names `GEMINI_API_KEY`.
  - Optional tester red: a temporary local edit of `env.ts:1` to `override: true` turns the first two red; it is reverted and `git diff src/env.ts` is empty.
- Invariants: "never write to Neon", "never call real APIs". No credential value is printed in any output.

**Step 16 (amended) — close holes 1 and 2 at the source.** The Batch E text and the Revision 1 constraint stay; D-4 is added.
- Files: `src/db/connections.ts:6-8`; `src/tests/support/test-database-guard.ts` (export the shared URL helper); `src/tests/test-database-guard.test.ts`.
- Change: `isForbiddenTestConnection({ url, env, argv, execArgv })` — pure; test process per D-4; in a test process the URL must pass the shared helper unless `env.ALLOW_REMOTE_TEST_DB === "1"` (neon refused even then). `connections.ts` calls it before `postgres(env.DATABASE_URL)` and throws `UnsafeTestDatabaseError` without printing the URL.
- Acceptance tests (unit, pure):
  - `"isForbiddenTestConnection recusa Neon em um filho do test runner"` — `NODE_TEST_CONTEXT: "child-v8"`, empty `execArgv` → forbidden. **Red first.**
  - `"… recusa a URL do E-4 e uma URL sem porta"`. **Red first.**
  - `"… aceita o sentinela unitário e o banco local de teste"`. **Red first** (predicate missing).
  - `"… não interfere fora de testes"` — no `NODE_TEST_CONTEXT`, no `--test`, Neon URL → allowed. **Red first**; pins production unchanged.
  - `"… ALLOW_REMOTE_TEST_DB=1 libera host remoto, nunca neon.tech"`. **Red first.**
- Integration proof (tester): `npm run test:db` green; `npm run test:unit` green.
- Invariants: "never write to Neon". Production unchanged (fourth test).

**Step 18a — egress guard gaps E-6 (and E-7, E-8 if cheap); register the adversarial file.**
- Files: `src/tests/support/test-network-egress-guard.ts` (`hostFromOptions` 68-76 for the socket path; new wrappers for E-7/E-8); `src/tests/test-network-egress-guard-adversarial.test.ts` (remove the E-6, E-7, E-8 `todo` markers that get closed); `package.json:21` (`test:unit`).
- Change: D-5.
- Acceptance tests: the adversarial `todo` tests for E-6 (and E-7, E-8 when done) lose `todo`. **Red first** (failing todos today). E-9 and E-9b stay `todo`. Proof of registration: `test:unit` count rises by the file's tests; the file passes under the unit preload.
- Invariants: loopback stays reachable (`npm run test:db` green).

**Step 18 — a blocked egress fails the test file.**
- Files: `src/tests/support/test-network-egress-guard.ts` (counter, `takeBlockedEgressAttempts`, exit hook in `installTestNetworkGuard`); `src/tests/test-network-egress-guard.test.ts`; adversarial file (drain the counter where it triggers blocks on purpose).
- Change: D-6.
- Acceptance tests (unit):
  - `"uma tentativa bloqueada e engolida por try/catch faz o arquivo falhar"` — spawn `tsx --import <unit preload> --test <temp fixture>` whose test calls `fetch("https://example.invalid")` inside `try/catch`; then exit code non-zero and the output names the host. **Red first** (today exit 0). No packet leaves: the guard blocks before DNS.
  - `"sem tentativa bloqueada o arquivo passa"` → exit 0. Green before and after.
  - `"com ALLOW_TEST_NETWORK=1 nada é contado"` — predicate and counter only, with a fake `lookup` as in the step 17 wiring test; no real request. **Red first** for the counter.
- Expected consequence: `npm run test:db` turns red on the two files of R2-7. That red is step 19's start. The tester records the full list of flagged files.
- Invariants: none in product code.

**Step 19 — mock every external call the step 18 run flags.**
- Files: `src/tests/routes/webhook-whatsapp.test.ts` (test at `:1830`); `src/tests/reliability/session-choice-invalid-replies.test.ts` (test at `:473`, drain at `:500`); any other test file the step 18 run flags. Test files only.
- Change: D-7.
- Acceptance tests: the flagged tests. **Red first** = the step 18 failure. Green = they pass, the blocked-egress count for their file is zero, the WhatsApp mock was called with the expected recipient (`:1830`), and the E-10 turn did not end as `model_error`.
- Invariants at risk: "a duplicate inbound event is never processed twice"; "an outbound message that may have been accepted by Meta never goes back to `pending`". The tests' existing assertions on events and outbound rows stay unchanged; only the transport is mocked. If an existing assertion must change, stop and report.

### Out of scope (Revision 2)

- `src/env.ts` and `fake-external-env.ts`: not changed (D-1 checks them from outside; R2-3).
- E-9 (Workers) and E-9b (child processes): listed, no step (D-5).
- The accepted limit of the tester's table: a custom `lookup` can map `localhost` to any IP; the guard checks names, not resolved addresses.
- Refusing `PG*` variables (D-3 makes them irrelevant to the target).
- DNS resolution of custom DB host names (unchanged from 14b).
- postgres.js's `[::1]` parse (tester observation): fails safe.
- The flake `autonomous-task-executor.test.ts:275`: listed only.

### Questions for Davi (Revision 2)

1. Step 15: child-process test with a fake `.env` in a temp folder (recommended), or a check inside `src/env.ts` under `NODE_ENV=test` (touches production code)?
2. E-4: pure structural rule plus a test that compares with postgres.js (recommended), or make the guard call postgres.js's parser?
3. E-5: require explicit port and database (recommended), or refuse `PGPORT`/`PGDATABASE`/`PGHOST`?
4. Step 16 trigger: add `NODE_TEST_CONTEXT` to the `--test` condition (recommended; without it the guard never fires inside a test file). This changes one property you approved.
5. Egress: steps 18a + 18 + 19 now (recommended), or only 19 (mocks) and defer the fail-closed rule?
6. E-7/E-8: close them in 18a under the size rule (recommended), or list them with E-9/E-9b?


## Revision 3 — Batch E (2026-10-26, after `test-report-batch-E.md` "E-R2a" and "E-R2b")

Context: task `2026-10-26-flow-review`, R0; spec `mariana_spec.md`. Inputs: `test-report-batch-E.md` E-R2a (E-11, `:326`) and E-R2b (E-12, `:404`; runner probes `:391-400`; regex note `:406`), `progress.md` "Batch E-R2c". Steps 12–19 are done and not reopened; the tester is verifying E-R2c (18a, 18, 19, E-13) now. DB target unchanged: `localhost:5432/mariana_test`; `RELIABILITY_WORKERS_ENABLED=false`.

### Root causes (Revision 3)

| # | Claim | Status | Evidence |
|---|---|---|---|
| R3-1 | E-12: a test file run directly reaches the `.env` `DATABASE_URL` (Neon) | **confirmed** (planner gap in D-4) | Trigger `test-database-guard.ts:186-189` = `NODE_TEST_CONTEXT` or `--test` in `execArgv`/`argv`. `tsx x.test.ts` or IDE "Run file" runs `node:test` in-process: neither is set, and no preload runs, so `src/env.ts:1` loads `.env` and `connections.ts:27` opens it. Tester probe "imported — evaded" (`test-report-batch-E.md:398`) |
| R3-2 | In that run, `process.argv[1]` is the test file | **confirmed by reading**, to be probed by the tester | Node sets `argv[1]` to the resolved entry script; tsx's CLI relays the file as the child's entry (the tester's todo uses that shape, `test-database-guard-adversarial.test.ts:536-547`). Production entries: `dist/server.js` (`package.json` `start`), `src/server.ts` (`dev`), `src/db/seed.ts` (`db:seed`), `scripts/simulate-conversation.ts` (`sim:conversation`). None ends in `.test.*` or sits under `src/tests/` |
| R3-3 | E-12b: the same direct run also has no fake credentials and no egress guard | **confirmed by reading** (new, not probed) | Both are installed only by the preloads (`unit-test-preload.ts:7-12`, `db-test-preload.ts`). A DB test file is stopped by step 20 at its `connections.ts` import, before any send. A test file that never imports `connections.ts` and has an unmocked `fetch` would use the `.env` credentials. Today step 18 proves no file leaks under the preloads; the risk is a future leak run directly |
| R3-4 | E-11: `pg` reads 3 guard-accepted forms differently | **confirmed** | Tester table `test-report-batch-E.md:320-322`. Cause: the guard parses with WHATWG `new URL` (`test-database-guard.ts:24`), which strips leading/trailing spaces and keeps `%xx` in the path; `pg` re-encodes and decodes the path. The guard never looks at the raw string for whitespace or `%` |
| R3-5 | Host `%xx` is already refused | **confirmed by reading** | `assertDriverReadsSameHost` (`test-database-guard.ts:45-79`) decodes the host and compares it with `URL.hostname`, which keeps `%xx` for `postgres:` URLs; they differ, so it throws. Step 21 still adds an explicit rule, so the message is clear and does not depend on that side effect |

### Design (Revision 3)

**D-8 — E-12: the entry script also marks a test process (amends D-4, step 16 unchanged as text).** Add a third trigger to `isForbiddenTestConnection` (`test-database-guard.ts:180-199`): the entry script `argv[1]` is a test entry when
- its base name matches `/\.test\.[cm]?[jt]sx?$/`, **or**
- its path has the consecutive segments `src` `tests` (split on `/` and `\`, so Windows paths count).
The predicate stays pure (it already receives `argv`). `connections.ts` is unchanged except its comment (`:12-13`). The `ALLOW_REMOTE_TEST_DB=1` hatch and the neon refusal behave as today.

Options weighed:

| Option | False negatives (misses a test run) | False positives (fires in prod) | Verdict |
|---|---|---|---|
| A. `argv[1]` base name is `*.test.*` | a wrapper whose entry is not the test file (custom runner script, some IDE shims); `node -e`/REPL importing a test file | none: no prod entry has that name | take |
| B. `argv[1]` under `src/tests/` | an entry outside the repo layout | a future support script under `src/tests/` that needs a non-local DB — forbidden by `CLAUDE.md` anyway; `setup-test-db.ts` does not import `connections.ts` | take (covers helpers run directly, e.g. `conversation-harness.ts`) |
| C. `NODE_ENV=test` | the direct run itself: no preload sets it, `.env` normally does not | a prod deploy with `NODE_ENV=test` would refuse Neon and stop the bot | reject |
| D. detect that `node:test` was loaded | ESM link order and `process.moduleLoadList` are internal, undocumented | none | reject (fragile) |
| E. structural: tests get `db` only through a preload-installed seam | none | none | reject now: rewires every DB test and `connections.ts`; much larger than the risk |
| F. a preload marker env var, refuse when missing | the marker only helps if the trigger already knows it is a test | same as A/B | not needed: A ∪ B is the trigger, the URL check is the decision |

Known false negatives after step 20 (listed, no step): a custom wrapper entry that imports test files; `node -e`/REPL. Known false positive kept: prod started with a literal `--test` argument (below).

**D-9 — E-11: refuse whitespace, control characters and `%` outside the userinfo (cheap).** In `assertSafeTestDatabaseUrl` (`test-database-guard.ts:108`), right after the empty check and before `parsePostgresUrl`, on the **raw** value (the WHATWG parser trims, so the check must not use the parsed URL):
- refuse any whitespace or control character anywhere (`/[\s\x00-\x1f\x7f]/`);
- refuse `%` in the host part (raw authority after its single `@`; 14c already refuses a second one) and in the path (database name).
`%` stays allowed in the userinfo, so `%40` in a password still works. Messages name the rule and never print the value. This applies to `TEST_DATABASE_URL` and, in a test process, to `DATABASE_URL` (shared helper). Stricter only. The sentinel (`unit-test-preload.ts:11`) and `CLAUDE.md:24`'s URL pass.

### Revised step order for the rest of Batch E

Batch E-R3a: step 20 (E-12; live Neon risk, first). Batch E-R3b: step 21 (E-11). Tester after each batch. Both start only after Davi approves Revision 3 **and** the tester's E-R2c report is in. Neither touches the E-R2c files except the two pinned `todo` tests.

**Step 20 — E-12: a test file run directly is a test process.**
- Files: `src/tests/support/test-database-guard.ts` (`isForbiddenTestConnection` 180-199 and its doc comment 173-179); `src/db/connections.ts:12-13` (comment only); `src/tests/test-database-guard-adversarial.test.ts:533-548` (E-12 `todo`); `src/tests/test-database-guard.test.ts`.
- Change: D-8.
- Acceptance tests (unit, pure unless noted):
  - adversarial "E-12: um arquivo .test.ts executado direto também é processo de teste": remove `todo`. **Red first.**
  - "isForbiddenTestConnection trata um arquivo .test.* como entrada de teste" — `argv[1]` = `/tmp/x/f.test.mjs`, `C:\repo\src\x.test.ts`, empty env and execArgv, Neon URL → forbidden. **Red first.**
  - "… trata uma entrada em src/tests/ como processo de teste" — `argv[1]` = `/repo/src/tests/support/conversation-harness.ts`, `C:\repo\src\tests\a.ts` → forbidden. **Red first.**
  - "… não interfere com as entradas de produção" — `argv[1]` = `/app/dist/server.js`, `/repo/src/server.ts`, `/repo/src/db/seed.ts`, `/repo/scripts/simulate-conversation.ts`, `/home/u/tests/app/dist/server.js`, `/repo/src/testsuite/a.ts`, `/repo/src/latest.ts`; also `argv` with no `[1]` → allowed with a Neon URL. Green before and after; pins "no false positive".
  - "… entrada de teste com banco local passa" — `argv[1]` test file, URL `postgresql://mariana:mariana@localhost:5432/mariana_test` → allowed. **Red first** only if the implementation is wrong; green expected.
  - Wiring (child process, tester pattern `importConnectionsInChild`, temp cwd, fake `.env` with `ep-fake.neon.tech`, `env -i`, no connection): a temp `f.test.mjs` run as `tsx f.test.mjs` (no `--test`) → `UnsafeTestDatabaseError`, URL not printed. **Red first** (today "imported").
- Tester probes: `node --import tsx f.test.ts`, `tsx watch f.test.ts` (one start, then kill), an IDE-style `node --require tsx/cjs --import tsx/esm <file>` → refused; `npm run test:unit`, `npm run test:db` green; `sim:conversation` is not run (needs Gemini) — read-only check that its entry is outside the rule.
- Invariants: "never write to Neon". Production unchanged (fourth test). The bot keeps starting from `dist/server.js`.

**Step 21 — E-11: refuse URL forms the drivers read differently.**
- Files: `src/tests/support/test-database-guard.ts` (`assertSafeTestDatabaseUrl` 108-158); `src/tests/test-database-guard-adversarial.test.ts:473-495` (E-11 `todo`); `src/tests/test-database-guard.test.ts`.
- Change: D-9.
- Acceptance tests (unit, no connection):
  - adversarial "tester E-R2a: guard recusa URL que o pg lê com outro host ou banco": remove `todo`. **Red first.**
  - "recusa espaço, caractere de controle e % no host ou no banco" — leading space, trailing space, tab inside the host, `\n` at the end, `…/mariana%5Ftest`, `…@local%68ost:5432/db` → `UnsafeTestDatabaseError`; messages contain neither `mariana:mariana` nor the password. **Red first** for the first five.
  - existing "aceita senha com %40 codificado" stays green.
  - the 14c three-way agreement test (guard, postgres.js, `pg`) stays green and now has no exceptions.
- Fixture edits, if any, listed in `progress.md`.
- Invariants: stricter only. Risk: a quoted `TEST_DATABASE_URL` with a trailing space in Davi's `.env` gets a clear refusal on the next `npm run test:db`; nothing is dropped.

### Listed only, no step (Revision 3)

- **Step 16 false fire:** a production process started with a literal `--test` argument is treated as a test process and refuses Neon (`test-report-batch-E.md:400`). No repo script passes `--test`; the bot would stop at start-up, loudly. Low.
- **Credential regex blind spots** (step 15 coverage check, `test-report-batch-E.md:406`): suffixed names (`*_TOKEN_V2`, `API_KEYS`, `*_SECRET_2`), and `*_PASSWORD`, `*_DSN`, `*_JSON` are not matched. Only future keys are at risk. A later option: an explicit allowlist of non-credential keys.
- **E-9** (`worker_threads` gets unguarded `net`/`fetch`) and **E-9b** (a child `node` process or tool does not inherit the egress guard): latent, no repo code uses them in tests (D-5).
- **E-12b** (R3-3): a direct run of a test file that does not import `connections.ts` has real `.env` credentials and no egress guard. See question 3.
- Known false negatives of D-8: a custom wrapper entry; `node -e`/REPL.
- **E-14:** the implementer fixes it inside step 20's batch, as a defect of an approved step (no new step).
- **E-15** (low): `dns.lookupService` is not wrapped by the egress guard. Pinned as a `todo`.

### Out of scope (Revision 3)

- `src/env.ts`, `fake-external-env.ts`, the preloads, the egress guard: not changed.
- Any product file other than the comment in `connections.ts`.
- Done steps 12–19: text and code not reopened.

### Questions for Davi (Revision 3)

1. E-12 trigger: entry file named `*.test.*` **or** under `src/tests/` (recommended), only `*.test.*`, or add `NODE_ENV=test` too (not recommended: can stop the bot in prod)?
2. E-11: do step 21 now (recommended; small and stricter only), or list it?
3. E-12b: list it now and decide later (recommended), or plan a step that also stops a direct test run from loading real credentials (needs a check in product code such as `src/env.ts`, which you declined in Revision 2)?
4. Order: E-R3a (step 20) as soon as the tester's E-R2c report is in, then E-R3b (step 21) (recommended)?
