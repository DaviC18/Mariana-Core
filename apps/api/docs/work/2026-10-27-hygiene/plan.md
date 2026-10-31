Status: DRAFT — waiting for Davi's approval

# Plan — 2026-10-27-hygiene

Source: open-items table of `docs/work/2026-10-26-flow-review/test-report.md:1037-1056` (final verification, step 25).

## Summary
- Close the low-risk leftovers of flow-review: doc drift (D-3, D-4), AC15 and other dead session-choice references, the missing findings table.
- Remove three known test flakes and make fake provider/calendar ids unique. Test code only.
- Get a decision on R-V3c-1. No customer-visible change in any step unless Davi picks option B or C there.

## Root causes / status of each item
| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | D-3 spec drift | **confirmed** | `docs/specs/2026-10-17-scheduling-and-session-flow.md:65-72` (D3 = preference → consultant buttons → slots; `awaiting_consultant_preference`), `:80` (tap while awaiting preference), `:112-114` (AC3–AC5). Contradicts R-SCH-01 v1.4 (`MARIANA_BEHAVIOR_SPEC.md:57`). `:21-22`, `:45`, `:49` are the production transcript and root-cause history: keep. `:67` is inside D3. |
| 2 | ROADMAP gaps (D-4) | **confirmed** | `docs/specs/ROADMAP-2026-10-22.md:18` cites "(R-SCH-01, v1.1)"; rows D/F/G (`:29`, `:31`, `:32`) lack the Rev1 notes of `flow-review/plan.md:373-377` (N-1 under WP-5; F not needed for correctness; G index still wanted). `:3` "spec v1.1" is the base at the time: keep. |
| 3a | UUID/hash flake | **confirmed, wider than reported** | `generate-mariana-response.test.ts:934` (report says :936) and `turn-trace-integration.test.ts:288` run `/\d{11}/` over the whole JSON trace line. The line carries `leadId`, `conversationId`, `turnId` (UUIDs; the last 12-hex group gives ≥ 11 decimal digits with p ≈ 0.8 % per UUID) and 12-hex hashes `rawReplyHash`, `sentReplyHash`, `hashBefore`, `hashAfter` (`src/lib/turn-trace.ts:103,124-129`, same p ≈ 0.8 % each). Stripping UUIDs alone would leave the hash flake. |
| 3b | `autonomous-task-executor.test.ts:275` | **confirmed by code, not reproduced** | `recoverStaleAutonomousTasks` (`autonomous-task-executor.ts:336-368`) updates every expired `processing` task in the DB, with no conversation filter. `node --test` runs files in parallel processes; `runAutonomousTasksUntilIdle` (`:382`) calls it too and is used by `model-failure.test.ts`, `model-failure-acceptance.test.ts`, `inbound-batch-claim.test.ts`. If another file recovers this test's two tasks between the insert (`:256-269`) and the call (`:273`), `result.recovered`/`failed` are 0 → `:275`/`:276` fail, while the row statuses (`:283-284`) are still right. Not a product bug: recovery is global by design (worker). |
| 3c | Fake ids from `Date.now()`/constants | **confirmed (latent)** | The fake sender's id is written to `messages.externalId` (`outbound-messages.ts:357`; partial unique index `messages.ts:48`). Two sends in the same ms collide. Calendar ids go to `appointments.externalEventId` (unique, `appointments.ts:39`). Sites in step 6. |
| 4 | R-V3c-1 | **confirmed, behavior is spec-consistent** | `session-rotation.ts:122-165`: a tap whose `button-reply:<id>` task exists returns its conversation (`redelivery: true`). Webhook `webhook-whatsapp.ts:384` skips only when that conversation is closed; if A is active it bumps `lastCustomerMessageAt = receivedAt` (`:401-407`) and re-enqueues the task. Pinned by `tap-redelivery-adversarial.test.ts:601` (probe). Matches R-SES-02 v1.4 "o reenvio não abre conversa nova" and S-22. Decision needed (Q1). |
| 5 | AC15 / dead session-choice refs | **confirmed** | AC15 was proposed in `2026-10-22-session-choice-24h/plan.md:300` and never added; flagged at `…/session-choice-24h/test-report.md:185` and `flow-review/test-report.md:231,1048`. `CLAUDE.md`, `CODEMAP.md`, spec header: no dead refs (history lines in `MARIANA_BEHAVIOR_SPEC.md:145` are changelog). Only test-name remnant: fake id prefix `wamid.session_choice_` at `webhook-whatsapp.test.ts:1928` (handled in step 6). Comment `session-rotation.test.ts:1197` is correct history: keep. |
| 6 | findings.md missing | **confirmed** | No `docs/work/2026-10-26-flow-review/findings.md`. IDs live in `flow-review/plan.md:283-296` (F2-xx verdicts), `:98-180` (F2-04…F2-27), `test-report.md` (F-T*, F-V*, F-03, E-xx, `:1037-1056`). This planner run's harness forbids writing report/findings files, so I did not write it. |
| 7 | Biome | **refuted (nothing left)** | `npx biome check src scripts`: 195 files, clean. `session-choice-concurrency` / `session-choice-invalid-replies` test files are deleted. The only errors in the repo are in the untracked `docs/work/2026-10-27-scheduling-loop/repro/*.repro.ts` (another task): out of scope. |

