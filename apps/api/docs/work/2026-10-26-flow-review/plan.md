Status: APPROVED by Davi — "eu aprovo essa tarefa" (2026-10-27, revision 3.1)

Approval of Revision 3.1 (relayed verbatim by the coordinator: "eu aprovo essa tarefa", then "continue"). Before Davi replied, the coordinator told him that a plain approval accepts option (a) of D-R3-5 and D-R3-6.
- D-R3-5 (a): trace outcome `superseded` when the conversation closed during the turn (no-slots case and model failure after rotation); implemented in step 40.
- D-R3-6 (a): "Agendamento confirmado para … com …" is still sent when the booking committed before the rotation (`TH:634` unchanged).
- Steps 40–41 may start in the Rev3.1 order.

Previous status (history, Rev3.1): `DRAFT — revision 3.1 waiting for Davi's approval`

Revision 3.1 (end of file) adds steps 40–41 and decisions D-R3-5, D-R3-6 after the tester's V3-b FAIL (F-V3b-1). Steps 34–38 are done; their text is unchanged. Step 39 and 24–25 stay approved under Rev3. Steps 40–41 must NOT start until Davi approves Revision 3.1.

Previous status (history, Rev3): `APPROVED by Davi — "aprovo" (2026-10-27, revision 3)`

Approval of Revision 3 (relayed verbatim by the coordinator). Before Davi replied, the coordinator told him that a plain "aprovo" accepts option (a) for D-R3-1 to D-R3-4.
- D-R3-1 (a): a late redelivery into an already closed conversation gets no separate reply. S-22 and R-SES-02 v1.4 wording change as written in Rev3 step 24 ("se essa conversa ainda estiver ativa"). No code step for F-T26-1.
- D-R3-2 (a): the HTTP route `POST /conversations/:id/messages` (no `expectedConversationId`) is only listed, under Q1/F2-05.
- D-R3-3 (a): single-slot re-offer text "Esse horário acabou de ficar indisponível. Tenho outro horário: <data hora> com <consultor>. Posso confirmar?" [Confirmar | Não]. Step 35 unblocked.
- D-R3-4 (a): a tap on an expired session gets the notice + "Me conta o que você precisa agora?"; the automatic new offer (S-08) stays in package B.
- Revised step 24 texts approved as written in "Rev3 — Steps", step 24: the re-offer rule is R-SCH-08 (spec:63 keeps R-SCH-07) and "Mudanças da v1.4" says "R-SCH-08, S-24 e S-25 novos"; R-SES-02 and S-22 wording per D-R3-1; R-SCH-08 single-slot sentence per D-R3-3; S-08 note per D-R3-4; CODEMAP notes.
- Steps 34–39 and the amended 24–25 may start in the Rev3 order.

Previous status (history, Rev3): `DRAFT — revision 3 waiting for Davi's approval`

Revision 3 (end of file) adds steps 34–39 and amends the not-started steps 24–25. Steps 19–23 and 26–33 are done; their text is unchanged. Steps 34–39 and the amended 24–25 must NOT start until Davi approves Revision 3.

Previous status (history, Rev2 + 2.1): `APPROVED by Davi — "aprovo" (2026-10-27, revision 2 + 2.1)` — still valid for steps 26–33 (done).

Approval of Revision 2 + 2.1 (relayed verbatim by the coordinator). Before Davi replied, the coordinator told him that a plain "aprovo" accepts option (a) for D-R2-1 to D-R2-7 and all of the spec v1.4 wording. He was also told that the confirmation shows the drawn consultor's name and that he could ask to hide it. He did not ask, so the name stays visible.
- D-R2-1 (a): a late redelivery stays in the conversation where the message was first stored, and A answers it. Step 26 unblocked.
- D-R2-2 (a): stale-turn guard for the AI turn. Step 28 unblocked.
- D-R2-3 (a): spec v1.4 wording approved as written in "Rev2 — Spec v1.4 wording" and "Rev2.1 — Spec v1.4 wording, additions". It covers R-SES-02, R-SES-03, R-SCH-01, R-SCH-03, R-SCH-07, S-07, S-08 and S-22 to S-25, the changelog, and ROADMAP D-10.
- D-R2-4 (a): add the "lead first" lock-order invariant to CLAUDE.md, next to E8.
- D-R2-5 (a): Davi's earlier words: "deixe random a escolha de consultor". The consultant is drawn at offer time, among the consultants free at that time, and stored on the slot. If the slot is taken before Confirmar, the customer gets a fresh offer and the consultant is never swapped. The confirmation shows the drawn consultant's name.
- D-R2-6 (a): fixed texts approved. Stale tap: "Esse botão é de uma mensagem antiga.", followed by "Estes são os horários que tenho para você:" plus the current buttons, or by "Me conta o que você precisa agora?" when no scheduling is in progress. Re-offer: "Esse horário acabou de ficar indisponível. Tenho estes outros horários:". Steps 29, 32 and 33 unblocked.
- D-R2-7 (a): pure random, with no load weighting.
- Rev2.1 changes approved: F-V1c-1 is handled like S-07 (step 29), and step 27 uses real DB deadlock tests (F-V1c-2).
- Earlier reply to Rev2 (history, "aprovo com mudanças"): "aprovo as mudanças, mas antes, verifique uma coisa, quando o cliente quer marcar reunião, o agente manda primeiro o horarios depois pergunta se tem preferencia de consultor. então tire a escolha de consultor, deixe somente o horario e depois do horario o botão para confirmar"

Previous status (history, Rev2): `DRAFT — revision 2 (with Rev2.1 changes) waiting for Davi's approval`

Revision 2 (end of file) is a DRAFT. It adds steps 26–28 and replaces the not-started steps 24–25. Rev1 approval below stays valid for steps 19–23 (done; V1-c in tester verification). Steps 26–28 and the new 24–25 must NOT start until Davi approves Revision 2.

Previous status (history, Rev1): `APPROVED by Davi — "aprovo" (2026-10-27, revision 1)`

Approval of Revision 1 (relayed verbatim by the coordinator; the coordinator told Davi beforehand that a plain "aprovo" accepts the 8 recommendations and the spec v1.3 wording):
- Spec v1.3 wording (R-SES-02, S-18, S-19, S-20 with E1-a, new S-21, change log) approved as written in "Rev1 — Spec v1.3 wording". Step 19 may apply it.
- E1-a: tap on an old scheduling button after 4h → new session, tap not honored, one fixed reply ("Oi! Já faz um tempo desde a nossa última conversa, então aqueles horários não valem mais. Me conta o que você procura agora?"). Step 22 unblocked.
- E2-a: future confirmed appointment → rotate too; status stays `scheduled`.
- E3-a: **partly open.** Davi did not say whether the old 4h gate is already in production. Deploy precondition: Davi runs the 2 read-only Neon SELECTs and both return 0. Keep the no-op drain for one release. Does not block code.
- E4-a: B's first reply is the normal conversation start; no extra backend text, no prompt change.
- E5-a: A becomes `closed`, never deleted; snapshot in a `completed` `autonomous_tasks` row `session-rotation:<A id>`.
- E6-a: opt-out text after 4h rotates like any message; `optOutAt` copied and written on B.
- E7-a: N-1 fix approved: no future appointment → `new` + `qualifiedAt = null` for any status. Step 21 unblocked.
- E8-a: remove the pending-choice invariant from `CLAUDE.md` and add "A new conversation is opened only by the backend, under the lead lock, in the transaction that stores the inbound."
- F2-29 ("Typed 'continuar' never decides", low, spec-gap, R-SES-02): **obsolete** (no choice exists any more).

Earlier status (history): `DRAFT — revision 1 waiting for Davi's approval`.

History: Revision 0 status was `APPROVED by Davi — "aprovo" (2026-10-26)`. Revision 1 (below, at the end of this file) replaces the session-choice design after Davi's product decision of 2026-10-27. Steps 8–18 of Revision 0 must NOT start until Davi approves Revision 1.

Approval relayed word for word by the coordinator. Q1–Q5 are **still open**: Davi did not answer them in that reply. Until he answers, these items must NOT start:
- step 10, fallback text only (Q2);
- step 12 (Q3);
- F2-05 (Q1);
- F2-08 (Q4);
- F2-17 (Q5).

Everything else in this plan is unchanged.

Decision D-1 (Davi, relayed by the coordinator, verbatim "aprovo"; 2026-10-27): for step 3 / S-19a, the lead is `new` with `qualifiedAt = null` right after "Nova conversa"; after the first turn the only requirement is `status !== "scheduled"`, so `qualifying` is allowed. Rejected alternative: "quero `new` depois do turno".

# Plan — flow & risk review (`2026-10-26-flow-review`)

Base: `develop` @ `03afdc2`. Spec: `mariana_spec.md` + `docs/specs/MARIANA_BEHAVIOR_SPEC.md` v1.2. Findings F2-xx: see the findings section delivered with this plan (the `findings.md` write was refused by the harness; the coordinator has the full table). Flow: `flow-map.md`.
Skills: the `Skill` tool is not available to this subagent; systematic-debugging (evidence → verdict) and writing-plans (small red-first steps) were applied by hand. Nothing installed.

## Summary
- Close the unfinished session-choice / 4h work (R1) and the three critical session-choice bugs it hides (R2): a second 4h gap swallows the message, a non-atomic choice claim, and a silent `Continuar` after a held tap.
- Then the high/medium defects of the gate (R2–R3). Everything else maps to roadmap packages B, C2, D, E.
- No migration, no prompt/knowledge change, no change to the existing session-choice texts or to the 4h value.

## Root causes (status)
- F2-01 **confirmed**: `session-choice-store.ts:49-51,92-104` + `webhook-whatsapp.ts:560-586` / `:442-468`.
- F2-02 **confirmed**: `autonomous-task-handlers.ts:1515-1518` claim is outside the transactions at `:1550` / `:1582`.
- F2-03 **confirmed**: `webhook-whatsapp.ts:442-468` discards the tap; `autonomous-task-handlers.ts:1567-1578` sends nothing without held text.
- F2-06, F2-07, F2-13–F2-16, F2-19–F2-22 **confirmed** (file:line in the findings table).
- K2 "step 9 unimplemented" **refuted**: `autonomous-task-handlers.ts:1707-1731`.
- Gate test failing today: **unclear** until `baseline-report.md` (the 4h progress says the file passes).

## Design (what changes, what must not)
- Session-choice state stays in `autonomous_tasks` (Q1 of session-choice). There is still one row per conversation (the unique key is unchanged), but a resolved row can be re-opened atomically. The previous resolution is kept under `payload.history`, never deleted.
- Every gate branch in the webhook ends in exactly one of these: a task, or a message held by a pending choice that will replay it. No `return` without one of them.
- Choice effects and claim are one transaction.
- Must NOT change: the session-choice texts, `SESSION_INACTIVITY_MS`, the `sessao:*` IDs, the outbox state machine, the `runKey`s, the `drizzle/` folder, the prompts or the knowledge files, `.claude/`, `.env`.
- Invariants protected in every step: one active conversation per lead; a duplicate inbound event is never processed twice; no outbound goes back to `pending`; `unknown` is never resent; the AI never decides IDs, availability or authorization; confirm requires `selectedSlotId`.

## R0 — already approved (no new approval)
pkg-A **Batch E, steps 12–17**, exactly as written in `docs/work/2026-10-22-pkg-A/plan.md:266-306`. Closes F2-04. The tester writes `docs/work/2026-10-22-pkg-A/test-report-batch-E.md`.

## R1 — close session-choice / 4h

**Batch R1-a**
1. **Acceptance pass, no code** (F2-27, F2-25).
   - The tester verifies pkg-A Batch D and R-REL-05 / R-REL-07 / S-17 against spec v1.2. It replaces the "redação não disponível" markers with the rule IDs, and lists session-choice steps 8–12 against their tests.
   - Output: `docs/work/2026-10-22-pkg-A/test-report-batch-D.md`, and the step 8–12 section in `docs/work/2026-10-22-session-choice-24h/test-report.md`.
2. **Gate test + 4h regression test** (K2, F2-23, F2-25).
   - Files: `src/tests/reliability/session-choice-gate.test.ts` ("send_confirmation_request durante a pendência…"), `src/tests/session-inactivity-regression.test.ts`, `package.json:21`.
   - Gate test: if the baseline still shows it red, align the expectation with plan step 10: 1 deterministic reminder outbound, 0 confirmation requests, the session unchanged. Production code is not touched. If the cause is in production code, STOP and revise this plan.
   - Regression test: rename it to "4h" and assert the 4h boundary: `4h → true`, `4h − 1 ms → false`, `null → false`.
     - **Red first**: a temporary local mutation (`SESSION_INACTIVITY_MS = 24h`) makes it fail. Show that run, then revert the mutation.
   - Register the file in `test:unit`.

**Batch R1-b**
3. **Step 9 acceptance (R-SES-04, S-19)**.
   - File: `src/tests/reliability/session-choice-new.test.ts`.
   - Add "S-19a: nova conversa com reunião passada começa na saudação e não diz 'já está agendado'". Given a past appointment; when Nova runs and then the held message is processed with a stubbed `generateMarianaReplyFn`; then the stage is `greeting`/`reason`, `lead.status === "new"`, and no reply contains "agendad".
   - Clarification (Decision D-1): `lead.status === "new"` and `qualifiedAt === null` are asserted right after Nova, before the first turn; after the first turn only `lead.status !== "scheduled"` is required (`qualifying` is allowed).
   - Add "S-19b: reunião futura mantém scheduled". Assert the status only; S-10 answers belong to package D.
   - These are verification tests and may be green on arrival. Say so in `progress.md`. They are not presented as red→green.
