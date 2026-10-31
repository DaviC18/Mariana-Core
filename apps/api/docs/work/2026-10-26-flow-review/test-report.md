# Test report — 2026-10-26-flow-review

Plan: `docs/work/2026-10-26-flow-review/plan.md` (`Status: APPROVED by Davi`, line 1). Tester run: 2026-10-27.
DB: `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`, `.env` not loaded. No Neon, no real Gemini/WhatsApp/Google. No git writes.

## Full suites (one verification, shared by step 2 and step 4)

| Command | Result |
|---|---|
| `npm run test:unit` | exit 0 — tests 357, pass 351, fail 0, todo 6 (pre-existing). Includes `regressão: inatividade exata de 4h…` |
| `npm run test:db` run 1 | exit 0 — tests 617, pass 611, fail 0, todo 6 |
| `npm run test:db` run 2 | exit 1 — tests 619, pass 612, **fail 1**, todo 6. The failure is the implementer's in-progress step 3 test (see "Out-of-scope observation"). Not a step 2 / step 4 failure |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 (`dist/server.js 1.44 MB`) |
| `npx biome check` on the 2 step-2 files | "Checked 2 files … No fixes applied" |
| `git diff --check` | exit 0 |

Known flakes (`autonomous-task-executor.test.ts:275`, `generate-mariana-response.test.ts:936`) did not fire in either DB run.

---

## Step 2 (R1-a) — Gate test + 4h regression test

**Verdict: PASS.** 0 failures.

Diff scope: `src/tests/session-inactivity-regression.test.ts` and `package.json:21` only, as planned (plan.md:51). No product code changed. Other dirty files in the tree belong to other tasks/steps (pkg-A batch D report, `model-failure-acceptance.test.ts`, `turn-trace-rel07-acceptance.test.ts`, step 3 edits to `session-choice-new.test.ts`).

| Plan criterion (plan.md:50-57) | Evidence | Result |
|---|---|---|
| Rename to "4h" | title `regressão: inatividade exata de 4h, 4h − 1 ms e conversas sem histórico prévio` | PASS |
| `4h → true` | test line ~12; red under `SESSION_INACTIVITY_MS = 24h` (implementer, `progress.md`) | PASS |
| `4h − 1 ms → false` | test line 20; **red proven by tester** (below) | PASS |
| `null → false` | test, last assertion | PASS |
| Registered in `test:unit` | `package.json:21`, after `session-choice-policy.test.ts`; seen in the unit run output | PASS |
| Gate test matches plan step 10 (1 reminder, 0 confirmation requests, session unchanged) | `src/tests/reliability/session-choice-gate.test.ts:697`. Asserts `workflowStage` stays `awaiting_slot_selection`; exactly 1 outbound, kind `buttons`, body "Antes de seguir, preciso da sua escolha", buttons `sessao:continuar` + `sessao:nova` (so 0 confirmation requests); 0 appointments; re-run is idempotent (still 1 outbound). Matches session-choice plan step 10 (`2026-10-22-session-choice-24h/plan.md:258-268`, Design §7.3) and flow-review plan.md:52 | PASS |

### Red proof for "4h − 1 ms → false" (closes the implementer's gap)

- Before: `git diff --quiet -- src/services/conversations/session-choice-policy.ts` → clean.
- Mutation (temporary, `session-choice-policy.ts:5`): `SESSION_INACTIVITY_MS = 4 * 60 * 60 * 1000 - 1`.
- Run: `npx tsx --import ./src/tests/support/unit-test-preload.ts --test src/tests/session-inactivity-regression.test.ts`
  ```
  ℹ tests 1  ℹ pass 0  ℹ fail 1
  at TestContext.<anonymous> (.../session-inactivity-regression.test.ts:20:9)
  actual: true, expected: false
  ```
  Line 20 is the `justUnder4hAgo → false` assertion, so this check is the one that caught the mutation.
- Revert: restored from a `/tmp` copy (no git command). `git diff --quiet -- src/services/conversations/session-choice-policy.ts` → "EMPTY DIFF after revert"; `git status --short src/services` → empty.
- Green after revert: `tests 1, pass 1, fail 0`.

### New tests added by tester
- None.

---

## Step 4 (R1-b) — Steps 11–12 verification, no code

**Verdict: PASS with GAPs.** 0 failures. No code changed. Reuses the steps 8–12 listing in `docs/work/2026-10-22-session-choice-24h/test-report.md` (section "Steps 8–12"); this section adds dedicated, repeated runs of the three files that plan.md:66 names.

Each file run twice in isolation on the prepared DB: `npx tsx --import ./src/tests/support/db-test-preload.ts --test src/tests/reliability/session-choice-<file>.test.ts`.

| File | Run 1 | Run 2 |
|---|---|---|
| `session-choice-adversarial.test.ts` | 4/4 pass | 4/4 pass |
| `session-choice-concurrency.test.ts` | 6/6 pass | 6/6 pass |
| `session-choice-invalid-replies.test.ts` | 4/4 pass | 4/4 pass |

Also green in both full `test:db` runs.

| Session-choice plan criterion | Test | Result |
|---|---|---|
| 11 — continuar then nova: first wins, second informs | adversarial `continuar e depois nova…` | PASS ×4 (2 isolated + 2 full) |
| 11 — nova then continuar: B only active, A closed | adversarial `nova e depois continuar…` | PASS ×4 |
| 11 — `sessao:xyz` / old slot tap re-send the question | invalid-replies `toque sessao:desconhecido e toque de slot antigo…` | PASS ×4 |
| 11 — unknown `sessao:*` does not consume the choice | invalid-replies `toque sessao:desconhecido não consome a escolha…` | PASS ×4 |
| 11 — free text "quero começar do zero" ⇒ reminder, no B, not processed | invalid-replies `texto livre 'quero começar do zero'…` | PASS ×4 |
| 11 — same Meta delivery twice ⇒ 1 outbound (dedup invariant) | invalid-replies `a mesma entrega repetida pelo Meta…` | PASS ×4 |
| 12 — pending state survives restart | concurrency `estado pendente sobrevive a restart e executeNextAutonomousTask…`; adversarial `estado pendente sobrevive a restart…` | PASS ×4 |
| 12 — concurrent message + Nova ⇒ 1 active conversation (invariant) | concurrency + adversarial `mensagem concorrente ao toque nova…` | PASS ×4 |
| 12 — two concurrent taps ⇒ one B | concurrency `dois toques concorrentes…` | PASS ×4 |
| 12 — task in `processing` + pending choice ⇒ 0 appointments | concurrency `task de agendamento em processing…` | PASS ×4 |
| 12 — three quick messages stay in one conversation (AC12) | concurrency `três mensagens seguidas dentro de 24h…` | PASS ×4 |
| 12 — repeated `externalId` processed once (invariant) | concurrency `a mesma mensagem com externalId repetido…` | PASS ×4 |

### GAPs (carried, not new failures)
- **GAP-2 (TDD evidence).** No recorded red run for session-choice steps 11–12. Step 4 is "no code", so no mutation proof was done here. Owner: planner (decide if a mutation proof is required).
- **GAP-3 (naming).** `session-choice-concurrency.test.ts` title still says "dentro de 24h"; valid under 4h. Owner: step 5/6 docs.
- Not covered by these files: two messages in one debounce window after a gap (S-18, plan step 12, BLOCKED on Q3); a second 4h gap after a resolved choice (F2-01, step 8); a stale `sessao:*` tap after resolution (F2-06, step 11); `Continuar` after a held tap (F2-03, step 10). All are planned R2 steps.

### New tests added by tester
- None (step 4 is verification only).

---

## Out-of-scope observation (step 3, implementer in progress)

- `test:db` run 2 picked up the implementer's on-disk S-19a test: `session-choice-new.test.ts:820`, `S-19a: nova conversa com reunião passada começa na saudação…`, `actual: 'qualifying', expected: 'new'`.
- Run 1 did not include it (tests 617 vs 619), so the file changed between runs.
- Possible cause: the plan (plan.md:62) asserts `lead.status === "new"` *after* the held message is processed. Normal processing may legitimately move the lead to `qualifying`. If so this is a **planner** design gap (assert status before replay, or accept `new|qualifying`), not a code bug. Implementer to confirm before deciding.

## Risks not covered by tests
- F2-01, F2-02, F2-03, F2-06, F2-07 (see plan R2). Session-choice still unsafe on a second gap and on a crash between claim and effects.
- Full `test:db` ran while the implementer edited step 3 files; run 2 results reflect that on-disk state.

## Manual WhatsApp checklist (owner, staging)
1. Set `lastCustomerMessageAt` to 3 h 59 min ago; send "oi". Expect a normal reply, no choice question.
2. Set it to 4 h 01 min ago; send "oi, voltei". Expect only the choice question with "Continuar" and "Nova conversa".
3. While pending, tap an old slot button. Expect the reminder "Antes de seguir, preciso da sua escolha" with the same two buttons; no confirmation request, no appointment.
4. Type "quero começar do zero". Expect the same reminder; no new conversation.
5. Tap "Continuar", then "Nova conversa". Expect the held message answered once, then "já registrada" and nothing else.
6. Resend the same message quickly twice (network retry). Expect one reply only.

## Step 3 (R1-b) — Step 9 acceptance (R-SES-04, S-19) — tester

**Verdict: PASS** (0 failures). One deviation is open and waits for Davi's decision. See below.

- Approval: plan.md:1 `Status: APPROVED by Davi`. Step-3 diff touches only `src/tests/reliability/session-choice-new.test.ts`, as plan step 3 lists. No product change (`git diff src/services` is empty).

| Spec criterion | Test(s) | Result |
|---|---|---|
| R-SES-04 / S-19(a): past appointment, "Nova" starts from zero (lead `new`, `qualifiedAt=null`) | S-19a (`session-choice-new.test.ts:749`); existing `:545`; tester `S-19a (tester)` (past `confirmed`) | pass |
| S-19(a): new conversation starts at greeting/reason and no reply says "agendad" | S-19a (stage assert + `/agendad/i` on reply, assistant messages, outbounds of B) | pass |
| R-SES-04 / S-19(b): future appointment keeps `scheduled` | S-19b `:860` (future `scheduled`); existing `:616` (future `confirmed`); `:676` (future cancelled does not keep it) | pass |
| S-19(b) "responde como na S-10" | not covered: plan assigns it to package D | out of scope |

**Mutation proofs (re-run by the tester; each mutation reverted; `git diff src/services/conversations/autonomous-task-handlers.ts | wc -l` printed `0` after each one)**
- M1 `:1726` → `false && lead.status === "scheduled"`: S-19a fails `actual: 'scheduled', expected: 'new'`. The tester test also fails. S-19b passes.
- M1 with the status and stage asserts of S-19a temporarily disabled: the test fails on text: `actual: 'Sua reunião já está agendada, até lá!'`, `expected: /agendad/i`. The test file was restored afterwards.
- M2 `:1713` → `["confirmed"]`: S-19b fails `actual: 'new', expected: 'scheduled'`. S-19a passes.

**Is the "agendad" text check meaningful?** Yes, but only through the stub. The stub says "agendada" only when `stage === "confirmation"`. A real regression (lead kept `scheduled`) leads to that stage, so M1 shows up in the text. A regression to some other stage would not show up in the text. The stage assert (`greeting`/`reason`) catches that case. The text check proves the backend does not inject its own "agendad" text, for example in the Nova confirmation outbound.

**Deviation (judged against the spec, not resolved)**: plan line 62 can be read as "`status === "new"` after the held message is processed". The test asserts `new` + `qualifiedAt=null` right after Nova, and `status !== "scheduled"` after the turn. Spec S-19(a) says "começa do zero, sem 'já está agendado'". R-SES-04 says "volta ao fluxo normal". The normal flow may move `new` to `qualifying` on the first turn. So the implemented assertions satisfy the spec, and the strict reading of the plan would contradict the normal flow. Decision: Davi/planner.

**New test added by tester**: `S-19a (tester): reunião passada com status confirmed também volta a new` (end of `session-choice-new.test.ts`). It passes, and it fails under M1.

**Suites**
- `npm run test:unit`: exit 0, tests 357, pass 351, fail 0, todo 6.
- `npm run test:db` (localhost:5432 / mariana_test, workers off), twice: exit 0 both times, tests 620, pass 614, fail 0.
- `npx tsc --noEmit`: 0. `npm run build`: 0. Biome on the test file: clean (after the tester fixed a numeric separator in its own test). `git diff --check`: clean.

**Risks not covered**
- S-19a processes the held message by calling `generateMarianaResponse` directly, not through the enqueued `PROCESS_INBOUND_MESSAGE` task. The test at `:151` covers the move to B and the replay separately.
- Boundary case: an appointment that starts exactly now (`gt(startAt, now)`) is untested.
- S-19(b) reply content (S-10) is deferred to package D.

**Manual WhatsApp checklist (owner)**
1. Lead with a past meeting (status `scheduled`). Wait more than 4h, send "oi", tap "Nova conversa". Expect the new-conversation confirmation, then a greeting/qualification reply. Expect no "já está agendado".
2. Lead with a future meeting. Same steps. Expect the lead to stay `scheduled`. The reply follows S-10 (package D).

# R1 final — batch R1-c step 6 (session-choice step 14 + the 4h change, F2-26) — tester, 2026-10-27

**Verdict: PASS.** Zero product failures. One spec gap closed by a new tester test (S-20 free-text "continuar"). One more test-only flake found, same root cause as `:936`.