## Design
- Batch 1 (steps 1–3): doc-only. Exact wording below; Davi approves it.
- Batch 2 (steps 4–5): test-only. A shared helper strips ids/hashes before the phone check; the executor test asserts its own rows, not global counts.
- Batch 3 (steps 6–7): a shared `uniqueFakeId` helper for fake senders/calendars; findings.md.
- Step 8: R-V3c-1, BLOCKED on Q1.
- Must NOT change: any file under `src/` outside `src/tests/`; `package.json` except adding new unit test files to `test:unit`; `drizzle/`; `CLAUDE.md`; `.claude/`; `.env`; `MARIANA_BEHAVIOR_SPEC.md` (only if Q1 = A with the note, and Davi approves that wording).

## Steps

### Batch 1 — docs

**Step 1 — D-3: scheduling-flow spec aligned with R-SCH-01 v1.4**
- File: `docs/specs/2026-10-17-scheduling-and-session-flow.md`.
- Replace `:65-72` (D3 heading, list and the paragraph under it) with:
  > ### D3. One scheduling path, in this order (superseded on 2026-10-27 by `MARIANA_BEHAVIOR_SPEC.md` R-SCH-01 v1.4)
  > 1. the client accepts the offer;
  > 2. up to 3 slot buttons; the system draws the consultant of each slot among the free ones (a single slot is pre-selected and goes straight to step 3);
  > 3. confirmation buttons (Confirmar / Não), already with that slot's consultant;
  > 4. final confirmation with date, time and consultant.
  >
  > There is no consultant preference question. The client never picks the consultant, and the AI never picks one. Never two concurrent sets of buttons.
- Replace `:80` with:
  > Legacy case (one release, flow-review step 32): a valid, persisted slot of the ACTIVE session tapped while a legacy session is still in a preference stage → accept it, set `selectedSlotId`, move to confirmation. An old `pref:*` / `consultant:*` tap gets the stale-tap notice + current buttons (S-25).
- Replace `:112-114` with:
  > - AC3. "sim" to the offer → exactly ONE outbound with buttons in that turn: the slot buttons (with a single slot, Confirmar / Não). No consultant preference question. (Rewritten 2026-10-27, R-SCH-01 v1.4.)
  > - AC4. The full happy path: offer → slot → Confirmar → appointment created with the drawn consultant (Calendar mocked) → final confirmation message. Also the single-slot path: offer → Confirmar → appointment.
  > - AC5. Superseded on 2026-10-27 (no preference step since R-SCH-01 v1.4). Legacy only: a slot tapped in a legacy preference stage → accepted, confirmation buttons sent; an old `pref:*` / `consultant:*` tap → stale-tap notice + current buttons (S-25).
- Keep `:21-22`, `:45`, `:49` unchanged (transcript/history).
- Acceptance: `grep -n "preference" <spec>` only hits `:21`, `:22`, `:45`, `:49`, the new D3 sentence, the legacy line and AC3/AC5; no other line changes (`git diff` on this file); `git diff --check`. No automated test (doc-only).
- Invariants: none touched.