4. **Steps 11–12 verification, no code**. The tester runs the adversarial, concurrency and invalid-replies files and records the results in the session-choice `test-report.md`.

**Batch R1-c**
5. **Docs (session-choice step 13, approved Q6)** (F2-24).
   - `docs/specs/ROADMAP-2026-10-22.md:29`: WP-4 becomes "4h gate (done); expire overdue sessions".
   - `docs/specs/2026-10-17-scheduling-and-session-flow.md:93,124,125`: D6/AC11/AC12 move to 4h + choice.
   - `docs/CODEMAP.md:3,28,34,45`: line counts and "after 4h".
   - `CLAUDE.md`: add the 2 invariants approved in Q6 ("at most one pending session choice per conversation"; "a new conversation never inherits the commercial state of the previous one").
   - Proof: `grep` plus `git diff --check`.
6. **Final verification (session-choice step 14 + the 4h change)** (F2-26).
   - The tester runs `test:unit`, `test:db` on a local DB, `tsc` and `build`.
   - Output: the final section of `docs/work/2026-10-22-session-choice-24h/test-report.md` and a new `docs/work/mariana-4h-session/test-report.md`.

## R2 — critical, then high

**Batch R2-a**
7. *(reserved: step numbers stay stable when the baseline adds work)*
8. **F2-01: re-open the choice on a later gap.**
   - Files: `src/services/conversations/session-choice-store.ts` (`openSessionChoice`), `src/routes/whatsapp/webhook-whatsapp.ts:442-468, 560-586`.
   - Change: `openSessionChoice` uses an upsert on the same key with `DO UPDATE … WHERE payload->>'state' <> 'pending'`, keeping the old payload under `history`. When the webhook does not open a choice, it re-reads the pending choice. If one exists, the message is held (it will be replayed). If none exists, the webhook falls through to the normal inbound task. It never returns empty.
   - Tests (DB, new `src/tests/reliability/session-choice-reopen.test.ts`), **red first**:
     - "segundo intervalo de 4h depois de Continuar pergunta de novo";
     - "nenhuma mensagem fica sem task nem pendência depois de um intervalo";
     - "a resolução anterior fica guardada em history".
   - Invariants: the unique key keeps it to 1 pending per conversation; webhook dedup is untouched.
9. **F2-02: atomic claim.**
   - File: `autonomous-task-handlers.ts:1515-1748`.
   - Change: move `claimSessionChoice({ executor: tx })` into the transaction of each branch. If the claim loses, the transaction ends without effects and the "já registrada" reply follows, as today.
   - Tests (DB, `session-choice-concurrency.test.ts`), **red first**:
     - "falha depois do claim não perde a escolha (continuar)": inject one throw from `enqueueTask`, retry; the held messages get tasks and there is no "já registrada";
     - the same test for "nova": A is closed, B is active.

**Batch R2-b**
10. **F2-03: Continuar after a held tap.**
    - Files: `webhook-whatsapp.ts:470-483` (extract a pure `resolveButtonTaskType(buttonId)`), `autonomous-task-handlers.ts:1549-1579`.
    - Change: on continue, if `discardButtonId` is set, enqueue the tap as its own task type. The handler's own validation answers it: stale tap → F-03 behaviour today. If there is nothing to replay, send the fallback text with the current-stage buttons.
    - **The fallback text is BLOCKED on Q2.** The replay part is not blocked.
    - Tests (DB), **red first**:
      - "Continuar reprocessa o toque de horário guardado";
      - "Continuar sem mensagem guardada sempre responde";
      - unit test of `resolveButtonTaskType` (registered in `test:unit`).
11. **F2-06: stale `sessao:*` taps.**
    - File: `webhook-whatsapp.ts:411-426`.
    - Change: route `sessao:*` to `process_session_choice` before the pending check.
    - Test (DB, `session-choice-invalid-replies.test.ts`), **red first**: "toque em Continuar depois da escolha resolvida recebe 'já registrada'".

**Batch R2-c**
12. **F2-07: no reminder inside the trigger burst (BLOCKED on Q3).**
    - File: `webhook-whatsapp.ts:545-558`.
    - Change: while `receivedAt - askedAt < env.MESSAGE_DEBOUNCE_MS`, hold the message without a reminder task.
    - Tests (DB, webhook test), **red first**:
      - "duas mensagens em 3 s depois de 4h geram só a pergunta";
      - "mensagem 10 min depois da pergunta gera um lembrete" (regression).

Not planned here, BLOCKED or mapped:
- F2-05 → Q1 (separate security spec).
- F2-08 → Q4.
- F2-09 → roadmap B.
- F2-10 → roadmap E.
- F2-11 → roadmap C2 / E.
- F2-12 and F2-18 → roadmap D.

## R3 — medium (and trivial lows)

**Batch R3-a**
13. **F2-13, F2-14, F2-28** (`autonomous-task-handlers.ts:1331-1334, 1551-1565, 1672-1697`).
    - Replay only messages with `createdAt >=` the trigger message.
    - A remind with no pending choice enqueues a normal inbound task for its message.
    - Every skip marks the event processed.
    - Tests (DB), **red first**:
      - "mensagem antiga não processada não é reenviada no Continuar nem movida no Nova";
      - "lembrete que chega depois da escolha vira processamento normal".
14. **F2-15** (`autonomous-task-executor.ts:79-99`, `autonomous-task-handlers.ts:624`).
    - Change: an SQL `NOT EXISTS` on the pending state row, matched by `idempotencyKey = 'session-choice-state:' || task."conversationId"` (unique index, no new index). The guard goes into the preference-question handler.
    - Test (DB), **red first**: "executeNextAutonomousTask sem conversationId não reclama task de agendamento durante a pendência".

**Batch R3-b**
15. **F2-16, F2-30** (`autonomous-task-handlers.ts:127-164, 1462-1543, 1733-1743`).
    - Change: each session-choice reply inserts its assistant row in the same transaction as its outbox row.
    - Test (DB), **red first**: "Nova grava a confirmação como mensagem da assistente em B".
16. **F2-19**: new `logDeterministicTurn` in `src/lib/turn-trace.ts`. It is called by the ask, remind, guard and choice replies, with `pureBackendText: true`, model `null`, and no text.
    - Tests (unit, `turn-trace.test.ts`), **red first**: "turno determinístico emite uma linha mariana_turn sem texto do cliente".
    - DB test: one line per reminder.

**Batch R3-c**
17. **F2-20** (`webhook-whatsapp.ts:371-615`).
    - Change: inside each branch transaction, lock the lead and re-resolve the active conversation with `getOrCreateActiveConversation(tx, …)`.
    - Test (DB, concurrency), **red first**: "texto concorrente com Nova cai na conversa ativa".
18. **F2-21, F2-22 (trivial)**.
    - Change: an opt-out text skips the gate (normal flow); an unknown `sessao:*` is treated as invalid.
    - Tests, **red first**: "opt-out depois de 4h não abre escolha"; "sessao:xyz reenvia a pergunta".

Every step:
- starts with the red test shown failing, then passing;
- runs the full `test:unit`, `test:db` (local `TEST_DATABASE_URL`, `RELIABILITY_WORKERS_ENABLED=false`), `tsc` and `build` once per batch;
- uses no real Gemini, WhatsApp or Google;
- makes no git writes.

## Out of scope
- Prompt and knowledge (C1/C2), model choice (A2), migrations, Neon writes.
- The session-choice texts and the 4h value.
- Package B's F-03 rewrite, beyond the replay hook of step 10.
- Splitting the hotspot files.
- `.claude/`.

## Questions for the owner
1. **Q1 — API exposure (F2-05).** Is the Fastify server reachable from the internet? Recommended: yes, treat it as public, and write a separate security spec (API key on every non-webhook route; remove `POST /conversations/:id/messages` or restrict it to `role: user`).
2. **Q2 — fallback text for Continuar with nothing to replay (step 10).** Recommended: "Combinado, seguimos de onde paramos. Como posso te ajudar?", plus the current scheduling buttons when a session is active.
3. **Q3 — reminders inside the burst (step 12).** Recommended: no reminder within `MESSAGE_DEBOUNCE_MS` of the question (S-18: "e nada mais").
4. **Q4 — audio/image/document (F2-08).** Recommended: record the event and reply "Por enquanto só consigo ler mensagens de texto. Pode me escrever?".
5. **Q5 — Nova with a held message (F2-17).** Recommended: keep both bubbles for now (no text change); revisit in C2.

## Revision history
- Revision 0 (2026-10-26): first DRAFT. "Baseline failures" will be folded in when `baseline-report.md` exists.

---

# Revision 1 — automatic new session after 4h (2026-10-27)

Davi's decision, verbatim: "não terá fallback perguntando se vai continuar a conversa anterior, depois das 4 horas se o cliente ficar inativo esse tempo todo, ja entra em outra sessão automaticamente não pergunta nada".
Meaning: the "Continuar / Nova conversa" question is removed. After ≥ 4h without a customer message, the next inbound starts a new conversation automatically. `SESSION_INACTIVITY_MS` (4h) stays.
Base: `develop` @ `89dacbf`. R0 and R1 (steps 1–6) are done and committed; they stay as history.

## Rev1 — Summary
- Replace the ask/remind/choice gate with a backend rotation: under the lead lock, in the same transaction that stores the inbound, close A and open B when the gap is ≥ 4h.
- Keep the "Nova conversa" effects (commercial reset, step 9 status rule, scheduling session expired, opt-out copied). Drop the question, the reminder, the confirmation bubble and the replay.
- Delete the dead session-choice code and tests. No migration: old `session_choice_state` rows stay in the table, unread.

