# Progress — 2026-10-26-flow-review

## Step 2 (R1-a) — Gate test + 4h regression test (K2, F2-23, F2-25)
- Approval: plan.md:1 `Status: APPROVED by Davi`. Q1–Q5 open; step 2 does not depend on them.
- Gate test (`src/tests/reliability/session-choice-gate.test.ts:697`): green on local DB (localhost:5432/mariana_test) → `tests 1, pass 1, fail 0`. Its assertions already match plan step 10 (1 reminder outbound with `sessao:continuar`/`sessao:nova` buttons, `workflowStage` unchanged, 0 appointments). No change made.
- Files: `src/tests/session-inactivity-regression.test.ts` (title 24h → 4h; asserts 4h → true, 4h − 1 ms → false, null → false); `package.json:21` (file added to `test:unit` after `session-choice-policy.test.ts`).
- Red: temporary mutation `SESSION_INACTIVITY_MS = 24h` → `AssertionError ... actual: false, expected: true` at test:12. Mutation reverted (`git diff` on `session-choice-policy.ts` empty).
- Green: `tests 1, pass 1, fail 0`.
- `npm run test:unit`: exit 0, tests 357, pass 351, fail 0, todo 6 (pre-existing todos).
- `npm run test:db` (localhost:5432/mariana_test, workers off): exit 0, tests 613, pass 607, fail 0, todo 6.
- `npx tsc --noEmit`: exit 0. Biome on the 2 changed files: no issues.
- Deviations: none. Production code untouched. CODEMAP unchanged (no file added or moved under `src/`).

## R1-b step 3 — Step 9 acceptance (R-SES-04, S-19) — implementer
- File: `src/tests/reliability/session-choice-new.test.ts` (tests only; helper `runNewConversationChoice`, const `SCHEDULED_TEXT_PATTERN`). No product code changed. Closes GAP-1.
- Added "S-19a: nova conversa com reunião passada começa na saudação e não diz 'já está agendado'" and "S-19b: reunião futura mantém scheduled" (future `scheduled`-status appointment; the existing test at :612 covers `confirmed`).
- Green on arrival (verification tests, as plan foresaw). Mutation proofs (all reverted, `git diff` empty on product file):
  - M1 `autonomous-task-handlers.ts:1726` reset disabled: S-19a red `actual 'scheduled', expected 'new'`; with the status asserts disabled: `stage inesperado: confirmation`; then `/agendad/` matched 'Sua reunião já está agendada, até lá!'.
  - M2 `:1713` only `["confirmed"]`: S-19b red `actual 'new', expected 'scheduled'`.
- Deviation (planner to confirm): plan line 62 reads as `status === "new"` after the held message is processed. The first run failed `actual 'qualifying', expected 'new'`, because a normal turn advances the lead. Spec S-19(a) "começa do zero" and R-SES-04 "volta ao fluxo normal" do not require `new` after a turn. So the test asserts `new` + `qualifiedAt=null` right after Nova, and `status !== "scheduled"` after the turn.
- Stub `generateMarianaReplyFn` follows stage (confirmation ⇒ "agendada" reply), so a regression is visible in text.
- Runs: file 12/12 pass; `test:db` (localhost/mariana_test) 619 tests, 613 pass, 0 fail; `test:unit` 357, 351 pass, 0 fail; `tsc` 0; biome clean.

## Step 5 — Docs (session-choice step 13, Q6) (F2-24) + GAP-3 title
- Files: `docs/specs/ROADMAP-2026-10-22.md:29` (WP-4 = 4h gate done; expire sessions), `docs/specs/2026-10-17-scheduling-and-session-flow.md:93,124,125` (D6/AC11/AC12 = 4h + continue/new choice), `docs/CODEMAP.md:3,28,34,45` (cde444d, ~14.9k lines, 80 test files, 982/1784 lines, "after 4h"), `CLAUDE.md` invariants (+2 lines, Q6 wording from session-choice plan.md:302 / this plan step 5), `src/tests/reliability/session-choice-concurrency.test.ts:519` (title 24h -> 4h only).
- TDD n/a (docs + test title). `git diff --check` clean.
- grep "24h|24 h" in the 4 docs: only `CODEMAP.md:44` "24h window / opt-out" (WhatsApp customer window, intentional). Test file comments `:12,:516` still say 24h (title-only change requested).
- `npm run test:unit`: 357 tests, 351 pass, 0 fail. `npx tsc --noEmit`: ok.
- DB (host=localhost db=mariana_test, workers off): concurrency file 6/6 pass.
- biome on the test file: pre-existing organizeImports error (lines 41-47), not from this change; left as is.
- Deviations: D6 text translated to English from the approved Portuguese and set to 4h. AC15 (session-choice step 13) not added: not in this plan's step 5 list. D6 sub-bullet "objective may be reused as a hint" left as is; it conflicts with the implemented reset (out of scope).

## Step 19 (Batch V1-a) — spec v1.3, docs only
- File: `docs/specs/MARIANA_BEHAVIOR_SPEC.md` — version 1.2 -> 1.3 (2026-10-27) in header; R-SES-02, S-18, S-19, S-20 (E1-a) replaced with the approved "Rev1 — Spec v1.3 wording"; S-21 added after S-20; "Mudanças da v1.3" section appended. Nothing else changed.
- TDD: n/a (docs only). No code, no DB.
- `git diff --check`: clean. `git diff --stat`: 1 file, 10 insertions, 5 deletions.
- `grep -n -i "continuar\|nova conversa"` on the spec: only `:116` (S-18 approved text "Nenhuma pergunta sobre continuar") and `:140` (v1.2 changelog, history). No "Continuar"/"Nova conversa" button wording left in R-SES-02 or S-18–S-20.
- Other rules still mentioning the question: none. R-SCH-03 / S-07 mention "botão de uma oferta antiga" (in-session stale tap, not the session question); not edited.
- Deviations: header suffix changed to "Mudanças da v1.1, da v1.2 e da v1.3 no fim do documento" (part of the version bump). Changelog wording split into two bullets in v1.2 style.