**Step 2 — ROADMAP (D-4)**
- File: `docs/specs/ROADMAP-2026-10-22.md`.
- `:18` D-10: replace "(R-SCH-01, v1.1)" with "(R-SCH-01, spec v1.4)".
- `:29` row D, after "WP-5 (status pela data da reunião, saída do `scheduled`, dados da reunião no prompt" append: "; N-1 feito em flow-review step 21: sem reunião futura, o lead volta para `new` com `qualifiedAt = null`, qualquer que seja o status (decisão E7)".
- `:31` row F, append to the content cell: "Nota flow-review Rev1: fechar conversas paradas não é mais necessário para a correção (a próxima mensagem do cliente fecha a conversa antiga); continua útil para deixar os dados limpos."
- `:32` row G, append: "Nota flow-review Rev1: o índice único de conversa ativa continua desejado; hoje o lock do lead é a única proteção."
- Keep `:3` ("spec v1.1" = the base at that date).
- Acceptance: `grep -n "v1.1" ROADMAP` → only `:3`, `:9` (D-01) and `:12` (D-04), all history; `grep -n "N-1"` → row D; `git diff --check`.

**Step 3 — Close AC15 in the session-choice plan docs**
- Files (append only, no history rewritten): `docs/work/2026-10-22-session-choice-24h/plan.md` (end), `docs/work/2026-10-22-session-choice-24h/test-report.md` (end).
- Append to both:
  > ## Closure note (2026-10-27, hygiene)
  > AC15 ("no scheduling action before the choice", step 13) is closed as obsolete: the session choice was removed in flow-review Rev1 (R-SES-02 v1.4, automatic new conversation after 4h). It was never added to the spec, and the code and tests it referred to are deleted. GAP-2 is obsolete for the same reason.
- Acceptance: `grep -n "Closure note" …` in both; `git diff` shows only appended lines.

### Batch 2 — trace and executor flakes (test-only)

**Step 4 — Phone check ignores ids and hashes**
- Files: new `src/tests/support/trace-line-privacy.ts`; new unit test `src/tests/trace-line-privacy.test.ts` (add to `test:unit` in `package.json`); `src/tests/services/generate-mariana-response.test.ts` (`:830`, `:853-870` seed, `:934`); `src/tests/services/turn-trace-integration.test.ts` (`:24`, `:68-82` seed, `:288`); `docs/CODEMAP.md` Tests/Support line.
- Helper: `stripTraceIdentifiers(line: string): string`:
  - removes every UUID (`8-4-4-4-12` hex, case-insensitive);
  - removes the value of the keys `rawReplyHash`, `sentReplyHash`, `hashBefore`, `hashAfter` only (`"<key>":"<12 hex>"`). Key-scoped on purpose: a 12- or 13-digit phone in any other field must still trip the check.
- Both tests: `/\d{11}/.test(stripTraceIdentifiers(line))` must be false.
- Seeds: insert the lead with a forced id `${randomUUID().slice(0, 24)}012345678901` (random prefix, so reruns do not collide). This keeps the worst case covered on every run.
- Acceptance tests:
  - `trace-line-privacy.test.ts` "remove UUID cujo último grupo tem 11 dígitos": given a line with `"leadId":"…-012345678901"`, when stripped, then `/\d{11}/` is false. Red: module missing.
  - "remove hash de 12 dígitos só nas chaves de hash": given `"rawReplyHash":"123456789012"`, stripped → false.
  - control "telefone em outro campo continua detectado": `"x":"5531999998888"` and `"phone":"553199999888"` → still true after strip (green from the start; guards against over-stripping).
  - Forced red on the real tests: change only the seeds first and run `generate-mariana-response.test.ts --test-name-pattern=<the :934 test>` and `turn-trace-integration.test.ts` (the `:288` test) → fail at the `\d{11}` assert. Then switch to the helper → green.
- Invariants: none (test-only). The privacy check stays as strict for real data.

**Step 5 — Executor recovery test immune to parallel recovery**
- File: `src/tests/reliability/autonomous-task-executor.test.ts:249-290`.
- Red first: add test "recupera tarefas com lease expirado mesmo se outro worker recuperou antes": same fixture, call `recoverStaleAutonomousTasks()` once (simulates a parallel file) before the measured call, keep the current count asserts → fails at `result.recovered >= 1`.
- Change, in both tests: drop the asserts on the global counts (`:275-276`); assert this test's rows only: `recoverable` → `pending`, `leaseToken` null, `leaseExpiresAt` null, `lastError` "processing lease expired"; `exhausted` → `failed`, same lease fields. Then both green.
- Do NOT scope `recoverStaleAutonomousTasks` by conversation in product code (worker contract).
- Invariants: none (test-only).