- Base: `develop` @ `89dacbf`. Steps 1–5 are already committed in `89dacbf` (Davi's commit). Working tree before this step: only `plan.md` (+3 lines, Decision D-1 for S-19a). `plan.md:1` = `Status: APPROVED by Davi`.
- S-19a settled by Davi (Decision D-1, plan line 62): `new` + `qualifiedAt=null` right after "Nova conversa"; `!== "scheduled"` after the turn. Not re-opened.
- Env: `DOTENV_CONFIG_PATH=/dev/null`, `RELIABILITY_WORKERS_ENABLED=false`, DB target `localhost:5432/mariana_test`. Gemini, WhatsApp, Calendar mocked. No simulator. No git write.

## Step 5 (docs) verification

| Check | Evidence | Result |
|---|---|---|
| `CLAUDE.md` +2 invariants after the `selectedSlotId` line | `CLAUDE.md:36` "At most one pending session choice per conversation."; `:37` "A new conversation never inherits the commercial state of the previous one." | PASS |
| Wording = Q6 (`session-choice-24h/plan.md:302`) | Q6 text: "at most one pending session choice per conversation" (identical) and "uma conversa nova nunca herda estado comercial da anterior" (faithful English translation; plan step 5 gives the English text). | PASS |
| No other `CLAUDE.md` section changed | `git show 89dacbf -- CLAUDE.md`: one hunk `@@ -33,6 +33,8 @@`, 2 added lines, 0 removed. | PASS |
| `ROADMAP-2026-10-22.md:29` | WP-4 = "gate de 4h com escolha continuar/nova: feito; expirar sessões vencidas, …". | PASS |
| Spec `:93,124,125` | D6 = "≥ 4 hours … continue … or start a new one"; AC11 = 4h + both branches + commercial isolation; AC12 = "within 4h". | PASS |
| `CODEMAP.md` | `:3` snapshot `cde444d`; `:28,:34` line counts; `:45` "Session choice after 4h". | PASS |
| Test title `session-choice-concurrency.test.ts:519` | "três mensagens seguidas dentro de 4h …". | PASS |
| No "24h" session-close wording left in the 4 docs + `CLAUDE.md` | `grep -nE "24 ?h|24 hours"`: only `CODEMAP.md:44` "24h window / opt-out" (WhatsApp window, intended). | PASS |
| `git diff --check HEAD~1 HEAD` | clean | PASS |

Minor wording leftovers (tests only, not in step 5's list, not FAIL): comments `session-choice-concurrency.test.ts:12,:516`; test titles `session-choice-policy.test.ts:98` ("a pergunta de 24h …") and `session-choice-continue.test.ts:243` ("continuar não repete a pergunta de 24h"). The work folder name `2026-10-22-session-choice-24h` is historic. Owner: implementer, optional title rename.

## Commands and results

| Command | Result |
|---|---|
| `npm run test:unit` (before and after the new test) | tests 357, pass 351, fail 0, todo 6 (both runs) |
| `npm run test:db` run 1 (before the new test) | tests 620, pass 614, fail 0, todo 6 |
| `npm run test:db` run 2 (before the new test) | tests 620, pass 614, fail 0, todo 6 |
| `npm run test:db` run 3 (with the new test) | tests 621, pass 615, fail 0, todo 6 |
| `npm run test:db` run 4 (with the new test) | tests 621, pass 614, **fail 1**: `turn-trace-integration.test.ts:288` (flake, see below) |
| new test alone, then whole `session-choice-invalid-replies.test.ts` | 1/1; then 5/5 pass |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0, `dist/server.js 1.44 MB` |
| `git diff --check` | clean |
| biome `session-choice-new.test.ts`, `session-inactivity-regression.test.ts` | clean |
| biome `session-choice-concurrency.test.ts` | 3 errors (organizeImports, unused `buttonWebhook`, format). The same 3 appear on `HEAD~1`. Pre-existing. |
| biome `session-choice-invalid-replies.test.ts` | 2 `noAwaitInLoops` in the existing `cleanup()`. Pre-existing. My hunk is formatted. |

The 6 todos are the known E-12c etc. holes in the guard adversarial files. The "✖ failing tests" list in a green run holds only these todos.

## AC → test → result

| Criterion | Test(s) (file:line) | Result |
|---|---|---|
| 4h boundary: exactly 4h asks, 4h − 1 ms does not, null/invalid/future does not | `session-choice-policy.test.ts:24`, `:43`, `:62`; `session-inactivity-regression.test.ts:7` (red shown in step 2); `routes/webhook-whatsapp.test.ts:1831` (4h asks before processing), `:1658` (4h − 1 ms processes normally) | PASS |
| 4h rule independent of the WhatsApp 24h window | `session-choice-policy.test.ts:139` | PASS |
| R-SES-02: question with 2 buttons, sent once, before any automatic reply | `session-choice-handlers.test.ts:56`, `:121`; `webhook-whatsapp.test.ts:1831`; `session-choice-store.test.ts:166` | PASS |
| R-SES-02 Continuar: same conversation, history, state; held messages answered in order, once | `session-choice-continue.test.ts:58`, `:176`, `:243` | PASS |
| R-SES-02 Nova: A closed, never deleted; B starts at greeting, no previous history, no interest or offers | `session-choice-new.test.ts:87`, `:151`, `:239`, `:287`, `:403`, `:468`; `session-choice-isolation.test.ts:100` | PASS |
| R-SES-02 pending: nothing is scheduled; free text and old taps get a short reminder | `session-choice-gate.test.ts:217`, `:423`, `:470`, `:538`, `:607`, `:650`, `:697`, `:783`; `session-choice-concurrency.test.ts:442` | PASS |
| Invariant: at most one pending choice / one active conversation | `session-choice-store.test.ts:93`; `session-choice-concurrency.test.ts:325`, `:392`; `session-choice-adversarial.test.ts:111`, `:172`, `:271` | PASS |
| Duplicate webhook / restart | `session-choice-concurrency.test.ts:582`, `:266`; `session-choice-invalid-replies.test.ts:412`; `session-choice-adversarial.test.ts:217` | PASS |
| R-SES-04: "scheduled" only with a future confirmed appointment; past → normal flow | `session-choice-new.test.ts:545`, `:616`, `:676`, `:749` (S-19a), `:860` (S-19b), `:891` | PASS |
| S-18: mid-qualification client back after > 4h gets only the question; after Continuar the held message is answered once, in the old context | `webhook-whatsapp.test.ts:1831`; `session-choice-handlers.test.ts:56`; `session-choice-continue.test.ts:58`, `:176`, `:243` | PASS |
| S-19(a): Nova with a past appointment starts from zero, no "já está agendado" | `session-choice-new.test.ts:749` (D-1 assertions), `:545`, `:891` | PASS |
| S-19(b): Nova with a future confirmed appointment stays "scheduled" | `session-choice-new.test.ts:616`, `:860` (S-10 answers are package D) | PASS |
| S-20: old slot tap during the pending choice → reminder, no appointment, no AI | `session-choice-invalid-replies.test.ts:264`, `:475`; `session-choice-gate.test.ts:538` | PASS |
| S-20: free text "continuar" → reminder with the 2 buttons, no AI, no decision, no appointment | **new** `session-choice-invalid-replies.test.ts` "S-20: texto livre 'continuar' …" (asserts choice still `pending`, 0 `generateContent` calls, 0 inbound tasks, `processedAt` null, exactly 1 reminder body with buttons `[sessao:continuar, sessao:nova]`, 0 texts, 0 appointments) | PASS (was a gap) |
| R-REL-05 (pkg-A): model failure after retries → short honest notice + log | `model-failure.test.ts:119`, `:179`; `model-failure-notice.test.ts:47`, `:74`, `:161`; `ai-client.test.ts:6` (see `pkg-A/test-report-batch-D.md` §2) | PASS |
| R-REL-07 (pkg-A): per-turn trace (model, latency, tokens, stage, layers with lengths/hashes, never client text); model config from env | `turn-trace-rel07-acceptance.test.ts:58`; `turn-trace.test.ts:68`, `:93`; `turn-trace-adversarial.test.ts:130`–`:301`; `agent-model-config.test.ts:23`, `:45`; `env.test.ts:109`–`:154` | PASS |
| S-17 (pkg-A): model error or invalid model name → notice, error logged, no silence | `model-failure-acceptance.test.ts:153`, `:211`; `generate-mariana-response.test.ts:1110`; `model-failure.test.ts:119` | PASS |

## New test added by the tester (this step)

- `src/tests/reliability/session-choice-invalid-replies.test.ts`: "S-20: texto livre 'continuar' durante a pendência recebe lembrete com os dois botões, sem IA e sem decidir". Imports added: `SESSION_CHOICE_*` from `session-choice-policy`, `readPendingSessionChoice`. It is an acceptance test, green on arrival. It fails if free text "continuar" resolves the choice, runs a Gemini turn, enqueues an inbound task or sends anything other than the reminder. It was not shown red: that needs a product mutation, which this step forbids.

## Flaky tests (test-only, product does not leak)

| Test | Symptom | Cause | Owner |
|---|---|---|---|
| `generate-mariana-response.test.ts:936` | `ELEVEN_DIGITS.test(line)` true | 2 random UUIDs in the line; ~1.6 % hold 11 straight digits (`pkg-A/test-report-batch-D.md` §5) | implementer: strip UUIDs/hashes before the check |
| `services/turn-trace-integration.test.ts:288` (**new in this report**) | `true !== false` at `ELEVEN_DIGITS.test(line)`, `test:db` run 4 | Same cause: UUIDs/hashes in the trace line | implementer: same fix |
| `autonomous-task-executor.test.ts:275` | known timing flake | not reproduced in 4 runs | implementer |

## Open gaps

- **GAP-2**: no recorded red run for session-choice steps 8, 9, 11 and 12. Their tests exist and pass. Mutation proofs exist only for S-19a/S-19b (step 3) and the 4h boundary (step 2).
- AC15 ("no scheduling action before the choice", session-choice plan step 13) was not added to the spec. It is covered by tests (`session-choice-gate.test.ts`). Owner: planner.
- D6 sub-bullet "objective may be reused as a hint" conflicts with the implemented reset (implementer note). Owner: planner.
- Leftover "24h" in 2 test titles and 2 comments (see step 5). Cosmetic.

## Risks not covered by tests

- F2-01 (R2 step 8): a second 4h gap after "Continuar" does not re-open the choice. Not fixed yet.
- F2-02 (R2 step 9): `claimSessionChoice` is outside the branch transaction. A crash after the claim can lose the choice. Not fixed yet.
- Real Meta delivery order and real button payloads are not exercised (injected webhooks only).
- S-17 with a malformed `GEMINI_MODEL` stops the boot, so the client gets no notice (deploy check).
- `POST /conversations/:id/messages` has no `ModelUnavailableError` catch (outside the WhatsApp path).

## Manual WhatsApp checklist S-17 to S-20 (owner, staging only)

Preparation: a test number with no open conversation. For the 4h cases, set that conversation's `lastCustomerMessageAt` to now − 4h 1 min on the **staging** DB only (never Neon), or wait 4h.

1. **S-18**: send "Oi, quero saber de consórcio" and answer up to the qualification question. Move the gap past 4h. Send "é para carro". Expect only "Oi! Já passou mais de 4 horas desde a nossa última conversa. Você prefere continuar de onde paramos ou começar uma conversa nova?" with the buttons "Continuar" and "Nova conversa", and nothing else. Tap "Continuar". Expect exactly one reply to "é para carro" that continues the car qualification.
2. **S-19(a)**: lead with an appointment in the past. Move the gap past 4h. Send "oi". Tap "Nova conversa". Expect the new-conversation confirmation, then a greeting. No reply says "agendado"/"agendada".
3. **S-19(b)**: lead with a future confirmed appointment. Move the gap past 4h. Send "oi". Tap "Nova conversa". Expect the lead to stay "scheduled" and the answer to follow S-10 (meeting details, no new offer).
4. **S-20 (old tap)**: get a time-slot offer. Move the gap past 4h. Send "oi" and get the question. Tap a slot from the old offer. Expect only "Só para eu não misturar os assuntos: você quer continuar a conversa anterior ou começar uma nova?" with the 2 buttons. No appointment is created.
5. **S-20 (text)**: with the choice still pending, type "continuar". Expect the same reminder with the 2 buttons. No AI reply. Then tap "Continuar". Expect the normal flow to resume.
6. **S-17**: follow `docs/work/2026-10-22-pkg-A/test-report-batch-D.md` §7 (unknown `GEMINI_MODEL` on staging gives one failure notice per message, plus `mariana_model_failure` in the log).

## Step 19 (batch V1-a, docs-only): spec v1.3 wording

**Verdict: PASS.** No failures. 2 spec-gap observations for the planner (below); they do not block this step.

Inputs: `plan.md` line 1 (`Status: APPROVED by Davi — "aprovo" (2026-10-27, revision 1)`), approved text at `plan.md:219-224`, `git diff -- docs/specs/MARIANA_BEHAVIOR_SPEC.md` (1 file, +10/-5 in the spec).

| Item | Approved (`plan.md`) | Spec after diff | Result |
|---|---|---|---|
| R-SES-02 | :219 | spec:70 | identical, word for word |
| S-18 | :220 | spec:116 | identical (inner single quotes kept) |
| S-19 | :221 | spec:117 | identical |
| S-20 (E1-a) | :222 | spec:118 | identical |
| S-21 (new) | :223 | spec:119 | identical |
| Changelog | :224 one line: "R-SES-02 sem pergunta; S-18, S-19, S-20 reescritos; S-21 novo." | spec:143-145, new heading "Mudanças da v1.3 (2026-10-27, decisões do Davi)", 2 bullets | deviation, no meaning change (see below) |
| Header | not in the approved text | spec:3 "Versão: 1.3 (2026-10-27) ... Mudanças da v1.1, da v1.2 e da v1.3" | deviation, no meaning change |
| Other rules | must not change | no other hunk in the diff | PASS |
| `git diff --check` | clean | rc=0, no output | PASS |

Deviations judged:
- Header: it bumps the version number and date and adds v1.3 to the changelog pointer. This is bookkeeping that the approved "change log" item implies. No rule changes.
- Changelog: split into 2 bullets, with "S-18, S-19 e S-20" instead of "S-18, S-19, S-20" (one added "e"). The heading copies the v1.2 pattern. Same content, same meaning.
- The v1.2 changelog (spec:140, "pergunta 'Continuar' ou 'Nova conversa'") stays as history. Correct: v1.3 entries do not rewrite past entries.

Rules that conflict with v1.3, or are ambiguous (spec-gap, owner: planner/Davi):
1. R-SCH-03 (spec:59) "Sessão expirada → aviso + nova oferta" and S-08 (spec:106) "Toca num botão depois que a sessão expirou → Aviso + nova oferta". After 4h, an old slot tap is both an expired scheduling session and S-20. S-20 requires no new offer, only a short question about what the lead wants now. The spec does not say which rule wins. Proposal: add "(com menos de 4h; depois de 4h vale a S-20)" to R-SCH-03 and S-08. The same applies to S-07/R-SCH-03 "botão de uma oferta antiga → os botões da etapa atual".
2. R-SES-03 (spec:71) "o objetivo antigo só como pista a confirmar numa frase". R-SES-02 v1.3 says "começa do zero ... sem histórico anterior no prompt, sem interesse". It is unclear whether the old goal may still be offered as a hint in conversation B. Low risk. Clarify whether R-SES-03 applies after rotation.
- No remaining spec rule assumes a pending choice, a "Continuar"/"Nova conversa" button, or a held message. Grep for `continuar|nova conversa|pendente|escolha|guardad|lembrete` finds only R-FLOW-10 ("oferta pendente", unrelated: the consultant offer) and the v1.2 history entry.
- Outside the spec: the `CLAUDE.md` change from E8-a (add the "opened only by the backend" invariant) is not part of this diff. It must land in its own step.

New tests: none (docs-only). Suites not run: docs-only diff, as instructed.
Diff scope: the diff changes the spec, `plan.md` and `progress.md`. `explicacao-rev1.md` is an untracked new file. The spec is the only product-rule file changed.

## V1-b (steps 20 and 21): text rotation and N-1

**Verdict: PASS for step 20 and PASS for step 21, with one ship condition.** V1-b must not ship without V1-c (see F-V1b-2). There are no implementer bugs. Three findings go to the planner.

Approval: `plan.md:1` reads `APPROVED by Davi — "aprovo" (2026-10-27, revision 1)`. E1–E8 and D-1 were read. Nothing in the diff falls outside steps 20–21. Target: host=localhost:5432, db=mariana_test, `RELIABILITY_WORKERS_ENABLED=false`.

### Commands and results
| Command | Result |
|---|---|
| `npm run test:unit` | 357 tests, 351 pass, 0 fail, 6 todo |
| `npm run test:db`, run 1 (before the tester's file) | 633 tests, 624 pass, 3 fail (the 3 known ones) |
| `npm run test:db`, run 2 | 641 tests, 630 pass, 4 fail: the 3 known ones plus `session-choice-concurrency.test.ts:325` (40P01) |
| `npm run test:db`, run 3 | 641 tests, 631 pass, 3 fail (the 3 known ones), 7 todo |
| rotation files (`session-rotation*.test.ts`) | 20 tests, 19 pass, 0 fail, 1 todo |
| `npx tsc --noEmit` / `npm run build` | 0 / ok |
| biome on the 4 changed src/test files and the new tester file | clean |
| `git diff --check` | clean |

### K / spec criterion, test and result
| Criterion | Test(s) | Result |
|---|---|---|
| R-SES-02 v1.3 / S-18 / K-4: one reply in B, no question | `session-rotation.test.ts` "texto após 4h fecha A, abre B…"; `webhook-whatsapp.test.ts` "mensagem com 4h exatas inicia conversa nova e processa" | PASS (the implementer showed red on the old code) |
| 4h boundary (`>=`) | `webhook-whatsapp.test.ts:1658` (4h−1ms); tester's "fronteira: 4h − 1 ms não rotaciona; 4h exatas rotacionam (módulo)" with an explicit `receivedAt` | PASS |
| K-1 / K-6 / S-21: two messages give one B and one reply | "duas mensagens simultâneas…"; "segunda transação espera o lock do lead…" | PASS |
| K-1: concurrent text and tap after 4h | tester's "texto e toque de horário concorrentes após 4h…" (4 rounds, both arrival orders) | PASS: 1 active conversation, the text is stored in it, no `failed` event, no pending task left on a closed A |
| K-5 / R-REL-02: duplicate and reclaimed delivery | "a mesma entrega repetida após 4h…" | PASS |
| K-5: late redelivery ≥ 4h of a message stored but not processed | tester's "reentrega ≥ 4h…" (`todo`) | **FAIL, documented as todo**: `sent.length` actual 0, expected 1 (F-V1b-1) |
| K-3 / K-7 / K-8: reset, session `expired`, pending tasks superseded, `optOutAt` copied, A closed, snapshot | "rotação não herda estado comercial" | PASS |
| E6-a: opt-out text after 4h | "texto de opt-out após 4h rotaciona e grava optOutAt em B (E6)" | PASS |
| K-2 / S-19a / D-1: past appointment | "S-19a na rotação…" | PASS |
| K-2 / S-19b / E2-a: future appointment | "S-19b na rotação…"; "lead com reunião futura continua scheduled…" | PASS |
| K-2: cancelled future appointment does not count | tester's "reunião futura cancelada não conta…" | PASS |
| E7-a / N-1 (step 21) | "lead qualified\|qualifying sem reunião futura volta a new…" (red `'qualified'`/`'qualifying'`, then green) | PASS |
| A is never closed without B being created | tester's "falha depois da rotação na mesma transação desfaz tudo…" | PASS: 1 conversation, A active, lead/session intact, no snapshot |
| Lead with no prior conversation | tester's "lead novo (sem conversa anterior)…" | PASS: 1 conversation, 1 inbound task, no snapshot |
| `null` timestamp never rotates | tester's "lastCustomerMessageAt null nunca rotaciona…" | PASS |
| A task already running during rotation | tester's "rotação só supera tarefas pending de A…" | PASS as characterization. A `processing` task is not touched; B gets its inbound task (risk R-V1b-1) |

### Known failures (expected, not regressions)
- `session-choice-invalid-replies.test.ts:348`, "quero começar do zero": `actual 0, expected 1` reminders. The text gate is gone, so the text now gets a `process_inbound_message` task. This is the R-SES-02 v1.3 behavior.
- `:418`, "S-20 continuar": `actual 1, expected 0` inbound tasks, for the same reason.
- `:574`, "toque sessao:desconhecido": this test mocks Gemini itself and passes alone (`--test-name-pattern`, 1/1 pass). It fails in the file run because of a leak from the `:348` test. That test has no Gemini mock. Its text now reaches the AI turn inside `drainConversationWork`, and the egress guard blocks 3 attempts (one call plus retries) to `generativelanguage.googleapis.com`. Those attempts collect in the process-wide buffer, and the first test to drain it is `:574` (`takeBlockedEgressAttempts()` at `:659`). No real request left the machine.
- Note: the progress note says "quero começar do zero" is in `session-choice-adversarial.test.ts`. It is actually in `session-choice-invalid-replies.test.ts`.
- All three go away with step 23 (files deleted or ported).

### Findings
- **F-V1b-1 (planner, medium-low): a late redelivery after 4h loses the message.** Setup: message X was stored in A, `inbound:X` is pending, and the event is still `processing` with an expired lease. This happens if the server crashed before the 200 and stayed down for 4h or more. When Meta redelivers X, the lease is reclaimed and the conversation rotates. The rotation supersedes `inbound:X` on A. `enqueueTask(preserveExisting)` finds the existing key and does not insert a task on B, so X is never answered. Command: `npx tsx --import ./src/tests/support/db-test-preload.ts --test src/tests/reliability/session-rotation-adversarial.test.ts`. Result: todo with `actual: 0, expected: 1`. The old gate (`markSupersededTasks`) behaved the same way, so this is not a regression. Possible fix: when the inbound message already exists in A, do not rotate, or move its task to B.
- **F-V1b-2 (ship condition, V1-b plus V1-c): lock-order deadlock.** Confirmed: `handleProcessSessionChoice` locks the conversation FOR UPDATE (`autonomous-task-handlers.ts:1587`) and then the lead (`:1598`). The text tx locks the lead (`session-rotation.ts:56` or `active-conversation.ts:34`) and then UPDATEs the conversation (`webhook-whatsapp.ts` text branch). The rotation itself also UPDATEs A. The deadlock does **not** need a gap: the no-rotation path has the same order. Run 2 trace: victim at `autonomous-task-handlers.ts:1594`, `40P01`. Production between V1-b and V1-c: this is reachable because a tap after 4h still opens the old choice in the button branch, and legacy `pending` rows exist. If the webhook tx is the victim, the event becomes `failed` and the route still returns 200, so Meta does not redeliver and **the text is lost**. The `:325` test cannot see this case: it only checks that one conversation is active. Verdict: do not deploy V1-b alone. V1-c (step 23) removes the Nova handler.
- **F-V1b-3 (planner, low; remains after V1-c): a second lock-order cycle.** `appointment-service.ts:280-340` UPDATEs `scheduling_sessions` and then `leads`. The rotation locks `leads` and then UPDATEs `scheduling_sessions`. This needs a rotation running at the same moment as `POST /appointments` (admin) or the confirmation orchestrator, for the same lead. The outcome on the webhook side is the same as F-V1b-2 (message lost). Suggested fix: lock the lead first in `createConfirmedAppointment`, or retry 40P01 in the webhook tx.

### Deviations judged
- The button branch now reads the conversation and `lastCustomerMessageAt` inside its own tx through `getOrCreateActiveConversation`. **Accepted.** The plan's Design says both branches run in one tx, and the outside read `:380-389` had to go. It is outside the line range listed for step 20, but it is a required consequence.
- The snapshot row (`taskType session_rotation_snapshot`, `status completed`, key `session-rotation:<A id>`) matches E5-a. **Accepted.**
- The extra lock test that holds two open txs: **accepted.** The implementer showed a mutation (drop `.for("update")`) that only this test catches.
- `docs/CODEMAP.md:47`: a one-line doc addition. Accepted.

### Diff scope
The V1-b files match the plan. The spec, `plan.md` and the earlier `progress.md`/`test-report.md` edits come from steps 19 and earlier. `explicacao-rev1.md` is still an untracked file from earlier work. No changes to `drizzle/`, `.claude/`, `.env` or the outbox.

### New tests (tester)
`src/tests/reliability/session-rotation-adversarial.test.ts`: 8 tests (7 pass, 1 todo for F-V1b-1). They cover the boundary at the exact ms, the `null` timestamp, rollback atomicity, a lead with no conversation, a running A task, a cancelled future appointment, concurrent text and tap, and the late redelivery.

### Risks not covered by tests
- **R-V1b-1:** an A task that is `processing` during the rotation is not stopped. Its turn may write commercial fields onto the reset lead, or open a scheduling session, after the reset. It also replies from the closed A. The handlers do not check `conversation.status`. Probability is low, because it needs an A task that runs 4h or more after the customer's last message.
- Between V1-b and V1-c: a tap after 4h still asks the old question. A text sent while a choice is pending now reaches the AI (the `:418` failure shows 1 Gemini call).
- Workers down for 4h or more: a pending, unanswered inbound task on A is superseded at rotation. Only the new message is answered. This matches "começa do zero", but the owner should know.
- `qualifiedAt` is set to null even when the status stays `scheduled` (future appointment). This matches the old Nova behavior. The spec is silent on it.

### Manual WhatsApp checklist (owner, staging, after V1-c ships)
1. Send "quero consórcio de carro". Wait 4h or more (or set `lastCustomerMessageAt` back by 4h in staging). Send "é para carro". Expected: no question about continuing; one reply that starts from zero (greeting/reason); the admin shows A `closed` and B `active`.
2. After 4h or more, send "oi" and "quero ver imóvel" within 8 s. Expected: one reply that considers both messages; one new conversation.
3. With a future confirmed meeting, wait 4h or more and send "oi". Expected: the reply treats you as scheduled (S-10); the lead status stays `scheduled`.
4. With a past meeting, wait 4h or more and send "oi, quero saber de consórcio". Expected: no "já está agendado"; normal qualification.
5. After an earlier "pare", wait 4h or more and send any text. Expected: Mariana sends no marketing messages; `optOutAt` is set on B.
6. Within 4h, send any text. Expected: same conversation, normal reply.

## V1-c — steps 22 and 23 (tester, 2026-10-27)

**Verdict: PASS for step 22 and PASS for step 23.** No implementer bug. No lost test case. Four findings go to the planner (F-V1c-1 to F-V1c-4). F-V1b-3 is still open and now has a deterministic reproduction.

Approval: `plan.md:1` `APPROVED by Davi` (Rev1), E1–E8 and D-1. Target DB: host=localhost, db=mariana_test, workers off.

### Suites
| Command | Result |
|---|---|
| `npm run test:unit` | 357 tests, 351 pass, 0 fail, 6 todo |
| `npm run test:db`, run 1 | 614 tests, 606 pass, 0 fail, 8 todo; 0 egress hits |
| `npm run test:db`, run 2 | 614 tests, 606 pass, 0 fail, 8 todo; 0 egress hits |
| `npx tsc --noEmit` / `npm run build` | exit 0 / build success |
| biome (9 changed src/test files) / `git diff --check` | clean / clean |

The 3 known flaky tests did not fail. The count is 614 against the implementer's 606 because of the 8 tester tests added below (7 pass, 1 todo).

### Criteria
| Criterion | Test(s) | Result |
|---|---|---|
| S-20 v1.3 / E1-a: a slot tap after 4h rotates, is not routed, gets one E1 reply and books nothing | `session-rotation.test.ts:907` | PASS |
| E1 for every button family (`confirm:`, `cancel:`, `pref:`, `consultant:`, `sessao:`) after 4h, with A at `awaiting_confirmation` and `selectedSlotId` set | tester `:1450` (5 cases) | PASS |
| E1 reply: assistant row and outbox in the same tx as the rotation, linked by `messageId`; key `session-rotation-tap:<externalId>` | `:907` (tx: `webhook-whatsapp.ts:369-439`) | PASS |
| E1 text equals the approved text byte for byte | python compare of `plan.md:5` and `session-rotation.ts:29-30`: `True` | PASS |
| R-REL-02: a duplicate tap and a reclaimed redelivery (`failed`) give one reply and no routing | `:990` | PASS |
| Two different old taps at the same time after 4h: one B, one E1, no booking, no event left `processing` | tester `:1506` | PASS (the second tap is silent, see F-V1c-3) |
| K-7 on the tap path: an opted-out lead taps after 4h and receives nothing; B keeps `optOutAt` | tester `:1552` | PASS (blocked by `assertWhatsAppOutboundAllowed`) |
| No E1 for a tap under 4h; the scheduling flow is unchanged | `:1037`, `:1138` | PASS |
| Step 23 unit: legacy types map to one no-op; old handlers gone; policy exports only the 4h rule; the store file is deleted | `session-choice-policy.test.ts:97` | PASS |
| An old `session_choice_state` pending row does not block a text or a tap, and sends no reminder | `:1089` (x2), `:1138` | PASS |
| The legacy no-op marks events processed, never fails and never replies | `:1162`, `:1208`; code `autonomous-task-handlers.ts:1079-1088` | PASS |
| No import of deleted code | `grep` over `src/`, `scripts/`, `package.json`: only test literals and comments | PASS |
| Executor filter removed | `autonomous-task-executor.ts` diff; `tsc` | PASS |
| Lock order lead before conversation (F-V1b-2) | `session-choice-policy.test.ts:151` | PASS, but limited (F-V1c-2) |

### Coverage of the 9 deleted files
Legend: P = ported (`session-rotation.test.ts` unless stated; `adv` = `session-rotation-adversarial.test.ts`). O = obsolete under v1.3 R-SES-02 ("sem perguntar nada"). That is: no pending choice, no question, no reminder, no Continuar/Nova. LOST = still valid and not ported.

| File:line (HEAD) | Case | Status |
|---|---|---|
| gate:217 | tap from another family while pending: invalid, no booking | O; v1.3 analogue P `:1138`, tester `:1450` |
| gate:423 | a scheduling task is not claimed while pending | O (the executor filter was deleted in plan step 23) |
| gate:470 | opening the choice supersedes old tasks, auditable | P as rotation: `:409`, adv `:366` |
| gate:538 | `confirm:<slot>` while pending: no appointment | O; v1.3 analogue tester `:1450` (`confirm` after 4h) |
| gate:607, :650, :697 | pref / consultant / confirmation handlers while pending | O (guard removed) |
| gate:783 | after resolving, scheduling works | P `:1037`, `:1138` |
| handlers:56, :121 | question sent once; the reminder does not duplicate it | O (no question or reminder) |
| handlers:179 | with no pending state the handler sends nothing | P `:1208` (no-op) |
| continue:58, :176, :243 | Continuar keeps the conversation, history and state; no repeated question | O (no Continuar); under-4h continuity P `:648`, `:1379` |
| invalid-replies:272, :574 | unknown `sessao:` or an old slot while pending; an invalid tap does not consume the choice | O; v1.3 analogue `:1162`, `:1138` |
| invalid-replies:348 | free text "quero começar do zero" | P `:1089` |
| invalid-replies:418 | S-20 v1.2 typed "continuar" | P `:1089` (S-20 v1.3 itself = `:907`) |
| invalid-replies:511 | the same delivery repeated gives no second reply | P `:369`, `:990`, `:1403` |
| adversarial:111, :172 | Continuar then Nova (and the reverse) | O |
| adversarial:217 | the pending state survives a restart | O |
| adversarial:271 | a message concurrent with Nova never leaves two active conversations | P `:329`, `:678`, adv `:460` |
| store:53, :93, :138, :166 | store persistence, claim race, the executor ignores the state row, no inbound task | O (store deleted). The `completed` row is never claimed: the executor claims only `pending` |
| new:87 | B on the same lead; A closed, not deleted | P `:409` |
| new:151 | held messages move to B and are processed there | P `:280` (the message is inserted directly in B) |
| new:239 | the "Nova" confirmation is sent | O (E4-a: no extra text) |
| new:287 | scheduling session expired; appointment kept | P `:1273` |
| new:354 | B inherits opt-out and the customer window | P `:409`, `:535`, `:302`; tap path tester `:1552` |
| new:403 / :468 | snapshot / no commercial field inherited | P `:409` |
| new:545, :749, :891 | past meeting → `new`, greeting, no "agendado" (incl. a `confirmed` past meeting) | P `:552` |
| new:616, :860 | future confirmed → `scheduled`, not deleted | P `:614`, `:782`, `:1273` |
| new:676 | a cancelled future meeting does not keep `scheduled` | P adv `:416` |
| isolation:100 | B prompt has no A vehicle state or history | P `:1325` |
| concurrency:266 | restart then executor applies the choice | O |
| concurrency:325 | message concurrent with Nova | P `:329`, `:678`, adv `:460` |
| concurrency:392 | two concurrent taps give one B | was not ported by the implementer; now P tester `:1506` |
| concurrency:442 | a scheduling task in `processing` while pending gives no appointment | O; rotation analogue adv `:366` |
| concurrency:519 | three messages within 4h | P `:1379` |
| concurrency:582 | repeated `externalId` | P `:1403` |

`session-choice-policy.test.ts`: the text/ID case and the `hasPreviousCustomerMessage` case were removed as the plan says (O).

### Implementer deviations
- **(a) An existing `session-rotation-tap:<externalId>` reply also skips routing.** Accepted. The plan's own test "toque repetido pelo Meta responde uma vez" needs it. The lookup is by the unique idempotency key, so it can only match the same Meta message. Reachable case: the tx commits, the COMMIT ack is lost, and the catch marks the event `failed` (`webhook-whatsapp.ts:577-586`). A later redelivery is then reclaimed, B no longer has a gap, and without this guard the old tap would be routed. Cost: one indexed SELECT per tap.
- **(b) A legacy `sessao:*` tap under 4h gets no reply.** Acceptable for one release under E3-a, but it conflicts with the spec. That is F-V1c-1, for the planner and Davi; it is not an implementer FAIL. E3-a explicitly approved "no failure, no reply" for the legacy types, and F2-06 "changed" keeps only the legacy `sessao:*` taps. With the E3-a deploy precondition (both SELECTs return 0), a `sessao:*` tap can only come from a question that was already resolved. The old code answered that with `SESSION_CHOICE_ALREADY_RECORDED_TEXT`. R-SCH-03 says "Nenhum toque em botão fica sem resposta". R-REL-05 does not apply: this is not a failure. The tap also refreshes `lastCustomerMessageAt` (`webhook-whatsapp.ts:387-393`), so the 4h clock restarts while the customer sees nothing.

### Findings
- **F-V1c-1 (planner/Davi, low): the legacy `sessao:*` tap under 4h is silent.** Evidence: `:1162`, `sent = []`. It conflicts with R-SCH-03. Options: (1) accept it for one release; (2) route the tap to the E1-style fixed reply; (3) reply "Pode me contar o que você procura?" (a new text, so it needs approval).
- **F-V1c-2 (planner, low): the lock-order unit test (`session-choice-policy.test.ts:151`) is both too strict and incomplete.**
  - Too strict: it flags every `.for("update")` whose last `.from()` is not `leads`. A future correct lock taken after the lead lock (for example `scheduling_sessions FOR UPDATE` inside a tx that locked the lead first) fails the test.
  - Incomplete: it matches only the literal `.for("update")`. It misses `.for("update", {...})`, `.for("no key update")`, raw `sql` `FOR UPDATE`, and implicit row locks from `UPDATE`.
  - It does **not** cover F-V1b-3. `appointment-service.ts` takes its locks through plain `UPDATE`s, so the test passes while that cycle exists.
  - Suggestion: rename it to "no explicit row lock on conversations", or replace the scan with a documented rule: lock the lead first in every tx that writes lead-scoped rows.
- **F-V1b-3 (planner, low-medium): still open, now reproduced.** Lock order in `appointment-service.ts`: `:291` UPDATE `scheduling_sessions`, then `:338` UPDATE `leads`. Lock order in the rotation: `session-rotation.ts:67` lead FOR UPDATE, then `:166` UPDATE `scheduling_sessions`. Run: `npx tsx --import ./src/tests/support/db-test-preload.ts --test --test-reporter=tap --test-name-pattern="F-V1b-3" src/tests/reliability/session-rotation.test.ts`. Output: `not ok … # TODO`, with `actual: ['40P01'], expected: []`. If the webhook tx is the victim, the event becomes `failed` with a 200 response, so the inbound is lost. Fix options are unchanged: lock the lead first in `createConfirmedAppointment`, or retry `40P01` in the webhook tx.
- **F-V1c-3 (planner, low; pre-existing F-03 / package B): a second old tap after rotation is silent.** It is routed to `send_confirmation_request` on B, which has no active session, so it returns `skipped` with no reply (`autonomous-task-handlers.ts:995-998`). Nothing is booked (tester `:1506`). Same R-SCH-03 gap as before.
- **F-V1c-4 (planner, low): the E1 wording and the tap record.**
  - (1) A `pref:`, `consultant:` or `sessao:` tap after 4h also gets "aqueles horários não valem mais". That wording fits only a slot tap. E1 was approved for "old scheduling button", so this is a wording gap for `sessao:` only.
  - (2) The tap is not stored as a customer message in B. B starts with an assistant row and no user row. R-SCH-03's last clause ("Todo toque é gravado como mensagem do cliente") is not met. This is pre-existing for every tap, since no path inserts a user row for a tap.
- **Scope note:** `docs/CODEMAP.md:45-46` was edited in V1-c. The plan places it in step 24 "with Davi's approval of each text". It is docs only; Davi should approve it in V1-d. `CLAUDE.md` was not touched (correct, step 24).

### Tester tests added (`src/tests/reliability/session-rotation.test.ts`)
- `:1450`: "tester: toque '<kind>:*' antigo após 4h não é roteado, não agenda e recebe só a resposta E1" (5 cases).
- `:1506`: "tester: dois toques diferentes no horário antigo após 4h, concorrentes…".
- `:1552`: "tester: toque após 4h de lead com opt-out não envia nada e B mantém optOutAt (K-7)".
- `:1581`: "tester: F-V1b-3 — rotação e confirmação de agendamento concorrentes não entram em deadlock" (`todo`; it fails today with `40P01`).

### Risks not covered
- F-V1b-1 (a late redelivery after 4h loses the message) is still `todo`.
- F-V1b-3 deadlock (above).
- E3-a still depends on Davi's 2 read-only Neon SELECTs. Until both return 0, held messages in a pending choice are answered only by the next turn.
- Red evidence for steps 22 and 23 comes from `progress.md`. It was not re-run by the tester (no git writes or worktree allowed). The assertions would fail on HEAD, where the question is sent instead of E1.

### Manual WhatsApp checklist (staging, V1-c)
1. Get an offer with time buttons. Wait 4h or more and tap one of the old times. Expected: exactly "Oi! Já faz um tempo desde a nossa última conversa, então aqueles horários não valem mais. Me conta o que você procura agora?". No booking, no calendar event.
2. Right after step 1, tap the same old time again. Expected today: no reply and no booking (F-V1c-3).
3. Within 4h of an offer, tap a time. Expected: the normal confirmation question for that slot.
4. Reach the confirmation buttons. Wait 4h or more and tap "Confirmar". Expected: the E1 text only, and no appointment.
5. Within 4h, tap an old "Continuar" / "Nova conversa" button, if one exists from before the deploy. Expected today: no reply (F-V1c-1), and no new conversation.
6. After "pare", wait 4h or more and tap an old time. Expected: nothing is sent.

## Steps 26–27 (Batch V2-a) — tester verification (2026-10-27)

**Verdict: PASS** (step 26 PASS, step 27 PASS). 0 failures in scope. 3 findings for the planner (below), none caused by this diff.

- Approval: plan.md:1 `APPROVED by Davi` (Rev2 + 2.1), D-R2-1 (a). Diff touches only the files listed in steps 26–27 plus CODEMAP (helper row). No unapproved change.
- Product files checked after every temporary mutation: diff stat 27/8/40 lines, same as the implementer's change. No mutation left.
- Env for every run: host=localhost db=mariana_test, `RELIABILITY_WORKERS_ENABLED=false`, `DOTENV_CONFIG_PATH=/dev/null` (real `.env` not loaded).

### Criteria → tests → result
| Criterion | Test(s) | Result |
|---|---|---|
| R-SES-02 v1.4 / S-22: redelivery ≥ 4h of a stored, unanswered message stays in A, answered once | `session-rotation-adversarial.test.ts` "reentrega ≥ 4h …" | PASS; red on HEAD code: `no new conversation 2 !== 1` |
| Redelivery into closed A: B untouched, no reply, event processed (plan step 26) | `session-rotation.test.ts` "reentrega de mensagem já gravada numa conversa fechada …" | PASS; red on HEAD: `B lastCustomerMessageAt not bumped` |
| K-5 / 4h − 1 ms regressions | rotation files, `webhook-whatsapp.test.ts` | PASS (full suite) |
| Step 27: appointment vs rotation, no 40P01 | `lock-order.test.ts` test 1; `session-rotation.test.ts` "tester: F-V1b-3 …" | PASS ×5 each; red on HEAD `appointment-service.ts`: `actual: ['40P01']` (both) |
| Step 27: tap/text vs confirm, both orders | `lock-order.test.ts` appointment-first / webhook-first | PASS ×5; red on HEAD (appointment-first): `event failed: … update "scheduling_sessions" …`; webhook-first green before and after (no cycle in that order, as the implementer said) |
| Invariants: 1 active conversation, duplicate not processed twice, `selectedSlotId` | full `test:db`; tester file below | PASS |

### The two deviations
- `:1581` rewritten to call the real `createConfirmedAppointment`: accepted. The old body was an inline copy of the pre-fix order, so it could never turn green. The new body still makes rotation wait on an appointment tx that holds the session row, and still asserts `failures = []`. Red on HEAD `appointment-service.ts`: `actual: ['40P01'], expected: []`. Same failure.
- `eventId`/`eventExternalId` in the adversarial task payload: accepted. The real webhook writes this payload (`webhook-whatsapp.ts` text branch). With the old `{ kind: "text" }` payload and the fixed code, only the last assert fails (`'processing' !== 'processed'`); the reply-once-in-A asserts still pass. On HEAD code the test fails earlier (`2 !== 1`, rotation). Same failure as the old todo.

### Break attempts (new file `src/tests/reliability/redelivery-adversarial.test.ts`, 10 tests, 9 pass, 1 todo)
- Redelivery while the task is still pending, with a different payload and the same externalId: 1 message (first payload kept), 1 task, 1 reply, event processed. PASS.
- Redelivery after the task completed: duplicate claim, no 2nd reply. Forced `failed` + redelivery: no 2nd reply, but the event stays `processing` (diagnostic). Risk R-1.
- Two messages in one debounce window, then the 1st is redelivered: 1 batched reply, both events processed. PASS.
- Concurrent late redelivery + new message (×5): 1 active conversation, X stays in A, the new message lands in the active conversation and is answered, no event failed. PASS. In all 5 runs the new message won the lead lock (rotation, X silent by design).
- Sequential late redelivery then new message: no rotation (the redelivery resets A's gap), 2 replies (X and the new one). PASS.
- Tap redelivered after B was opened: no reply (OK), but B's `lastCustomerMessageAt` is bumped. Marked `todo` (F-T26-2).
- Lock orders: `lock-order.test.ts` 3/3 and F-V1b-3 1/1, 5 runs each, 0 failures.

### Findings (planner, not implementer)
- **F-T26-1 (spec vs plan):** S-22 v1.4 says "nunca silêncio" and D-R2-1 (a) says "A answers it". In the closed-A case (X stored in A, task superseded when a newer message rotated to B), the approved step-26 test asserts no reply, so X is never answered. The newer message is answered in B. The code matches the plan. Decide whether S-22 needs "quando a conversa ainda está ativa".
- **F-T26-2 (gap):** the tap branch does not pass `externalId` (taps are not stored as messages, F-V1c-4 (2)). An old tap redelivered after rotation bumps B's `lastCustomerMessageAt`, the same symptom step 26 fixed for text. No double reply. Test left as `todo`.
- **F-T27-1 (lock order, other paths):** grep found no other raw `FOR UPDATE` before the lead (only `active-conversation.ts:34`, `session-rotation.ts:82`, `appointment-service.ts:287`; the `SKIP LOCKED` queues lock no lead rows). But these txs run `UPDATE scheduling_sessions` first, then insert a row with an FK to `leads`, which needs `FOR KEY SHARE` on the lead and conflicts with rotation's `FOR UPDATE`: `autonomous-task-handlers.ts:554, 718, 768, 913, 1034` (`enqueueOutboundMessage` with `leadId`) and `scheduling-offer-service.ts:71` (`insert schedulingSessions`). A temporary test with the same statement shape (UPDATE session → INSERT outbound with `leadId`) against the real `resolveConversationForInbound` gave `["40P01"]` on the rotation side 3/3. That test was deleted after the run. Trigger needs the handler to run while a ≥ 4h-gap inbound rotates, so it is unlikely: the tap/offer itself just reset the gap. Out of step 27 scope. Proposal: lock the lead first in these txs (or in `enqueueOutboundMessage` callers) in a later step.

### Risks not covered
- R-1: a redelivery into the active A after its task completed leaves the event `processing` (later `failed` by lease recovery). No reply is duplicated. Pre-existing behavior.
- A redelivery into the active A bumps A's `lastCustomerMessageAt` to the redelivery time (K-5 behavior, pre-existing).

### Full suites
- `test:unit`: 356 tests, 350 pass, 0 fail, 6 todo. `tsc --noEmit`: 0. `build`: ok. Biome (9 changed/new files): clean. `git diff --check`: clean.
- `test:db` run 1: 627 tests, 620 pass, 0 fail, 7 todo. Run 2: 627/620/0/7. 0 `generativelanguage`/`graph.facebook` hits. The known flaky tests did not fail.

### Manual WhatsApp checklist (owner, staging)
1. Send "oi"; with the worker stopped long enough for Meta to redeliver (or replay the webhook), restart. Expected: exactly one reply in the same conversation.
2. Book a meeting: tap a time, then "Confirmar". At the same moment, send a text after ≥ 4h of silence (staging clock). Expected: the booking either succeeds or gets the normal failure; the text is always answered; no `failed` webhook event in the DB.

## Steps 28–29 (Batch V2-b) — tester verification (2026-10-27)

**Verdict: PASS** (0 failures in scope; 1 new design finding F-T29-1, left as `todo`; 2 residual risks).

- Approval: plan.md:1 `APPROVED by Davi` (Rev2 + 2.1), D-R2-2 (a), D-R2-6 (a). Diff matches plan steps 28–29 (files: `generateMarianaResponse.ts`, `autonomous-task-handlers.ts`, new `stale-tap-reply.ts`, `webhook-whatsapp.ts`, rotation tests, CODEMAP). No unapproved change.
- Target: host=localhost db=mariana_test, `RELIABILITY_WORKERS_ENABLED=false`, `DOTENV_CONFIG_PATH=/dev/null`. Gemini/WhatsApp/Calendar mocked.

### Criteria → tests → result
| Criterion | Test(s) | Result |
|---|---|---|
| S-23 / R-V1b-1: in-flight A turn during rotation writes nothing (lead, assistant row, outbox) | adversarial "turno em andamento em A quando a rotação acontece…" | PASS; mutation (in-tx re-check disabled) → red |
| R-SES-01/02: A task run after rotation never answers in B, 0 Gemini calls | adversarial "tarefa de A executada depois da rotação não responde em B" | PASS |
| S-07 / R-SCH-03 <4h: legacy `sessao:*` tap answered, D-R2-6 text, no AI, no task, event `processed` | rotation "toque legado sessao:* … nunca silêncio" | PASS |
| S-07 slot stage → notice + "Estes são os horários…" + slot buttons | rotation "… horários ofertados …" | PASS |
| S-07 awaiting_confirmation → notice + Confirmar/Não for `selectedSlotId` | rotation "… awaiting_confirmation …" | PASS |
| R-REL-02: repeated / reclaimed tap answers once | rotation "… repetido pelo Meta responde uma vez" | PASS; mutation (key check removed) → red (2 assistant rows) |
| Opted-out lead gets nothing (K-7) | tester "… lead com opt-out não envia nada (K-7)" | PASS (blocked at dispatch, `contact_opted_out`) |
| Never the stale-tap reply after 4h (S-20 wins) | existing tester loop `toque 'sessao:*' antigo após 4h …` | PASS (rotation branch returns before the `sessao:` branch, webhook-whatsapp.ts:404-437) |
| Expired session → no-scheduling text | tester "… sessão de agendamento vencida …" | PASS |
| Preferred consultant filter | tester "… consultor preferido mostra só os horários desse consultor" | PASS; mutation (filter removed) → red |
| R-SCH-03 "botões da etapa atual" in `awaiting_availability` / `awaiting_consultant_preference` / `awaiting_consultant_selection` | tester "F-T29-1 — …" ×3 | FAIL, kept as `todo` (see F-T29-1) |
| Same-tx write of assistant row + outbox + `processed` | code review: `replyToStaleTap(tx)` + event update in the same `db.transaction` (webhook-whatsapp.ts:445-461) | PASS |

### Findings
- **F-T29-1 (planner, design gap; transient until step 31).** `stale-tap-reply.ts` sends slot buttons for every active session that is not `awaiting_confirmation`. In `awaiting_availability`, `awaiting_consultant_preference` and `awaiting_consultant_selection`, a slot tap is rejected (`scheduling-choice-service.ts:110` `invalid_workflow_stage`; B-1 says that tap is skipped in silence). Chain: legacy tap → slot buttons → tap → silence. Breaks R-SCH-03. Command: `npx tsx --import ./src/tests/support/db-test-preload.ts --test --test-name-pattern="F-T29-1" src/tests/reliability/session-rotation.test.ts` → `stage awaiting_consultant_preference offered slot button …, which the stage rejects`. Expected: buttons the stage accepts. The plan's step 29 text names only slot or Confirmar/Não buttons. Step 31 removes those stages, so the `todo` should flip green there. Otherwise step 32 must cover it.
- **Step 28, unanswered message.** This is the same case as F-T26-1, not a new one. The adversarial test seeds "é para carro" unanswered in A, and "oi de novo" then rotates to B. Only B is answered. S-23 v1.4 approves this explicitly ("Essa resposta não é enviada…; a mensagem nova recebe uma única resposta"). The trigger needs an A message whose task did not run for ≥ 4h (workers down, retries). F-T26-1 is still open only because S-22 says "nunca silêncio" for the redelivery variant.
- **Step 28, other callers.** `receive-customer-message.ts:134` (HTTP route `create-messages.ts`, registered in `server.ts:64`) calls `generateMarianaResponse` without `expectedConversationId`. That turn has no stale-turn guard. Test callers and simulator also omit it, which is fine. Production WhatsApp path (`autonomous-task-handlers.ts:271`) passes it.
- **D-R2-6 texts.** Notice and the two follow-ups match verbatim (`stale-tap-reply.ts:20-23`). `\n` separator: acceptable; D-R2-6 says "followed by" and gives no separator. Deviation for the owner to see: in `awaiting_confirmation` the follow-up is the confirmation body "Você escolheu … Posso confirmar?", not "Estes são os horários…". This follows plan step 29 (Confirmar/Não) and reads correctly.
- **`turn_error` trace on supersede (R-REL-07).** R-REL-07 requires one trace per turn, and the model was called, so emitting a trace is correct. The label is wrong: `emitFailureTrace` maps it to `turn_error` (generateMarianaResponse.ts:378-379). The error message has only the conversation id, never customer text. This inflates error metrics. Not a spec breach. Proposal (planner): add outcome `superseded`. The start-check throw happens before the `try`, emits no trace, and makes no model call. Correct.
- **`dotenv/config`.** No changed or new test file imports it. Loaded by design in `src/env.ts:1`, `db-test-preload.ts:8`, `setup-test-db.ts:7`, `drizzle.test.config.ts:4`. Every `.env` secret key (all 20 key names checked, values not read) is overwritten by `FAKE_EXTERNAL_ENV` or the DB guard, and `test-env-isolation.test.ts` proves the override. Leak that is not a safety issue: `MESSAGE_DEBOUNCE_MS` and `PORT` from `.env` still reach test processes unless `DOTENV_CONFIG_PATH=/dev/null`.

### Risks not covered
- **Post-commit window (step 28).** Some work runs after the guarded tx commits and outside the guard: `runSchedulingOfferIfAuthorized`/`persistOffer` (generateMarianaResponse.ts:917-981) and the handler's `enqueueOutboundMessage` (autonomous-task-handlers.ts:324). A rotation that commits inside this window (milliseconds, plus a Calendar call) still lets A's reply or offer go out, and writes a scheduling session into closed A. Needs an A task ≥ 4h late. No test.
- The skip path marks the event `processed` but leaves A's batch messages with `processedAt = null`. No sweeper re-reads them today.
- The opted-out stale tap still writes an assistant row in A that is never delivered (same as the existing E1 path).

### Tester tests added (`src/tests/reliability/session-rotation.test.ts`, end of file)
- opt-out <4h legacy tap; expired session text; preferred-consultant filter; `F-T29-1` ×3 (`todo`).

### Full suites
- `test:unit`: 356 / 350 pass / 0 fail / 6 todo. `tsc --noEmit`: 0. `build`: ok. Biome on the 6 changed files: clean (after formatting the tester block). `git diff --check`: clean.
- `test:db` run 1: 638 / 628 pass / 0 fail / 10 todo. Run 2: 638 / 628 / 0 / 10. 0 egress hits. Known flaky tests did not fail.
- Temporary product mutations (3) were reverted with `cmp` checks.

### Manual WhatsApp checklist (owner, staging)
1. Within 4h, tap an old "Continuar/Nova conversa" button (`sessao:*`) with no scheduling in progress. Expect "Esse botão é de uma mensagem antiga." then "Me conta o que você precisa agora?" in one message. No AI reply.
2. Within 4h, while times are on screen, tap an old `sessao:*` button. Expect the notice, "Estes são os horários que tenho para você:" and the same time buttons. Tapping one advances to Confirmar.
3. After choosing a time (Confirmar/Não on screen), tap an old `sessao:*` button. Expect the notice, "Você escolheu … Posso confirmar?" and Confirmar/Não.
4. Tap the same old button twice quickly. Expect exactly one reply.
5. After the preference question ("tem preferência de consultor?"), tap an old `sessao:*` button. Today you get time buttons that do nothing (F-T29-1). Skip this until step 31 lands.
6. After ≥ 4h of silence, tap an old `sessao:*` button. Expect only the S-20 fixed reply in a new conversation, not the stale-tap notice.

## Steps 30–31 (Batch V2-c) — tester verification (2026-10-27)

**Verdict: PASS** (0 failures). Approval: plan.md:1 `APPROVED by Davi` (Rev2 + 2.1), D-R2-5 (a), D-R2-7 (a), consultant name visible.

### Criteria → tests → result
| Criterion | Test(s) | Result |
|---|---|---|
| Draw only among consultants free at the time (R-SCH-01 v1.4) | draw unit "sorteia o consultor entre os livres…", "um único consultor livre…"; tester "random() fora de [0,1)…" | PASS |
| Pure random, not biased by list order (D-R2-7 a) | tester "sorteio com fonte semeada é uniforme…" (3000 draws, each of 3 free ≈ 1/3 ± 5 pp, busy 0); tester "a ordem da lista (carga/nome) não enviesa…" (2 permutations) | PASS; mutation "always first free" → both red (share 1.000) |
| One draw per offered time | tester "cada horário tem o seu próprio sorteio" (random called exactly 2× for 2 times) | PASS |
| Draw persisted on the slot before any Confirmar; booking + Calendar event use it (R-SCH-04) | DB "a oferta grava o consultor sorteado no slot…" (slot, `appointments.consultantId`, fake `createEvent.calendarId`) | PASS |
| Redelivery / re-render never re-draw | tester DB "reentrega do aceite e re-render (toque antigo) não sorteiam de novo…" (same event twice → 1 session, slots unchanged; stale-tap reply re-renders same slot ids from DB) | PASS |
| AI cannot influence consultant or slot | tester DB "a IA não escolhe consultor nem horário…" (Gemini returns `consultantId`, `slotId`, `selectedSlotId`, names a consultant and "03:00": slots keep the backend draw, `selectedSlotId` null, AI text replaced, 0 appointments). Code: `generateMarianaResponse.ts:931` reads slots only from `SchedulingAvailabilityService` | PASS |
| Confirmation shows the drawn consultant's name | DB "toque no horário da primeira oferta… (B-1)" + tester redelivery test (` com <slot.consultantName>. Posso confirmar?`); single slot uses "Tenho um horário disponível: X com <nome>" (`scheduling-confirmation-service.ts:121`); final "Agendamento confirmado para X com <nome>" (`TH:413`) | PASS; mutation (name removed from body) → 2 red |
| No preference question (S-01, R-SCH-01) | DB "aceite oferece só horários…" (0 `pref:`, 0 preference tasks); tester redelivery test (no `pref:`/`consultant:` buttons, no "preferência" text across offer, stale-tap re-render, slot tap). Grep: `SEND_CONSULTANT_PREFERENCE_QUESTION_TASK` has no enqueuer left in `src/` | PASS |
| B-1 slot tap on first offer → Confirmar | DB "toque no horário da primeira oferta…" | PASS |
| B-2 single slot selected + `awaiting_confirmation` in the `persistOffer` tx | DB "um único horário: Confirmar agenda (B-2)"; ported `generate-mariana-response` "Etapa 10"; `scheduling-offer-service.ts:137-157` (same tx) | PASS |
| Confirm requires persisted `selectedSlotId` (CLAUDE.md) | DB "Confirmar exige o selectedSlotId gravado" | PASS |
| R-SCH-07 / S-24 (slot taken before Confirmar) | not in steps 30–31 (step 33) | N/A — still B-3 silent |
| S-25 (legacy `pref:`/`consultant:` tap) | not in steps 30–31 (step 32) | N/A |

### Ported tests
- `generate-mariana-response.test.ts` "Etapa 10": intent "no confirm without a persisted selection" is kept in substance (selection now persisted by the offer tx; Confirmar is validated against it). Inversion is required by B-2. OK.
- `webhook-whatsapp.test.ts` single-slot offer: old intent (preference before slots) is obsolete by R-SCH-01 v1.4; kept "no appointment on offer". Now asserts Confirmar/Não ids and titles. Does not assert the body name; covered elsewhere. OK.
- `objective-flow-matrix.test.ts` case 2: full happy path kept (slot → confirm → appointment, Calendar event, lead `scheduled`, confirmation text). Preference steps removed; asserts the offer enqueues no task. No valid case lost; legacy handler coverage stays in `phase3-scheduling-workflow.test.ts` and `handler-partial-failure.test.ts`.

### F-T29-1 (3 `todo` tests, `session-rotation.test.ts:2037-2073`)
- Claim holds. After step 31 the only writers of `awaiting_availability`/`awaiting_consultant_preference`/`awaiting_consultant_selection` are legacy handlers gated on a legacy stage (`TH:543, 673, 880`); `persistOffer` writes `awaiting_slot_selection` or `awaiting_confirmation`. New-flow coverage: DB "toque legado sessao:* numa oferta nova…" (mutation-checked by implementer).
- Condition: for pre-deploy sessions the stale-tap reply still shows slot buttons that the slot handler skips in silence. Steps 30–31 must not ship without step 32 in the same release.

### Admin route order
- `routes/appointments/get-availability.ts:27` passes no random source, so it still shows the first free consultant in load/name order. This is approved in the plan (Rev2.1 Design). It is acceptable: the route is read-only and not customer-facing. It persists nothing, and booking always uses the slot row. Residual: the admin view may name a different consultant than the customer offer.

### Suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit`: 363 / 357 pass / 0 fail / 6 todo. `test:db` run 1: 653 / 643 / 0 / 10 todo; run 2: 653 / 643 / 0 / 10. `tsc --noEmit`: 0. `build`: ok. Biome on the changed `src/` files: clean. `git diff --check`: clean. Known flaky tests did not fail.
- Product mutations (temporary, reverted, `cmp` verified): `consultant-availability.ts` draw forced to the first free; `scheduling-confirmation-service.ts:110` name removed.

### New tests (tester)
- `src/tests/services/consultant-availability-draw.test.ts`: 4 tests (seeded uniformity, order independence, one draw per time, out-of-range `random()`).
- `src/tests/services/scheduling-without-consultant-choice.test.ts`: 2 DB tests (no re-draw on redelivery/re-render + name in Confirmar + no preference text; AI cannot pick consultant/slot).

### Risks not covered
- B-3 / S-24: a slot taken before Confirmar still gets no reply (step 33).
- Pre-deploy sessions in legacy stages: slot taps are skipped in silence until step 32. A pending `send_consultant_preference_question` task created before deploy still sends the question (step 32 no-op).
- `drawConsultant` with `random()` = `NaN` drops the time (`freeConsultants[NaN]`). `Math.random` never returns NaN, so this matters only for an injected source.
- After a slot tap (`awaiting_confirmation`), tapping another slot from the first offer is skipped in silence (F-V1c-3, out of scope).
- The draw uses Calendar free/busy only, as before. No new DB conflict check at offer time; revalidation at booking is unchanged (R-SCH-06).

### Manual WhatsApp checklist (staging, real Calendar test accounts)
1. Qualified lead sends "Quero agendar". Expect "Tenho estes horários disponíveis. Escolha uma opção:" with up to 3 slot buttons. No "Você tem preferência por algum consultor?".
2. Tap the 2nd slot. Expect "Você escolheu <data hora> com <nome>. Posso confirmar?" [Confirmar | Não].
3. Tap Confirmar. Expect "Agendamento confirmado para <data hora> com <nome>." The name must match step 2. The event must be in that consultant's calendar.
4. Repeat steps 1–2 with 3 leads at the same time. Expect that the names vary across offers (random), never a busy consultant.
5. With only one free time: expect "Tenho um horário disponível: <data hora> com <nome>. Posso confirmar?". Confirmar books it.

## Steps 32–33 (Batch V2-d) — tester verification (2026-10-27)

**Verdict: FAIL** (1 failure, design gap → planner). Everything else in steps 32–33 passes. A new flaky test was found, and its cause was fixed in test code.

Approval: `plan.md:1` `APPROVED by Davi` (Rev2 + 2.1). D-R2-5 (a) and D-R2-6 (a) checked.

### Criteria → tests → result
| Criterion | Test(s) | Result |
|---|---|---|
| Pending `send_consultant_preference_question` task drains with no send | `session-rotation.test.ts` "tarefa pendente de pergunta de preferência…"; `handler-partial-failure` "tarefa legada…"; `phase3` legacy flow | PASS |
| Old `pref:`/`consultant:` tap as a task: notice + slot buttons, `awaiting_slot_selection`, one tx | `handler-partial-failure` 3 legacy cases (outbox failure → retry, key `stale-tap:<ext>`); `phase3` legacy flow + invalid pref button | PASS |
| New `pref:`/`consultant:` tap in the webhook: S-07 reply, no task, event `processed`, no AI | `session-rotation.test.ts` "toque pref:*/consultant:* antigo…" ×2, "…sem sessão…" | PASS |
| Slot tap in each of the 3 legacy stages goes to Confirmar | `session-rotation.test.ts` "toque legado sessao:* em <stage>…" ×3, "sessão em awaiting_consultant_preference…" | PASS |
| Slot tap / Confirmar from **another session** gets a reply (R-SCH-03, S-07) | tester todo ×2 in `scheduling-without-consultant-choice.test.ts`; implementer "toque num horário de outra sessão em etapa legada não muda a etapa" asserts `sent = []` | **FAIL** (silence) |
| No handler left for a task type; no import of deleted code (incl. `scripts/`) | grep: every enqueued type is registered (`session_rotation_snapshot` is written `completed`, never run); no reference to removed handlers or `enqueueConsultantPreferenceQuestion` in `src/` or `scripts/` | PASS |
| S-24: nothing booked, no Calendar event, fresh offer, consultant never drawn again | "consultor do horário ocupado antes do Confirmar…" | PASS |
| S-24 single fresh slot (deviation 1) | tester "reoferta com um único horário novo…" | PASS |
| Re-offer idempotent on Meta redelivery + task re-run | "reoferta repetida pelo Meta responde uma vez" | PASS |
| Assistant row + session + outbox in one tx | tester "reoferta é atômica…" (injected outbox failure → rollback → retry replies once) | PASS |
| No slots: existing text; old session closed (deviation 2) | "sem horários na reoferta…" | PASS |
| `slot_unavailable` reason kept; other errors stay `appointment_failed` | `scheduling-confirmation-orchestrator.test.ts` "mantém slot_unavailable…" | PASS |
| D-R2-6 texts exact | `SLOT_UNAVAILABLE_REOFFER_TEXT` and `STALE_TAP_*` match `plan.md:1` verbatim; asserted by equality in the tests | PASS |
| CLAUDE.md invariants: `selectedSlotId`, one pending choice, lead-first lock | re-offer opens a new session with `selectedSlotId` null (or the single pre-selected slot); old Confirmar refused (tester test); `sendSlotUnavailableReoffer` and `handleLegacyConsultantTap` lock the lead first | PASS |

### Failure F-T32-1 — a tap from another session is silent (planner)
- Command: `npx tsx --import ./src/tests/support/db-test-preload.ts --test --test-name-pattern="^tester: depois" src/tests/services/scheduling-without-consultant-choice.test.ts`
- Output: `old-offer slot tap gets one reply  3 !== 4`; `old Confirmar gets one reply  3 !== 4`.
- Expected: a short notice plus the current buttons (R-SCH-03, S-07 in the current spec). Actual: `handleSendConfirmationRequest` returns `skipped` (`resolveChoice` fails), and `confirm:` returns `rejected`. No outbox is written.
- Cause: the plan puts it out of scope (Rev2.1 "Out of scope", F-V1c-3). But step 33 makes the case common: after every re-offer, the old offer's buttons are still in the chat, including the taken time. The legacy-stage variant is pinned as silence by the implementer's regression test (`session-rotation.test.ts` "toque num horário de outra sessão em etapa legada…", `sent = []`).
- Fix owner: the planner decides the scope. The fix is likely `replyToStaleTap` on these two `skipped`/`rejected` paths. Then the 2 tester `todo`s become plain tests and the implementer's assertion flips.

### Implementer deviations (judgement)
1. Single fresh slot → re-offer text + "Tenho um horário disponível: … com <consultor>. Posso confirmar?" [Confirmar | Não]. **Accepted.** It follows the approved B-2 shortcut, and slot buttons would be refused in `awaiting_confirmation`. The new consultant's name is shown before Confirmar, so there is no silent swap. Covered now by a tester test: an old Confirmar is refused, and the new Confirmar books the shown consultant. Mutation: single-slot branch off → test red (`actual: null` on the body regex). Note for Davi: "Tenho estes outros horários:" (plural) is followed by a single time.
2. No slots → old session closed. **Accepted.** It protects R-SCH-06 and the `selectedSlotId` invariant (the taken slot cannot be confirmed again). The test asserts it.
3. `sessao:*` taps do not promote the stage. **Accepted.** Plan step 32 names only `pref:`/`consultant:`. The slot tap is accepted in the legacy stage anyway (3 stage tests).
4. `objective-flow-matrix` case 2 flake: **a new flaky test. The cause was found and fixed (test-only).**
   - Repro: 6 full `test:db` runs passed. 8 runs of 6 files in parallel (matrix, scheduling-without-consultant-choice, phase3, webhook, generate-mariana-response, session-rotation) gave 2 failures: matrix case 2 `:284 0 !== 1`, and step-30 test `:473 0 !== 1`.
   - Probe: a temporary `console.error` in the orchestrator catch (reverted, `cmp` ok) showed `Failed query: insert into "appointments" … externalEventId = fake-event-1`.
   - Cause: both Calendar fakes return `fake-event-${n}`, so `fake-event-1` appears in every process, and `appointments.externalEventId` is UNIQUE. When two files book at once, the second insert fails (23505). The error collapses to `appointment_failed`, so no appointment is created. The clash came in with the new file from step 30. Product is not at fault: the real Google ids are unique.
   - Fix: `randomUUID()` in both fakes (`objective-flow-matrix.test.ts:134`, `scheduling-without-consultant-choice.test.ts:90`). After the fix: 10/10 parallel runs green, plus 2 full runs green.

### Coverage of legacy tests (handler-partial-failure, phase3)
- Not weakened. The 4 old outbox-failure cases became 1 no-op case and 3 legacy-tap cases, which still go through `runWithOneOutboxFailure`. They now also assert the slot buttons and the stage.
- `phase3` full flow still ends slot → confirm → appointment. The invalid pref button changed from `failed` to `completed` + one reply, which follows "never silent". Only the assertions about the removed behaviour (preference question, consultant list, `preferredConsultantId`) were inverted.

### Scope
- Step 32/33 code is in the listed files. Extra: `scheduling-offer-service.ts` `persistOffer({ executor })`. Step 33 does not list this file, but the "same tx" requirement needs it. Minor, accepted.
- Plan gap (planner, step 24): the Rev2.1 "R-SCH-07 (new)" re-offer rule collides with the existing `MARIANA_BEHAVIOR_SPEC.md:63` R-SCH-07 ("Só é agendado depois…"). It needs a new number before step 24 edits the spec.

### Suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit`: 363 / 357 / 0 fail / 6 todo. `tsc --noEmit`: 0. `build`: ok. `git diff --check`: clean. Biome on the changed files: clean.
- `test:db` before the tester tests: 663 / 656 / 0 / 7 todo. With the tester tests: 5 runs at 667 / 658 / 0 / 9 todo. After the flake fix: 2 more runs at 667 / 658 / 0 / 9.
- Product mutations, all temporary, reverted and checked with `cmp`:
  - single-slot branch off → red;
  - `persistOffer` without `executor` → hangs. The inner tx waits on the outer uncommitted message row, so any split of the tx self-deadlocks;
  - orchestrator probe log.

### New tests (tester), `scheduling-without-consultant-choice.test.ts`
- "tester: reoferta com um único horário novo vai com Confirmar/Não…" (pass)
- "tester: reoferta é atômica…" (pass; uses a per-test trigger keyed on its own `reoffer:` key, dropped in `finally`)
- "tester: depois da reoferta, toque num horário da oferta antiga responde…" (`todo`, F-T32-1)
- "tester: depois da reoferta, Confirmar antigo responde…" (`todo`, F-T32-1)

### Risks not covered
- A legacy tap task whose conversation is already closed: event processed, no reply. B already started, so this is acceptable, but it is silent.
- A slot tap in a legacy stage on an **expired** session is still skipped in silence (pre-existing; R-SCH-03 "sessão expirada → aviso + nova oferta").
- The re-offer may offer the same time with another consultant. This is visible (name shown before Confirmar, R-SCH-07 Rev2.1), but the multi-slot buttons show the time only.
- `reoffer:` key fallback `<conversationId>:<buttonId>` when `externalId` is missing would dedupe a later identical tap forever. The webhook always passes `externalId`.
- Other fakes with constant ids (`google-event-123`, `google-event-test`) could clash the same way if they ever reach a real insert in parallel.

### Manual WhatsApp checklist (staging, Calendar test accounts)
1. Qualified lead: "Quero agendar". Expect up to 3 slot buttons. Tap the 2nd. Expect "Você escolheu <data hora> com <A>. Posso confirmar?".
2. In A's test calendar, create a busy event at that time. Tap Confirmar. Expect "Esse horário acabou de ficar indisponível. Tenho estes outros horários:" with new slot buttons. No booking, no event in A's calendar.
3. Tap a new slot, then Confirmar. Expect "Agendamento confirmado para <data hora> com <nome>." The name must match the Confirmar question.
4. After step 2, tap Confirmar on the **old** message. Today you get no reply (F-T32-1). After the fix, expect "Esse botão é de uma mensagem antiga." plus the current buttons.
5. Make every consultant busy, then repeat step 2. Expect "No momento, não encontrei horários disponíveis nos próximos 5 dias.". An old Confirmar books nothing.
6. Only one free time left during the re-offer: expect "Esse horário acabou de ficar indisponível. Tenho estes outros horários:\nTenho um horário disponível: <data hora> com <nome>. Posso confirmar?" [Confirmar | Não].
7. A lead with an old "Você tem preferência por algum consultor?" message taps "Sem preferência" under 4h. Expect "Esse botão é de uma mensagem antiga.\nEstes são os horários que tenho para você:" plus slot buttons. Tapping a slot then asks for Confirmar.

## V3-a (steps 34, 35) — tester verification, 2026-10-27

**Verdict: PASS** (0 failures). Plan Rev3 `Status: APPROVED by Davi` (line 1; D-R3-1..4 = a).

### Criteria
| Criterion | Test(s) | Result |
|---|---|---|
| R-SCH-03/S-07: old slot tap after re-offer replies | `scheduling-without-consultant-choice` "depois da reoferta, toque num horário da oferta antiga…" | PASS |
| R-SCH-03/R-SCH-04: old Confirmar replies, 0 appointments | "…Confirmar antigo responde…" | PASS |
| Cancel refused replies (notice + current buttons) | "Não (cancel:) de uma oferta antiga…" | PASS |
| Slot-tap exit 1 (no/expired session, S-08 + D-R3-4 text exact) | `webhook-whatsapp` "button_reply rejeitado pelo SchedulingChoiceService…"; `session-rotation:1748` | PASS |
| Slot-tap exit 2 (foreign slot, legacy stage, S-25) | `session-rotation` "toque num horário de outra sessão em etapa legada responde aviso…" | PASS |
| Slot-tap exit 3 (`session_changed_before_confirmation`) | none yet (race; step 36 lock-order test will reach it) | NOT COVERED |
| Meta repeat idempotent (R-REL-02) | "toque recusado repetido pelo Meta responde uma vez" | PASS |
| Closed conversation: no reply (R-SES-01, S-23) | "toque recusado numa conversa já fechada não responde" (mutation-checked) | PASS |
| Opted-out lead: nothing reaches WhatsApp | NEW tester "toque recusado de lead que pediu para parar…" | PASS |
| `appointment_failed` excluded | NEW tester "Confirmar com appointment_failed…" (mutation-checked) | PASS |
| `slot_unavailable` excluded (re-offer only) | NEW tester "Confirmar com slot_unavailable recebe só a reoferta…" | PASS |
| Lead locked first | code: `replyToRefusedTap` tx statement 1 = `leads … FOR UPDATE` (TH:518-522) | PASS (read) |
| No select / no booking in helper | code: only `replyToStaleTap` | PASS (read) |
| Step 35 / D-R3-3 text word for word | "reoferta com um único horário novo…" exact equality | PASS |

### Deviation tests (not in plan) — judged acceptable
- `handler-partial-failure` "replay de confirmação não vaza appointment de outro lead": the "intruder" is a different lead (own conversation, session `awaiting_availability`) whose task carries `confirm:<owner slot id>`. The reply is built only from the intruder's own conversation. Tester strengthened it: no owner slot id, session id, name or phone in the payload; buttons exactly `[intruder.slot.id]`; 0 intruder appointments. Nothing actionable on the owner's offer.
- `webhook-whatsapp` expired-session tap: now mocks `sendTextMessage` and asserts exactly "Esse botão é de uma mensagem antiga.\nMe conta o que você precisa agora?" (D-R3-4 a) and no blocked egress. Needed: the old unmocked send hit the egress guard.

### Duplicate `messages.externalId` (23505) — root cause and fix
- Seen in `test:db` run 1: `Key ("externalId")=(wamid.outbound_…) already exists`, logged by `[Outbound] Failed to link WAMID` (caught, test still passed).
- Cause (test code, deterministic, not parallel-only): `webhook-whatsapp.test.ts` "fluxo completo…" fake `sendTextMessage` returned the same fixed `outboundWamid` for both Mariana replies; the second link hit the unique index. Reproduced 3/3 running that test alone.
- Fix (test only): first send keeps `outboundWamid`, later sends get `${outboundWamid}_${randomUUID}`. New assert: 2 assistant rows, all `externalId` non-null and distinct. Red before fix: `[{"externalId":"wamid.outbound_…"},{"externalId":null}]`; green after.
- After the fix: 4 full `test:db` runs, `duplicate key` count 0 in each.

### Mutations (temporary, reverted, `cmp` identical)
- Drop `reason !== "appointment_failed"` → new appointment_failed test red.
- Drop the `status !== "active"` check → closed-conversation test red.

### Suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit` 363/357/0/6 todo. `tsc --noEmit` 0. `build` ok. Biome on 4 changed src/test files clean. `git diff --check` clean.
- `test:db` 673/666/0/7 todo, 4 runs (2 after the last test edit).

### Scope
- Diff = plan files (TH, the 2 listed test files, CODEMAP notes, plan/progress) + the 2 judged test deviations. No `drizzle/`, `.claude/`, `.env` change.

### Risks not covered
- Exit 3 (`session_changed_before_confirmation`) has no test; step 36 lock-order test is planned to cover it.
- Double-tap Confirmar with 2 different wamids after a successful booking: the second tap now gets "Esse botão é de uma mensagem antiga. Me conta…" right after "Agendamento confirmado". Correct per R-SCH-03, but odd UX; owner decision.
- Opted-out lead: a stale-tap outbox row is still written; only the send-time compliance guard blocks it.
- Other fake senders use `Date.now()`-only ids (`phase3-scheduling-workflow.test.ts:173,179,390,396`; `webhook-whatsapp.test.ts:474,1409,1579,1896`): two sends in the same ms could collide again. Not observed in 4 runs.

### Manual WhatsApp checklist (owner)
1. Ask to schedule; get 3 slots; tap slot 2; get Confirmar/Não. Have the consultant's calendar take slot 2; tap Confirmar → "Esse horário acabou de ficar indisponível. Tenho estes outros horários:" + new buttons (or, with one free slot, "Esse horário acabou de ficar indisponível. Tenho outro horário: <data hora> com <consultor>. Posso confirmar?" + Confirmar/Não).
2. Now tap the old slot 1 button → "Esse botão é de uma mensagem antiga." + the current buttons. No booking.
3. Tap the old "Não" → same notice + current buttons; the current offer stays.
4. Wait for the session to expire (or > 4h), tap any old slot → "Esse botão é de uma mensagem antiga.\nMe conta o que você precisa agora?" (one message only).
5. Send "parar", then tap an old button → no reply at all.

## V3-b (steps 36–38) — tester verification (2026-10-27)

**Verdict: FAIL** — 1 failure, planner cause (design gap; pre-existing, not a regression). Steps 36–38 as planned: all criteria PASS. Approval: plan.md:1 `APPROVED by Davi` (Rev3).

### Criteria
| Criterion | Test(s) | Result |
|---|---|---|
| 36: confirmation-request tx lead first (F-T27-1) | `lock-order.test.ts` "pedido de confirmação (toque no horário) e rotação…" | PASS; mutation (lock removed) → `['40P01']` |
| 36: `persistOffer` lead first, re-entrant | `lock-order.test.ts` "oferta (persistOffer) e rotação…"; re-offer suite (`scheduling-without-consultant-choice`) | PASS; mutation → `['40P01']` |
| 36: lock-order file stable | 5 runs | 5/5, 5 pass each |
| 37: AI-turn offer not persisted on closed A | adversarial "rotação durante a busca de horários…" | PASS; mutation (flag dropped) → `no active session in A` red |
| 37: AI-turn reply not enqueued on closed A | adversarial "rotação durante a busca, sem horários…" | PASS; mutation (re-check removed) → `no outbox from A` red |
| 37: flag only on AI-turn path | grep `requireActiveConversation`: only `generateMarianaResponse.ts:966`; re-offer caller `TH:464` off | PASS |
| 37/S-23: every send of the inbound handler re-checks | tester `todo` "tester V3-b: rotação durante a chamada ao Gemini que falha…" | **FAIL** (F-V3b-1) |
| 38: `superseded` for rotation-cancelled turn (R-REL-07) | adversarial "turno em andamento em A…" | PASS; mutation → `['turn_error']` |
| 38: `superseded` also on the `persistOffer` throw | tester extension of "rotação durante a busca de horários…" | PASS (`['superseded']`) |
| 38: real errors stay `turn_error` / `model_error` | `generate-mariana-response.test.ts:1035, :1137` | PASS |
| 38: R-SCH-07 → R-SCH-08 comments | `grep -rn "R-SCH-07" src` → 0 hits; R-SCH-08 at TH:372, TH:383, orchestrator:191, test:808 | PASS |
| Invariants: lead-first in every tx writing sessions/appointments/conversations | review: TH:327, 428, 540, 813, 975; offer-service:227; webhook:371, 502 (`resolveConversationForInbound`); generate:729; appointment-service:280; create-conversations:47 (`getOrCreateActiveConversation` locks lead) | PASS (all lead FOR UPDATE first) |

### Failure F-V3b-1 — model-failure notice sent from closed A (planner)
- Command: `npx tsx --import ./src/tests/support/db-test-preload.ts --test --test-name-pattern="tester V3-b" src/tests/reliability/session-rotation-adversarial.test.ts`
- Output: `AssertionError: no outbox from A` — `actual: [ { id: '95cc…' } ], expected: []`.
- Expected (S-23 v1.4, R-V1b-1): a response of A still being prepared when B opens is not sent. Actual: rotation commits during the Gemini call, Gemini fails (`ModelUnavailableError`), `sendModelFailureNotice` (`TH:129-170`) inserts an assistant row and enqueues `MODEL_FAILURE_NOTICE` into closed A with no lead lock and no status re-check. Customer gets the failure notice plus B's answer.
- Cause: step 37 scoped only `TH:324-341`. Not "after commit" (the turn never commits), so not an implementer bug. Fix: same lead-locked tx + status re-check around the notice insert + enqueue. Pinned as `todo`.

### Implementer deviations judged
- `holdTransaction.locked` + `finally { release; await done }`: removes the race that hung test:db (other side starts only after T0 holds the lock; waitForLockWait timeout now releases T0). Residual: if `lock(tx)` itself throws, `await t0.locked` never resolves (hang). Low risk (fresh lead). Suggest `await Promise.race([t0.locked, t0.done])`.
- `biome-ignore noBarrelFile` re-export: the plan asked for it, but the only importer is `autonomous-task-handlers.ts:40`; no test imports it. A direct import from `./turn-superseded-error` there removes the re-export and the ignore. Cleaner; non-blocking.
- Nit: `failureOutcome` was inserted between `emitFailureTrace`'s JSDoc and the function (`generateMarianaResponse.ts:~345-362`), so that JSDoc now documents `failureOutcome`.

### New tests (tester)
- `session-rotation-adversarial.test.ts` step-37 loop: trace capture; asserts `['superseded']` (with slots) and `['replied']` (no slots) for A's turn.
- `session-rotation-adversarial.test.ts` `todo` "tester V3-b: rotação durante a chamada ao Gemini que falha: o aviso de falha de A não é enviado" (F-V3b-1).

### Suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit` 363/357/0/6 todo. `tsc` 0. `build` ok. Biome on 12 changed src/test files clean. `git diff --check` clean.
- `test:db` run 1: 677/670/0/7 todo; run 2: 677/670/0/7 (before tester additions). Adversarial file after additions: 13/12/0/1 todo.
- Mutations restored; sha256 of the 3 product files verified identical to pre-mutation copies.

### Scope
- V3-b src diff = plan files (turn-trace, offer service, orchestrator comment, TH, generateMarianaResponse, new turn-superseded-error) + planned tests. Other modified tests (`handler-partial-failure`, `webhook-whatsapp`, `session-rotation`) are V3-a, already judged. No `drizzle/`, `.claude/`, `.env`.

### Risks not covered
- "Sem horários" variant: the trace says `replied` though nothing is sent (the handler skips after the turn trace). R-REL-07 does not define outcomes; misleading in metrics. Planner decision.
- Orphan assistant row in closed A ("Vou consultar os horários." / no-slots text): accepted by plan (Rev3 out of scope), never sent.
- No trace consumer in `src/` or `scripts/` parses `outcome`; only tests. External log dashboards (if any) must accept `superseded`.

### Manual WhatsApp checklist (owner, staging)
1. Qualified lead, last message > 4h ago, pending inbound in A asking to schedule. While the bot is checking the calendar, send "oi de novo" → exactly one reply (fresh start, B); no slot list from the old conversation.
2. Same, but no free slots → one reply only ("oi de novo" answered in B); never "No momento, não encontrei horários…" from A.
3. Tap a slot in a live offer while a second message rotates the session (hard to time manually; covered by lock tests) → either Confirmar/Não or "Esse botão é de uma mensagem antiga." + current buttons, never both, never silence.

## Steps 40–41 (Batch V3-b' + V3-b'') — tester verification (2026-10-27)

**Verdict: PASS** (0 failures). Approval: plan.md:1 `APPROVED by Davi` (Rev3.1; D-R3-5 a, D-R3-6 a). Diff scope matches Rev3.1 steps 40–41 (TH, GMR, lock-order hygiene, model-failure, adversarial) plus CODEMAP/plan/progress. Nothing outside the plan.

### Criteria
| Criterion | Test(s) (`session-rotation-adversarial.test.ts` unless noted) | Result |
|---|---|---|
| S-23/R-V1b-1: model-failure notice not sent from closed A (turn-level) | "tester V3-b: rotação durante a chamada ao Gemini que falha…" (todo removed) | PASS; mutation M6 → red `model_error` |
| Same, handler guard alone (`sendModelFailureNotice` lock + re-read) | NEW "tester V3-b': rotação real enquanto o aviso de falha espera o lead…" | PASS; mutation M4 → red (only this test catches M4) |
| R-REL-07/D-R3-5: `superseded` on no-slots + model failure after rotation | step-37 loop "sem horários" (`['superseded']`); V3-b Gemini test | PASS; M5 → red `replied`, M6 → red `model_error` |
| `replied` still emitted on the real handler path (active A) | NEW "tester V3-b': turno em A ativa sem rotação: rastro `replied`…" | PASS |
| S-17: exactly 1 notice + `model_error` in active conversation | `model-failure.test.ts` "falha do modelo enfileira o aviso…" | PASS |
| Re-offer not sent from closed A | "Confirmar de A com o horário ocupado…" | PASS; M3 → red |
| cancel/choice replies re-check under lead lock | "Não (cancel:) … logo depois do cancelamento" ×2; "toque de horário de A…" | PASS; M2 → red (3 tests) |
| cancel after rotation (session already expired) | "Não (cancel:) … rotação antes da task" ×2 | PASS (regression only; green before) |
| Legacy pref:* tap re-reads status after the lock | "toque pref:* legado … entre a leitura e o lock"; NEW "tester V3-b'': … rotação real roda…" | PASS; M1 → red (both) |
| D-R3-6: booking committed before rotation still notifies | "D-R3-6: agendamento confirmado antes da rotação…" | PASS (1 outbox, 1 appointment) |
| Button success paths unaffected | NEW "tester V3-b'': botão em A ativa sem rotação (choice/cancel)…"; full button suites | PASS |

Mutations were temporary edits of TH/GMR, restored from backup; `sha1sum -c` OK afterwards.

### Send-path sweep (`grep enqueueOutboundMessage|replyToStaleTap` in `src/`, tests excluded)
| Call site | Guard | Class |
|---|---|---|
| TH:170 model-failure notice | lead FOR UPDATE + status re-read, same tx | guarded |
| TH:374 AI reply | lead FOR UPDATE + status re-read (step 37) | guarded |
| TH:579 re-offer | `lockLeadAndCheckActive` | guarded |
| TH:631 `replyToRefusedTap` → `replyToStaleTap` | lead + status (step 34) | guarded |
| TH:708 "Agendamento confirmado …" | none | exempt (D-R3-6 a) |
| TH:764, :778 cancel replies; TH:816 choice reply | `enqueueIfConversationActive` | guarded |
| TH:888 legacy tap → `replyToStaleTap` | `lockLeadAndCheckActive` inside tx | guarded |
| TH:1074 confirmation request | `lockLeadAndCheckActive` + session `status = active` | guarded (M7 removal: suite green; redundant by design) |
| webhook-whatsapp.ts:417, :459 | same tx as `resolveConversationForInbound` (lead lock) | guarded |
| `receive-customer-message.ts` (HTTP) | no enqueue; D-R3-2 a | listed |
No unguarded path after a rotation other than D-R3-6.

### Deviations (judgement)
1. Rotate right after the service call + backdate A's `lastCustomerMessageAt` 4h: **acceptable.** The tap writes `now` without the lead lock, so a real webhook that read the old value under the lead lock before that write still rotates; backdating reproduces exactly that interleaving. The window is narrow but real.
2. Re-offer rotation after `getAvailableSlots`: **acceptable.** Rotating earlier resets the lead to `new`, the search refuses and nothing is sent; the only send-capable window is between the search and the re-offer tx, which is what the test hits.
3. Legacy tap with hand-written rotation writes: **lock mechanics are identical** (both take `leads` FOR UPDATE first; the tap's status read is a new READ COMMITTED statement after the lock). Real code cannot race. Confirmed with a REAL-rotation version (NEW test: T0 holds the lead, tap blocks, T0 runs `resolveConversationForInbound` and commits) → green, and red under M1. Findings while building it: (a) the real rotation completes A's *pending* tasks (`supersededBy: session_rotation`), so the gap only exists for an already-claimed (`processing`) task; (b) a webhook-ordered variant is not deterministic because lead ingestion and the rotation are two transactions, so the tap can legitimately win between them (A still active → a correct reply). Implementer's statement confirmed.

### Suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit` 363/357/0 fail/6 todo; `tsc --noEmit` 0; `build` 0; biome clean on 5 changed code/test files; `git diff --check` clean.
- `test:db` run 1: 691/684/0/7 todo; run 2: 691/684/0/7 (686 + 5 new).
- lock-order + adversarial ×5: 31/31 pass each run.

### New tests (tester)
- `session-rotation-adversarial.test.ts`: "tester V3-b'': toque pref:* legado … rotação real roda…"; "tester V3-b': rotação real enquanto o aviso de falha espera o lead…"; "tester V3-b': turno em A ativa sem rotação: rastro `replied`…"; "tester V3-b'': botão em A ativa sem rotação (choice|cancel)…".
- Process note: while I was editing, my splice script deleted the implementer's step-41 block. I restored it verbatim from the captured diff before running anything; biome reported no formatting change and 21 of 21 original tests passed.

### Risks not covered
- GMR catch: if `isConversationActive` throws (DB down), the original `ModelUnavailableError` is replaced by the DB error and the failure trace is not emitted. The comment "Relança sem tocar" is now inaccurate. Low; implementer to consider.
- Millisecond window between GMR's plain status read and the handler's lock: the trace says `replied`/`model_error` but nothing is sent (proven by the new notice-guard test). Accepted by the plan.
- `handleProcessButtonReply` writes `lastCustomerMessageAt = now` to A even when A is closed (pre-existing; not a send).
- Outbox rows queued in A before the rotation are still dispatched (by design).

### Manual WhatsApp checklist (owner)
1. Active chat, Gemini down (or invalid key in staging): send "oi" → exactly 1 model-failure notice (`MODEL_FAILURE_NOTICE`).
2. Get an offer, tap a time → "Confirmar | Não". Tap "Não" → exactly 1 "Tudo bem. Tenho estes horários disponíveis:" (2+ slots) or "Tudo bem. Esse horário não foi confirmado…" (1 slot).
3. Tap a time, then "Confirmar" → exactly 1 "Agendamento confirmado para <data> com <consultor>.".
4. Rotation cases (from a closed conversation after ≥ 4h): send "oi de novo" → only B's greeting; an old button tapped afterwards → only the S-20 rotation notice in B, never a reply from A.

---

## V3-c (step 39, F-T26-2) + step-40 catch fix — tester, 2026-10-27

**Verdict: PASS** (0 failures). Plan: `Status: APPROVED by Davi` (Rev 3.1). Diff for this batch is limited to the files of steps 39/40 (`session-rotation.ts`, `webhook-whatsapp.ts`, `generateMarianaResponse.ts`, `redelivery-adversarial.test.ts`, `model-failure.test.ts`). No unapproved change. Doc files modified in the tree (CLAUDE.md, specs, ROADMAP, CODEMAP) belong to the parallel docs agent and were not reviewed here.

| Criterion / attack | Test(s) | Result |
|---|---|---|
| Old tap redelivered after B opened: B untouched, event `processed`, no reply (R-REL-02, R-SES-01) | `redelivery-adversarial` "tester R2: toque reentregue depois que B abriu…" (todo removed) | PASS; red when `tapExternalId` is not passed |
| Same, lookup via outbox `stale-tap:<id>` (sessao: tap answered in A) | new "toque `sessao:` respondido em A (stale-tap) e reentregue…" | PASS; red under mutation |
| NEW tap with an id close to an old one (`<id>2`, upper case, trailing space) is never ignored | new "toque NOVO com id parecido…" | PASS (exact-match keys; each routed to B, answered once) |
| Key of ANOTHER lead never hijacks the tap | new "chave `button-reply:<id>` de OUTRO lead…" | PASS; red when the `conversations.leadId` filter is removed from the task lookup |
| Tap redelivered into ACTIVE A: one task, one reply; forced redelivery after completion: no second reply | new "toque reentregue em A ATIVA continua idempotente…" | PASS |
| Tap after 4h with no prior row: E1 once in B; forced redelivery: no second E1, no task (lookup via `session-rotation-tap:<id>`) | new "toque após 4h sem resposta anterior recebe E1 uma vez…" | PASS |
| Concurrent: old tap redelivery + new tap in B (×3) | new "reentrega do toque antigo concorrente com toque novo em B (run 1–3)" | PASS; red under mutation |
| Step-40 catch: DB down on status re-read keeps `ModelUnavailableError`, trace `model_error` | `model-failure` "passo 40 (R-REL-07): banco fora na releitura…" | PASS; red (`actual: Error: db down`) with `.catch(() => true)` removed, reverted (cmp identical) |
| 0 `todo` left for F-T26-2 / F-T32-1 | `grep -rn "todo:" src/tests` | none |

Mutations (temporary, restored from backup, `cmp` identical):
1. `webhook-whatsapp.ts`: drop `tapExternalId: externalId` → 6 fail (R2 test, sessao-stale-tap, concurrent ×3, probe).
2. `session-rotation.ts`: drop `eq(conversations.leadId, leadId)` in the task lookup → cross-lead test fails.
3. `generateMarianaResponse.ts`: drop `.catch(() => true)` → step-40 test fails `Error: db down`.

Full suites (host=localhost db=mariana_test, `RELIABILITY_WORKERS_ENABLED=false`, `DOTENV_CONFIG_PATH=/dev/null`):
- `test:unit` 363 / 357 pass / 0 fail / 6 todo. `tsc` 0. `build` OK. biome clean on 6 files. `git diff --check` clean.
- `test:db` run 1: 701 / 695 pass / 0 fail / 6 todo; run 2: identical.

New tests: `src/tests/reliability/tap-redelivery-adversarial.test.ts` (9 tests).

Risks not covered / observations (non-blocking):
- **R-V3c-1 (behavior change, probe test).** A tap whose task in A is `failed` while A is still active, redelivered ≥ 4h later: before step 39 it rotated and got E1 in B; now it stays in A, `enqueueTask` upsert resets the failed task to `pending`, it runs and answers once in A ("Esse botão é de uma mensagem antiga…"), and A's `lastCustomerMessageAt` is bumped to now, so the next real text within 4h does not rotate. Consistent with the text redelivery path (also bumps on an active conversation; "decided once"). Planner to confirm this is intended; pinned by the probe test (`at most one reply`, no E1, no rotation).
- The lookup is two extra indexed selects per tap (idempotency keys are unique); not load-tested.
- Meta wamids are globally unique, so a genuine id collision is not reachable through the webhook (the event claim dedups by `externalId` first); the cross-lead test exercises the function directly.

Manual WhatsApp checklist (staging, owner):
1. Tap an old "Confirmar" button from a conversation closed > 4h ago, after you already wrote "oi" and got the new greeting → expected: no reply; the new conversation keeps its state.
2. In an active conversation, tap a button twice quickly → expected: one reply only.
3. After 4h of silence, tap an old button → expected: one reply, the E1 text ("…" per `SESSION_ROTATION_TAP_REPLY_TEXT`), and a new conversation; tapping it again → no second E1.

## Final verification (step 25) — tester, 2026-10-27

**Verdict: PASS** (0 failures). Plan `Status: APPROVED by Davi` (Rev 3.1, plan.md:1). Code diff = Rev3.1 steps 39–41 + step-40 fix (already verified in "Steps 40–41" and "V3-c"); docs diff = step 24. No unapproved change. 0 `todo` left for F-V1b-1, F-T32-1, F-T26-2, F-V3b-1 (`grep todo` in `src/tests/reliability` and `scheduling-without-consultant-choice.test.ts`: none). Four doc differences (D-1 to D-4), all low and doc-only. Nothing for the implementer to fix.

### Suites (host=localhost:5432 db=mariana_test, `RELIABILITY_WORKERS_ENABLED=false`, `DOTENV_CONFIG_PATH=/dev/null`)
| Command | Result |
|---|---|
| `npm run test:unit` | 363 tests / 357 pass / 0 fail / 6 todo |
| `npm run test:db` run 1 | 701 / 695 pass / 0 fail / 6 todo |
| `npm run test:db` run 2 | 701 / 695 pass / 0 fail / 6 todo |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | OK (`dist/server.js` 1.43 MB) |
| biome on 4 changed src files + `src/tests/reliability/*.test.ts` | 17 files, clean |
| `git diff --check` | clean |
- The 6 todo are the known guard holes E-9, E-9b, E-11b, E-12c, E-12d and E-15. None of them is from this task.
- Note: run 2 of `redelivery-adversarial` "reentrega tardia e mensagem nova concorrentes" printed `conversations=1 replies=2` once (the late redelivery won the lead lock before the 4h text, so both messages landed in A). It passed. This is the allowed interleaving that `:508` describes. It is not a failure, but the outcome depends on timing.

### Step 24 — docs vs approved wording
| File | Result |
|---|---|
| `CLAUDE.md` | Only the Invariants lines differ. The pending-choice line is removed. The E8-a and D-R2-4 lines are verbatim from plan:449. |
| `MARIANA_BEHAVIOR_SPEC.md` | Header, R-SCH-01, R-SCH-03, R-SCH-08 (+ D-R3-3 sentence), R-SES-02 (+ D-R3-1 ending), R-SES-03, S-07, S-08 (+ D-R3-4 note), S-22 (D-R3-1), S-23, S-24 and S-25 are verbatim. R-SCH-07 appears once and R-SCH-08 once as a row. "Mudanças da v1.4" has the same content as the approved text, written as bullets (the v1.3 style). |
| `CODEMAP.md` | Has "redelivery keeps its conversation", the stale-turn guard (`expectedConversationId`), "lock order: `leads` first", "refused tap → stale-tap reply" and the `superseded` trace. Line counts are updated. Paraphrased but complete. |
| scheduling-flow spec | D6, AC11 and AC12 are rewritten. See D-3. |
| `ROADMAP` | D-10 is verbatim. The WP-4 text is verbatim from plan:374. See D-4. |

Judgements:
- **(a) R-SES-02 drops "mesmo que o reenvio chegue 4h ou mais depois": accepted, and it follows the approved text.** The approved Rev3 step 24 (plan:727) gives the new sentence ending from "… e é respondida uma única vez ali". The clause sat inside that replaced part, so the approved text removes it. The meaning is kept. "o reenvio não abre conversa nova" has no time condition, so it also covers the ≥ 4h case. S-22 still says "4h ou mais depois" explicitly. Optional clarity edit (needs Davi): "…; o reenvio não abre conversa nova, mesmo 4h ou mais depois."
- **(b) D6, AC11 and AC12 worded from R-SES-02: accepted.** The plan gave only the intent ("automatic new conversation"). The new text matches R-SES-02 v1.4 and the code. D6 has no line on redelivery or late taps. That is acceptable, because the behavior spec is the authority.
- **D-3 (c) Doc drift (planner/Davi).** The scheduling-flow spec still describes the old consultant-preference flow in the parts that prescribe behavior:
  - D3 at `:63-72` lists the steps "consultant preference question → consultant buttons → slots";
  - `:72` keeps "awaiting_consultant_preference";
  - `:80` describes the "tap while awaiting preference" special case;
  - AC3 at `:112` expects "ONE outbound … (the preference question)";
  - AC4 at `:113` expects the "with preference" path;
  - AC5 at `:114` covers a tap while awaiting preference.

  These lines contradict R-SCH-01 v1.4 and the code (steps 30–33). Lines `:21`, `:45` and `:49` are only a production transcript and root-cause history, so they can stay. Fix: mark D3 and AC3–AC5 as superseded by R-SCH-01 v1.4. This needs approved wording.
- **D-4 (d) ROADMAP is incomplete compared with the "Rev1 — Roadmap impact" note (plan:373-377).** Three bullets are missing:
  - "WP-5 gains N-1 (E7)" (N-1 is done in step 21);
  - "Package F fechar conversas paradas no longer needed for correctness";
  - "Package G unique index still wanted".

  The step 24 text named only `:29` and gave no exact wording for these bullets, so this is a planner gap, not an implementer error. Also, D-10 still cites "(R-SCH-01, v1.1)", and the rule it describes is now v1.4. This is low.
- Known spec vs code gap, not new: R-SCH-03 says "Todo toque é gravado como mensagem do cliente", but taps are still not stored as messages (F-V1c-4, package B).

### AC → test
| Criterion | Test (file:line) | Result |
|---|---|---|
| R-SES-01 | `reliability/active-conversation.test.ts:59`; `session-rotation-adversarial.test.ts:472` | PASS |
| R-SES-02 | `session-rotation.test.ts:288`; `session-rotation-adversarial.test.ts:235` (4h boundary), `:546` (redelivery) | PASS |
| R-SES-03 | `session-rotation.test.ts:1571` (B prompt has no A history), `:520` (reset) | PASS for the backend. Whether the model avoids "pista" wording: GAP (needs the simulator, not run) |
| R-SES-04 | `session-rotation.test.ts:663`, `:725`; `session-rotation-adversarial.test.ts:428` | PASS |
| R-SCH-01 | `scheduling-without-consultant-choice.test.ts:428`, `:488` | PASS |
| R-SCH-03 | `scheduling-without-consultant-choice.test.ts:1203`, `:1234`, `:1289`; `session-rotation.test.ts:2157` | PASS. "toque gravado como mensagem": GAP (package B) |
| R-SCH-08 | `scheduling-without-consultant-choice.test.ts:859`, `:1023` (exact single-slot text) | PASS |
| S-07 | `session-rotation.test.ts:1285`, `:2248`; `scheduling-without-consultant-choice.test.ts:1203` | PASS |
| S-08 | `routes/webhook-whatsapp.test.ts:1160` (D-R3-4 interim text) | PASS for the interim. "nova oferta": GAP (D-R3-4, package B) |
| S-17 | `reliability/model-failure-acceptance.test.ts:153`; `reliability/model-failure.test.ts:121` | PASS |
| S-18 | `session-rotation.test.ts:288` | PASS |
| S-19 | `session-rotation.test.ts:663` (a), `:725` (b) | PASS |
| S-20 | `session-rotation.test.ts:1018`, `:1696`, `:1752` | PASS |
| S-21 | `session-rotation.test.ts:337`; `redelivery-adversarial.test.ts:314` | PASS |
| S-22 | `session-rotation-adversarial.test.ts:546`; `session-rotation.test.ts:419` (closed: no reply); `redelivery-adversarial.test.ts:508` | PASS |
| S-23 | `session-rotation-adversarial.test.ts:708`, `:830`, `:1067`, `:1341` | PASS |
| S-24 | `scheduling-without-consultant-choice.test.ts:859`, `:930` | PASS |
| S-25 | `session-rotation.test.ts:2131`, `:2193`, `:2248`, `:2309` | PASS |
| K-1 one active conversation | `session-rotation.test.ts:789`; `session-rotation-adversarial.test.ts:472` | PASS |
| K-2 status by meeting date | `session-rotation.test.ts:663`, `:725`, `:853` | PASS |
| K-3 no inherited state | `session-rotation.test.ts:520`, `:1571` | PASS |
| K-4 crossing message answered once in B | `session-rotation.test.ts:288` | PASS |
| K-5 redelivery idempotent | `session-rotation.test.ts:377` | PASS |
| K-6 two messages → one B | `session-rotation.test.ts:337`, `:789` | PASS |
| K-7 opt-out kept | `session-rotation.test.ts:646`, `:1807` | PASS |
| K-8 A kept, snapshot | `session-rotation.test.ts:520` (asserts at `:611`) | PASS |
| Inv. one active conversation | `reliability/active-conversation.test.ts:59` | PASS |
| Inv. duplicate never processed twice | `routes/webhook-whatsapp.test.ts:466`; `session-rotation.test.ts:1649` | PASS |
| Inv. accepted outbound never back to `pending` | `reliability/outbound-persistence-failure.test.ts:128` | PASS |
| Inv. `unknown` never resent | `reliability/outbound-messages.test.ts:234`, `:360` | PASS |
| Inv. AI not the authority | `scheduling-without-consultant-choice.test.ts:748`; `services/generate-mariana-response-authorization.test.ts:18` | PASS |
| Inv. `selectedSlotId` | `scheduling-without-consultant-choice.test.ts:607` | PASS |
| Inv. never inherits commercial state | `session-rotation.test.ts:520` | PASS |
| Inv. new conversation only by the backend, under the lead lock, in the inbound tx | `session-rotation-adversarial.test.ts:286` (rollback), `session-rotation.test.ts:789` | PASS |
| Inv. lead first | `reliability/lock-order.test.ts:294`, `:357`, `:526`, `:653` | PASS |
| Inv. pending consultant offer (inactive in prod) | `execute-next-action.test.ts:300`, `:313`; `services/pending-offer.test.ts:50` | PASS |

### Red → green evidence (progress.md, test-report.md)
- Recorded red then green: steps 20, 21, 22, 23, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, plus the step-40 fix. See progress.md "Step NN". Steps 36 and 41 (pref:*) proved red by temporarily restoring the old code.
- Green before and after, by design (regressions the plan allows):
  - step 21 future-appointment;
  - step 34 "toque recusado numa conversa já fechada";
  - step 40 S-17 regression;
  - step 41 "Não (cancel:) … rotação antes da task" ×2 and D-R3-6.
- Step 38: the R-SCH-08 renumbering is comment-only, so it has no test. The `superseded` part has a red result (`['turn_error']`).
- No step in 20–23 or 26–41 lacks evidence. GAP-2 (no red run for the old session-choice steps 8–12) is pre-Rev1, and that code is deleted, so the gap is obsolete.

### Manual WhatsApp checklist (staging, Calendar test accounts, owner)
Fixed texts are verbatim from the code. `<x>` = value shown in staging.
1. **S-17.** Set an invalid Gemini model in staging, then send "oi". Expected: exactly one "Desculpe, tive uma falha técnica aqui e não consegui processar sua mensagem agora. Pode me enviar de novo em alguns instantes?". A `model_error` line appears in the log.
2. **S-18.** In qualification, wait ≥ 4h, then send "é para carro". Expected: one normal reply that starts from zero, with no "continuar" question.
3. **S-19.** (a) A lead with a past meeting waits ≥ 4h and sends "oi". Expected: a fresh greeting, with no "já está agendado". (b) A lead with a future meeting does the same. Expected: a new conversation; "quando é a reunião?" returns the date, time and consultant.
4. **S-20.** Wait ≥ 4h, then tap a slot button of an old offer. Expected: one reply, "Oi! Já faz um tempo desde a nossa última conversa, então aqueles horários não valem mais. Me conta o que você procura agora?". No meeting is created. Tap a second old button: you get the stale-tap notice + "Me conta o que você precisa agora?", and still no meeting.
5. **S-21.** Wait ≥ 4h, then send "oi" and "quero um carro" less than 8 s apart. Expected: one reply that considers both messages.
6. **S-22.** Not reproducible by hand (it needs a Meta redelivery). Rely on the DB tests.
7. **S-23.** Not reproducible by hand (it needs a race). Rely on the DB tests.
8. **S-24.**
   - Accept an offer and tap a slot. In Calendar, block that consultant at that time, then tap Confirmar.
   - Expected with ≥ 2 free slots: "Esse horário acabou de ficar indisponível. Tenho estes outros horários:" + new buttons.
   - Expected with exactly 1 free slot: "Esse horário acabou de ficar indisponível. Tenho outro horário: <data hora> com <consultor>. Posso confirmar?" [Confirmar | Não].
   - No meeting is created with another consultant.
9. **S-25.** Not reproducible on new offers (only legacy sessions exist at deploy). If any exist, tap the old "Tenho preferência"/"Sem preferência" button. Expected: "Esse botão é de uma mensagem antiga." + "Estes são os horários que tenho para você:" + slot buttons.
10. **S-07 (old slot tap).** After a re-offer, tap a slot button from the first offer. Expected: the notice + the current buttons. Nothing is booked.
11. **Old "Não".** Tap "Não" on a replaced offer. Expected: the notice + the current buttons, not "Tudo bem…".
12. **S-08 interim.** Let the session expire (< 4h), then tap a slot button. Expected: "Esse botão é de uma mensagem antiga.\nMe conta o que você precisa agora?".
13. **D-R3-6.** Tap Confirmar on a free slot. Expected: one "Agendamento confirmado para <data hora> com <consultor>.".
14. **Duplicate tap.** Tap the same button twice quickly. Expected: one reply.

### Open items (consolidated)
| Item | Status | Owner |
|---|---|---|
| F2-05 / Q1: API auth; `POST /conversations/:id/messages` has no `expectedConversationId` (D-R3-2) | open, needs a security spec | Davi/planner |
| Q4 / F2-08: audio, image and document; media after 4h must rotate too | open | Davi |
| Package B: S-08 "nova oferta" (D-R3-4); `appointment_failed` silent (F-03, R-REL-05); taps not stored as messages (F-V1c-4); E1 wording for `sessao:` taps | open | planner |
| Package C2: prompt, WP-7/8/11 | open | planner |
| Package D: WP-5 (dates in the prompt, leaving `scheduled`); ROADMAP missing N-1 and the F/G notes (D-4) | open | planner |
| Package E: 8 s debounce, WP-12 | open | planner |
| E-9, E-9b, E-11b, E-12b, E-12c, E-12d, E-15: test-guard holes (todo or listed) | open, listed | planner/Davi |
| GAP-2: no red run for the old steps 8–12 | obsolete (code removed) | — |
| AC15 (session-choice step 13) | obsolete (no choice any more); close it | planner |
| R-V3c-1: a tap with a `failed` task in active A, redelivered after ≥ 4h, answers in A and bumps `lastCustomerMessageAt` | planner to confirm it is intended | planner |
| Flaky tests: `generate-mariana-response.test.ts:936` and `turn-trace-integration.test.ts:288` (UUID digits); `autonomous-task-executor.test.ts:275` (timing). They did not fire in these runs. | open | implementer |
| E3-a deploy precondition: Davi runs the 2 read-only Neon SELECTs (plan:361-362), and both must return 0. Keep the no-op drain for one release. | open, blocks deploy | Davi |
| "Agendamento confirmado" exemption (D-R3-6 a): still sent after a rotation, by decision | accepted, documented | — |
| D-3: scheduling-flow spec D3 and AC3–AC5 describe the old flow | open, doc drift | planner/Davi |
| Orphan assistant row in closed A (steps 28, 37); A batch messages keep `processedAt = null` | accepted residual | — |
| Constant ids in Calendar fakes (test hygiene) | only if a flake appears | implementer |
| F2-19 (trace for deterministic replies), migrations/baseline, Q2, Q3, Q5 | open (outside this task) | Davi/planner |

### Risks not covered by tests
- The model wording for R-SES-03 "nem como pista" (no simulator run).
- The real WhatsApp and Calendar behavior (checklist above).
- Lock tests depend on timing. They passed in both runs, but a slow CI could expose waits.
- The `redelivery-adversarial:346` outcome depends on the interleaving (see the note under Suites).
