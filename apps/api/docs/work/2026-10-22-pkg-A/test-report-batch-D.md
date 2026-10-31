# Test report — pkg-A Batch D (steps 9–11) + acceptance of R-REL-05, R-REL-07, S-17

**Verdict: PASS** for R-REL-05, R-REL-07 and S-17 against `docs/specs/MARIANA_BEHAVIOR_SPEC.md` v1.2. Two GAPs found and closed by tester tests (see §4). Three residual risks (see §6); none is a FAIL against the spec text.

- Task: `2026-10-26-flow-review`, batch R1-a, step 1 (`docs/work/2026-10-26-flow-review/plan.md:43-45`, F2-27). `plan.md:1` = `Status: APPROVED by Davi — "aprovo" (2026-10-26)`.
- Base: `develop` @ `cde444d`. Batch D is already committed (`595db13`, together with Batches A–C). Its file list matches `pkg-A/plan.md:266-292` (`src/ai/model-errors.ts`, `src/ai/agent.ts`, `model-failure-notice.ts`, `autonomous-task-handlers.ts`, tests). No unapproved product change found.
- No product code changed. No git write. `.env` not loaded (`DOTENV_CONFIG_PATH=/dev/null`, `DATABASE_URL` pointed at `127.0.0.1:9`). DB target: `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`. Gemini mocked (`ai.models.generateContent` / `generateContentFn`).

## 1. Markers replaced by the rule IDs (spec v1.2)

The markers *"redação de R-REL-07/S-17 não disponível — critério derivado do brief, pendente de confirmação"* at `pkg-A/plan.md:61`, `:215` (step 2), `:260` (step 7) and `:291` (step 11) are now resolved. The tester does not edit `plan.md` (planner file); this table is the replacement. The planner should swap the marker text for the rule ID in `plan.md`.

| Marker location | Replaced by | Spec v1.2 text | Brief-derived criterion still matches? |
|---|---|---|---|
| `plan.md:215` (step 2, model config) | **R-REL-07** (2nd sentence) | "O nome do modelo e os parâmetros (temperatura, raciocínio, limite de saída) vêm de variáveis de ambiente." | Yes. `GEMINI_MODEL`, `GEMINI_TEMPERATURE`, `GEMINI_THINKING_LEVEL`, `GEMINI_MAX_OUTPUT_TOKENS`. |
| `plan.md:260` (step 7, turn trace) | **R-REL-07** (1st sentence) | "Cada turno registra um rastro mínimo: modelo usado, latência, tokens, etapa, e quais camadas alteraram o texto do modelo, com tamanhos e hashes, nunca o texto do cliente." | Yes. One `mariana_turn` line per turn. |
| `plan.md:291` (step 11, handler) | **S-17** + **R-REL-05** | S-17: "O modelo falha (erro ou nome de modelo inválido) → O cliente recebe a mensagem curta de falha; o erro aparece no log; nada fica em silêncio". R-REL-05: "Se o modelo falhar depois das tentativas, o cliente recebe uma mensagem curta e honesta (…), e o erro aparece nos logs." | Yes. Note: the R-REL-05 wording quoted at `plan.md:56` is the older text; v1.2 adds "depois das tentativas" (covered by `client.ts` retry, `ai-client.test.ts:6`). |
| `plan.md:61` (header) | the three rows above | — | — |

## 2. Acceptance criteria → tests → result

| Rule / criterion | Test (file:line) | Result |
|---|---|---|
| R-REL-07: model name from env, no literal | `src/tests/agent-model-config.test.ts:45`; `src/tests/gemini-model-config-adversarial.test.ts:142` | PASS |
| R-REL-07: temperature, thinking level, output limit from env, defaults, invalid values fail | `src/tests/env.test.ts:109`, `:118`, `:125`, `:140`, `:154`; `agent-model-config.test.ts:23`; `gemini-model-config-adversarial.test.ts:84`, `:95`, `:110`, `:119`, `:128`, `:182` | PASS |
| R-REL-07: one line per turn, JSON, `event=mariana_turn` | `src/tests/turn-trace.test.ts:68`; `src/tests/services/generate-mariana-response.test.ts:874` | PASS (`:936` flaky, see §5) |
| R-REL-07: layers that changed the text, with lengths and hashes | `turn-trace-adversarial.test.ts:130`, `:140`, `:159`, `:180`, `:208`, `:301`; `turn-trace-integration.test.ts:131`, `:183`, `:214`, `:291`; `generate-mariana-response.test.ts:874` | PASS |
| R-REL-07: model, params, latency, **tokens**, stage reach the emitted line on a real-agent turn | **new** `src/tests/services/turn-trace-rel07-acceptance.test.ts:58` | PASS (was GAP-1) |
| R-REL-07: never the client text | `turn-trace.test.ts:93`; `turn-trace-adversarial.test.ts:267`; `generate-mariana-response.test.ts:874`; new `turn-trace-rel07-acceptance.test.ts:58` | PASS |
| R-REL-07: turn id = anchor task | `src/tests/reliability/inbound-batch-claim.test.ts:138` | PASS |
| S-17 / R-REL-05: transport error (N6 404) → `ModelUnavailableError`, cause kept | `src/tests/model-failure-notice.test.ts:47` | PASS |
| S-17: empty response / invalid JSON → `ModelUnavailableError` | `model-failure-notice.test.ts:74` | PASS |
| Scope: guardrail error is not wrapped, task still fails | `model-failure-notice.test.ts:110`; `src/tests/reliability/model-failure.test.ts:225` | PASS |
| Notice text short, Portuguese, pinned | `model-failure-notice.test.ts:161` | PASS |
| Notice does not arm the pending offer (CLAUDE.md invariant) | `model-failure-notice.test.ts:141` | PASS |
| Notice carries no scheduling promise | `model-failure-notice.test.ts:147` | PASS |
| S-17: client gets the notice, task completes, message processed, same `runKey` | `model-failure.test.ts:119` | PASS |
| Notice never sent twice (dedup by `runKey`, invariant "duplicate inbound never processed twice") | `model-failure.test.ts:179` | PASS |
| S-17: failure is logged as `model_error` in the turn trace | `generate-mariana-response.test.ts:1110` | PASS |
| S-17: "o erro aparece no log" — `mariana_model_failure` line (kind, model, ids, no client text/phone); webhook event `processed` | **new** `src/tests/reliability/model-failure-acceptance.test.ts:153` | PASS (was GAP-2) |
| S-17: `empty_response` and `invalid_json` through the real handler → one notice, task `completed`, log kind | **new** `model-failure-acceptance.test.ts:211` (2 cases) | PASS (was GAP-2) |
| R-REL-05: "depois das tentativas" (retries before the notice) | `src/tests/ai-client.test.ts:6` | PASS |