## Step 20 (Batch V1-b) — text rotation in the webhook (K-1 to K-8)
- Approval: plan.md:1 `APPROVED by Davi` (Rev1), E1–E8 + D-1 read.
- Files: new `src/services/conversations/session-rotation.ts` (`resolveConversationForInbound`); `src/routes/whatsapp/webhook-whatsapp.ts` (separate conversation tx + outside `lastCustomerMessageAt` read removed; text branch calls the module first in the insert tx, webhook-event `conversationId` update moved into it; text gate `pending`/`openSessionChoice` removed, so text always ends in `process_inbound_message`; unused `REMIND_SESSION_CHOICE_TASK` import dropped); new `src/tests/reliability/session-rotation.test.ts`; `src/tests/routes/webhook-whatsapp.test.ts:1831` rewritten to "4h exatas inicia conversa nova e processa"; `docs/CODEMAP.md:47`.
- Red (old code): 7/8 fail, e.g. `Expected "actual" to be strictly unequal` (no B) and K-6/K-5 `A and a single B actual: 1, expected: 2`. Old `:1831` on new code: `actual: undefined, expected: 'pending'`.
- Green: rotation file 9/9; `:1658` and new `:1831` pass.
- Extra K-1/K-6 test "segunda transação espera o lock do lead…" (module level, held tx1). Reason: mutation "drop `.for("update")`" left the `Promise.all` webhook test green (the snapshot unique key also serializes), so a deterministic proof was added. Mutation: `second sees B, no second rotation actual: true, expected: false`; reverted (diff on `active-conversation.ts` empty).
- Deviation (design choice, within plan :266): button branch keeps its gate unchanged until step 22, but now reads conversation + `lastCustomerMessageAt` via `getOrCreateActiveConversation(tx)` inside its own tx (the removed outside read fed it). Snapshot row: `taskType = session_rotation_snapshot`, `status = completed`. Lead status rule ported verbatim from TH:1719-1731 (changed in step 21).
- Old gate code (handlers, store, executor filter, button gate) NOT deleted (step 23).

## Step 21 (Batch V1-b) — E7 / N-1
- File: `session-rotation.ts` status rule: no future `confirmed`/`scheduled` appointment and `status !== "new"` → `new` + `qualifiedAt = null`.
- Tests: "lead qualified|qualifying sem reunião futura volta a new na rotação (E7, N-1)" red `actual: 'qualified'|'qualifying', expected: 'new'` → green; "lead com reunião futura continua scheduled na rotação (regressão E7)" green before and after.
- Rotation file: 12/12 pass.

## Batch V1-b — full suites (host=localhost db=mariana_test, workers off)
- `test:unit`: 357 tests, 351 pass, 0 fail, 6 todo. `tsc --noEmit`: ok. `build`: ok. Biome on the 4 changed src/test files: clean.
- `test:db`: 633 tests, 624 pass, 3 fail, 6 todo. Failing (all assert the removed text gate; files deleted/ported in step 23): `session-choice-invalid-replies.test.ts` "S-20: texto livre 'continuar'…", "toque sessao:desconhecido não consome a escolha…" (text after a pending choice now reaches the inbound task; Gemini not mocked there, egress guard blocked it); `session-choice-adversarial.test.ts` "texto livre 'quero começar do zero' não cria B…".
- Intermittent (1 of 2 runs): `session-choice-concurrency.test.ts:325` "mensagem concorrente ao toque nova…" deadlock 40P01: old Nova handler locks conversation then lead; rotation locks lead then conversation. Old Nova path goes in step 23 (E3-a no-op). Must not ship V1-b without V1-c.

## Step 22 (Batch V1-c) — tap after 4h (E1-a, S-20 v1.3)
- Approval: plan.md:1 `APPROVED by Davi` (Rev1); E1–E8, D-1 and the V1-b test-report constraints read.
- Files: `session-rotation.ts` (+ `SESSION_ROTATION_TAP_REPLY_TEXT` = E1 text, `sessionRotationTapReplyKey`); `webhook-whatsapp.ts` button branch now calls `resolveConversationForInbound` (lead lock in the insert tx). If rotated, or if the `session-rotation-tap:<externalId>` outbox already exists (reclaimed redelivery), it does not route the tap: in the same tx it writes one assistant row + one outbox text (F2-16) and marks the event `processed`. The old `openSessionChoice`/`markSupersededTasks`/ask branch is gone (now unreachable).
- Tests (`session-rotation.test.ts`): "toque de horário antigo após 4h abre conversa nova, não agenda e responde uma vez", "toque repetido pelo Meta após 4h responde uma vez", "toque com menos de 4h segue o fluxo de agendamento". Red: 2 fail (`tap after 4h rotates` same id; `A and one B actual: 1, expected: 2`), regression green. Green: 3/3; rotation files 22 pass, 1 todo (F-V1b-1).
- Unit 357/351 pass/0 fail/6 todo; tsc 0; biome clean.
- Deviation: the reclaim-path guard (existing tap-reply key → do not route). Needed for R-REL-02: on a reclaimed redelivery, B has no gap any more, so without it the old tap would be honored.