### Batch 3 — fake ids and findings

**Step 6 — Unique fake provider and calendar ids**
- Files: new `src/tests/support/fake-ids.ts` (`uniqueFakeId(prefix: string): string`); new unit test `src/tests/fake-ids.test.ts` (add to `test:unit`); sites below.
- Red: first write `uniqueFakeId` as `${prefix}${Date.now()}` (today's pattern) and the test "dois ids no mesmo milissegundo são diferentes" (given `Date.now` mocked to a constant with `t.mock.method`, when called twice, then the ids differ) → red. Then change it to `${prefix}${randomUUID()}` → green.
- Replace at (id lands in a unique column):
  - fake WhatsApp sends → `messages.externalId`: `phase3-scheduling-workflow.test.ts:173,179,390,396`; `routes/webhook-whatsapp.test.ts:506,1611,1928` (prefix `wamid.session_choice_` → `wamid.fake_send_`); `support/conversation-simulator.ts:94`; `reliability/outbound-messages.test.ts:282,286` (`"x"`).
  - fake Calendar events → `appointments.externalEventId`: `services/appointment-service.test.ts:519,763,805`; `routes/webhook-whatsapp.test.ts:1407`; `reliability/handler-partial-failure.test.ts:396`.
- Not changed: `integrations/whatsapp-service.test.ts` (fetch mock, no DB); `scheduling-confirmation-orchestrator.test.ts:40` (in-memory); sites already using `Math.random`/`randomUUID`/a session id; `sourceLeadId`/inbound wamids from `Date.now()` (sequential, distinct prefixes; no flake seen). If an assert compares a fixed id literal, keep the value in a local const.
- Acceptance: unit test red → green; each touched file runs green alone (DB preload, local `TEST_DATABASE_URL`); `grep -n 'Date.now()}' ` at the listed lines → none.

**Step 7 — findings.md for flow-review**
- File: `docs/work/2026-10-26-flow-review/findings.md` (new). Written by the planner in a later run if its harness allows, otherwise by the implementer (doc-only).
- Content: one table `ID | Short title | Severity | Status (fixed / open / obsolete / accepted) | Evidence (step, test file:line or plan:line)`, built only from `flow-review/plan.md:98-180,283-296,373-377` and `test-report.md` (F-T*, F-V*, F-03, `:1037-1056`), plus the E-xx guard holes (todo, owner pkg-A). No new analysis.
- Acceptance: every ID found by `grep -ohE 'F2-[0-9]+|F-[A-Za-z0-9]+-[0-9]+|F-0[0-9]|E-[0-9]+[a-z]?' plan.md test-report.md` appears once in the table.

### Step 8 — R-V3c-1 (BLOCKED on Q1)
- Q1 = A (recommended): no code. Optionally a one-line note in `MARIANA_BEHAVIOR_SPEC.md` S-22 (`:121`), wording for approval: "Vale também para um toque reenviado cuja tarefa falhou: a resposta sai na conversa em que o toque foi tratado, se ela ainda está ativa." Optionally pin the `lastCustomerMessageAt` bump in the probe test (`tap-redelivery-adversarial.test.ts:601`, green by design).
- Q1 = B or C: product behavior change → out of this hygiene task; new spec, new plan.

## Out of scope
- D4 "expired session → fresh offer" and AC6 in the scheduling spec: still the S-08 interim text (D-R3-4, package B). Not reworded here.
- Product code, prompt, migrations, Neon, `.claude/`, `.env`, `CLAUDE.md`.
- Biome errors in `docs/work/2026-10-27-scheduling-loop/repro/` (other task, untracked).
- Scoping `recoverStaleAutonomousTasks` per conversation.
- Other open items of the table (F2-05, Q4/F2-08, packages B/C2/D/E, E3-a Neon SELECTs, E-xx guard holes).

## Questions for the owner
- Q1 (blocks step 8): R-V3c-1 — A keep (recommended) / B keep in A but do not bump `lastCustomerMessageAt` on a redelivery / C rotate and send E1 again when the earlier task failed.
- Q2: approve the exact wording of steps 1, 2 and 3 (and of the S-22 note, if Q1 = A with the note)?
- Q3: step 7 — who writes findings.md (planner in a new run, recommended; or implementer)?