## Rev1 — Evidence (what the change touches)
- Gate today: `webhook-whatsapp.ts:392-456` (tap) and `:498-586` (text): `readPendingSessionChoice`, `isSessionInactivityGap`, `openSessionChoice`, `markSupersededTasks`, tasks `ask/remind/process_session_choice`.
- Conversation resolved in its own transaction `webhook-whatsapp.ts:370-372`; `lastCustomerMessageAt` read outside it `:380-389` (F2-20). **Confirmed blocker for auto-rotation**: two messages after 4h both read the old timestamp. M1 would create B, M2 (already holding A's id) would insert into closed A, or see a gap and create C. The rotation must lock the lead and re-read the active conversation and its `lastCustomerMessageAt` in the same transaction as the insert.
- Nova effects to reuse: `autonomous-task-handlers.ts:1581-1747` (lock A + lead, snapshot, reset 8 fields + `qualifiedAt`, close A, expire active scheduling session, create B via `active-conversation.ts:24`, copy `optOutAt`, step 9 status at `:1707-1731`).
  - Nova copies A's `lastCustomerMessageAt` into B (`:1663-1670`). The rotation must **not** copy it: B gets `receivedAt` in the same transaction, otherwise M2 sees a gap again.
- Handler guards to remove: `checkPendingSessionChoiceAndRespond` `TH:98-168`, called at `TH:485`, `:776`, `:993`, `:1139`. Handlers `TH:1248` (ask), `:1327` (remind), `:1437` (choice); registry `:1771-1773`.
- Executor filter to remove: `autonomous-task-executor.ts:79-99` (+ import `:13`).
- Store `session-choice-store.ts` (237 lines): only the webhook, executor and handlers use it.
- Policy `session-choice-policy.ts`: keep `SESSION_INACTIVITY_MS` + `isSessionInactivityGap`; delete `hasPreviousCustomerMessage` (no caller in `src/`) and every `SESSION_CHOICE_*` text/ID.
- Missing handler = permanent failure (`autonomous-task-executor.ts:310-318`). A queued `ask/remind/process_session_choice` task left in production at deploy would fail with no reply, so legacy rows matter (E3).
- **New finding N-1 (confirmed)**: Nova resets `qualifiedAt` but keeps `status` `qualifying`/`qualified` (`TH:1707-1731` only touches `scheduled`). `GMR:668-670` keeps `qualified` (`baseStatus`), `lead-status.ts:15` allows `qualified → qualified|scheduled` only, and `GMR:554,568` passes the status to stage/prompt. So B inherits a commercial status. Proposed fix in step 21 (E7).

## Rev1 — Spec v1.3 wording (proposal; `MARIANA_BEHAVIOR_SPEC.md` is NOT edited until Davi approves)
- **R-SES-02 (v1.3)**: "Depois de **4 horas** ou mais sem mensagem do cliente, a próxima mensagem dele (texto ou toque) começa uma conversa nova automaticamente, sem perguntar nada. A anterior é fechada sem apagar nada (o estado anterior fica guardado). A nova começa do zero: etapa saudação, sem histórico anterior no prompt, sem interesse, ofertas ou horários da anterior. A mensagem que chegou depois do intervalo é respondida uma única vez, já na conversa nova. Mensagens que chegam juntas depois do intervalo caem na mesma conversa nova e recebem uma única resposta (R-REL-01). Com menos de 4 horas, a conversa continua igual."
- **S-18 (v1.3)**: Situação "Cliente no meio da qualificação volta depois de 4h ou mais e escreve 'é para carro'". Esperado "Nenhuma pergunta sobre continuar; a conversa anterior fecha; uma única resposta, numa conversa nova que começa do zero".
- **S-19 (v1.3)**: Situação "Volta depois de 4h ou mais: (a) com reunião passada; (b) com reunião futura confirmada". Esperado "(a) conversa nova do zero, sem 'já está agendado'; (b) conversa nova, continua 'agendado' e responde como na S-10".
- **S-20 (v1.3)**, wording depends on E1: Situação "Depois de 4h ou mais, toca num horário de uma oferta antiga". Esperado (rec. E1-a) "Conversa nova; o horário antigo não é reservado; uma resposta curta pedindo o que ele procura agora; nenhum agendamento".
- **S-21 (new)**: Situação "Duas mensagens seguidas, até 8 s entre elas, depois de 4h ou mais". Esperado "Uma única conversa nova e uma única resposta que considera as duas".
- "Mudanças da v1.3": R-SES-02 sem pergunta; S-18, S-19, S-20 reescritos; S-21 novo.

## Rev1 — What the rotation must keep (each one is an acceptance test)
| # | Requirement | Rule | How |
|---|---|---|---|
| K-1 | At most one active conversation | R-SES-01 | Lead `FOR UPDATE` + re-read active conversation in the insert transaction; B through `getOrCreateActiveConversation` |
| K-2 | Lead status by meeting date | R-SES-04 | Port `TH:1707-1731`: future `confirmed`/`scheduled` appointment → `scheduled`; otherwise `new` + `qualifiedAt = null` (D-1 stays valid) |
| K-3 | No inherited commercial state | CLAUDE.md invariant | Reset the 8 fields + `qualifiedAt`; expire the active scheduling session; supersede A's `pending` tasks; B history empty |
| K-4 | Crossing message answered once, in B | R-SES-02 v1.3 | Message inserted into B in the same transaction; one `process_inbound_message` on B; no question, no confirmation bubble |
| K-5 | Redelivery is idempotent | R-REL-02 | Second run sees B with a fresh `lastCustomerMessageAt` (no gap); message `onConflictDoNothing` + `inbound:<externalId>` task |
| K-6 | Two messages together give one B | R-SES-01, R-REL-01 | M2 waits for the lead lock, sees B with `receivedAt` of M1, joins the open batch |
| K-7 | Opt-out never lost | R-SEG (compliance) | Copy A's `optOutAt` to B; an opt-out text writes `optOutAt` on B |
| K-8 | A kept, never deleted | R-SES-02 v1.3 | A `closed`; snapshot stored (E5) |

## Rev1 — Verdicts on R2/R3 steps and findings
| Item | Verdict | Reason |
|---|---|---|
| F2-01 / step 8 | **obsolete** | No state row to re-open. Its rule "no branch returns without a task" becomes AC of step 20 |
| F2-02 / step 9 | **obsolete** | No claim. Atomicity moves to the rotation transaction (step 20) |
| F2-03 / step 10 | **obsolete** | No Continuar. Replaced by E1 (tap after 4h) in step 22 |
| F2-06 / step 11 | **changed** | No session-choice routing. Only legacy `sessao:*` taps from questions sent before deploy remain (E3, step 23) |
| F2-07 / step 12 | **obsolete** | No reminder. Replaced by K-6 / S-21 |
| F2-13, F2-14, F2-28 / step 13 | **obsolete** | No replay, no remind handler |
| F2-15 / step 14 | **obsolete** | No pending state; the executor filter is deleted (step 23) |
| F2-16, F2-30 / step 15 | **obsolete for session choice** | Kept as a rule for the one new deterministic reply (step 22): assistant row and outbox in the same transaction |
| F2-17 / Q5 | **obsolete** | No "Nova" confirmation bubble |
| F2-19 / step 16 | **still needed, smaller** | Only scheduling buttons and the step-22 reply are deterministic now. Stays under R-REL-07; not in Rev1 batches |
| F2-20 / step 17 | **changed, absorbed** | Mandatory part of step 20 (K-1, K-6) |
| F2-21 / step 18 | **changed** | Decision E6 |
| F2-22 / step 18 | **obsolete** | No `sessao:*` choice |
| F2-29 | **obsolete** | "Typed 'continuar' never decides" (low, spec-gap, R-SES-02): no choice exists any more |
| Q2 | **obsolete** | Continuar fallback text no longer exists |
| Q3 | **obsolete** | No reminders |
| Q4 / F2-08 | **still needed** | Unrelated to the gate. When done, media after 4h must rotate too |
| Q5 | **obsolete** | See F2-17 |
| Q1 / F2-05 | **still needed** | `POST /conversations/:id/messages` also bypasses rotation; stays in the security spec |
| R1 tests (steps 2–3) | **changed** | 4h boundary tests stay; S-19a/S-19b move to the rotation file |

## Rev1 — Design
- New module `src/services/conversations/session-rotation.ts`: `resolveConversationForInbound(tx, { leadId, receivedAt }) → { conversation, rotated, previousConversationId? }`.
  - Locks the lead, reads the active conversation (`lastCustomerMessageAt`, `optOutAt`), computes `isSessionInactivityGap`. A `null` timestamp never rotates.
  - On a gap, in the same `tx`: snapshot (E5); reset; status by K-2 (and N-1, E7); close A; expire the lead's active scheduling session; supersede A's `pending` tasks; create B; copy `optOutAt`.
- Webhook: both branches run in one transaction that calls the module first, then inserts or routes and writes `lastCustomerMessageAt = receivedAt` on the returned conversation. The webhook-event `conversationId` update moves into it. The separate `getOrCreateActiveConversation` transaction (`:370`) and the outside read (`:380-389`) go away.
- Must NOT change: `SESSION_INACTIVITY_MS`, the 4h boundary (`>=`), outbox state machine, `runKey`s, dedup (`claimWhatsAppWebhookEvent`), debounce/batching, prompts and knowledge, `drizzle/`, the WhatsApp 24h window, `.claude/`, `.env`.

## Rev1 — Steps (numbering continues; old steps 7–18 are closed by the verdicts above)

**Batch V1-a — spec (docs only, after Davi approves the wording)**
19. Edit `docs/specs/MARIANA_BEHAVIOR_SPEC.md` to v1.3 exactly as approved (R-SES-02, S-18–S-21, change log). Proof: `grep`, `git diff --check`. No code.

**Batch V1-b — rotation (core)**
20. **Text rotation in the webhook** (K-1 to K-8, F2-20).
    - Files: new `session-rotation.ts`; `webhook-whatsapp.ts:367-389, 498-586`.
    - Change: as in Design. The gate code in the text branch is removed; the text branch always ends in a `process_inbound_message` task.
    - Tests (DB, new `src/tests/reliability/session-rotation.test.ts`), **red first** (today the question is sent):
      - "texto após 4h fecha A, abre B e responde uma vez, sem pergunta" (R-SES-02 v1.3, S-18): 1 active conversation; message in B; 1 inbound task on B; 0 outbound with `sessao:` buttons; after the task (stubbed Gemini) exactly 1 reply in B.
      - "duas mensagens simultâneas após 4h criam uma única conversa nova e uma resposta" (K-6, S-21): `Promise.all` of 2 webhooks.
      - "a mesma entrega repetida após 4h não cria outra conversa nem outra resposta" (K-5, R-REL-02).
      - "rotação não herda estado comercial" (K-3, K-7, K-8): fields reset, scheduling session `expired`, A's pending tasks superseded, `optOutAt` copied, A `closed`, snapshot stored.
      - "S-19a/S-19b na rotação" (K-2, D-1): past appointment → `new` + `qualifiedAt = null` after rotation, `!== scheduled` after the turn, no "agendad"; future → `scheduled`.
      - Regression (green): "4h − 1 ms continua na mesma conversa" (`webhook-whatsapp.test.ts:1658`); rewrite `:1831` to "4h exatas inicia conversa nova e processa".
    - Invariants: one active conversation (lead lock + re-read); dedup untouched; no outbox change.
21. **N-1: status `qualifying`/`qualified` back to `new` on rotation** (BLOCKED on E7).
    - File: `session-rotation.ts` (status rule).
    - Test, **red first** (red on the ported Nova logic): "lead qualified sem reunião futura volta a new na rotação"; "lead com reunião futura continua scheduled" (regression).

**Batch V1-c — taps and dead code**
22. **Tap after 4h** (BLOCKED on E1 text).
    - File: `webhook-whatsapp.ts:392-497`.
    - Change (E1-a): rotate; do not route the tap; in the same transaction insert one assistant row + one outbox text, `idempotencyKey = session-rotation-tap:<externalId>`; mark the event processed. A tap under 4h is unchanged.
    - Tests (DB), **red first**: "toque de horário antigo após 4h abre conversa nova, não agenda e responde uma vez" (S-20 v1.3); "toque repetido pelo Meta responde uma vez" (R-REL-02); "toque com menos de 4h segue o fluxo de agendamento" (regression).
23. **Remove the session-choice code** (E3 decides the legacy part).
    - Files: `autonomous-task-handlers.ts` (`:98-168`, guard calls `:485/:776/:993/:1139`, handlers `:1248-1747`, constants `:1764-1767`, registry `:1771-1773`); `autonomous-task-executor.ts:13,79-99`; delete `session-choice-store.ts`; `session-choice-policy.ts` keeps only the 4h rule; `webhook-whatsapp.ts` imports and `sessao:*` routing.
    - Legacy (E3-a): the three old task types map to one no-op handler that marks the event processed (no failure, no reply), for one release.
    - Tests, **red first**:
      - unit: "createAutonomousTaskHandlers não expõe a escolha de sessão como fluxo ativo" (the old handlers are gone; the legacy types map to the no-op).
      - DB: "linha session_choice_state pendente antiga não bloqueia nem lembra" (given a legacy `pending` row inserted directly; when a text arrives under 4h; then a normal inbound task, no reminder).
    - Delete: `session-choice-{gate,handlers,continue,invalid-replies,adversarial,store}.test.ts`. Port into `session-rotation.test.ts` the still-valid cases of `session-choice-{new,isolation,concurrency}.test.ts` (step 9, isolation, "três mensagens dentro de 4h", repeated `externalId`), then delete those files. Remove text/ID cases and `hasPreviousCustomerMessage` from `session-choice-policy.test.ts`.
    - Note: the tester's uncommitted S-20 test in `session-choice-invalid-replies.test.ts` (in `git status`) is deleted by this step.

**Batch V1-d — docs and final check**
24. **Docs** (with Davi's approval of each text).
    - `CLAUDE.md:36`: remove "At most one pending session choice per conversation." Keep `:37`. Optional new line (E8).
    - `docs/CODEMAP.md:45-46`: replace the two session-choice rows with "Session rotation after 4h → `session-rotation.ts`, `session-choice-policy.ts` (4h rule)"; line counts.
    - `docs/specs/2026-10-17-scheduling-and-session-flow.md:93,124,125` (D6, AC11, AC12): automatic new conversation.
    - `docs/specs/ROADMAP-2026-10-22.md:29`: see roadmap note.
    - Proof: `grep -n "Continuar\|Nova conversa\|session choice" CLAUDE.md docs/CODEMAP.md docs/specs`, `git diff --check`.
25. **Final verification (tester)**: `test:unit`, `test:db` (local), `tsc`, `build`; red→green evidence for steps 20–23; manual staging checklist for S-18–S-21.

Every step: red test first, full suites once per batch, `RELIABILITY_WORKERS_ENABLED=false`, no Neon, no real Gemini/WhatsApp/Google, no git writes.

## Rev1 — Edge cases (decisions for Davi)
- **E1 — tap on an old scheduling button after 4h.** (a, rec.) New session, tap not honored, one fixed reply, e.g. "Oi! Já faz um tempo desde a nossa última conversa, então aqueles horários não valem mais. Me conta o que você procura agora?". (b) Honor the tap if the slot is still free (contradicts "entra em outra sessão").
- **E2 — future confirmed appointment.** (a, rec.) Rotate too; status stays `scheduled` (K-2); answers per S-10 (package D). (b) Do not rotate while a future meeting exists.
- **E3 — session choices pending in production at deploy.** Davi runs read-only SQL first:
  - `SELECT count(*) FROM autonomous_tasks WHERE "taskType"='session_choice_state' AND payload->>'state'='pending';`
  - `SELECT "taskType", status, count(*) FROM autonomous_tasks WHERE "taskType" IN ('ask_session_choice','remind_session_choice','process_session_choice') AND status IN ('pending','processing') GROUP BY 1,2;`
  - (a, rec.) Deploy only when both are 0 (or the gate was never deployed); keep the no-op drain for one release. A held message in such a conversation is answered by the next rotation or the next normal turn. (b) Write a one-time Neon fix (package F, separate approval).
- **E4 — does B's first reply greet?** (a, rec.) Yes, normal start of a conversation, no extra backend text, no prompt change now; a "welcome back" tone goes to C2. (b) Fixed prefix "Oi de novo!" (new text).
- **E5 — old conversation.** (a, rec.) `closed` (the only other enum value; a new status needs a migration), never deleted; snapshot in a `completed` `autonomous_tasks` row `session-rotation:<A id>` (same no-migration pattern, write-only audit). (b) No snapshot.
- **E6 — opt-out text after 4h.** (a, rec.) Rotate like any message; `optOutAt` copied and written on B; normal opt-out reply. (b) Skip rotation for opt-out (old F2-21 idea; extra branch).
- **E7 — N-1.** (a, rec.) No future appointment → `new` + `qualifiedAt = null` for any status. (b) Keep today's rule (only `scheduled` resets).
- **E8 — CLAUDE.md.** (a, rec.) Remove the pending-choice invariant and add "A new conversation is opened only by the backend, under the lead lock, in the transaction that stores the inbound." (b) Remove only.

## Rev1 — Out of scope
- F-03 silent exits (package B), media (Q4), API exposure (Q1), turn trace for deterministic replies (F2-19), prompt/knowledge, migrations, Neon writes, renaming `session-choice-policy.ts`, an expiry sweep for idle conversations (package D/F).

## Rev1 — Roadmap impact (WP-4, package D)
- WP-4 becomes "rotação automática após 4h (feito em flow-review Rev1); criação de conversa em transação (feito, step 20)". The "expirar sessões vencidas" part is now done lazily on the next inbound (step 20); a background sweep stays optional in D.
- Package F "fechar conversas paradas" is no longer needed for correctness (the next inbound closes them); still useful for clean data.
- Package G: the unique active-conversation index is still wanted (today the lead lock is the only guard).
- WP-5 gains N-1 (E7).

## Revision history (Rev1)
- Revision 1 (2026-10-27): session choice removed by Davi's decision. Steps 8–18 closed by verdicts; new steps 19–25. Waiting for approval of the plan, the spec v1.3 wording and E1–E8.

---

# Revision 2 — close V1-b planner findings (2026-10-27)

Inputs: `test-report.md` "V1-b" (F-V1b-1, F-V1b-3, R-V1b-1) and "Step 19" (2 spec-gaps); `progress.md` steps 20–23. Base: working tree on `develop` @ `904b76d` (V1-b/V1-c uncommitted). Steps 19–23 are not changed. F-V1b-2 (conversation→lead lock in the Nova handler) is closed by step 23 (handler deleted + static scan "every `.for("update")` is on `leads`"), pending the tester's V1-c verdict.

## Rev2 — Summary
- A message stored but not yet answered must never go silent on a late redelivery (F-V1b-1).
- Every transaction that writes a lead and lead-owned rows locks the lead first (F-V1b-3).
- A turn still running on A after the rotation writes nothing and sends nothing (R-V1b-1). Spec v1.4 settles the 2 spec-gaps.

## Rev2 — Root causes
- **F-V1b-1: confirmed.** `session-rotation.ts:82-93` decides the gap from A's `lastCustomerMessageAt` only; it never checks whether this `externalId` is already stored. On a gap it supersedes every `pending` task of A (`:144-157`), including `inbound:X`. The text branch then finds the existing row (`webhook-whatsapp.ts:505-524`, `onConflictDoNothing` + select; the message stays in A, the unique index `messages_external_id_unique_idx` blocks a copy) and calls `enqueueTask(preserveExisting)` (`:545-557`, `webhook-whatsapp.ts:168-172`), which hits the existing key and inserts nothing. Result: no task on B, the task on A is `completed`; X is never answered. Pinned by the `todo` test `session-rotation-adversarial.test.ts:531`.
  - Root: the rotation decision is re-made on a redelivery. A message's conversation should be decided once, when it is first stored.
- **F-V1b-3: confirmed.** `appointment-service.ts:280-346`: tx UPDATEs `scheduling_sessions` (`:290-310`), then `leads` (`:337-346`), with no lead lock. Rotation: `leads FOR UPDATE` (`session-rotation.ts:63-68`), then UPDATE `scheduling_sessions` (`:165-173`). Opposite order → 40P01. If the webhook tx is the victim, the event goes `failed` and the route still returns 200 (`webhook-whatsapp.ts:572-590`): the message is lost. If the appointment tx is the victim, the catch deletes the calendar event (`:367-375`); no data loss. Callers: `routes/appointments/create-appointments.ts:49`, `scheduling-confirmation-orchestrator.ts:166`.
- **R-V1b-1: confirmed (low probability, real effect).** `generateMarianaResponse.ts` reads the lead (`:442-446`) and the active conversation (`:453-463`) before the Gemini call, then writes in its own tx (`:697`): lead fields (`persistLeadUpdate :129-145`), conversation status, scheduling actions, assistant row in `activeConversation.id` (`:821-833`) and the outbox. Nothing re-checks the conversation. If the rotation commits during the Gemini call, the turn writes A's commercial fields onto the reset lead and replies from closed A. Second path: a task of A run after the rotation finds B as "active" (`:453`) and writes A's turn into B. `handleProcessInboundMessage` (`autonomous-task-handlers.ts:168-183`) does not read `conversations.status`. Decision: guard it (step 28), because it breaks the CLAUDE.md invariant "A new conversation never inherits the commercial state of the previous one" and the fix is local.
- **Spec-gap 1 (R-SCH-03/S-07/S-08 vs S-20): confirmed.** Spec:59, :105, :106 vs :118. The code already follows S-20 after 4h (step 22). Docs-only.
- **Spec-gap 2 (R-SES-03 "pista"): confirmed.** Spec:71 vs :70. The code already gives no hint: the snapshot is write-only (no reader outside `session-rotation.ts`), the lead fields are reset (`:129-142`). Docs-only.

## Rev2 — Design
- **Redelivery keeps its conversation (F-V1b-1, rec. D-R2-1 a).** `resolveConversationForInbound` gets an optional `externalId`. After the lead lock and before the gap check, it looks up a `role = user` message with that `externalId`.
  - Found in the active conversation → return it, `rotated: false`, `redelivery: true`. No rotation, nothing superseded; the existing `inbound:X` task on A answers X. The text branch keeps today's writes (`lastCustomerMessageAt = receivedAt`, so the next message continues A after the late reply).
  - Found in a closed conversation (a newer message already rotated) → return that conversation, `redelivery: true`. The text branch writes nothing else and marks the event `processed` in the same tx. No reply: the newer message was already answered in B (R-SES-02 "começa do zero").
  - Not found → today's behavior.
  - The lookup runs under the lead lock, so a concurrent new message cannot rotate between the lookup and the insert.
- **Lead first (F-V1b-3).** First statement of the tx at `appointment-service.ts:280`: `SELECT id FROM leads WHERE id = $leadId FOR UPDATE`. Then session, appointment, lead as today. Conforms to the step-23 static scan.
- **Stale-turn guard (R-V1b-1).** `generateMarianaResponse` gets an optional `expectedConversationId`; `handleProcessInboundMessage` passes `task.conversationId`.
  - Handler: also select `conversations.status`. If not `active` → complete the task with `result.skipped = "conversation_not_active"`, mark the event `processed`, no Gemini call.
  - Turn start (`:453-463`): active id ≠ expected → same skip, no Gemini call.
  - Persist tx (`:697`): first lock the lead `FOR UPDATE`, re-read the active conversation; if ≠ expected → throw a typed `TurnSupersededError` before any write. The handler catches it → same skip. No lead write, no assistant row, no outbox.
  - Other callers of `generateMarianaResponse` (no `expectedConversationId`) keep today's behavior.
- Must NOT change: `SESSION_INACTIVITY_MS` and the `>=` boundary; the rotation steps (snapshot, reset, supersede, close, expire, B, `optOutAt`, status rule); dedup in `claimWhatsAppWebhookEvent`; debounce/batching; outbox state machine; `runKey`s; prompts/knowledge; `drizzle/`; `.claude/`; `.env`.

## Rev2 — Steps (numbering continues; 24–25 are replaced at the end)

**Batch V2-a — no silent message, no lock cycle**

26. **Redelivery stays in its conversation** (F-V1b-1; BLOCKED until D-R2-1 is answered; the text below is option a).
    - Files: `session-rotation.ts:59-93` (param `externalId?`, lookup after `:63-68`, result `redelivery?`); `webhook-whatsapp.ts:490-560` (pass `externalId`; closed-conversation case marks the event `processed` and returns).
    - Tests (DB), **red first**:
      - `session-rotation-adversarial.test.ts:531` "reentrega ≥ 4h depois de mensagem gravada e não processada em A ainda responde uma vez": remove `todo`; add asserts: 1 conversation (A, `active`), no snapshot `session-rotation:<A id>`, the reply is in A, the event is `processed` after the drain. Red today: `sent.length` actual 0, expected 1. Rule: R-SES-02 v1.4 / S-22, R-REL-02.
      - `session-rotation.test.ts` "reentrega de mensagem já gravada numa conversa fechada não cria conversa nem resposta": given X in closed A, B active and answered; when X is redelivered; then B unchanged (no new message, no task, `lastCustomerMessageAt` not bumped), no outbox, event `processed`. Red today: the event stays `processing` and B's `lastCustomerMessageAt` is bumped to the redelivery time. Rule: R-REL-02, R-SES-01.
      - Regression (green before and after): "a mesma entrega repetida após 4h…" (K-5) and "4h − 1 ms continua na mesma conversa" (`webhook-whatsapp.test.ts:1658`).
    - Invariants: one active conversation (lookup under the lead lock); a duplicate event never processed twice (no new task; existing key reused); no outbox change.

27. **Appointment locks the lead first** (F-V1b-3).
    - File: `appointment-service.ts:280` (one `FOR UPDATE` on `leads` as the first tx statement).
    - Test (DB, new `src/tests/reliability/lock-order.test.ts`), **red first**: "agendamento e rotação concorrentes não dão deadlock; a mensagem é gravada" — given a `qualified` lead with an active scheduling session and a fake `GoogleCalendarService` (`new AppointmentService(fake)`); when T0 locks the lead `FOR UPDATE`, `createConfirmedAppointment` starts, the test waits until its backend shows `wait_event_type = 'Lock'` in `pg_stat_activity`, then T0 UPDATEs that session to `expired` and commits; then T0 commits without error, the appointment rejects with "A sessão de agendamento não está mais ativa.", `deleteEvent` was called once, no `appointments` row. Red today: 40P01 `deadlock detected` in one of the two. Rule: R-SES-02 v1.3 ("respondida uma única vez") and R-SCH-03 (no lost tap).
    - Regression: `src/tests/services/appointment-service.test.ts` and `phase3-scheduling-workflow.test.ts` green; step-23 unit static scan green.
    - Invariants: confirming a slot still requires the persisted `selectedSlotId` (no change to the checks); the calendar compensation path unchanged.

**Batch V2-b — stale turn**

28. **A turn of a closed conversation writes nothing** (R-V1b-1; BLOCKED until D-R2-2 is answered; text below is option a).
    - Files: `autonomous-task-handlers.ts:168-183, 258-266` (status read, pass `expectedConversationId`, catch `TurnSupersededError`); `generateMarianaResponse.ts:453-463, 697` (param, start check, lead lock + re-check as first statements of the tx).
    - Tests (DB, `session-rotation-adversarial.test.ts`), **red first**:
      - "turno em andamento em A quando a rotação acontece não grava no lead nem responde" — Gemini mock that blocks until released; start the A task; while it waits, post a text ≥ 4h (rotation commits); release Gemini. Then the lead fields are the reset values, no assistant row in A, no outbox from A, B has 1 inbound task and, after drain, 1 reply; A's task `completed` with `skipped = conversation_not_active`. Red today: lead fields from the A turn, 1 outbox from A. Rule: R-SES-02 v1.3 ("começa do zero"), CLAUDE.md "never inherits the commercial state".
      - "tarefa de A executada depois da rotação não responde em B" — given rotation done and an A inbound task forced to `pending`; when drained; then 0 Gemini calls, 0 messages in B from that task, task skipped. Red today: 1 reply written into B. Rule: R-SES-01, R-SES-02.
      - Replace the tester's characterization "rotação só supera tarefas pending de A; tarefa em processing não é tocada; B recebe o inbound" (`:366`) only if it asserts the old reply; otherwise keep it green.
      - Regression: the full rotation files and the AI-turn suites green.
    - Invariants: lead lock first (static scan); the AI is not the authority (no change); one reply per batch on B.

**Batch V1-d (replaced) — docs and final check**

24. **Docs (Rev2 text; Rev1 step 24 is superseded).** Each text needs Davi's approval (D-R2-3, D-R2-4).
    - `docs/specs/MARIANA_BEHAVIOR_SPEC.md` → v1.4 exactly as in "Rev2 — Spec v1.4 wording". Header "Versão: 1.4 (date) … Mudanças da v1.1 à v1.4 no fim do documento"; new section "Mudanças da v1.4".
    - `CLAUDE.md:36`: remove "At most one pending session choice per conversation." Add (E8-a): "A new conversation is opened only by the backend, under the lead lock, in the transaction that stores the inbound." If D-R2-4 = a, also add: "A transaction that writes a lead and its conversations, scheduling sessions or appointments locks the lead first." Keep `:37`.
    - `docs/CODEMAP.md:46`: add "redelivery keeps its conversation; stale-turn guard (`expectedConversationId`)" and "lock order: `leads` first".
    - `docs/specs/2026-10-17-scheduling-and-session-flow.md:93,124,125` (D6, AC11, AC12): automatic new conversation (Rev1 item kept).
    - `docs/specs/ROADMAP-2026-10-22.md:29`: Rev1 roadmap note (kept).
    - Proof: `grep -n "Continuar\|Nova conversa\|session choice\|pista" CLAUDE.md docs/CODEMAP.md docs/specs`, `git diff --check`. No code.
25. **Final verification (tester, Rev2 text).** `test:unit`, `test:db` (local, workers off) twice (the lock tests are timing-sensitive), `tsc`, `build`; red→green evidence for steps 20–23 and 26–28; no `todo` left for F-V1b-1; manual staging checklist S-18–S-23.

Every step: red test first, full suites once per batch, `RELIABILITY_WORKERS_ENABLED=false`, no Neon, no real Gemini/WhatsApp/Google, no git writes.

## Rev2 — Spec v1.4 wording (proposal; the spec is NOT edited until Davi approves)
- **R-SES-02 (v1.4)**: v1.3 text + "Uma mensagem que o WhatsApp reenvia depois de já ter sido gravada continua na conversa em que foi gravada e é respondida uma única vez ali, mesmo que o reenvio chegue 4h ou mais depois; o reenvio não abre conversa nova."
- **R-SES-03 (v1.4)** (coordinator rec. b): "Uma conversa nova começa do zero. Só dados duráveis (nome, telefone) são reaproveitados. Nada da conversa anterior passa para a nova, nem como pista: objetivo, tipo de consórcio, situação, interesse, ofertas e horários não são citados nem sugeridos."
- **R-SCH-03 (v1.4)** (coordinator rec. a): "Nenhum toque em botão fica sem resposta. Na mesma conversa (menos de 4h sem mensagem do cliente): sessão expirada → aviso + nova oferta; etapa errada ou botão de uma oferta antiga → aviso curto + os botões da etapa atual. Depois de 4h ou mais, vale a S-20. Todo toque é gravado como mensagem do cliente na conversa."
- **S-07 (v1.4)**: Situação "Toca num botão de uma oferta antiga, já substituída, na mesma conversa (menos de 4h)". Esperado "Aviso curto + os botões da etapa atual; nunca silêncio. Depois de 4h, vale a S-20".
- **S-08 (v1.4)**: Situação "Toca num botão depois que a sessão expirou, na mesma conversa (menos de 4h)". Esperado "Aviso + nova oferta. Depois de 4h, vale a S-20".
- **S-22 (new)**: Situação "O WhatsApp reenvia, 4h ou mais depois, uma mensagem já gravada que ainda não foi respondida". Esperado "Uma única resposta, na conversa em que a mensagem foi gravada; nenhuma conversa nova; nunca silêncio".
- **S-23 (new)**: Situação "Uma resposta da conversa anterior ainda estava sendo preparada quando a conversa nova abriu". Esperado "Essa resposta não é enviada e não muda nada na conversa nova; a mensagem nova recebe uma única resposta, na conversa nova".
- **Mudanças da v1.4**: "R-SES-02: reenvio fica na conversa original. R-SES-03: começa do zero, nem como pista. R-SCH-03, S-07 e S-08 valem só com menos de 4h; depois vale a S-20. S-22 e S-23 novos."
- If D-R2-1 = b, R-SES-02 and S-22 change to "o reenvio abre conversa nova e a mensagem é respondida ali, do zero".

## Rev2 — Out of scope
- A redelivered **tap** after 4h: it gets the E1 reply in B (S-20), not silence. Making taps follow the "first store decides" rule needs a stored tap message; later.
- In-flight non-AI tasks on A (button reply, consultant preference, confirmation) during the rotation: they need a tap that is ≥ 4h old and still running. Listed as a risk, no guard.
- Webhook tx failure returns 200 and marks the event `failed` (no Meta redelivery): systemic, covers every error, not only 40P01. Package B (F-03); a 40P01 retry is not added here.
- Using Meta's message timestamp instead of `receivedAt` as the 4h clock.
- Q1/F2-05, Q4/F2-08, F2-19, migrations, Neon writes, prompts/knowledge.

## Rev2 — Questions for the owner
- **D-R2-1 — who answers a late redelivery (blocks step 26).** (a, rec.) Conversation A, where the message was first stored: no rotation from a redelivery; Mariana answers in A's context; the next message continues A. No row is moved. (b) Rotate and move X into B (`messages.conversationId` and the task change): answer from zero in B. Changes A's history and needs more code.
- **D-R2-2 — R-V1b-1 (blocks step 28).** (a, rec.) Guard the AI turn as in step 28. (b) List only (low probability) and accept the rare inherited field.
- **D-R2-3 — spec v1.4 wording (blocks step 24 spec part).** (a, rec.) As written above (includes coordinator recs a and b, S-22, S-23). (b) Approve with changes.
- **D-R2-4 — lock-order invariant in CLAUDE.md.** (a, rec.) Add the "lead first" line next to E8. (b) Only E8 and the CODEMAP note.
- Still open from Rev1, not blocking code: E3-a deploy precondition (the 2 read-only Neon SELECTs return 0, run by Davi). Q1, Q4 unchanged.

## Revision history (Rev2)
- Revision 2 (2026-10-27): F-V1b-1, F-V1b-3, R-V1b-1 and the Step-19 spec-gaps. New steps 26–28 (batches V2-a, V2-b); steps 24–25 replaced. Steps 19–23 unchanged. Waiting for Davi's approval of the plan and D-R2-1 to D-R2-4.

---

# Revision 2.1 — mudanças pedidas pelo Davi (2026-10-27)

Davi's reply to Rev2, verbatim: "aprovo as mudanças, mas antes, verifique uma coisa, quando o cliente quer marcar reunião, o agente manda primeiro o horarios depois pergunta se tem preferencia de consultor. então tire a escolha de consultor, deixe somente o horario e depois do horario o botão para confirmar"
Second decision, verbatim: "deixe random a escolha de consultor"
Treated as "aprovo com mudanças". The status stays DRAFT. The coordinator had proposed two changes, and Davi approved both: F-V1c-1 is handled like S-07; step 27 uses a real deadlock test. D-R2-1 to D-R2-4 (recommended option a) are not confirmed explicitly, so the next approval must confirm them. Inputs: `test-report.md` "V1-c" (F-V1c-1 to F-V1c-4).

## Rev2.1 — Consultant flow: what the code does today (evidence)
- **Davi's description is confirmed, and the code also violates the spec.** Spec R-SCH-01 (v1.1, spec:57, changelog :131) already says "Não há pergunta de preferência de consultor", and ROADMAP D-10 (`ROADMAP-2026-10-22.md:18`) says the same. The code was never changed. The old design is in `2026-10-17-scheduling-and-session-flow.md:66-80`.
- Flow today:
  1. The AI turn with `schedule_meeting` gets the slots (`generateMarianaResponse.ts:872-878`, top 3) and persists the session at `awaiting_availability` plus the slots (`scheduling-offer-service.ts:102-134`).
  2. It enqueues `send_consultant_preference_question` (`generateMarianaResponse.ts:908-915`, `scheduling-offer-service.ts:171-190`).
  3. The inbound handler sends the slot buttons "Tenho estes horários disponíveis. Escolha uma opção:" (`autonomous-task-handlers.ts:286-293`, `scheduling-offer-service.ts:30-48`).
  4. The preference task moves the session to `awaiting_consultant_preference` and sends "Você tem preferência por algum consultor?" [Tenho preferência | Sem preferência] (`TH:485-588`, buttons `pref:<session>:has_preference|no_preference`).
  5. With "Tenho preferência", the customer gets consultant buttons `consultant:<session>:<id>` (`TH:594-741`). The pick writes `preferredConsultantId` and moves the session to `awaiting_slot_selection` (`TH:802-940`, `:917-918`). With "Sem preferência", the same slots are sent again and the session moves to `awaiting_slot_selection` (`TH:743-791`).
  6. A slot tap sets `selectedSlotId` (`scheduling-choice-service.ts:120`), moves the session to `awaiting_confirmation` and sends "Você escolheu X com <consultor>. Posso confirmar?" (`TH:996-1078`, `scheduling-confirmation-service.ts:110`).
  7. A tap on Confirmar books the appointment (orchestrator `:166`, `appointment-service.ts`).
- **Bugs that this ordering causes (confirmed by reading the code):**
  - B-1: a slot tap on the first set of buttons, before the customer answers the preference question, is skipped in silence. The stage is not `awaiting_slot_selection` (`TH:996-998`). This breaks R-SCH-01 ("nunca dois conjuntos de botões concorrentes") and R-SCH-03.
  - B-2: the single-slot shortcut sends Confirmar directly (`TH:288-290`, `scheduling-confirmation-service.ts:123`). But `selectedSlotId` is never set and the stage is never `awaiting_confirmation`, so the confirm tap is rejected (`scheduling-confirmation-service.ts:162-169`) and nothing is sent back (`TH:374-401` has no reply when the result is not ok).
  - B-3: the confirm tap fails when the slot was taken in the meantime (`appointment-service.ts` revalidates: DB conflict + Calendar `getBusyPeriods`, reason `slot_unavailable`). The orchestrator collapses that into `appointment_failed` (`orchestrator:186-191`), and the customer gets no reply.
- **Who assigns the consultant today:** the system does, at offer time, not the customer and not the AI. For each unique time, `consultant-availability.ts:80-103` takes the first free consultant in an order sorted by lowest load, then by name (`scheduling-availability.ts:98-109`). The result is persisted on `scheduling_slots` (`consultantId`, `consultantName`, `calendarId`; `scheduling-offer-service.ts:121-134`). Booking uses the slot's consultant and calendar (orchestrator `:166-167`).
- **What the preference flow writes:** only `scheduling_sessions.preferredConsultantId` (`TH:917`), and it filters the slots that are shown again. No other reader.
- **Prompt and knowledge are not involved.** The question is deterministic backend code. `request_consultant` in `src/ai/agent.ts:313-324` is the human-handoff action, not the preference question. Nothing in C1/C2 changes.

## Rev2.1 — Design (consultant)
- **D-R2-5 (Davi: "deixe random a escolha de consultor").**
  - Rule: for each offered time, the backend draws one consultant at random from the consultants that are free at that time, based on the Calendar availability that is already computed (`consultant-availability.ts:80-103`).
  - The draw happens once, when the offer is persisted. It is stored on `scheduling_slots` before any Confirmar button exists, so Confirmar books exactly the consultant shown in "Você escolheu X com <consultor>". The `selectedSlotId` invariant is unchanged.
  - The AI never picks. The random source can be injected (`random: () => number`, default `Math.random`) through the `ConsultantAvailabilityService` constructor or the offer path, so tests are deterministic.
  - The admin route `routes/appointments/get-availability.ts:27` keeps today's order (it passes no random source).
- **D-R2-5, consultant busy before Confirmar (coordinator's rule; Davi confirms it in this approval).** If the revalidation says `slot_unavailable`:
  - nothing is booked;
  - the backend never swaps the consultant in silence;
  - the backend makes a fresh offer: a new session and new draws, with a notice text and the new slot buttons, all in one tx;
  - if there are no slots, it sends the existing text "No momento, não encontrei horários disponíveis nos próximos 5 dias.".
- **New flow.** Acceptance, then up to 3 slot buttons, then a slot tap (`selectedSlotId`), then "Você escolheu X com <consultor>. Posso confirmar?" [Confirmar | Não], then booking.
  - A multi-slot session starts at `awaiting_slot_selection`.
  - The single-slot shortcut sets `selectedSlotId` and `awaiting_confirmation` inside the `persistOffer` tx (this fixes B-2).
  - No preference task is enqueued.
- **No migration.** The enum values `awaiting_consultant_preference` and `awaiting_consultant_selection` and the column `preferredConsultantId` stay in place, unwritten (migration freeze).
- **Customers who are mid-flow at deploy** (one release, the same pattern as E3-a):
  - a pending `send_consultant_preference_question` task becomes a no-op: the event is marked processed and nothing is sent;
  - a slot tap in `awaiting_availability`, `awaiting_consultant_preference` or `awaiting_consultant_selection` is accepted like `awaiting_slot_selection` (the session's own slot, validated by the backend);
  - a `pref:*` or `consultant:*` tap under 4h gets the S-07 reply: a short notice plus the session's slot buttons, and the session moves to `awaiting_slot_selection`; with no active session it gets the short notice only;
  - after 4h, every tap rotates (E1, unchanged).
- **Must NOT change:** revalidation before booking (R-SCH-06), the Calendar event creation and its compensation, the `confirm:` / `cancel:` checks, `R-SCH-02` slot rules, outbox and `runKey`s, prompts and knowledge, `drizzle/`.

## Rev2.1 — Changes to Rev2 steps
- **Step 27 (amended, F-V1c-2).**
  - The lead-first lock in `appointment-service.ts:280` stays.
  - Acceptance moves to real DB tests:
    - (1) the tester's `session-rotation.test.ts:1581` "tester: F-V1b-3 — rotação e confirmação de agendamento concorrentes não entram em deadlock": remove `todo`. Red today: `actual: ['40P01'], expected: []`.
    - (2) the "lock-order.test.ts" test from Rev2.
  - Replace the unit static scan `session-choice-policy.test.ts:171` "nenhum caminho de sessão trava conversa antes do lead (F-V1b-2)" with the DB test "toque e confirmação concorrentes não dão deadlock (lead primeiro)", in the same file as (2). Given a text/tap tx and an appointment tx for the same lead, run both orders. Then neither side gets 40P01, and the webhook event is never `failed`. The scan is too strict and incomplete (F-V1c-2).
  - Rule: R-SES-02 ("respondida uma única vez") and R-SCH-03.

## Rev2.1 — New steps
**Batch V2-b (amended): steps 28 and 29**

29. **Legacy `sessao:*` tap under 4h answers like S-07** (F-V1c-1; needs the D-R2-6 text).
    - Files: `webhook-whatsapp.ts` legacy branch (`buttonId.startsWith("sessao:")`, near `:443-456`); a small helper `replyToStaleTap(tx, …)` in `autonomous-task-handlers.ts` or a new `stale-tap-reply.ts`, reused by step 32.
    - Change: in the same tx, insert one assistant row and one outbox entry, key `stale-tap:<externalId>`. With an active scheduling session: the notice plus the current stage's buttons (slot buttons, or Confirmar/Não in `awaiting_confirmation`). Without one: the notice only. The event is marked `processed`.
    - Tests (DB, `session-rotation.test.ts`), **red first**:
      - replace the assertion at `:1162` (`sent = []`) with "toque legado sessao:* com menos de 4h responde com aviso curto, nunca silêncio": 1 outbox with the D-R2-6 text, no AI call, no task. Red today: `sent` is empty. Rule: R-SCH-03, S-07.
      - "toque legado sessao:* repetido pelo Meta responde uma vez" (R-REL-02).

**Batch V2-c — consultant removal, core: steps 30 and 31**

30. **Random consultant per offered time** (D-R2-5).
    - Files: `consultant-availability.ts:20-30, 80-103` (random source; draw among the consultants free at the time); `scheduling-availability.ts:33-110` (pass the source); `generateMarianaResponse.ts:872` (offer path uses the random source).
    - Tests, **red first**:
      - unit `src/tests/services/consultant-availability.test.ts` (extend or create) "sorteia o consultor entre os livres naquele horário com a fonte aleatória injetada": 3 consultants, 2 free at T. `random = () => 0.99` picks the 2nd free one; `() => 0` picks the 1st. The busy one is never picked. Red today: always the lowest-load consultant. Rule: R-SCH-01 v1.4.
      - unit "um único consultor livre é sempre o escolhido" (regression).
      - DB "a oferta grava o consultor sorteado no slot e a confirmação usa esse consultor": slot row `consultantId` = the drawn one; after the slot tap and Confirmar, `appointments.consultantId` and the Calendar fake `createEvent.calendarId` match that consultant. Rule: R-SCH-01, R-SCH-04.
    - Invariants: the AI is not the authority (draw in the backend only); R-SCH-06 revalidation unchanged.

31. **No preference question; slots, then Confirmar** (R-SCH-01; fixes B-1 and B-2).
    - Files: `generateMarianaResponse.ts:908-915` (drop the enqueue); `scheduling-offer-service.ts:102-134` (start stage `awaiting_slot_selection`; single slot → `selectedSlotId` + `awaiting_confirmation` in the same tx; `enqueueConsultantPreferenceQuestion` removed); `TH:485-940` (preference, consultant-list and selection handlers removed from the active flow; step 32 handles the legacy task types).
    - Tests (DB, `phase3-scheduling-workflow.test.ts` or a new `scheduling-without-consultant-choice.test.ts`), **red first**:
      - "aceite oferece só horários; nenhuma pergunta de preferência" (S-01, R-SCH-01): after the turn, exactly 1 outbox with buttons (slots), 0 outbox with `pref:` buttons, 0 `send_consultant_preference_question` tasks. Red today: 1 preference task and question.
      - "toque no horário da primeira oferta pede Confirmar com o consultor do horário" (B-1): reply "Você escolheu … com <consultor>. Posso confirmar?", `selectedSlotId` set. Red today: skipped, no reply.
      - "um único horário: Confirmar agenda" (B-2): Confirmar creates the appointment. Red today: rejected (`invalid_workflow_stage` or selection mismatch).
      - "Confirmar exige o selectedSlotId gravado" (CLAUDE.md invariant, R-SCH-04): `confirm:<other slot>` is rejected (regression).
      - Update or delete the old tests that assert the preference question. List: `phase3-scheduling-workflow.test.ts`, `handler-partial-failure.test.ts`, `objective-flow-matrix.test.ts`, `webhook-whatsapp.test.ts` (grep `pref:|awaiting_consultant|send_consultant_preference_question`). Port any case that stays valid.

**Batch V2-d — mid-flow customers and a busy slot: steps 32 and 33**

32. **Customers caught mid-flow at deploy** (one release).
    - Files: `TH` registry (the legacy `send_consultant_preference_question`, `process_consultant_preference_reply` and `process_consultant_selection` types map to the S-07 / no-op path); `TH:996-998` (accept a slot tap in the 3 legacy stages); the `webhook-whatsapp.ts:461-465` routing.
    - Tests (DB), **red first**:
      - "tarefa pendente de pergunta de preferência é drenada sem enviar nada" (red: the question is sent);
      - "sessão em awaiting_consultant_preference: toque no horário segue para Confirmar" (red: skipped);
      - "toque pref:* antigo responde aviso + botões de horário e vai para awaiting_slot_selection" (S-07; red: the consultant list or the slots are sent with no notice);
      - "toque consultant:* antigo idem".
    - Rule: R-SCH-03, S-07, S-25.

33. **Slot taken before Confirmar → re-offer, never swap** (D-R2-5; fixes B-3; needs the D-R2-6 text).
    - Files: `scheduling-confirmation-orchestrator.ts:186-191` (keep the `slot_unavailable` reason instead of collapsing it); `TH:374-401` (on `slot_unavailable`: new availability with the random source, `persistOffer`, one assistant row and one outbox with the notice and the new buttons, key `reoffer:<externalId>`, same tx; other failures unchanged, package B).
    - Tests (DB), **red first**:
      - "consultor do horário ocupado antes do Confirmar: nada agendado, nova oferta, consultor não trocado" (S-24): the Calendar fake reports busy for the drawn consultant. Then 0 appointments, 1 `deleteEvent` or no `createEvent`, 1 outbox with the notice and new slot buttons, a new session, and no appointment with another consultant at the old time. Red today: no reply.
      - "reoferta repetida pelo Meta responde uma vez" (R-REL-02).
      - "sem horários na reoferta: texto de sem horários" (regression text).
    - Invariants: `selectedSlotId` (the new offer means a new session and a new selection); R-SCH-06.

Order: V2-a (26, 27), V2-b (28, 29), V2-c (30, 31), V2-d (32, 33), then V1-d (24, 25). Step 25 adds red→green evidence for steps 29–33 and manual staging checks for S-24 and S-25.

## Rev2.1 — Spec v1.4 wording, additions (proposal)
- **R-SCH-01 (v1.4):** "Um único caminho, nesta ordem: **aceite → até 3 horários em botões → Confirmar/Não, já com o consultor daquele horário → confirmação final** com data, hora e consultor. O consultor de cada horário é sorteado pelo sistema entre os consultores livres naquele horário, uma única vez, quando os horários são oferecidos; o cliente nunca é perguntado e a IA nunca escolhe. Não há pergunta de preferência de consultor. Nunca dois conjuntos de botões concorrentes."
- **R-SCH-07 (new):** "Se o horário escolhido ficar ocupado antes do Confirmar, nada é agendado: a Mariana avisa numa frase e oferece horários novos. O consultor nunca é trocado sem o cliente ver."
- **S-24 (new):** Situação "Escolhe um horário e, antes de confirmar, o consultor daquele horário fica ocupado". Esperado "Aviso curto + nova oferta de horários; nenhum agendamento; o consultor nunca é trocado em silêncio".
- **S-25 (new):** Situação "Estava na pergunta antiga de preferência de consultor quando a mudança entrou e toca um desses botões". Esperado "Aviso curto + os botões de horário (S-07); nenhuma pergunta de consultor".
- **Mudanças da v1.4**, append: "R-SCH-01: consultor sorteado entre os livres, sem pergunta. R-SCH-07, S-24 e S-25 novos."
- `ROADMAP-2026-10-22.md:18` (D-10): "pela menor carga" → "sorteado entre os livres" (step 24).

## Rev2.1 — Questions for the owner
- **Confirm D-R2-1 to D-R2-4**, option a for each (Rev2). The reply "aprovo as mudanças" did not name them.
- **D-R2-5, consultant (Davi decided: "deixe random a escolha de consultor").** To confirm:
  - (a, rec.) the draw happens at offer time, among the free consultants, and is stored on the slot; when the slot is taken before Confirmar, the customer gets a fresh offer and the consultant is never swapped;
  - (b) the draw happens at the slot tap: one more Calendar call per tap, and the consultant could differ from the one available when the offer was made.
- **D-R2-6, new fixed texts (block steps 29, 32 and 33).**
  - (a, rec.) Stale tap: "Esse botão é de uma mensagem antiga." When the customer is in the middle of scheduling, the current buttons follow with "Estes são os horários que tenho para você:" (or the Confirmar/Não question). Otherwise add "Me conta o que você precisa agora?".
  - (a, rec.) Re-offer: "Esse horário acabou de ficar indisponível. Tenho estes outros horários:" followed by the slot buttons.
  - (b) Davi writes the texts.
- **D-R2-7, load balance.** Random ignores the consultants' load.
  - (a, rec.) Pure random, as Davi asked.
  - (b) Random only among the consultants with the lowest load at that time.

## Rev2.1 — Out of scope
- F-V1c-3: other wrong-stage taps are still silent (package B / F-03), except the legacy cases in steps 29 and 32.
- F-V1c-4:
  - (1) the E1 wording also answers `pref:`, `consultant:` and `sessao:` taps after 4h. After step 31 the first two only come from legacy messages.
  - (2) taps are not stored as customer messages (R-SCH-03, last clause). This gap is pre-existing.
- The admin availability route keeps its order. Dropping the enum values or the column needs a migration (package G).

## Revision history (Rev2.1)
- Revision 2.1 (2026-10-27): Davi's "aprovo com mudanças" plus the consultant decision. Step 27 amended (F-V1c-2). New steps: 29 (F-V1c-1), 30 to 33 (consultant removal, random draw, mid-flow customers, re-offer). Spec v1.4 additions. Waiting for approval of the plan, the confirmation of D-R2-1 to D-R2-4, and D-R2-5 to D-R2-7.

---

# Revision 3 — close V2 tester findings (2026-10-27)

Inputs: `test-report.md` "Steps 26–27", "Steps 28–29", "Steps 30–31", "Steps 32–33" (F-T32-1 FAIL, F-T26-1, F-T26-2, F-T27-1, step-28 window, HTTP route, `turn_error` label, R-SCH-07 clash, single-slot re-offer text); `progress.md` steps 26–33. Base: working tree on `develop` @ `a0b12fc` (V2 uncommitted). Steps 19–23 and 26–33 are done and not changed. `TH` = `src/services/conversations/autonomous-task-handlers.ts` (950 lines now; the line numbers below are current).

## Rev3 — Summary
- No tap gets silence when the stage refuses it: old-offer slot, old Confirmar, old Não, a second old tap after rotation (F-T32-1, F-V1c-3).
- Every remaining "session first, then a row that points to the lead" tx locks the lead first, and the post-commit tail of the AI turn is guarded too (F-T27-1, step-28 window).
- Small closures: an old tap redelivered after B opened does not touch B (F-T26-2); `superseded` trace outcome; S-22 wording vs F-T26-1; re-offer text with one slot; spec numbering.

## Rev3 — Root causes
- **F-T32-1: confirmed (planner cause).** Slot tap: `TH:820-823` returns `skipped` (`no_active_session_or_invalid_stage`) and `TH:832-835` returns `skipped` (`choiceResult.reason`: `no_active_session`, `slot_from_another_session`, `expired`, `invalid_workflow_stage`, `selection_already_made`) with no outbox; `TH:894-897` (`session_changed_before_confirmation`) is the same. Confirm/cancel: `TH:585-588` and `TH:626-629` return `rejected` with no outbox. After step 33 the old offer stays on screen, so the case is common. Pinned by tester `todo`s `scheduling-without-consultant-choice.test.ts:1194, :1227` (`3 !== 4`) and locked in as silence by `session-rotation.test.ts:2144` (`assert.deepEqual(sent, [])` at `:2170`).
- **F-V1c-3: confirmed, same fix.** The second old tap after rotation is routed to `send_confirmation_request` on B; B has no session, so it exits at `TH:820-823`. Tester test `session-rotation.test.ts:1748` asserts only the E1 reply (`:1768`).
- **F-T26-1: confirmed (spec vs plan).** Code follows the approved step 26 (`webhook-whatsapp.ts:517-528`: redelivery into a closed conversation → event `processed`, nothing else). S-22 v1.4 ("nunca silêncio") is wider than D-R2-1 (a). Resolution: D-R3-1.
- **F-T26-2: confirmed.** The tap branch calls `resolveConversationForInbound` without any key (`webhook-whatsapp.ts:374-378`) and always bumps `lastCustomerMessageAt` (`:388-394`). Taps are not stored as messages, so the step-26 lookup (`session-rotation.ts:90-111`, `messages.externalId`) cannot find them. The tap's own task key `button-reply:<externalId>` (`webhook-whatsapp.ts:491`) already exists in A. Pinned by `todo` `redelivery-adversarial.test.ts:428`.
- **F-T27-1: confirmed, re-located.** Steps 32–33 deleted most of the old lines (preference/consultant handlers). Two txs still do `UPDATE scheduling_sessions` before a lead-FK insert, with no lead lock:
  - `TH:858-892` (`handleSendConfirmationRequest`): UPDATE session → `enqueueOutboundMessage` with `leadId`.
  - `scheduling-offer-service.ts:76-199` (`persistOffer` `write`, default path): UPDATE sessions (`:84`, `:99`) → INSERT `scheduling_sessions` (`:115`, FK to `leads`). The AI-turn caller passes no executor (`generateMarianaResponse.ts:~956`).
  - Already lead-first: `TH:402-407` (re-offer), `TH:714-719` (legacy tap), webhook txs (via `resolveConversationForInbound`), `generateMarianaResponse.ts:730` (step 28), `appointment-service.ts:280` (step 27). Single-statement autocommit updates (`scheduling-choice-service.ts:118`, `scheduling-cancellation-service.ts:99, :133`, `scheduling-session-expiration.ts:16`) cannot form a cycle.
- **Step-28 window: confirmed.** After the guarded tx commits, `runSchedulingOfferIfAuthorized` calls Calendar then `persistOffer` on `activeConversation.id` (`generateMarianaResponse.ts:917-981`), and the handler enqueues the reply with no re-check (`TH:324-341`). A rotation that commits in that window lets A's reply go out and writes an active scheduling session into closed A. Fix is local (same pattern as step 28), so it is planned, not only listed.
- **HTTP route: confirmed.** `receive-customer-message.ts:134` calls `generateMarianaResponse` without `expectedConversationId`. That route never rotates and writes into the conversation id the caller gives. It has no auth (Q1/F2-05, still open). Resolution: D-R3-2.
- **`turn_error` label: confirmed.** `emitFailureTrace` maps every non-model error to `turn_error` (`generateMarianaResponse.ts:382-384`); `TurnOutcome` has no `superseded` (`src/lib/turn-trace.ts:35-39`).
- **R-SCH-07 clash: confirmed.** `MARIANA_BEHAVIOR_SPEC.md:63` already has R-SCH-07 ("Só é agendado depois…"). The Rev2.1 re-offer rule becomes **R-SCH-08**. Code comments that cite it: `TH:349`, `TH:357`, `scheduling-confirmation-orchestrator.ts:191`, `scheduling-without-consultant-choice.test.ts:805`.
- **Single-slot re-offer text: confirmed.** `TH:448-459` builds `SLOT_UNAVAILABLE_REOFFER_TEXT + "\n" + buildSingleSlotConfirmationMessage().body` → "…Tenho estes outros horários:\nTenho um horário disponível: X com N. Posso confirmar?". Plural + "Tenho … Tenho". Resolution: D-R3-3.

## Rev3 — Design
- **Refused tap → stale-tap reply (F-T32-1, F-V1c-3).** One helper in `TH`, `replyToRefusedTap(task, conversationId, leadId, externalId, eventId)`:
  - one tx: `leads` FOR UPDATE; re-read `conversations.status`; not `active` → no reply (R-V1b-1, same as `TH:709-712`); else `replyToStaleTap(tx, …)` (key `stale-tap:<externalId>`, notice + buttons of the current stage, from `stale-tap-reply.ts:79-151`);
  - then mark the event processed.
  - Called from: `TH:820-823`, `TH:832-835`, `TH:894-897` (slot tap); `TH:585-588` and `TH:626-629` when `!ok` (confirm/cancel).
  - Not called for `appointment_failed` (technical failure; package B / R-REL-05) nor for `slot_unavailable` (step 33 re-offer).
  - `expired` gets the stale-tap reply: the active-session filter in `buildStaleTapPayload` (`:91-97`) finds no session, so it sends notice + "Me conta o que você precisa agora?". S-08 "nova oferta" stays a gap (D-R3-4).
  - Confirm still requires the persisted `selectedSlotId`: the helper only writes text/buttons; it never selects or books.
- **Lead first everywhere left (F-T27-1).** `TH:858`: first statement `leads` FOR UPDATE. `persistOffer` `write`: first statement `leads` FOR UPDATE (re-entrant when the caller already holds it, e.g. `TH:402-407`).
- **Post-commit guard (step-28 window).**
  - `persistOffer` gets optional `requireActiveConversation?: boolean`. When true, after the lead lock it re-reads the conversation; not `active` → throw `TurnSupersededError` before any write. Only the AI-turn call (`generateMarianaResponse.ts:~956`) passes it.
  - `TurnSupersededError` moves to a small module (e.g. `src/services/conversations/turn-superseded-error.ts`) and is re-exported from `generateMarianaResponse.ts`, so `scheduling-offer-service.ts` does not import the turn module (no cycle).
  - Handler `TH:324-341`: the lead read and `enqueueOutboundMessage` run in one tx that locks the lead and re-reads `conversations.status`; not `active` → no outbox, event processed, `{ reason: "conversation_not_active", skipped: true }`. The existing `TurnSupersededError` catch (`TH:291-294`) also covers the offer throw.
  - Residual: A keeps an assistant row that is never sent (closed conversation, history only).
- **Tap redelivery keeps its conversation (F-T26-2).** `resolveConversationForInbound` gets optional `tapExternalId`. Under the lead lock, before the gap check, it looks for a row this tap already produced for the same lead: task `button-reply:<id>`, or outbox `stale-tap:<id>` / `sessionRotationTapReplyKey(id)`. Found → return that row's conversation, `redelivery: true`, `rotated: false`. Tap branch: `redelivery` and conversation not `active` → event `processed`, return (no bump, no task, no reply). `redelivery` and active → today's path unchanged.
- **Trace.** `TurnOutcome` += `"superseded"`; `emitFailureTrace` maps `TurnSupersededError` to it.
- Must NOT change: rotation steps and the 4h boundary; dedup in `claimWhatsAppWebhookEvent`; outbox state machine; existing `runKey`s and `stale-tap:`/`reoffer:` keys; D-R2-6 texts (except D-R3-3); consultant draw; R-SCH-06 revalidation; prompts/knowledge; `drizzle/`; `.claude/`; `.env`.

## Rev3 — Steps (numbering continues; 24–25 amended at the end)

**Batch V3-a — no silent tap**

34. **A tap the stage refuses gets the stale-tap reply** (F-T32-1, F-V1c-3).
    - Files: `TH:585-588, 626-629, 820-823, 832-835, 894-897` + new local helper `replyToRefusedTap` (uses `replyToStaleTap`, `stale-tap-reply.ts:158`).
    - Tests (DB), **red first**:
      - `scheduling-without-consultant-choice.test.ts:1194` "tester: depois da reoferta, toque num horário da oferta antiga responde…": remove `todo`. Red today `3 !== 4`. Rule R-SCH-03, S-07.
      - `:1227` "tester: depois da reoferta, Confirmar antigo responde…": remove `todo`; also assert 0 new appointments. Red `3 !== 4`. Rule R-SCH-03, R-SCH-04.
      - `session-rotation.test.ts:2144` "toque num horário de outra sessão em etapa legada…": rename to "… responde aviso e não muda a etapa"; replace `sent = []` with exactly 1 reply starting with `STALE_TAP_NOTICE`; stage and `selectedSlotId` asserts kept. Red `[] vs 1`. Rule R-SCH-03, S-25.
      - `session-rotation.test.ts:1748` "tester: dois toques diferentes … após 4h…": expect `[E1, stale-tap notice + "Me conta o que você precisa agora?"]`, still 0 appointments. Red: only E1. Rule R-SCH-03, S-20 (F-V1c-3).
      - New "Não (cancel:) de uma oferta antiga responde aviso + botões atuais" (red: silent). Rule R-SCH-03.
      - New "toque recusado repetido pelo Meta responde uma vez" (same payload twice + task re-run; 1 outbox `stale-tap:<ext>`). Red: 0. Rule R-REL-02.
      - New "toque recusado numa conversa já fechada não responde" (task of closed A; 0 outbox). Green before and after (regression). Rule R-SES-01, S-23.
    - Invariants: `selectedSlotId` (no select, no booking in the helper); lead first; one reply per tap (key); `appointment_failed` path unchanged.

35. **Single-slot re-offer text** (D-R3-3; BLOCKED until Davi answers; text below is option a).
    - Files: `TH:448-459` (body = new constant `SLOT_UNAVAILABLE_SINGLE_REOFFER_PREFIX` + ` ${formatSlotDate(start)} com ${consultantName}. Posso confirmar?`; buttons unchanged from `buildSingleSlotConfirmationMessage`).
    - Test (DB, `scheduling-without-consultant-choice.test.ts` tester "reoferta com um único horário novo…"): body equals exactly "Esse horário acabou de ficar indisponível. Tenho outro horário: <data hora> com <nome>. Posso confirmar?". Red: today's two-line body. Rule R-SCH-08 (new number), S-24.
    - Invariants: Confirmar books the shown consultant (existing tester assert kept); `selectedSlotId` pre-selected by `persistOffer` unchanged.

**Batch V3-b — lock order and the post-commit window**

36. **Lead first in the last two txs** (F-T27-1).
    - Files: `TH:858` (first statement `leads` FOR UPDATE); `scheduling-offer-service.ts:76` (first statement of `write`).
    - Tests (DB, `src/tests/reliability/lock-order.test.ts`, pattern of step 27 test 1 with `lock-wait.ts`), **red first**:
      - "pedido de confirmação (toque no horário) e rotação concorrentes não dão deadlock": T0 locks the lead FOR UPDATE; the slot-tap handler starts; wait for its `Lock` wait; T0 UPDATEs the session to `expired` and commits. Then no 40P01; the handler ends `session_changed_before_confirmation` or replies once (step 34); no event `failed`. Red today `['40P01']`.
      - "oferta (persistOffer) e rotação concorrentes não dão deadlock": same shape on `persistOffer` (default path). Red today `['40P01']`.
      - Regression: `lock-order.test.ts` existing 3, `phase3-scheduling-workflow.test.ts`, `scheduling-without-consultant-choice.test.ts`.
    - Invariants: lead-first rule (D-R2-4); `persistOffer` called with an executor that already holds the lock still works (re-entrant).

37. **AI-turn tail after commit writes and sends nothing on a closed conversation** (step-28 window).
    - Files: new `turn-superseded-error.ts` (move + re-export); `scheduling-offer-service.ts` (`requireActiveConversation`); `generateMarianaResponse.ts:~956` (pass it); `TH:324-341` (lead-locked tx + status re-check before enqueue).
    - Tests (DB, `session-rotation-adversarial.test.ts`, Calendar fake that blocks until released), **red first**:
      - "rotação durante a busca de horários: a oferta de A não é gravada nem enviada": Gemini returns `schedule_meeting` for a qualified lead; while Calendar waits, a text ≥ 4h rotates; release. Then 0 active sessions in A, 0 outbox from A, task `skipped = conversation_not_active`, B answered once. Red: 1 outbox from A + active session in A. Rule S-23, R-SES-02.
      - "rotação durante a busca, sem horários: a resposta de A não é enviada": same, Calendar returns 0 slots (no `persistOffer`, reaches the handler enqueue). Red: 1 outbox from A. Rule S-23.
      - Regression: step-28 tests (`turno em andamento…`, `tarefa de A executada depois…`), AI-turn suites, `generate-mariana-response.test.ts`.
    - Invariants: never inherits commercial state (rotation already reset the lead; nothing rewrites it); one reply per batch on B; other `persistOffer` callers unchanged (flag off).

38. **`superseded` trace outcome + R-SCH-08 comments** (R-REL-07).
    - Files: `src/lib/turn-trace.ts:35-39`; `generateMarianaResponse.ts:382-384`; comment-only renumbering R-SCH-07 → R-SCH-08 at `TH:349, 357`, `scheduling-confirmation-orchestrator.ts:191`, `scheduling-without-consultant-choice.test.ts:805`.
    - Test, **red first**: in `session-rotation-adversarial.test.ts` "turno em andamento em A quando a rotação acontece…", capture the trace the same way `generate-mariana-response.test.ts` does; assert one trace with `outcome = "superseded"`. Red: `'turn_error'`. Rule R-REL-07.
    - Invariants: one trace per turn; no customer text in the trace.

**Batch V3-c — tap redelivery**

39. **Old tap redelivered after B opened does not touch B** (F-T26-2).
    - Files: `session-rotation.ts:70-111` (`tapExternalId?`, lookup under the lead lock); `webhook-whatsapp.ts:374-394` (pass it; closed-conversation redelivery → event `processed`, return before the bump).
    - Tests (DB), **red first**:
      - `redelivery-adversarial.test.ts:428` "tester R2: toque reentregue depois que B abriu não mexe em B": remove `todo`; also assert event `processed`. Red today `B lastCustomerMessageAt not bumped`. Rule R-REL-02, R-SES-01.
      - Regression: E1 redelivery ("… repetido pelo Meta responde uma vez" in `session-rotation.test.ts`), step-29 stale-tap repeat, lock-order tests.
    - Invariants: one active conversation (lookup under the lead lock); duplicate never processed twice; no new task.

**F-T26-1** — no code step if D-R3-1 = a (spec wording in step 24). If D-R3-1 = b, a new plan revision is needed (BLOCKED, not planned here).

**Batch V1-d (amended) — docs and final check**

24. **Docs (Rev2 text + Rev3 amendments).** Everything in Rev2 step 24 and Rev2.1 stays, plus:
    - Rev2.1 "R-SCH-07 (new)" is written as **R-SCH-08** (spec:63 keeps R-SCH-07). "Mudanças da v1.4" says "R-SCH-08, S-24 e S-25 novos".
    - If D-R3-1 = a: R-SES-02 v1.4 sentence ends "… e é respondida uma única vez ali, se essa conversa ainda estiver ativa; o reenvio não abre conversa nova." S-22 Esperado: "Uma única resposta, na conversa em que a mensagem foi gravada, se ela ainda está ativa; nenhuma conversa nova. Se uma mensagem mais nova já abriu outra conversa, o reenvio não recebe resposta separada: a mensagem nova já foi respondida, do zero."
    - If D-R3-3 = a: R-SCH-08 adds "Com um único horário novo: 'Esse horário acabou de ficar indisponível. Tenho outro horário: <data hora> com <consultor>. Posso confirmar?'".
    - If D-R3-4 = a: S-08 Esperado adds "Enquanto a nova oferta automática não existe, o toque recebe o aviso curto e 'Me conta o que você precisa agora?'".
    - `docs/CODEMAP.md`: "refused tap → stale-tap reply", "tap redelivery keeps its conversation", "`superseded` trace".
    - Proof: as Rev2 + `grep -n "R-SCH-07\|R-SCH-08" docs/specs/MARIANA_BEHAVIOR_SPEC.md` (R-SCH-07 once, R-SCH-08 once). No code.
25. **Final verification (tester).** As Rev2 step 25, plus red→green for steps 34–39, `test:db` ×2 (lock tests), 0 `todo` left for F-T32-1 and F-T26-2, manual staging items: test-report "Steps 32–33" checklist 4 and 6 (new text), plus "toque em Não antigo" and "segundo toque antigo após 4h".

Order: V3-a (34, 35), V3-b (36, 37, 38), V3-c (39), then V1-d (24, 25). Every step: red test first, full suites once per batch, `RELIABILITY_WORKERS_ENABLED=false`, `DOTENV_CONFIG_PATH=/dev/null`, no Neon, no real Gemini/WhatsApp/Google, no git writes.

## Rev3 — Out of scope
- S-08 "nova oferta" for a tap on an expired session (needs a Calendar call and a new text; package B) — D-R3-4.
- `appointment_failed` still silent (technical failure; package B / F-03, R-REL-05).
- Storing taps as customer messages (F-V1c-4 (2)); E1 wording for `sessao:` taps (F-V1c-4 (1)).
- The orphan assistant row left in closed A by steps 28/37 (history only, never sent).
- Batch messages of a skipped A task keep `processedAt = null` (no sweeper reads them).
- HTTP route guard and auth (D-R3-2, Q1/F2-05). Q4, F2-19, migrations, Neon, prompts/knowledge.
- Constant ids in other Calendar fakes (`google-event-123`, `google-event-test`): test hygiene, only if a flake appears.

## Rev3 — Questions for the owner
- **D-R3-1 — late redelivery when A is already closed (F-T26-1).** (a, rec.) Keep the approved behavior (no separate reply; the newer message was already answered in B) and fix the S-22/R-SES-02 wording. Why: answering X in B carries A's content into B (breaks R-SES-03 "nem como pista" and the CLAUDE.md "never inherits" invariant), X is ≥ 4h old, and the unique `externalId` forces moving A's row. (b) Answer X in B: move the row and the task into B; needs a new revision.
- **D-R3-2 — HTTP route `POST /conversations/:id/messages` (no `expectedConversationId`).** (a, rec.) List only, inside the Q1/F2-05 security spec (protect or remove the route). It is not the WhatsApp path and never rotates. (b) Pass `expectedConversationId` now and answer 409 on `TurnSupersededError`.
- **D-R3-3 — single-slot re-offer text (blocks step 35).** (a, rec.) "Esse horário acabou de ficar indisponível. Tenho outro horário: <data hora> com <consultor>. Posso confirmar?" [Confirmar | Não]. (b) Keep today's two-line text. (c) Davi writes it.
- **D-R3-4 — tap on an expired session (S-08).** (a, rec.) Now: notice + "Me conta o que você precisa agora?" (better than silence); automatic new offer later in package B. (b) New offer now (Calendar call + a new notice text, one more step).
- Still open, not blocking: E3-a deploy precondition; Q1, Q4.

## Revision history (Rev3)
- Revision 3 (2026-10-27): F-T32-1 + F-V1c-3 (step 34), D-R3-3 text (35), F-T27-1 (36), step-28 window (37), `superseded` + R-SCH-08 comments (38), F-T26-2 (39); F-T26-1 via spec wording (D-R3-1); steps 24–25 amended. Steps 19–23 and 26–33 unchanged. Waiting for Davi's approval and D-R3-1 to D-R3-4.

---

# Revision 3.1 — close F-V3b-1 and the last send-after-rotation gaps (2026-10-27)

Input: `test-report.md` "V3-b (steps 36–38)" (FAIL F-V3b-1, planner cause; non-blocking notes). Steps 34–38 are done and their text is not changed. Line numbers are current (`TH` = `autonomous-task-handlers.ts`).

## Rev3.1 — Root cause
- **F-V3b-1: confirmed (planner).** Step 37 guarded only the success enqueue (`TH:324-365`). On `ModelUnavailableError` the handler calls `sendModelFailureNotice` (`TH:129-170`). It inserts the assistant row (`:144-151`) and enqueues `MODEL_FAILURE_NOTICE` (`:153-160`) with plain `db`: no tx, no lead lock, no status re-read. Sequence: rotation commits during Gemini → Gemini fails → notice goes out from closed A, plus B's answer. Breaks S-23 and R-V1b-1. Pinned by `todo` `session-rotation-adversarial.test.ts:1059`.
- **D-R3-5 trace: confirmed.** The success trace (`generateMarianaResponse.ts:991`, `outcome: "replied"`) is emitted before the handler re-check, so the no-slots variant logs `replied` and sends nothing. The model-failure variant logs `model_error` (`emitFailureTrace`, `:374`) and then also sends nothing after step 40.

## Rev3.1 — Send-path sweep (every `enqueueOutboundMessage` / `replyToStaleTap` in `src/`, tests excluded)
| Path | Re-check of `conversations.status` under the lead lock? | Verdict |
|---|---|---|
| `TH:153` model-failure notice | no | **gap → step 40** |
| `TH:348` AI-turn reply | yes (step 37) | ok |
| `TH:505` re-offer (`sendSlotUnavailableReoffer`, `:391`) | lead locked, status not read; `persistOffer` called without `requireActiveConversation` | **gap → step 41** (a ≥ 4h-late Confirmar task would create a session in closed A and send) |
| `TH:634` "Agendamento confirmado …" | no tx | **D-R3-6** (booking is real; see below) |
| `TH:690, :704` cancel replies ("Tudo bem …") | no tx | **gap → step 41** |
| `TH:742` choice reply in `handleProcessButtonReply` | no tx | **gap → step 41** |
| `TH:1005` confirmation request | lead locked; the session UPDATE needs `status = active`, and the rotation expires A's sessions, so nothing is sent after rotation | ok (implicit); step 41 adds the explicit status read for uniformity |
| `TH:813` legacy consultant tap → `replyToStaleTap` | status read at `TH:808`, **outside** the tx | **gap → step 41** (move the read inside, after the lead lock) |
| `TH:527` `replyToRefusedTap` | yes (step 34) | ok |
| `webhook-whatsapp.ts:417` E1 reply; `:459` stale tap | conversation comes from `resolveConversationForInbound` in the same tx under the lead lock | ok |
| `receive-customer-message.ts` HTTP route | not the WhatsApp path | listed (D-R3-2 a) |
- No other module enqueues outbound. Every gap needs a task of A that runs ≥ 4h late (workers down/retries), the same class as F-V3b-1. After steps 40–41 every send of the inbound/button flow re-checks under the lead lock.

## Rev3.1 — Steps

**Batch V3-b' — model-failure notice and trace (closes the V3-b FAIL)**

40. **Model-failure notice is not sent from a closed conversation** (F-V3b-1; D-R3-5 a).
    - Files and changes:
      - `TH:129-170`: the assistant-row insert and the enqueue run in one `db.transaction`. First statement: `leads` FOR UPDATE. Then re-read `conversations.status`. If it is not `active`: no row, no outbox, event processed, return `{ reason: "conversation_not_active", skipped: true }`. Keep `markMessagesProcessed` and the `mariana_model_failure` log only on the sent path.
      - `generateMarianaResponse.ts` (D-R3-5 a, only when `expectedConversationId` is set):
        - before the success trace (`:991`), re-read `conversations.status`; if it is not active → emit `outcome: "superseded"` and throw `TurnSupersededError`. This covers the no-slots case.
        - in the failure path (`emitFailureTrace`, `:374`), a `ModelUnavailableError` on a conversation that is no longer active → `superseded` instead of `model_error`, then rethrow as `TurnSupersededError`.
        - the handler's existing catch (`TH:291-294`) skips. The handler re-checks (`TH:327`, and the new one in `sendModelFailureNotice`) stay as the last guard for the window of milliseconds after the trace.
    - Tests (DB), **red first**:
      - `session-rotation-adversarial.test.ts:1059` "tester V3-b: rotação durante a chamada ao Gemini que falha…": remove `todo`. Also assert the A trace is `['superseded']`. Red today: `no outbox from A` (1 row). Rule S-23, R-V1b-1, R-REL-07.
      - The step-37 tester loop "rotação durante a busca, sem horários…": change the trace assert from `['replied']` to `['superseded']`. Red: `'replied'`. Rule R-REL-07 (D-R3-5).
      - S-17 regression, green before and after: `src/tests/reliability/model-failure.test.ts`, `model-failure-acceptance.test.ts` and `src/tests/model-failure-notice.test.ts`. Add one assert: an active conversation + `ModelUnavailableError` → exactly 1 outbox with `MODEL_FAILURE_NOTICE` and trace `model_error`. Rule S-17, R-REL-05.
      - Outbox failure on the notice path: the existing partial-failure case (if present in `handler-partial-failure.test.ts`) stays green; retry sends once (key `runKey`).
    - Implementer hygiene (no behavior change; same batch):
      - `lock-order.test.ts:583` (and every `await t0.locked`): `await Promise.race([t0.locked, t0.done])`, so a throwing `lock(tx)` fails the test instead of hanging.
      - `TH:40` imports `TurnSupersededError` from `./turn-superseded-error`; delete the re-export and the `biome-ignore` at `generateMarianaResponse.ts:102-104` (grep first: no other importer).
      - Move `failureOutcome` (`generateMarianaResponse.ts:354`) above the `emitFailureTrace` JSDoc, so the JSDoc sits on its function again (or fold it into the new superseded logic).
    - Invariants: lead first; one notice per batch (S-17, key `runKey`); an outbound message that may have been accepted by Meta never goes back to `pending` (no outbox change); one trace per turn.

**Batch V3-b'' — the remaining button-flow sends**

41. **Every button-flow send re-checks the conversation under the lead lock** (sweep above; D-R3-6 a).
    - Files and changes:
      - `TH:391-520` re-offer: inside its tx, after the lead lock, re-read the status. If not active → no row, no session, no outbox, `{ replied: false, reason: "conversation_not_active" }`.
      - `TH:690, :704, :742`: wrap each enqueue in a lead-locked tx with the same re-check (one small local helper `enqueueIfConversationActive(tx-less args)`, reused).
      - `TH:808-813` legacy consultant tap: move the status read inside the tx, after the lead lock.
      - `TH:975-1005`: add the explicit status read after the lead lock.
      - `TH:634` booking confirmation: **unchanged** under D-R3-6 a.
    - Tests (DB, `session-rotation-adversarial.test.ts`), **red first**. Given a tap task of A forced to `pending` after the rotation, when it is drained, then 0 outbox from A and B is untouched:
      - "Confirmar de A com o horário ocupado, depois da rotação: nenhuma reoferta em A". Red: 1 re-offer outbox + 1 active session in A. Rule S-23, R-SES-02.
      - "Não (cancel:) de A depois da rotação não responde". Red or green today, depending on whether the rotation already expired the session. If it is green, keep it as a regression and say so in progress.md. Rule S-23.
      - "toque pref:* legado de A com a rotação entre a leitura e o lock não responde". Use the `lock-wait.ts` pattern: T0 holds the lead while the rotation is queued. Red: 1 stale-tap outbox. Rule S-23.
      - D-R3-6 regression: "agendamento confirmado antes da rotação ainda avisa o cliente". The appointment commits, then the rotation, then the enqueue → exactly 1 "Agendamento confirmado …". Green before and after. Rule R-SCH-07 (spec:63), E2-a.
    - Invariants: lead first; `selectedSlotId` unchanged; no change to keys or texts; the success paths in active conversations send exactly as today (full button suites green).

Order: V3-b' (40), then V3-b'' (41), then V3-c (39) and V1-d (24, 25) as approved in Rev3. Step 25 adds red→green for 40–41. Every step: red test first, full suites once per batch, workers off, `DOTENV_CONFIG_PATH=/dev/null`, no Neon, no real Gemini/WhatsApp/Google, no git writes.

## Rev3.1 — Questions for the owner
- **D-R3-5 — trace when the turn was cancelled after the model answered (no-slots case) or the model failed after the rotation.**
  - (a, rec.) `superseded`. Implement it in step 40: the turn re-reads the conversation before emitting the trace.
  - (b) Keep `replied` / `model_error` and only document it.
- **D-R3-6 — booking confirmed just before the rotation.**
  - (a, rec.) Still send "Agendamento confirmado para … com …". The appointment and the Calendar event exist, and E2-a keeps the lead `scheduled`. Hiding the message would leave the customer unaware of a real meeting.
  - (b) Suppress it like the other sends.

## Revision history (Rev3.1)
- Revision 3.1 (2026-10-27): F-V3b-1 (step 40, plus D-R3-5 and the tester hygiene notes); send-path sweep → step 41 plus D-R3-6. Steps 34–38 unchanged. Waiting for Davi's approval.