## Step 23 (Batch V1-c) — remove the session-choice code (E3-a)
- `autonomous-task-handlers.ts`: removed `checkPendingSessionChoiceAndRespond`, its 4 guard calls, `_SCHEDULING_TASK_TYPES`, the ask/remind/process handlers (incl. the Nova handler with the conversation→lead lock, F-V1b-2) and `createInboundTasksForMessages`. Added `handleLegacySessionChoice` (no-op: marks the event processed, no reply), mapped from `LEGACY_SESSION_CHOICE_TASK_TYPES` for one release. Biome dropped the unused imports (this also removes the handlers→webhook `enqueueTask` import).
- `autonomous-task-executor.ts`: pending filter + import removed. `session-choice-policy.ts`: 4h rule only. Deleted `session-choice-store.ts`.
- `webhook-whatsapp.ts`: store import and pending routing removed. A legacy `sessao:*` tap under 4h goes to `process_session_choice` (the no-op), per old step 11 / F2-06 "changed". After 4h it rotates like any tap (E1 reply).
- Deleted tests: `session-choice-{gate,handlers,continue,invalid-replies,adversarial,store,new,isolation,concurrency}.test.ts`. Ported into `session-rotation.test.ts`: the S-20 "continuar" text and `:348` "quero começar do zero" (no rotation, legacy pending row, 1 AI turn with Gemini mocked, 1 reply, no reminder); the scheduling-session expiry + appointment kept; isolation (B prompt has no A history or vehicle state, stage greeting); "três mensagens dentro de 4h"; repeated `externalId`. Step 9 / S-19 / opt-out / snapshot / cancelled-future cases were already covered by the rotation files. `session-choice-policy.test.ts`: text/ID and `hasPreviousCustomerMessage` cases removed. `webhook-whatsapp.test.ts:1658/:1831`: store and constant imports replaced by a literal and a direct row check.
- New tests: unit "createAutonomousTaskHandlers não expõe a escolha de sessão como fluxo ativo" (red: `remind_session_choice maps to the single no-op`); unit "nenhum caminho de sessão trava conversa antes do lead (F-V1b-2)", a static scan where every `.for("update")` in `src/` must be on `leads` (red: `autonomous-task-handlers.ts: FOR UPDATE on conversations`); DB "…pendente antiga não bloqueia toque de horário…" (red `actual: 0, expected: 1`), "toque legado sessao:*… no-op" (red `['process_button_reply']`), "tarefas legadas… drenadas sem resposta" (red: the question and the reminder were sent). All green after the change.
- Tester's `todo` for F-V1b-1 was not touched.

## Batch V1-c — full suites (host=localhost db=mariana_test, workers off)
- `test:unit`: 357 tests, 351 pass, 0 fail, 6 todo. `tsc --noEmit`: 0. `build`: ok. Biome on the changed files: clean. `git diff --check`: clean.
- `test:db` run 1: 606 tests, 599 pass, 0 fail, 7 todo. Run 2: 606 tests, 599 pass, 0 fail, 7 todo. No blocked egress (0 `generativelanguage`/`graph.facebook` hits). The 3 known flaky tests did not fail.
- `docs/CODEMAP.md`: store row removed; policy row = 4h rule; rotation row covers taps, the E1 key and the legacy no-op.

## Step 26 (Batch V2-a) — redelivery stays in its conversation (F-V1b-1, D-R2-1 a)
- Approval: plan.md:1 `APPROVED by Davi` (Rev2 + 2.1), D-R2-1..7 read.
- Files: `session-rotation.ts` (`externalId?` param; after the lead lock, look up a `role = user` message with that `externalId` for this lead; found → return its conversation, `redelivery: true`, no rotation); `webhook-whatsapp.ts` text branch (passes `externalId`; redelivery into a closed conversation marks the event `processed` in the same tx and returns).
- Tests: `session-rotation-adversarial.test.ts` "reentrega ≥ 4h…" `todo` removed, asserts added (1 conversation A active, no snapshot, 1 reply, reply in A, event `processed`). Red: `no new conversation 2 !== 1`. New `session-rotation.test.ts` "reentrega de mensagem já gravada numa conversa fechada…". Red: `B lastCustomerMessageAt not bumped` (actual bumped). Both green.
- Rotation files + `webhook-whatsapp.test.ts`: all pass except the F-V1b-3 todo (step 27).
- Unit 357/351 pass/0 fail/6 todo; tsc 0; biome clean (4 files). `test:db` (localhost/mariana_test, workers off): 615 tests, 608 pass, 0 fail, 7 todo.
- Deviation: the adversarial fixture task payload now carries `eventId`/`eventExternalId` like a real 1st delivery (webhook-whatsapp.ts). Without it no handler can mark the event `processed`, so the plan's "event processed after the drain" assert could not hold.

## Step 27 (Batch V2-a) — appointment locks the lead first (F-V1b-3, F-V1c-2)
- File: `appointment-service.ts` — first statement of the `createConfirmedAppointment` tx is `SELECT id FROM leads WHERE id = $leadId FOR UPDATE`. Checks and calendar compensation unchanged.
- New `src/tests/reliability/lock-order.test.ts` (fake calendar, waits on `pg_blocking_pids`, no sleeps) + helper `src/tests/support/lock-wait.ts` (CODEMAP updated):
  - "agendamento e rotação concorrentes não dão deadlock; a mensagem é gravada" (plan Rev2). Red: `actual: ['40P01'], expected: []`.
  - "toque e confirmação concorrentes não dão deadlock (lead primeiro): appointment-first | webhook-first" (replaces the static scan). A T0 tx holds a uncommitted unique-key row (appointment `idempotencyKey` / message `externalId`) so the first side stops mid-tx. Red (appointment-first): `event failed: … update "scheduling_sessions" …` (40P01, webhook victim, message lost). webhook-first green before and after (no cycle in that order).
