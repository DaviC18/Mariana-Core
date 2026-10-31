# Test report — 2026-10-22-session-choice-24h

**Verdict: PASS** (Step 1 — política de tempo, textos e IDs)

Este relatório cobre **somente o lote Step 1**. Os lotes seguintes (Steps 2–13) acrescentam seções a este mesmo arquivo. Base: `develop` @ `595db13`. `plan.md:1` = `Status: APPROVED by Davi on 2026-10-22 — "aprovo"`.

## 1. Escopo verificado

Diff/untracked no momento da verificação:

| Arquivo | Estado | Previsto no Step 1 |
|---|---|---|
| `src/services/conversations/session-choice-policy.ts` | novo | sim |
| `src/tests/session-choice-policy.test.ts` | novo | sim |
| `package.json` (`test:unit` lista o novo teste) | M | sim |
| `docs/CODEMAP.md` (linha 45) | M | sim |
| `docs/work/2026-10-22-session-choice-24h/progress.md` | novo | sim (registro) |
| `docs/work/2026-10-22-session-choice-24h/explicacao.md` | novo | **não listado** |
| `docs/work/2026-10-22-session-choice-24h/plan.md` | novo | sim |
| `docs/work/2026-10-22-session-choice-24h/test-report.md` | novo | sim (este arquivo) |

`explicacao.md` é documento do planner na pasta da tarefa (não é código de produto, não altera comportamento). **Não é mudança não aprovada de produto**; fica registrado como arquivo extra em relação à lista de `Files` do Step 1 (`plan.md:163`). Nenhum arquivo de `src/` fora de `src/tests/` foi criado/alterado além do módulo do plano. Nenhum arquivo de `drizzle/`, `.env`, seed ou migration foi tocado.

## 2. Critérios do Step 1 → teste → resultado

| Critério (plan.md:161-170) | Teste | Resultado |
|---|---|---|
| `SESSION_INACTIVITY_MS = 24 * 60 * 60 * 1000` exportado | `a janela de sessão não reutiliza a janela do WhatsApp` | PASS |
| Exatamente 24h ⇒ `true` | `24h exatas contam como inatividade, 24h menos 1 ms não` | PASS |
| 24h − 1 ms ⇒ `false` | idem (segunda asserção) | PASS |
| `null` ⇒ `false`, sem throw | `timestamp nulo ou inválido não prova inatividade` | PASS |
| `Invalid Date` ⇒ `false`, sem throw | idem | PASS |
| 5 textos pinados exatos | `textos e IDs da escolha são estáveis e curtos` | PASS |
| IDs `sessao:continuar` / `sessao:nova` | idem | PASS |
| Títulos `Continuar` / `Nova conversa` e ≤ 20 chars | idem | PASS |
| Janela de sessão **não** importada de `whatsapp-compliance.ts` | `a janela de sessão não reutiliza a janela do WhatsApp` (lê o fonte e rejeita `from "...whatsapp-compliance"`) | PASS |
| `hasPreviousCustomerMessage` puro (contagem/lista) | *sem teste no lote entregue* → coberto por teste que adicionei (§4) | PASS (coberto) |
| Sem comportamento/DB/WhatsApp/Calendar | módulo não importa nada; só o teste o importa (`grep`/`rg`) | PASS |

### Meaningfulness (mutação, em cópia descartável em `/tmp/opencode/scp-mut`)

Cada teste foi rodado contra uma cópia mutada do módulo. Nenhum arquivo do repo foi alterado para isso.

| Mutação | Teste que falha |
|---|---|
| `>=` → `>` em `current - last` | `24h exatas...` (`✖`) |
| remoção do guard `instanceof Date` / `Number.isFinite` | `timestamp nulo ou inválido...` (`TypeError: Cannot read properties of null (reading 'getTime')`) |
| `import { WHATSAPP_CUSTOMER_WINDOW_MS } from "./whatsapp-compliance"` (com stub) | `a janela de sessão não reutiliza...` (`actual: true, expected: false`) |
| título `"Nova conversa agora!"` (21 chars) | `textos e IDs...` (`actual: 'Nova conversa agora!'`) |
| módulo removido | arquivo de teste inteiro falha (`Cannot find module` / `'test failed'`) |

## 3. Comandos e resultados