## 3. Commands and results

| Command | Result |
|---|---|
| `npm run test:unit` | tests 357, pass 351, fail 0, todo 6 |
| `npm run test:db` run 1 (`localhost:5432/mariana_test`) | tests 617, pass 611, fail 0, todo 6 |
| `npm run test:db` run 2 | tests 617, pass 610, **fail 1** (`generate-mariana-response.test.ts:936`, known flake, §5), todo 6 |
| `npx tsc --noEmit` | exit 0 |
| new files alone (`db-test-preload`, dot reporter) | 4/4 pass |
| `npx biome check` on the 2 new files | no errors (after `--write` format) |
| `git diff --check` | clean |

The 6 todos are the known holes E-12c, E-15 etc. in the guard adversarial files (not Batch D). Build not run: no product change in this step (step 6 of flow-review runs it).

## 4. Tests added by the tester

- `src/tests/services/turn-trace-rel07-acceptance.test.ts` (DB glob). GAP-1: no test asserted that `model`, `temperature`, `thinkingLevel`, `maxOutputTokens`, `latencyMs`, `usage.*Tokens`, `stage` and `postTurnStage` reach the emitted line. Existing integration tests stub metadata with `usage: null`. This test runs the real agent with a fake `generateContentFn` returning token counts.
- `src/tests/reliability/model-failure-acceptance.test.ts` (DB glob). GAP-2: no test asserted the `mariana_model_failure` error log, the webhook event status, or `empty_response`/`invalid_json` through the real handler.
- Both are acceptance tests, green on arrival (the code already existed). They fail if the log call, token propagation or the handler catch is removed. Not shown red (would need a product-code mutation, which this step forbids).
- Neither file needs `test:unit` registration (DB glob `src/tests/**/*.test.ts`).

## 5. Failures

None against Batch D. Known flake, root cause found:

- `npm run test:db` run 2: `generate-mariana-response.test.ts:936` `assert.equal(ELEVEN_DIGITS_IN_LINE.test(line), false)` → `true !== false`.
- Cause (evidence): the line holds two random UUIDs (`conversationId`, `leadId`). A UUID's last group has 12 hex chars. A Node sample of 200,000 lines with two `randomUUID()` gave **1.57%** matching `/\d{11}/`. So the test fails on the UUID, not on a phone. The product does not leak.
- Fix owner: **implementer** (test-only): strip UUIDs/hex hashes before the 11-digit check, as the two new tester files do. Not done here (the file is not mine to change in this step).

## 6. Risks not covered by tests

- **S-17 "nome de modelo inválido" with a bad format**: `env.ts` rejects a malformed `GEMINI_MODEL` at boot (`env.test.ts:118`). The process does not start, so the client gets no notice. A well-formed but unknown name (N6) does get the notice. Deploy check required; owner decision whether this satisfies S-17.
- **`POST /conversations/:id/messages`** (`receive-customer-message.ts:134`): `generateMarianaResponse` runs inside the debounce callback with no `ModelUnavailableError` catch. A model failure there is silent. Not the WhatsApp path; outside Batch D scope ("on the inbound-message path", `pkg-A/plan.md:186`).
- **No request deadline** on the Gemini call: a hung call ends as a lease expiry, not a notice (declared out of scope, Package E).

## 7. Manual WhatsApp checklist (owner, staging only, never with the production model key changed in place)

1. Set `GEMINI_MODEL=gemini-3.6-flash-lite` (well-formed, nonexistent) on a staging instance. Send "Oi, quero saber de consórcio". Expect exactly one reply: "Desculpe, tive uma falha técnica aqui e não consegui processar sua mensagem agora. Pode me enviar de novo em alguns instantes?". Expect one `mariana_model_failure` and one `mariana_turn` with `outcome:"model_error"` in the log, and no client text in either.
2. Send the same message again within 15 s. Expect one more notice for the new message only, never two for one message.
3. Restore `GEMINI_MODEL`. Send "como funciona?". Expect a normal answer and a `mariana_turn` line with `model`, `temperature`, `thinkingLevel`, `maxOutputTokens`, `usage` tokens and `stage` filled.