- `session-rotation.test.ts:~1581` tester `todo` removed. Red: `actual: ['40P01'], expected: []`.
- Removed unit `session-choice-policy.test.ts` "nenhum caminho de sessão trava conversa antes do lead (F-V1b-2)" + its unused patterns/import.
- Green: lock-order 3/3 (×4 runs), rotation files, `appointment-service.test.ts`, `phase3-scheduling-workflow.test.ts` all pass.
- Deviation: the tester's `:1581` body used an inline copy of the old appointment order (`UPDATE sessions` → `UPDATE leads`), so removing `todo` alone could never turn green. It now calls the real `AppointmentService.createConfirmedAppointment` against the real `resolveConversationForInbound`, paused mid-tx by the same unique-key blocker; same assertion (`failures` deep-equals `[]`).

## Batch V2-a — full suites (host=localhost db=mariana_test, workers off)
- `test:unit`: 356 tests, 350 pass, 0 fail, 6 todo. `tsc --noEmit`: 0. `build`: ok. Biome on the 8 changed files: clean.
- `test:db` run 1: 617 tests, 611 pass, 0 fail, 6 todo. Run 2: 617/611/0/6. Known flaky tests did not fail.

## Step 28 (Batch V2-b) — stale AI turn writes nothing (R-V1b-1, D-R2-2 a)
- Approval: plan.md:1 `APPROVED by Davi` (Rev2 + 2.1); D-R2-2 (a), D-R2-6 (a) read.
- Files: `generateMarianaResponse.ts` (`expectedConversationId?` param; exported `TurnSupersededError`; start check vs the active conversation; first statements of the write tx: `leads` FOR UPDATE, then re-check that conversation is `active`); `autonomous-task-handlers.ts` inbound handler (reads `status`; closed conversation → event processed, `{ reason: "conversation_not_active", skipped: true }`, no Gemini; passes `expectedConversationId`; catches `TurnSupersededError` the same way).
- Tests (`session-rotation-adversarial.test.ts`, gated Gemini mock): "turno em andamento em A quando a rotação acontece…" red `consortiumType reset kept: actual 'auto', expected null`; "tarefa de A executada depois da rotação não responde em B" red `no Gemini call: actual 1, expected 0`. Both green.
- `:366` characterization does not assert a reply: kept unchanged, green.
- Deviation: none in code. Note: the red run loaded `.env` through `dotenv/config` (guard still overrode DB and external creds); every later run used `DOTENV_CONFIG_PATH=/dev/null`.
- Risk: the in-tx superseded case still emits a `turn_error` trace line (catch in `generateMarianaResponse`); no outcome value for "superseded" exists.

## Step 29 (Batch V2-b) — legacy `sessao:*` tap under 4h answers like S-07 (F-V1c-1, D-R2-6 a)
- Files: new `src/services/conversations/stale-tap-reply.ts` (`replyToStaleTap(tx, …)`, key `stale-tap:<externalId>`; awaiting_confirmation → notice + Confirmar/Não for `selectedSlotId`; other active session with slots → notice + "Estes são os horários que tenho para você:" + up to 3 slot buttons (filtered by `preferredConsultantId` when set); else notice + "Me conta o que você precisa agora?"); `webhook-whatsapp.ts` `sessao:` branch calls it and marks the event `processed` in the same tx (no task); `LEGACY_SESSION_CHOICE_TAP_TASK` import dropped. CODEMAP rows updated.
- Tests (`session-rotation.test.ts`): replaced the no-op test with "toque legado sessao:* com menos de 4h responde com aviso curto, nunca silêncio" (red `one reply: actual 0, expected 1`); added slot-buttons and awaiting_confirmation variants (red `0 !== 1`) and "toque legado sessao:* repetido pelo Meta responde uma vez" (red `one reply: 0 !== 1`). All 4 green. First green attempt failed in the test itself (fixture already has an assistant row); lookup narrowed to the notice text.
- Deviation: notice and follow-up joined with `\n` (plan gives the strings, not the separator).

## Batch V2-b — full suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit`: 356 tests, 350 pass, 0 fail, 6 todo. `tsc --noEmit`: 0. `build`: ok. Biome on the 6 changed files: clean.
- `test:db` run 1: 632 tests, 625 pass, 0 fail, 7 todo. Run 2: 632/625/0/7. 0 egress hits. Known flaky tests did not fail.
- Not touched: F-T26-1, F-T26-2 (`todo` in `redelivery-adversarial.test.ts`), F-T27-1.