```
npx tsx --import ./src/tests/support/unit-test-preload.ts --test --test-reporter=dot src/tests/session-choice-policy.test.ts
  → ......  (6/6 pass, após os testes que adicionei)

npm run test:unit | tail -n 30
  → tests 253 / pass 253 / fail 0 / cancelled 0 / skipped 0

npx tsc --noEmit
  → sem saída (clean, exit 0)

npm run build            # script real: tsup src/server.ts --format cjs --clean
  → CJS dist/server.js 1.41 MB / Build success in 187ms

npx biome check src/services/conversations/session-choice-policy.ts src/tests/session-choice-policy.test.ts package.json
  → Checked 3 files. No fixes applied.

git diff --check
  → sem saída (clean)
```

`git status`: `M docs/CODEMAP.md`, `M package.json`, untracked `src/services/conversations/session-choice-policy.ts`, `src/tests/session-choice-policy.test.ts`, `docs/work/2026-10-22-session-choice-24h/`. Nada commitado.

## 4. Testes que adicionei

Somente em `src/tests/session-choice-policy.test.ts` (nenhum código de produto alterado):

1. `timestamp futuro, relógio inválido ou valor não-Date não provam inatividade` — `lastCustomerMessageAt` no futuro (clock skew do provedor), `now` inválido, `undefined` e string ISO (contrato de tipo, sem coerção) ⇒ `false`. Falha sob mutação `Math.abs(current - last)` (provado).
2. `a pergunta de 24h só aparece quando o cliente já escreveu antes` — `hasPreviousCustomerMessage` com `1`/`40` ⇒ `true`; `0`, `null`, `undefined`, `NaN` ⇒ `false`. Falha sob mutação `> 0` → `>= 0` (provado). Fecha a lacuna do helper entregue no Step 1 sem teste.

Não adicionei testes de colisão de prefixo: os IDs já são pinados por igualdade exata, e uma colisão só poderia vir de mudança nas famílias existentes (fora deste módulo).

## 5. Não executado (com motivo)

| Item | Motivo |
|---|---|
| `npm run test:db` | **not run — no authorized TEST_DATABASE_URL** |
| `npm test` | idem (exige `TEST_DATABASE_URL` preparada) |
| `setup-test-db.ts`, migrations, seeds, `db:push` | proibidos nesta sessão; Step 1 não toca DB |
| `DATABASE_URL` / Neon | nunca acessado; nenhuma consulta ou escrita |
| WhatsApp/Gemini/Calendar reais | não usados; Step 1 é puro |
| `npm run sim:conversation` | sem permissão do dono e sem comportamento a simular |

## 6. Riscos remanescentes (para os próximos lotes)

- **Detecção de import por regex**: o teste "não reutiliza" cobre `from "...whatsapp-compliance"` (estilo do repo, sem extensão). Não cobre `require(...)`, `import(...)` dinâmico nem extensão `.js`. Risco baixo; se o Step 4 importar o módulo por barrel, o teste não detecta.
- **Valores iguais hoje**: `SESSION_INACTIVITY_MS` e `WHATSAPP_CUSTOMER_WINDOW_MS` valem ambos 24h. O teste garante independência de *import*, não de valor; as regras podem divergir sem que o teste quebre (é o desejado).
- **Regra de 24h ainda inativa**: nada usa `isSessionInactivityGap` em produção. Até o Step 4, o bug RC-1 continua em produção.
- **Um relógio por mensagem**: o plano exige `receivedAt = new Date()` calculado uma vez no webhook (`plan.md:49`). Não é verificável neste lote; precisa de teste no Step 4.
- **`hasPreviousCustomerMessage` sem chamador**: a regra "não perguntar em conversa vazia/seed" só é provada de verdade no Step 4 (webhook).
- **Steps 2 e 9 continuam BLOCKED** por Q1/Q2 (`plan.md:352`); nenhum teste deste lote reduz esse risco.
- **Checklist manual de WhatsApp**: não se aplica ao Step 1 (nenhum comportamento novo). Fica para o lote que ativar o fluxo.

---

# Steps 8–12 — acceptance listing (flow-review R1-a step 1, 2026-10-27)

**Verdict: PASS with GAPs.** Every planned test for steps 8–12 exists and passes. No FAIL. Three GAPs (below) are already owned by later flow-review steps or are process gaps.