## Step 30 (Batch V2-c) — random consultant per offered time (D-R2-5 a, D-R2-7 a)
- Approval: plan.md:1 `APPROVED by Davi` (Rev2 + 2.1); D-R2-5 (a), D-R2-7 (a) read.
- Files: `consultant-availability.ts` (`ConsultantDrawOptions { random? }` 4th arg; per time, list the free consultants, `drawConsultant` picks `floor(random()*n)`; no source = first free, admin route unchanged); `scheduling-availability.ts` (`random?` passed through); `generateMarianaResponse.ts` (`random` param, default `Math.random`, passed on the offer path). Slot persistence unchanged (`persistOffer` already writes the slot's consultant/calendar).
- Tests: new unit `src/tests/services/consultant-availability-draw.test.ts` (added to `test:unit` in package.json): "sorteia o consultor entre os livres…" red `0.99 picks the 2nd free: actual 'c-free1', expected 'c-free2'`; "um único consultor livre…" and "sem fonte aleatória mantém a ordem…" (regressions, green before and after).
- New DB `src/tests/services/scheduling-without-consultant-choice.test.ts` "a oferta grava o consultor sorteado no slot e a confirmação usa esse consultor": red `slot keeps the drawn one` (actual first free). Green: slot, `appointments.consultantId` and fake `createEvent.calendarId` = drawn one.
- Green: draw unit 3/3; DB file + `consultant-availability.test.ts` + `routes/appointments.test.ts`. Unit 359/353/0/6 todo; tsc 0; biome clean (4 src/test files).
- Deviation: the plan says "unit … (extend or create)" for `consultant-availability.test.ts`; that file imports the DB, so the unit cases are in a new file registered in `test:unit`. The DB test has a STEP-30-ONLY block (drop preference task, force `awaiting_slot_selection`) removed in step 31.

## Step 31 (Batch V2-c) — no preference question; slots, then Confirmar (R-SCH-01; B-1, B-2)
- Files: `generateMarianaResponse.ts` (preference enqueue removed); `scheduling-offer-service.ts` (session starts `awaiting_slot_selection`; single slot → `selectedSlotId` + `awaiting_confirmation` in the `persistOffer` tx; `enqueueConsultantPreferenceQuestion` and its imports removed).
- Tests (`scheduling-without-consultant-choice.test.ts`, webhook + drain): "aceite oferece só horários…" red `one button message: 2 !== 1`; "toque no horário da primeira oferta… (B-1)" red `selectedSlotId null`; "um único horário: Confirmar agenda (B-2)" red `selectedSlotId null`; "Confirmar exige o selectedSlotId gravado" red (selection blocked by B-1). All green. Step-30 test's STEP-30-ONLY block removed; still green (covers B-1 too).
- F-T29-1: new "toque legado sessao:* numa oferta nova… toque segue para Confirmar" green; mutation (start stage back to `awaiting_availability`) → red. The 3 tester `todo`s stay `todo`, reason updated: obsolete for new offers (stages never written now); only legacy sessions reach them, and step 32 accepts the slot tap there, which makes their assertion wrong; step 32 replaces them.
- Ported: `generate-mariana-response.test.ts` "Etapa 10 — 1 slot" (now selected + `awaiting_confirmation`, Confirmar accepted); `webhook-whatsapp.test.ts` single-slot offer (now Confirmar/Não, no `pref:`); `objective-flow-matrix.test.ts` case 2 (preference steps removed; asserts the offer enqueues no task).
- Kept unchanged (legacy handler coverage, still valid until step 32): `phase3-scheduling-workflow.test.ts` preference/consultant tests, `handler-partial-failure.test.ts` preference cases. Handlers stay registered so a pending legacy task still works until step 32.
- Deviation: plan lists `TH:485-940` "removed from the active flow"; done by removing the only enqueue, handlers untouched (removing them now would fail pending legacy tasks before step 32).

## Batch V2-c — full suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit`: 359 / 353 pass / 0 fail / 6 todo. `tsc --noEmit`: 0. `build`: ok. Biome on the 11 changed files: clean.
- `test:db` run 1: 647 / 637 pass / 0 fail / 10 todo. Run 2: 647/637/0/10. Run 3 (egress check): 647/637/0/10; "egress" grep matches only "regressão" test names and the egress-guard test file itself. Known flaky tests did not fail.
- CODEMAP: button-reply line, new scheduling-flow line, availability and offer rows.

## Step 32 (Batch V2-d) — mid-flow customers at deploy (S-25, one release)
- Approval: plan.md:1 `APPROVED by Davi` (Rev2 + 2.1); D-R2-5 (a), D-R2-6 (a) read.
- Files: `stale-tap-reply.ts` (`LEGACY_SCHEDULING_STAGES`, `promoteLegacySchedulingStage(tx, …)`; `eventId` optional); `webhook-whatsapp.ts` (`pref:`/`consultant:` taps under 4h: promote stage + `replyToStaleTap` + event `processed` in the inbound tx; no task routed); `autonomous-task-handlers.ts` (old preference/list/selection handlers removed; registry maps `send_consultant_preference_question` → no-op, `process_consultant_preference_reply`/`process_consultant_selection` → lead lock + promote + stale-tap reply in one tx; `handleSendConfirmationRequest` promotes a legacy stage when the tapped slot belongs to the session).
- Tests (`session-rotation.test.ts`): 3 F-T29-1 `todo`s replaced by "toque legado sessao:* em <stage> mostra horários e o toque no horário segue para Confirmar" (red `slot selected: actual null`); "sessão em awaiting_consultant_preference: toque no horário segue para Confirmar" (red null); "tarefa pendente de pergunta de preferência é drenada sem enviar nada" (red `['buttons:Você tem preferência por algum consultor?']`); "toque pref:*/consultant:* antigo responde aviso + botões…" (red `one reply: 0 !== 1`); "toque pref:* antigo sem sessão…" (red 0 !== 1); regression "toque num horário de outra sessão em etapa legada não muda a etapa" (green before/after). All 48 in file green.
- Ported: `handler-partial-failure.test.ts` (question → completes with no outbox; 3 legacy tap tasks → `stale-tap:<ext>` after one outbox failure, stage `awaiting_slot_selection`); `phase3-scheduling-workflow.test.ts` (full flow keeps slot → confirm → appointment; question sends nothing; old taps → stale reply, `preferredConsultantId` null; invalid pref button → completed with notice instead of `failed`).
- Suites: unit 363/357/0/6 todo; tsc 0; biome clean (6 files); test:db 659/652/0/7 todo.
- Deviations: `sessao:*` taps do not promote the stage (plan names only `pref:`/`consultant:`); slot taps in legacy stages are accepted anyway. One combined run showed `objective-flow-matrix` case 2 failing; it passed alone and on 2 reruns (parallel-file flake, not reproduced).

## Step 33 (Batch V2-d) — slot taken before Confirmar → re-offer, never swap (B-3, S-24, R-SCH-07)
- Files: `scheduling-confirmation-orchestrator.ts` (`AppointmentServiceError` `slot_unavailable` → reason `slot_unavailable`; other errors stay `appointment_failed`); `scheduling-offer-service.ts` (`persistOffer({ executor })` runs in the caller tx; default unchanged); `autonomous-task-handlers.ts` (`SLOT_UNAVAILABLE_REOFFER_TEXT` = D-R2-6 text verbatim; `sendSlotUnavailableReoffer`: availability with `Math.random` outside the tx, then one tx: lead FOR UPDATE, key re-check, assistant row, `persistOffer` (closes old session, new session + slots), outbox `reoffer:<externalId>`; no slots → existing text "No momento, não encontrei horários disponíveis nos próximos 5 dias." and the old active session closed).
- Tests: `scheduling-confirmation-orchestrator.test.ts` "mantém slot_unavailable…" (red `reason 'appointment_failed'`); `scheduling-without-consultant-choice.test.ts` "consultor do horário ocupado antes do Confirmar…" (red `one re-offer reply: 0 !== 1`), "reoferta repetida pelo Meta responde uma vez" (red 0 !== 1; same payload twice + task re-run), "sem horários na reoferta…" (red `never silent: 0 !== 1`). All green (16/16 in the 2 files).
- Deviations: (1) single fresh slot: body `<re-offer text>\n<"Tenho um horário disponível: … Posso confirmar?">` with Confirmar/Não, because `persistOffer` pre-selects a single slot (B-2) and slot buttons would be refused; not covered by a test. (2) No-slot case closes the old session (plan silent) so the taken slot cannot be confirmed again; asserted in the test.

## Batch V2-d — full suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit`: 363 / 357 / 0 fail / 6 todo. `tsc --noEmit`: 0. `build`: ok. Biome on the 10 changed files: clean.
- `test:db` run 1: 663 / 656 / 0 fail / 7 todo. Run 2: 663 / 656 / 0 / 7. Known flaky tests did not fail.
- CODEMAP: button-reply line, scheduling-flow line, handlers row (line count), offer, orchestrator and stale-tap rows.

## Step 34 (Batch V3-a) — refused tap gets the stale-tap reply (F-T32-1, F-V1c-3; D-R3-4 a)
- Files: `autonomous-task-handlers.ts` (new `replyToRefusedTap`: one tx, `leads` FOR UPDATE, re-read `conversations.status`, not `active` → no reply, else `replyToStaleTap` key `stale-tap:<externalId>`; then event processed. Called from confirm `!ok` except `appointment_failed` (and `slot_unavailable`, step 33), cancel `!ok`, and the 3 refusal exits of `handleSendConfirmationRequest`; results gain `replied`).
- Tests: `scheduling-without-consultant-choice.test.ts` 2 tester `todo`s now plain (red `3 !== 4` ×2; Confirmar one also asserts 0 appointments); new "Não (cancel:) de uma oferta antiga…" (red `0 !== 1`), "toque recusado repetido pelo Meta responde uma vez" (red `0 !== 1`), "toque recusado numa conversa já fechada não responde" (green before/after). `session-rotation.test.ts` `:2144` renamed "… responde aviso e não muda a etapa", 1 reply starting with notice (red `0 !== 1`); `:1748` expects `[E1, notice + "Me conta o que você precisa agora?"]` (red: only E1). All green.
- Deviation (test-only, consequence of the approved design; not listed in the plan): 2 existing tests pinned silence and went red in `test:db`:
  - `handler-partial-failure.test.ts` "replay de confirmação não vaza appointment de outro lead": intruder now gets 1 outbox `stale-tap:<ext>` from its own stage; asserts no owner slot id, no "Agendamento confirmado", 0 intruder appointments.
  - `webhook-whatsapp.test.ts` "button_reply rejeitado pelo SchedulingChoiceService…" (expired session): the unmocked `sendTextMessage` hit the egress guard (failed later test `:2036` `['graph.facebook.com']`). Now mocks `sendTextMessage`, asserts the D-R3-4 text exactly, no blocked egress, cleans outbox/messages.

## Step 35 (Batch V3-a) — single-slot re-offer text (D-R3-3 a)
- Files: `autonomous-task-handlers.ts` (`SLOT_UNAVAILABLE_SINGLE_REOFFER_PREFIX`; body `<prefix> ${formatSlotDate(start)} com ${consultantName}. Posso confirmar?`; buttons unchanged).
- Test: tester "reoferta com um único horário novo…" regex + exact equality with the D-R3-3 text (red `actual: null` on the old two-line body) → green.

## Batch V3-a — full suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit` 363/357/0/6 todo; `tsc` 0; `build` ok; biome clean on the 5 changed test/src files.
- `test:db` run 1: 670/663/0/7 todo; run 2: 670/663/0/7. CODEMAP: scheduling-flow line (steps 34, 35), handlers row (1052 lines).

## Step 36 (Batch V3-b) — lead first in the last two txs (F-T27-1)
- Approval: plan.md:1 `APPROVED by Davi` (Rev3).
- Files: `autonomous-task-handlers.ts` (`handleSendConfirmationRequest` tx: statement 1 = `leads` FOR UPDATE); `scheduling-offer-service.ts` (`persistOffer` `write`: statement 0 = `leads` FOR UPDATE; re-entrant under the step-33 caller tx).
- Tests (`lock-order.test.ts`): "pedido de confirmação (toque no horário) e rotação concorrentes não dão deadlock" (also covers exit 3 `session_changed_before_confirmation`: task result reason, 1 outbox `stale-tap:<ext>` with the notice, session `expired`, event `processed`); "oferta (persistOffer) e rotação concorrentes não dão deadlock" (1 active session = new offer; T0's `expired` kept). Red both `['40P01']` → green.
- Test helper: `holdTransaction` gained `locked` (T0 holds the lock before the other side starts) and both new tests release T0 in `finally`. Reason: first full `test:db` hung (persistOffer won the race to the lead, `waitForLockWait` timed out, T0 never released). Red re-proven after this change by removing both locks temporarily (`['40P01']` ×2; files restored from backup).
- Lock tests ×5: 5/5 green each run.

## Step 37 (Batch V3-b) — AI-turn tail on a closed conversation writes/sends nothing
- Files: new `src/services/conversations/turn-superseded-error.ts` (class moved; `generateMarianaResponse.ts` imports it and re-exports it, `biome-ignore noBarrelFile` on that line); `scheduling-offer-service.ts` (`requireActiveConversation?`: under the lead lock, conversation not `active` → `TurnSupersededError` before any write); `generateMarianaResponse.ts` (AI-turn `persistOffer` passes it); `autonomous-task-handlers.ts` (`handleProcessInboundMessage`: lead FOR UPDATE + status re-check + `enqueueOutboundMessage` in one tx; not active → event processed, `{ reason: "conversation_not_active", skipped: true }`).
- Tests (`session-rotation-adversarial.test.ts`, `getBusyPeriods` fake blocks until released): "rotação durante a busca de horários: a oferta de A não é gravada nem enviada" (red: `no active session in A` — 1 row); "rotação durante a busca, sem horários: a resposta de A não é enviada" (red: `no outbox from A` — 1 row). Green; both also assert task result, reset kept, B answered once.

## Step 38 (Batch V3-b) — `superseded` trace outcome + R-SCH-08 comments
- Files: `src/lib/turn-trace.ts` (`TurnOutcome` += `superseded`); `generateMarianaResponse.ts` (`failureOutcome`: model → `model_error`, `TurnSupersededError` → `superseded`, else `turn_error`); comments R-SCH-07 → R-SCH-08 at TH:372, TH:383, `scheduling-confirmation-orchestrator.ts:191`, `scheduling-without-consultant-choice.test.ts:808`.
- Test: "turno em andamento em A quando a rotação acontece…" captures `console.info` trace lines; asserts exactly `['superseded']` for the task's turnId. Red `['turn_error']` → green.

## Batch V3-b — full suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit` 363/357/0/6 todo; `tsc` 0; `build` ok; biome clean on 9 changed files.
- `test:db` run 1: 677/670/0/7 todo; run 2: 677/670/0/7. CODEMAP: line counts, offer row, rotation/stale-turn row, turn-trace row.

## Step 40 (Batch V3-b') — model-failure notice and trace (F-V3b-1, D-R3-5 a)
- Approval: plan.md:1 `APPROVED by Davi` (Rev3.1; D-R3-5 a, D-R3-6 a).
- Files: `autonomous-task-handlers.ts` (`sendModelFailureNotice`: lead FOR UPDATE + status re-read + row + enqueue in one tx; not active → event processed, `{ reason: "conversation_not_active", skipped: true }`; direct import of `TurnSupersededError`); `generateMarianaResponse.ts` (`isConversationActive`; re-read before the success trace → throw `TurnSupersededError`; `ModelUnavailableError` on a closed conversation → rethrown as `TurnSupersededError`; re-export + `biome-ignore` removed; `failureOutcome` moved above the `emitFailureTrace` JSDoc).
- Tests: adversarial "tester V3-b: … Gemini que falha" `todo` removed, + trace `['superseded']` + task result. Red `['model_error']` → green. Step-37 loop "sem horários": `['replied']` → `['superseded']`. Red `['replied']` → green.
- S-17: `model-failure.test.ts` "falha do modelo enfileira o aviso…" + trace `['model_error']` (active conversation). Green before and after (regression guard). model-failure-acceptance, model-failure-notice, handler-partial-failure, generate-mariana-response: 33/33.
- Hygiene: `lock-order.test.ts:583, :675` → `await Promise.race([t0.locked, t0.done])`.

## Step 41 (Batch V3-b'') — button-flow sends re-check under the lead lock
- Files: `autonomous-task-handlers.ts`: helpers `lockLeadAndCheckActive(tx, leadId, conversationId)` and `enqueueIfConversationActive`; re-offer tx (not active → `{ replied: false, reason: "conversation_not_active" }`, no row/session/outbox); cancel reoffer/close + choice reply via `enqueueIfConversationActive`; legacy consultant tap reads status inside the tx after the lock; confirmation-request tx explicit status read. `TH:~634` "Agendamento confirmado" unchanged (D-R3-6 a).
- Tests (`session-rotation-adversarial.test.ts`, 8 new). Window simulated by rotating right after the service call (`rotateAfter` wraps the prototype method; A's `lastCustomerMessageAt` set back ≥ 4h, because the tap writes `now`):
  - "Confirmar de A com o horário ocupado…": red `reoffer:` outbox in A → green. Deviation: the rotation is placed after `getAvailableSlots` (rotating after `execute` resets `qualified`, so the search throws and the task fails; nothing sent).
  - "Não (cancel:) … rotação antes da task" (1 and 2 slots): green before and after (the session is expired → refused tap path) — kept as regression.
  - "Não (cancel:) … rotação logo depois do cancelamento" (1, 2 slots): red `button-reply:` outbox → green.
  - "toque de horário de A (process_button_reply)…": red → green.
  - "toque pref:* legado…": T0 = rotation-like tx (lead lock, close A, expire sessions, open B); tap blocked on the lead. Red `stale-tap:` outbox (proven by temporarily restoring the old lock-without-recheck) → green. Deviation: the real webhook as rotation was not deterministic (lock-queue order), so T0 performs the rotation writes.
  - "D-R3-6: agendamento confirmado antes da rotação ainda avisa o cliente": green before and after (1 outbox, 1 appointment).

## Batch V3-b' + V3-b'' — full suites (host=localhost db=mariana_test, workers off, DOTENV_CONFIG_PATH=/dev/null)
- `test:unit` 363/357/0/6 todo; `tsc` 0; `build` ok; biome clean on 5 changed files.
- `test:db` run 1: 686/679/0/7 todo; run 2: 686/679/0/7.
- Lock tests ×5: lock-order 5/5 pass each; adversarial 21/21 pass each.
- CODEMAP: line counts (1067, 1152), rotation/stale-turn row.

## Step 39 (V3-c, F-T26-2) — tap redelivery keeps its conversation
- Files: `src/services/conversations/session-rotation.ts` (`tapExternalId?`; under the lead lock, before the gap check, looks up task `button-reply:<id>` then outbox `stale-tap:<id>` / `session-rotation-tap:<id>` for the same lead → `redelivery: true`, `rotated: false`); `src/routes/whatsapp/webhook-whatsapp.ts` tap branch (passes `tapExternalId`; redelivery into a non-active conversation → event `processed`, return before the bump).
- Test: `redelivery-adversarial.test.ts` "toque reentregue depois que B abriu não mexe em B": `todo` removed, asserts event `processed`. Red: `B lastCustomerMessageAt not bumped by the old tap` → green.
- Regressions: `redelivery-adversarial` + `session-rotation` + `lock-order`: 63/63 pass, 0 todo.

## Step 40 fix (test-report "Steps 40–41", risk 1) — status re-read must not mask the model error
- File: `src/services/conversations/generateMarianaResponse.ts` catch: `isConversationActive(...).catch(() => true)`; original `ModelUnavailableError` rethrown, trace `model_error`. Stale "Relança sem tocar" comment corrected.
- Test: `model-failure.test.ts` "passo 40 (R-REL-07): banco fora na releitura…" (db.select mocked to throw after the model fails). Red: `actual: Error: db down` → green.
- Full: test:unit 357 pass / 0 fail / 6 todo; test:db ×2 686 pass / 0 fail / 6 todo (localhost/mariana_test); tsc 0; build OK; biome clean on 5 files.
- Deviations: none. CODEMAP unchanged (no file added/moved).

## Step 24 — Docs (Rev2 + Rev2.1 + Rev3 amendments; approved Rev3.1)
- Files: `docs/specs/MARIANA_BEHAVIOR_SPEC.md` (v1.4: header, R-SCH-01, R-SCH-03, new R-SCH-08 with D-R3-3 sentence, R-SES-02 with D-R3-1 ending, R-SES-03, S-07, S-08 + D-R3-4 note, S-22 (D-R3-1), S-23–S-25, "Mudanças da v1.4"); `CLAUDE.md` Invariants only (removed pending-choice line; added E8 and D-R2-4 lines); `docs/CODEMAP.md:47-48` (redelivery keeps conversation, lock order `leads` first, refused tap → stale-tap reply); `docs/specs/ROADMAP-2026-10-22.md` (D-10, WP-4); `docs/specs/2026-10-17-scheduling-and-session-flow.md` (D6, AC11, AC12).
- Proof: `git diff --check` clean; R-SCH-07 once (rule row), R-SCH-08 once as row (+1 changelog mention).
- Grep hits left (all intended): spec R-SCH-01/S-25 "preferência" (approved text says there is none); R-SES-03 and changelog "pista" (approved "nem como pista"); v1.1/v1.2 changelog history ("preferência", "Continuar"/"Nova conversa"); ROADMAP D-10 "sem pergunta de preferência"; scheduling-flow spec :21 (production transcript), :49, :67 (old consultant-preference flow, outside D6/AC11/AC12, not named by the plan).
- Deviations: R-SES-02 drops "mesmo que o reenvio chegue 4h ou mais depois" (Rev3 gives the sentence ending from "e é respondida…"). D6/AC11/AC12 wording derived from approved R-SES-02 (plan gives intent only). ROADMAP WP-5 "N-1 (E7)" not added (no approved wording; caller scoped WP-4/D-10).
- Commands: `npm run test:unit` → tests 363, pass 357, fail 0, todo 6; `npx tsc --noEmit` → OK. test:db not run (tester running it in parallel). No code/tests touched.