- Source: `docs/work/2026-10-26-flow-review/plan.md:43-45` (F2-25, F2-27), `Status: APPROVED by Davi`. Rules: `MARIANA_BEHAVIOR_SPEC.md` v1.2, R-SES-02, R-SES-04, S-18, S-19.
- No code changed. DB: `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`, `.env` not loaded. `npm run test:db` twice: 611/617 pass + 6 todo, then 610 + 1 known flake (`generate-mariana-response.test.ts:936`, unrelated, cause in `pkg-A/test-report-batch-D.md` §5). All session-choice files green in both runs. `npm run test:unit`: 351 pass, 0 fail, 6 todo. `tsc`: exit 0.
- The implementer was editing `session-choice-gate.test.ts` and `session-inactivity-regression.test.ts` (flow-review step 2) during these runs. Results for the gate file reflect its on-disk state at run time.

## Steps → tests → result

| Step / criterion (`plan.md`) | Test (file:line) | Result |
|---|---|---|
| 8 — snapshot of A before reset (`:243`) | `src/tests/reliability/session-choice-new.test.ts:399` | PASS |
| 8 — B inherits no commercial field; identity kept (`:244`) | `session-choice-new.test.ts:464` | PASS |
| 8 — "imóvel" question in B gets no vehicle state (`:245`) | `src/tests/reliability/session-choice-isolation.test.ts:100` | PASS |
| 9 — past appointment ⇒ `new`, `qualifiedAt=null` (`:253`; R-SES-04, S-19a) | `session-choice-new.test.ts:541` | PASS for status; **GAP-1** for stage and text |
| 9 — future confirmed appointment ⇒ `scheduled`, appointment kept (`:254`; S-19b) | `session-choice-new.test.ts:612` | PASS (status only; S-10 answers = package D) |
| 9 — future cancelled ⇒ `new` (`:255`) | `session-choice-new.test.ts:672` | PASS |
| 10 — Confirmar tap while pending: 0 appointments, 1 reply, slot kept (`:263`) | `src/tests/reliability/session-choice-gate.test.ts:538` | PASS |
| 10 — preference / consultant / slot taps change nothing (`:264`) | `session-choice-gate.test.ts:217`, `:607`, `:650` | PASS |
| 10 — queued scheduling task not claimed while pending (`:265`) | `session-choice-gate.test.ts:423` | PASS |
| 10 — old tasks superseded and auditable (`:266`) | `session-choice-gate.test.ts:470` | PASS |
| 10 — `send_confirmation_request` while pending: 1 reminder, 0 requests, session kept | `session-choice-gate.test.ts:697` | PASS on disk now (step 2 of flow-review owns it, K2) |
| 10 — flow works again after resolve (`:267`) | `session-choice-gate.test.ts:783` | PASS |
| 11 — continuar then nova: first wins, second informs (`:275`) | `src/tests/reliability/session-choice-adversarial.test.ts:111` | PASS |
| 11 — nova then continuar: B only active, A closed (`:276`) | `session-choice-adversarial.test.ts:172` | PASS |
| 11 — `sessao:xyz` and old slot tap re-send the question (`:277`; R-SES-02 "toques antigos") | `src/tests/reliability/session-choice-invalid-replies.test.ts:264`, `:475` | PASS |
| 11 — free text "quero começar do zero" ⇒ reminder, no B (`:278`; R-SES-02 "texto livre") | `session-choice-invalid-replies.test.ts:340` | PASS |
| 11 — same Meta delivery twice ⇒ 1 outbound (`:279`) | `session-choice-invalid-replies.test.ts:412` | PASS |
| 12 — pending state survives restart (`:287`) | `src/tests/reliability/session-choice-concurrency.test.ts:266`; `session-choice-adversarial.test.ts:217` | PASS |
| 12 — concurrent message + Nova tap ⇒ 1 active (`:288`; R-SES-01) | `session-choice-concurrency.test.ts:325`; `session-choice-adversarial.test.ts:271` | PASS |
| 12 — two concurrent taps ⇒ one B (`:289`) | `session-choice-concurrency.test.ts:392` | PASS |
| 12 — task in `processing` with pending choice ⇒ 0 appointments (`:290`) | `session-choice-concurrency.test.ts:442` | PASS |
| 12 — three quick messages stay in one conversation (`:291`, AC12) | `session-choice-concurrency.test.ts:519` | PASS (title still says "24h"; see GAP-3) |
| 12 — repeated `externalId` processed once (`:292`) | `session-choice-concurrency.test.ts:582` | PASS |

## GAPs

- **GAP-1 (S-19a, R-SES-04).** `session-choice-new.test.ts:541` asserts `status === "new"`, `qualifiedAt === null` and an empty assistant history. It does not assert that B's stage is `greeting`/`reason` (planned at `plan.md:253`). No test asserts the reply never says "já está agendado". Owner: **implementer**, flow-review step 3 (R1-b, "S-19a"), already planned.
- **GAP-2 (process, TDD evidence).** `progress.md` has no entries for steps 11 and 12, and steps 8–9 were folded into step 7 (`progress.md:78-80`). No red run is recorded for steps 8, 9, 11, 12. The tests exist and pass; their meaningfulness is not proven by a recorded red. Owner: **planner** (decide whether a mutation proof is required in flow-review step 4).
- **GAP-3 (docs / naming).** `session-choice-concurrency.test.ts:519` is titled "dentro de 24h"; the rule is now 4h (spec v1.2 R-SES-02). The test sends messages back to back, so it is valid under 4h. Rename belongs with flow-review step 5/6 docs (F2-24).

## Risks not covered by tests (already found in flow-review, not re-tested here)

- F2-01: a second 4h gap while a choice is resolved can swallow the message (`session-choice-store.ts:49-51,92-104`). R2.
- F2-02: the choice claim is outside the effect transactions (`autonomous-task-handlers.ts:1515-1518`). R2.
- F2-03: `Continuar` after a held tap with no held text sends nothing (`webhook-whatsapp.ts:442-468`). R2; fallback text waits for Q2.
- S-18 "e nada mais": reminder behaviour inside the debounce burst waits for Q3 (flow-review step 12).

## Manual WhatsApp checklist (owner, staging)

1. Lead in qualification. Set `lastCustomerMessageAt` to 5 h ago. Send "oi, voltei". Expect only the choice question with the buttons "Continuar" and "Nova conversa". Nothing else.
2. Type "quero começar do zero". Expect the short reminder with the same two buttons. No new conversation.
3. Tap an old slot button from an earlier offer. Expect the same reminder. No appointment.
4. Tap "Continuar". Expect "oi, voltei" answered once, in the old context. Tap "Nova conversa" afterwards: expect "já registrada", nothing else changes.
5. Repeat with a lead whose meeting is in the past; tap "Nova conversa". Expect a greeting from zero, no "já está agendado".
6. Repeat with a future confirmed meeting; tap "Nova conversa". Expect the lead to stay scheduled; asking "quando é minha reunião?" gives date, time and consultant.

---

# Steps 11–12 re-verification (flow-review R1-b step 4, 2026-10-27)

**Verdict: PASS.** No code changed. DB `localhost:5432/mariana_test`, workers off.

- `session-choice-adversarial.test.ts`: 4/4 pass, twice in isolation.
- `session-choice-concurrency.test.ts`: 6/6 pass, twice in isolation.
- `session-choice-invalid-replies.test.ts`: 4/4 pass, twice in isolation.
- All three also green in two full `npm run test:db` runs.
- GAP-2 (no recorded red for steps 11–12) and GAP-3 ("24h" title) stay open.
- Details and per-criterion table: `docs/work/2026-10-26-flow-review/test-report.md`, section "Step 4".

# Step 14 — final verification (flow-review R1-c step 6, 2026-10-27)

**Verdict: PASS.** Full details, the criterion → test table, flakes, gaps and the manual checklist are in `docs/work/2026-10-26-flow-review/test-report.md` § "R1 final".

- `test:unit`: 357 tests, 351 pass, 0 fail, 6 todo. `test:db` (`localhost:5432/mariana_test`, workers off): 620/614/0 twice; with the new tester test, 621/615/0, then 621/614/1 (flake `turn-trace-integration.test.ts:288`, UUID digits, not session-choice). `tsc` exit 0. `build` exit 0.
- Regression matrix (plan §"Matriz"): every row now runs at 4h instead of 24h. Mapped rows: `session-choice-policy.test.ts:24,:43`; `webhook-whatsapp.test.ts:1658,:1831`; `session-choice-continue.test.ts:58,:176`; `session-choice-new.test.ts:87,:287,:468`; `session-choice-isolation.test.ts:100`; `session-choice-invalid-replies.test.ts:264,:340,:412` + new S-20 text test; `session-choice-concurrency.test.ts:266,:325,:392,:519`; `session-choice-gate.test.ts:423,:538,:697`.
- Open: GAP-2 (no recorded red run for steps 8, 9, 11, 12). AC15 not yet in the spec.
