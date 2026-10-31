# Progress — Package A ("Enxergar e proteger")

## Batch A — model config (steps 1–3)

Implementer run, 2026-10-22. Approval gate checked: `plan.md` line 1 is
`Status: APPROVED by Davi — 2026-10-22.`, with the written caveat that item 1
(the `R-REL-07` / `S-17` wording) stays unresolved and that Davi chose to start
Batch A anyway. Unit tests only; no database, no migration, no network call to
Gemini or any Google API; `.env` not touched.

### Step 1 — `env.ts`: the four Gemini variables

Files changed:
- `src/env.ts` — added `GEMINI_MAX_OUTPUT_TOKENS`, `GEMINI_MODEL`,
  `GEMINI_TEMPERATURE`, `GEMINI_THINKING_LEVEL` to `envSchema` (alphabetical
  order, after `GEMINI_API_KEY`) and to `buildEnvInput` as
  `source.X || undefined`, so an invalid value fails validation instead of
  silently falling back (same pattern as `WHATSAPP_SEND_TIMEOUT_MS`).
- `src/tests/env.test.ts` — three new tests plus four error regexes.

Defaults implemented exactly as the owner decided: model
`gemini-3.5-flash-lite`, temperature `0.3`, thinking level `LOW`, max output
tokens `1024`.

RED (`npx tsx --import ./src/tests/support/unit-test-preload.ts --test --test-reporter=tap src/tests/env.test.ts`):

```
✖ parseEnv aplica os defaults do Gemini
  AssertionError [ERR_ASSERTION]: actual: undefined, expected: 'gemini-3.5-flash-lite'
✖ parseEnv recusa um nome de modelo fora do formato
  AssertionError [ERR_ASSERTION]: Missing expected exception. expected: /GEMINI_MODEL/
✖ parseEnv recusa temperatura e nível de raciocínio inválidos
  AssertionError [ERR_ASSERTION]: Missing expected exception. expected: /GEMINI_TEMPERATURE/
# tests 11 / pass 8 / fail 3
```

GREEN (same command): `# tests 11 / # pass 11 / # fail 0`.

### Step 2 — `agent.ts`: use the configuration

Files changed:
- `src/ai/agent.ts` — removed `const MODEL = "gemini-3.5-flash-lite"` (old line
  36); added the pure `buildModelRequestConfig({ systemInstruction })` returning
  `GenerateContentConfig` with `temperature`, `maxOutputTokens`,
  `thinkingConfig.thinkingLevel` from `env`, plus the unchanged
  `responseJsonSchema` / `responseMimeType`; added `resolveModelName()`; the
  three former `MODEL` references (the `generateContent` call site, the level-3
  short-circuit metadata, the `response.modelVersion ?? …` fallback) now use
  `resolveModelName()`.
- `src/tests/agent-model-config.test.ts` — new unit file.
- `package.json` — new file added to the `test:unit` list (first entry).
- `docs/CODEMAP.md` — the `src/ai/agent.ts` row no longer names `MODEL`; it
  names `resolveModelName` and `buildModelRequestConfig`.

No test calls the API: `buildModelRequestConfig` is pure and `ai` stays a
module-level singleton that performs no request at import time.

RED (`… --test-reporter=tap src/tests/agent-model-config.test.ts`):

```
not ok 1 - buildModelRequestConfig envia modelo, temperatura, nível de raciocínio e limite de saída
  error: '(0 , import_agent.buildModelRequestConfig) is not a function'
not ok 2 - o modelo vem do ambiente, não de uma constante
# tests 2 / pass 0 / fail 2
```

GREEN (same command): `# tests 2 / # pass 2 / # fail 0`.

Type error found and fixed during the step: the SDK's `thinkingLevel` is the
`ThinkingLevel` enum, not a string union, so `tsc` rejected the plain env
string (`src/ai/agent.ts(64,21): error TS2322: Type '"HIGH" | "LOW" | "MEDIUM"
| "MINIMAL"' is not assignable to type 'ThinkingLevel | undefined'`). Fixed by
indexing the enum: `ThinkingLevel[env.GEMINI_THINKING_LEVEL]`. The enum values
are the identical strings, so the test's `"LOW"` assertion still holds.

### Step 3 — document the variables in `.env.example`

File changed: `.env.example`, the "AI - Google Gemini (required)" block. Four
commented entries with the defaults, including the note that
`GEMINI_THINKING_LEVEL` replaces a token budget because Gemini 3.5 rejects
`thinkingBudget` with a user error. `.env` itself was not touched — Davi sets
the real values.

Proof (documentation step, no automated test):

```
grep -c GEMINI_ .env.example  →  5
names in .env.example : GEMINI_API_KEY GEMINI_MODEL GEMINI_TEMPERATURE GEMINI_THINKING_LEVEL GEMINI_MAX_OUTPUT_TOKENS
names in envSchema    : GEMINI_API_KEY GEMINI_MAX_OUTPUT_TOKENS GEMINI_MODEL GEMINI_TEMPERATURE GEMINI_THINKING_LEVEL
```

Same five names on both sides.

### Batch verification

```
npm run test:unit   →  ℹ tests 208 / ℹ pass 208 / ℹ fail 0
npx tsc --noEmit    →  no output, exit 0
npx ultracite check src/env.ts src/ai/agent.ts src/tests/env.test.ts src/tests/agent-model-config.test.ts
                    →  Checked 4 files in 5s. No fixes applied.
```

`npm run test:db` was not run: no step in this batch touches the database or the
schema. No migration command was run (freeze respected). Nothing was placed in
version control.

### Deviations from the plan

1. **`resolveModelName()` added** (step 2). The plan says to remove the `MODEL`
   constant and read `env.GEMINI_MODEL`, and its acceptance test asserts that
   "the resolved model equals `env.GEMINI_MODEL`" — but the planned
   `buildModelRequestConfig` signature returns `GenerateContentConfig`, which
   has no `model` field, so there was no exported seam to assert against. A
   one-line pure `resolveModelName()` is that seam, and the three call sites use
   it. The test also asserts, by reading `src/ai/agent.ts`, that no
   `const MODEL = "gemini-…"` hard-coding comes back.
2. **`ThinkingLevel` enum indexing** instead of passing the env string
   directly, forced by the SDK typings (see step 2 above).
3. **`docs/CODEMAP.md` test list**: the plan asks for the new test file to be
   added to CODEMAP, but CODEMAP has no per-file unit-test list — it points at
   `package.json` ("A new unit test file must be added there"), which was done.
   The CODEMAP edit made instead was the `src/ai/agent.ts` symbol row.

### Still open (not this batch's work)

The plan's own blocker stands: `R-REL-07` / `S-17` wording is unavailable, so
final acceptance of step 2 against the spec remains open. The step-2 criterion
stays marked as derived from Davi's brief.

## Batch A — defect fixes (from `test-report-batch-A.md`)

Both defects were assigned to the implementer. Unit tests only; no DB, no
migration, no `.env` edit, nothing placed in version control.

### D-1 (medium) — the test went red as soon as `.env` was tuned

Reproduced first, exactly as the tester reported:

```
GEMINI_THINKING_LEVEL=MEDIUM GEMINI_TEMPERATURE=0.7 npx tsx --import ./src/tests/support/unit-test-preload.ts \
  --test --test-reporter=tap src/tests/agent-model-config.test.ts
not ok 1 - buildModelRequestConfig envia modelo, temperatura, nível de raciocínio e limite de saída
  expected: 0.3
  actual: 0.7
# tests 2 / pass 1 / fail 1
```

Fix (test code only, no product change): `src/tests/agent-model-config.test.ts`
now asserts against `env.GEMINI_TEMPERATURE`, `env.GEMINI_MAX_OUTPUT_TOKENS`,
`ThinkingLevel[env.GEMINI_THINKING_LEVEL]` and `env.GEMINI_MODEL`, and the
literal `"gemini-3.5-flash-lite"` assertion was dropped from test 2. The owner
defaults stay pinned in `src/tests/env.test.ts` and in the tester's file, both
of which parse an explicit `VALID_SOURCE` and are immune to `.env`.

GREEN, under a tuned environment and under the defaults:

```
GEMINI_THINKING_LEVEL=MEDIUM GEMINI_TEMPERATURE=0.7 GEMINI_MODEL=gemini-2.5-pro GEMINI_MAX_OUTPUT_TOKENS=4096 …
  → # tests 2 / # pass 2 / # fail 0
(default environment)                        → # tests 2 / # pass 2 / # fail 0
```

### D-2 (low) — a whitespace-only `GEMINI_TEMPERATURE` became `0`

Two tests added to `src/tests/env.test.ts`. The second one confirms the
tester's "the other three are safe" claim instead of trusting it.

RED (trim temporarily backed out of `src/env.ts`):

```
not ok 12 - parseEnv não transforma uma GEMINI_TEMPERATURE em branco em zero
  expected: 0.3
  actual: 0
  operator: 'strictEqual'
# tests 13 / pass 12 / fail 1
```

The companion test `parseEnv recusa as outras três variáveis do Gemini em
branco` passed in that same red run — so `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`
and `GEMINI_MAX_OUTPUT_TOKENS` already reject `"   "` (two are text, and
`Number("   ") === 0` fails `min(128)`). Confirmed, not assumed.

Fix: `src/env.ts` → `GEMINI_TEMPERATURE: source.GEMINI_TEMPERATURE?.trim() || undefined`.
GREEN: `# tests 13 / # pass 13 / # fail 0`.

**The trim was applied to that variable only, deliberately.** A blanket
`.trim()` on all four would have broken the tester's own file, which requires
`GEMINI_MODEL=" gemini-3.5-flash-lite"` and `GEMINI_THINKING_LEVEL="LOW "` to
*throw* (`src/tests/gemini-model-config-adversarial.test.ts:59,72`). Trimming
`GEMINI_MAX_OUTPUT_TOKENS` would also have turned a blank value from a throw
into a silent default, which is worse. `Number` already ignores padding around
a real number, so nothing else is affected.

### Registering the tester's file

`package.json` → `src/tests/gemini-model-config-adversarial.test.ts` added to
the `test:unit` list, in alphabetical position. Its assertions were not
touched. Suite after the two fixes and the registration:
`ℹ tests 218 / ℹ pass 218 / ℹ fail 0` — 208 + the tester's 8 + the 2 new D-2
regression tests.

## Batch B — the trace module and the layer records (steps 4–6)

### Step 4 — `src/lib/turn-trace.ts`

Files: new `src/lib/turn-trace.ts`; new `src/tests/turn-trace.test.ts`;
`package.json` (`test:unit`); `docs/CODEMAP.md` (new row).

Contents: `RewriteLayer` (the twelve ids L0–L11), `RewriteRecord`,
`TurnOutcome`, `TurnTraceUsage`, `TurnTrace`, `hashText` (SHA-256 hex, first
12 chars), `isPureBackendText`, `logTurnTrace` (one `console.info` of one
`JSON.stringify` line). Only `node:crypto` is imported.

RED: `Error: Cannot find module '../lib/turn-trace'` → `# tests 1 / pass 0 / fail 1`.
GREEN: `# tests 4 / # pass 4 / # fail 0`.

One fixture correction during the step: the privacy test's own zero-padded
example UUIDs (`0f3c5a21-0000-4000-8000-000000000001`) contain a 12-digit run,
so the "no 11-digit sequence" assertion was failing on the trace's own ids
rather than on leaked text. The fixture now uses hex-mixed UUIDs, which makes
that assertion mean what it says.

### Step 5 — `agent.ts` reports L0–L4 and the raw reply

Files: `src/ai/agent.ts`; tests appended to `src/tests/agent-model-config.test.ts`.

`metadata` gained `commercialAccessLevel`, `finishReason`, `rawReplyHash`,
`rawReplyLength`, `requestedNextAction` and `rewrites`; `latencyMs`, `model`
and `usage` are unchanged. L0 is recorded on the level-3 short circuit (raw =
`""`), L1 when `sanitizeCommercialIdentity` changed the string, L3 when
`validateMarianaEvidence` replaced the reply. L2 and L4 still throw, and now
carry the partial records on the error as `turnRewrites` for step 7.

RED:

```
not ok 3 - metadata traz hash e comprimento da resposta crua
  error: '{"error":{"code":400,"message":"API key not valid…","status":"INVALID_ARGUMENT"…}}'
not ok 4 - o curto-circuito de nível 3 é registrado como L0
  expected: 3
# tests 5 / pass 3 / fail 2
```

**Note on that red run:** because the `generateContentFn` seam did not exist
yet, the first test fell through to the real client and a request did leave the
machine, rejected by the fake API key of `fake-external-env.ts`. No real
credential, no real usage — but it must not be possible, so both tests now
install a trap (`trapRealClient`) that makes `ai.models.generateContent` throw.
A future regression in the seam now fails the test instead of reaching the API.

GREEN: `# tests 5 / # pass 5 / # fail 0`.

The third test, `sem generateContentFn a chamada vai para o cliente Gemini
real`, mocks `ai.models.generateContent` and asserts it was called once — that
is the plan's "the default must be the real client" guard, and it passes both
before and after by design.

### Step 6 — `composeStageReplyWithTrace` (L6–L9)

Files: `src/services/conversations/conversation-stage.ts`; tests appended to
`src/tests/services/conversation-stage.test.ts`.

The body became `composeStageReplyWithTrace(input): { reply, rewrites }` and
`composeStageReply(input)` is now a one-line wrapper over `.reply`, so no
existing caller or test changed. Records: L6 `questionsDropped`, L7
`greetingsDropped`, L8 `{ cap, sentencesTruncated }`, L9
`{ fallbackText: "neutral_1" | "neutral_2" }` (the label, never the
client-visible string). The single old filter was split into two sequential
filters so questions and greetings are attributable to separate layers; the
resulting sentence set, and therefore the output text, is identical.

RED: `TypeError: (0 , import_conversation_stage.composeStageReplyWithTrace) is not a function` ×3.
GREEN: `# tests 27 / # pass 27 / # fail 0` (the file's 24 pre-existing tests
plus the 3 new ones, including the byte-identical regression guard over three
fixtures).

### Batch verification

```
npm run test:unit   →  ℹ tests 228 / ℹ pass 228 / ℹ fail 0
npx tsc --noEmit    →  no output, exit 0
npx ultracite check <the 8 changed source files>  →  Checked 8 files in 5s. No fixes applied.
```

`npm run test:db` was not run: no step in Batch B touches the database or the
schema, and no migration command was run. No network call, no Gemini call, no
Google API call, no write to Neon, `.env` untouched, nothing in version control.

### Deviations from the plan (Batch B)

1. **The new `metadata` fields are optional (`?`).** Three DB test files build
   `GenerateMarianaReplyResult` literals by hand
   (`src/tests/services/generate-mariana-response.test.ts`,
   `qualification-fallback-loop.test.ts`, `commercial-identity.test.ts`).
   Required fields would have broken `tsc` there and forced edits outside the
   files step 5 names. Step 7 must therefore read them defensively.
2. **`type` → `interface` in `turn-trace.ts` and for `TurnRewritesCarrier`.**
   The Design section writes `export type RewriteRecord = {…}`, but biome's
   `lint/style/useConsistentTypeDefinitions` rejects an object `type` alias, and
   `assist/source/useSortedInterfaceMembers` then sorts the members. The field
   names, types and optionality are exactly the Design's; only the declaration
   keyword and member order differ. Key order in the log line comes from the
   object literal at the call site, so the emitted line is unaffected.
3. **An 8-line private `recordRewrite` helper exists in both `agent.ts` and
   `conversation-stage.ts`.** Sharing it would mean exporting a fourth symbol
   from `turn-trace.ts`, and step 4 pins that module's contents. Worth
   revisiting in a later step if a third producer appears.
4. **`isPureBackendText` sentence comparison** is defined as: a
   backend-authoring layer (L0, L3, L5, L9, L10, L11) is present **and** no
   sentence of the final text appears among the raw reply's sentences
   (whitespace-normalised, split on `.`/`!`/`?`). The Design states the rule but
   not the comparison, so this is the implementation choice, unit-tested on the
   L0, L9 and L11 cases plus two negatives.

The step-4 acceptance criterion keeps its marker verbatim — `redação de
R-REL-07 não disponível — critério derivado do brief, pendente de
confirmação`. No spec wording was invented.

## Batch B — defect fixes (from `test-report-batch-B.md`)

### B-1 (medium-low) — the stage records did not chain to the raw reply hash

RED first, with the tester's own double-space fixture, in
`src/tests/services/conversation-stage.test.ts`:

```
not ok 28 - os registros do estágio encadeiam a partir da resposta crua
  expected: 62
  actual: 59
# tests 28 / pass 27 / fail 1
```

That is exactly the tester's measurement (`rawHash … len 62` vs
`L6 hashBefore … len 59`). The test asserts three things: the first record's
`hashBefore`/`lengthBefore` equal the raw `modelReply`, every later record's
`hashBefore`/`lengthBefore` equal the previous record's `after`, and the last
record's `hashAfter` equals the returned reply.

Fix: `src/services/conversations/conversation-stage.ts` now accumulates through
a small private `RewriteChain` seeded with the raw `modelReply`, so each layer's
`before` is literally the text that left the previous layer. The normalisation
performed by `splitSentences` is therefore absorbed into the first record
instead of vanishing. GREEN: `# tests 28 / # pass 28 / # fail 0`.

### Deviation 3's caveat — one shared helper

`buildRewriteRecord(layer, before: string, after: string, detail?)` now lives in
`src/lib/turn-trace.ts` (planner decision P-3) and is the only constructor of
records. The two private copies in `src/ai/agent.ts` and
`conversation-stage.ts` are gone, and the string/string-array asymmetry that
hosted B-1 is gone with them. Batch C's L5, L10 and L11 use the same helper, so
no third variant was added.

### Registering `src/tests/turn-trace-adversarial.test.ts`

Added to the `test:unit` list in `package.json`; assertions untouched. Suite
after the B-1 fix and the registration: `ℹ tests 238 / ℹ pass 238 / ℹ fail 0`
(228 + the tester's 9 + my 1 B-1 regression test). Notably the tester's
288-case golden digest over `composeStageReply` outputs *and* layer sequences
still passes, which is the evidence that the chaining fix changed no reply text
and no layer order.

## Batch C — assemble and emit (steps 7–8)

### Planner decision P-1 — `guardrailLayer`

RED first, in `src/tests/agent-model-config.test.ts` (`o erro de guardrail diz
qual camada lançou`, with the real-client trap installed **before** the run,
per the coordinator's warning):

```
not ok 6 - o erro de guardrail diz qual camada lançou
  expected: 'L4_safety_assertion'
# tests 6 / pass 5 / fail 1
```

Fix: `TurnRewritesCarrier` in `src/ai/agent.ts` gained
`turnGuardrailLayer?: RewriteLayer`, and the two catch sites attach their own id
(`L2_evidence_invalid_id`, `L4_safety_assertion`). The throw itself is
unchanged — same error, same message, same rejection. `TurnTrace` gained
`guardrailLayer: RewriteLayer | null`. GREEN: `# tests 6 / # pass 6 / # fail 0`.

### Planner decision P-2 — a missing `rewrites` is never `[]`

Route chosen: keep the six `metadata` fields optional (so the three DB test
files that hand-build `GenerateMarianaReplyResult` stay untouched) and make the
*sink* explicit. `TurnTrace` now has `rewrites: RewriteRecord[] | null` plus
`rewritesReported: boolean`, and `pureBackendText: boolean | null` — because
with the layers unknown that claim is undecidable, and `false` would be a
guess. The DB test `um produtor que não reporta rewrites nunca vira lista
vazia` pins all three (`rewritesReported === false`, `rewrites === null`,
`pureBackendText === null`).

Three more fields were widened to `| null` for the failure path, so the line
never invents data it does not have: `commercialAccessLevel`, `rawReplyHash`
/ `rawReplyLength`, `sentReplyHash` / `sentReplyLength`. On a guardrail throw
nothing was sent, and the trace now says so instead of reporting a hash of `""`.

### Step 7 — `generateMarianaResponse` assembles and logs the turn

Files: `src/services/conversations/generateMarianaResponse.ts`,
`src/ai/agent.ts` (P-1), `src/lib/turn-trace.ts` (P-1/P-2 fields),
`src/tests/services/generate-mariana-response-authorization.test.ts`,
`src/tests/services/generate-mariana-response.test.ts`.

L5/L10 (unit, RED first):

```
not ok 9 - persistAuthorizedAssistantReply registra L5 e L10
  error: "Cannot read properties of undefined (reading 'map')"
# tests 9 / pass 8 / fail 1
→ GREEN # tests 9 / # pass 9 / # fail 0
```

`persistAuthorizedAssistantReply` now returns `rewrites`, carrying
`L5_request_consultant_override` when the handoff replaces the text and
`L10_unauthorized_scheduling` when an unauthorised scheduling promise falls
back — and an empty list when it changed nothing.

Full turn (DB suite, RED first — 3 new tests):

```
not ok 8 - um turno emite exatamente uma linha mariana_turn com as camadas que alteraram o texto
not ok 9 - uma exceção de guardrail ainda é registrada como guardrail_throw
not ok 10 - um produtor que não reporta rewrites nunca vira lista vazia
# tests 10 / pass 7 / fail 3
→ GREEN # tests 10 / # pass 10 / # fail 0
```

Wiring: `traceTurnId?: string` param; the compose call uses
`composeStageReplyWithTrace` (or records L5 when `request_consultant`
short-circuits it); the transaction returns the stage + authorization records
plus `postTurnStage` and `questionKey`; L11 is recorded inline where the slot
offer replaces the text; a private `emitTurnTrace` builds the line and
`logTurnTrace` is called exactly once before the return. The model call is
wrapped so that an error carrying `turnGuardrailLayer` emits one
`guardrail_throw` line and is **rethrown unchanged** — an error without that
marker is left entirely alone, since model failure is Batch D.

One fixture correction, same class as step 4's: my synthetic turnIds
(`…-555555555555`) contain a 12-digit run and tripped my own "no 11-digit
sequence" privacy assertion. Replaced with hex-mixed UUIDs so the assertion
tests the line, not the fixture.

### Step 8 — thread `turnId` from the task

Files: `src/services/conversations/autonomous-task-handlers.ts` (one line:
`traceTurnId: task.id`); test in
`src/tests/reliability/inbound-batch-claim.test.ts` (which already mocks the
Gemini client).

RED — the trace used the conversation id:

```
not ok 2 - o rastro do turno usa o id da task âncora
  expected: 'adb50a90-a26c-4964-80db-80188090d9ad'   (task id)
  actual:   '05f8c327-9725-4539-9912-19221c5908c2'   (conversation id)
# tests 2 / pass 1 / fail 1
→ GREEN # tests 2 / # pass 2 / # fail 0
```

### Batch verification

```
npm run test:unit   →  ℹ tests 240 / ℹ pass 240 / ℹ fail 0
npx tsc --noEmit    →  no output, exit 0
npm run test:db     →  [setup-test-db] target localhost:5432/mariana_pkg_a_trace_test
                       ℹ tests 437 / ℹ pass 437 / ℹ fail 0
npx ultracite check <the 11 changed files>  →  Checked 11 files. No fixes applied.
```

**About the DB run.** Question 2 of the plan — which local container is the
disposable target — is still unresolved, so I reset *neither* existing
database. I created a brand-new `mariana_pkg_a_trace_test` on the container
documented in `CLAUDE.md:24` (`mariana:mariana@localhost:5432`, host and
database printed by the setup script, password never printed) and pointed
`TEST_DATABASE_URL` at it, with `RELIABILITY_WORKERS_ENABLED=false`. Dropping
the public schema of a database created seconds earlier cannot destroy
anything. Neon was never contacted; `mariana` and the other `mariana_*_test`
databases were not touched; no migration command was run. Davi can drop
`mariana_pkg_a_trace_test` at will.

### Deviations and known gaps (Batch C)

1. **`TurnTrace` grew three nullable widenings** beyond P-1/P-2
   (`commercialAccessLevel`, the two `rawReply*`, the two `sentReply*`). The
   Design table types them as always-present. Reporting `null` is the honest
   alternative to inventing a value on the guardrail path, and the privacy
   property is untouched (still no field whose type admits free text).
2. **`pureBackendText` and `rawReplyHash` use `response.result.reply` as "the
   raw reply"** when the producer did not report a hash. At this layer that is
   the text the backend actually received; the true pre-L1 text never leaves
   `agent.ts` by design.
3. **No record is emitted for pure normalisation.** If no layer fires but
   `splitSentences` re-joins differently, `rewrites` is `[]` while
   `sentReplyHash !== rawReplyHash`. Closing it would need a thirteenth layer
   id, which would contradict the fixed twelve-layer inventory, so the two
   hashes are left to speak for themselves.
4. **`actionBlockedReason` is always `null`** — `ExecuteNextActionResult` has
   no blocked branch today, so there is nothing to report. The field is kept
   for when one exists.
5. **`executedAction` is `nextActionResult.action`** (the Design says
   "`.action` / `.status`"); `status` is not in the line.

Step 7's acceptance criterion keeps its marker verbatim — `redação de
R-REL-07 não disponível — critério derivado do brief, pendente de
confirmação`. No spec wording was invented.

## Batch C — defect fixes (from `test-report-batch-C.md`)

DB target for every run below: `localhost:5433/mariana_impl_batch_d`, user
`postgres`, on the `mariana-test-pg` container Davi chose (password never
printed). I created that database; `mariana_test` and the tester's
`mariana_tester_batch_c` were not touched, and the `5432` container was not
used again. `.env`/Neon untouched, `RELIABILITY_WORKERS_ENABLED=false`.

### C-1 / P-4 — a turn that throws anywhere now emits its line

RED first, with the tester's shape (calendar failure after a successful model
call), in `src/tests/services/generate-mariana-response.test.ts`:

```
not ok 11 - um turno que falha depois da chamada ao modelo ainda emite uma linha
  expected: 1
  actual: 0
# tests 11 / pass 10 / fail 1
```

That is the tester's `PROBE_LINES=0`, reproduced as a committed test. Fix: the
whole turn is inside the `try` now, with a `traceEmitted` flag so the guardrail
path cannot double-emit, and a new `TurnOutcome` value `turn_error`
(`guardrailLayer` stays `null`). The catch re-throws the error untouched, so
the task fails exactly as before. A `turnResponse` capture means the line still
carries the model's own metadata when the model had already answered.
GREEN: `# tests 15 / # pass 15 / # fail 0` (including the tester's four
integration tests, unchanged).

Also added: a `model_error` classification, red first
(`expected: 'model_error' / actual: 'turn_error'`), so a `ModelUnavailableError`
is not reported as a generic turn error. That keeps one line per turn: the
trace is emitted where the context lives, and step 11's handler only adds its
`console.error`.

### C-4 / P-5 — `actionBlockedReason` carries the real reason

RED first, unit (`src/tests/execute-next-action.test.ts`) and DB:

```
not ok 21 - a ação rebaixada carrega o motivo do bloqueio
  expected: 'no_current_scheduling_intent'
# tests 21 / pass 20 / fail 1
```

`ExecuteNextActionResult`'s downgraded variant gained an optional
`blockedReason`, set in the blocked branches, and the trace reports it through
a `blockedReasonOf` narrowing helper. **There are four blocked branches, not
three** (`agent_action_blocked` at the post-edit lines 252, 268, 298, 314 — the
report cited 245/260/289 and missed the fourth); all four are patched, which is
what P-5 intends. No branch changed which action it downgrades to, and nothing
around `acceptedPendingOffer` was touched, so the pending-offer invariant is
intact.

Consequence I had to handle: seven pre-existing `assert.deepEqual(result, …)`
assertions in `execute-next-action.test.ts` broke, because the result object
grew a property. Control flow did not change, so I updated those seven
expectations to include the reason the branch now reports, and nothing else.

### C-2 and C-3 — the line stops inventing data

Both were implemented alongside C-1, so I captured their red by backing the
one-line fixes out again:

```
not ok 11 - um turno que falha depois da chamada ao modelo ainda emite uma linha
  expected: ~        actual: 'test-model'      (modelVersionReturned)
not ok 12 - o rastro não inventa latência, versão de modelo nem hash cru
  expected: ~        actual: 'test-model'
not ok 13 - um guardrail não reporta latência medida
  expected: ~        actual: 0                 (latencyMs)
# tests 13 / pass 10 / fail 3
```

C-2: `latencyMs` is `null` when nothing was measured (`TurnTrace.latencyMs` is
now `number | null`), and `modelVersionReturned` comes from a new
`metadata.modelVersionReturned` that holds `response.modelVersion ?? null` —
so a field named "returned" can no longer hold the configured name.
C-3: with `rewritesReported: false`, `rawReplyHash` and `rawReplyLength` are
`null` instead of a hash of the post-L1/L3 text. GREEN after restoring:
`# tests 17 / # pass 17 / # fail 0`.

### Declared deviation

`generateMarianaResponse` crossed biome's cognitive-complexity limit (23, then
21 after I extracted `emitFailureTrace`). The function was already at the limit
of 20 before P-4; splitting it is a behaviour refactor outside this step. I
added a file-scoped `biome-ignore-all` for that one rule **with the reason
written in it**, consistent with the four suppressions the file already
carries. In `src/ai/agent.ts` the same limit was crossed by one point and I
fixed it properly instead, by extracting a pure `parseModelJson` helper.

## Batch D — honest model failure (steps 9–11)

### Step 9 — `ModelUnavailableError`

Files: new `src/ai/model-errors.ts`; `src/ai/agent.ts`; new unit file
`src/tests/model-failure-notice.test.ts` (registered in `test:unit`, CODEMAP
row added). The real client is trapped in every test **before** the first red
run, as instructed — no request left the machine this time.

RED: `Error: Cannot find module '../ai/model-errors'`.
GREEN: `# tests 3 / # pass 3 / # fail 0` — transport (the N6 404, `cause`
preserved), `empty_response`, `invalid_json`, and the scope guard proving a
guardrail error is **not** wrapped.

The error carries `kind` in its options argument (`new ModelUnavailableError(
message, { cause, kind })`) because biome's `useErrorCause` only recognises
`cause` in the second argument; passing it third tripped the rule.

### Step 10 — the notice text

File: new `src/services/conversations/model-failure-notice.ts`.
RED: `Error: Cannot find module '…/model-failure-notice'`.
GREEN: `# tests 6 / # pass 6 / # fail 0`.

The text is pinned by an exact-text assertion, so any future edit needs a fresh
approval from Davi:

> Desculpe, tive uma falha técnica aqui e não consegui processar sua mensagem agora. Pode me enviar de novo em alguns instantes?

128 characters (≤ 160, one bubble). Two invariant tests back it:
`detectPendingOffer(MODEL_FAILURE_NOTICE) === null`, so it cannot arm the
pending-offer marker; and `persistAuthorizedAssistantReply` leaves it untouched
with `rewrites: []`, so it carries no scheduling promise.

### Step 11 — the handler completes instead of failing

Files: `src/services/conversations/autonomous-task-handlers.ts`; new DB test
`src/tests/reliability/model-failure.test.ts` (DB glob, no registration).

RED (only the Gemini client is mocked; the claim, handlers and outbox are real):

```
not ok 1 - falha do modelo enfileira o aviso e conclui a task
  expected: 1   actual: 0        (nenhuma linha de outbox)
not ok 2 - o aviso de falha nunca é enviado duas vezes
  error: 'Gemini request failed before producing a response'
# tests 3 / pass 1 / fail 2
```

Test 3 (a non-model failure must still fail the task) passed from the start, by
construction — it is the scope guard against swallowing every error.

Fix: a `sendModelFailureNotice` helper that persists the assistant message,
enqueues with **the `runKey` that already exists**, marks the messages and the
event processed exactly as the success path does, logs
`{ event: "mariana_model_failure", kind, model, conversationId, leadId }` and
returns `{ modelFailureNotice: true, outboundQueued: true }`. Only
`ModelUnavailableError` is caught; anything else is re-thrown unchanged.
GREEN: `# tests 3 / # pass 3 / # fail 0`.

Invariants, proved in the dedup test rather than assumed. My first expectation
was wrong and the code was right: on re-execution the handler returns
`{ skipped: true }`, because the inbound messages are already
`processedAt`-marked and the batch comes back empty — it never reaches the
`runKey` check. So I assert both layers: the skip, and then, after clearing
`processedAt` to simulate a retry where the marking had failed, that the reused
`runKey` returns `{ deduplicated: true }` with still exactly one outbox row. No
second idempotency key exists anywhere in the path.

### Deviation from Design item 3

Design item 3 step 4 puts `logTurnTrace({ outcome: "model_error", … })` in the
handler. I emit it in `generateMarianaResponse` instead, where the stage,
metadata and rewrites actually live, and leave only the `console.error` in the
handler. The handler has none of the trace context, and emitting in both places
would break the "exactly one `mariana_turn` line per turn" property the tester
verified on every outcome. Same data, honest source.

### Batch verification

```
npm run test:unit   →  ℹ tests 247 / ℹ pass 247 / ℹ fail 0
npm run test:db     →  [setup-test-db] target localhost:5433/mariana_impl_batch_d
                       ℹ tests 455 / ℹ pass 455 / ℹ fail 0
npx tsc --noEmit    →  no output, exit 0
npx ultracite check <the 11 changed files>  →  Checked 11 files. No fixes applied.
```

Step 11's acceptance criterion keeps its marker verbatim — `redação de S-17
não disponível — critério derivado do brief, pendente de confirmação`. No spec
wording was invented. Batch E was not started.

## Batch E — steps 12–14 (2026-10-26, R0 of flow-review)

DB target for every run: `localhost:5432/mariana_test` (`mariana-postgres`). `5433` is now `zapresponse-postgres-test` (another project), so it was not used.

### Step 12 — remove `vitest` — DONE
- Files: `package.json` (line removed), `package-lock.json` (`npm install --ignore-scripts`).
- Red: `package.json:33: "vitest": "^5.0.4"`; `node_modules/.bin/vitest` present.
- Green: grep (`*.ts/js/mjs/json`, minus node_modules/lock) → no hits; `ls node_modules/.bin/vitest` → absent.
- Lock churn: 85+/1042−. Only removals of vitest's tree; `jws@4.0.1` and `light-my-request@6.6.0` re-placed at identical versions. No upgrades.

### Step 13 — `setup-test-db.ts` — BLOCKED (plan incomplete), partial
- Added `applyTestDatabaseEnv(source)` to `src/tests/support/test-database-guard.ts`, with 2 tests in `src/tests/test-database-guard.test.ts`. Red: `applyTestDatabaseEnv is not a function`. Green: 10/10.
- Wiring it into `setup-test-db.ts:19` broke `test:db`. The spawned `drizzle-kit push` loads `drizzle.test.config.ts:11`, which re-runs `resolveTestDatabaseEnv`. That call now sees `DATABASE_URL === TEST_DATABASE_URL` and throws "points at the same database as DATABASE_URL". The plan's "also hardens the spawned push" is wrong.
- I reverted the `setup-test-db.ts` wiring by hand (its diff is empty). `test:db` is green again. The helper is shipped but not yet called. Fixing this needs a planner/Davi call (for example: the child env, the drizzle config, or a guard rule for "already applied").

### Step 14 — guard allowlist — DONE
- `test-database-guard.ts`: `LOCAL_HOSTS` = localhost/127.0.0.1/[::1]. A non-local host throws unless `ALLOW_REMOTE_TEST_DB === "1"`, which logs a `console.warn` naming host:port/db (no password). The neon.tech check runs first, so the hatch does not unlock Neon.
- Tests: 4 new. Red: 2 failed ("Missing expected exception"). Green: 14/14.
- Note: the existing "mesmo banco" test uses neon URLs, so the neon check (not the same-DB check) is what throws there. That was already true before this step.

### Batch verification
- `npm run test:unit`: 259 pass / 0 fail. `npx tsc --noEmit`: exit 0. `npm run build`: success.
- `npm run test:db`: 516 pass / 0 fail. Biome on the 4 files: no errors.
- Steps 15–17 were not assigned and were not started.

## Batch E — Revision 1: steps 14a, 14b, 13 (revised) (2026-10-26)

Plan status checked: `Status: APPROVED by Davi — "aprovo" (2026-10-26, Batch E revision 1)`. DB target: `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`.

### Step 14a — query allowlist (E-1) — DONE
- Files: `src/tests/support/test-database-guard.ts` (`ALLOWED_TEST_URL_QUERY_KEYS = {sslmode}`; any other key throws naming the key, not the value; runs after the neon check); `src/tests/test-database-guard.test.ts` (+2); adversarial `?host=` test: `todo` removed; `package.json` `test:unit` now lists `test-database-guard-adversarial.test.ts`.
- Red: `✖ recusa ?host= remoto…`, `✖ recusa ?hostaddr= e qualquer parâmetro…` (Missing expected exception). "aceita ?sslmode=disable" green before and after.
- Green: 23 pass / 0 fail / 2 todo. `test:unit` 259 → 270 tests (registration proof), 0 fail; tsc 0; biome clean.

### Step 14b — loopback aliases (E-2) — DONE
- Files: guard: new `comparableDatabaseIdentity` (localhost/127.0.0.1/[::1] → `loopback`), used only by the same-DB comparison; `describeDatabaseHost` and messages unchanged. Adversarial: E-2 `todo` removed, + "[::1] e localhost".
- Red: 2 ✖ (Missing expected exception). Green: 25 pass / 0 fail / 1 todo. `test:unit` 271/0 fail; tsc 0; biome clean.

### Step 13 (revised, option B) — DONE
- Files: guard: URL rules extracted to `checkTestDatabaseUrl` (shared by `resolveTestDatabaseEnv` and the new `assertAppliedTestDatabaseEnv`, which requires `DATABASE_URL === TEST_DATABASE_URL`, `NODE_ENV=test`, workers `"false"`); `drizzle.test.config.ts` calls the new export; `setup-test-db.ts:21` calls `applyTestDatabaseEnv(process.env)` before `postgres(` (:26) and `DROP SCHEMA` (:29). Drop/seed/push args unchanged.
- Tests: 5 new in `test-database-guard.test.ts`. Adversarial todo `:105-119` **rewritten** (approved decision 3): it asserted `resolveTestDatabaseEnv` accepts an applied env, which contradicts option B; now asserts `assertAppliedTestDatabaseEnv` accepts it and `resolveTestDatabaseEnv` still refuses "same database".
- Red: 5 ✖, `assertAppliedTestDatabaseEnv is not a function`. Green: 31 pass / 0 fail / 0 todo. "resolveTestDatabaseEnv continua recusando…" green throughout.
- Config load: applied env → loads; Neon-like `DATABASE_URL` → `UnsafeTestDatabaseError: DATABASE_URL is not the applied TEST_DATABASE_URL…`.

### Batch verification
- `npm run test:unit`: 276 pass / 0 fail / 0 todo. `npx tsc --noEmit`: exit 0. `npm run build`: success.
- `npm run test:db`: `[setup-test-db] target localhost:5432/mariana_test`; 533 pass / 0 fail / 0 todo (flake at `autonomous-task-executor.test.ts:275` did not occur).
- Biome on the 6 changed files: clean (one `useTopLevelRegex` fixed by hoisting `SAME_DATABASE_ERROR`).
- Deviation: none beyond the approved rewrite of the tester's todo. Steps 15–17 not started.

## Batch E — steps 15 and 17 (2026-10-26)

Plan status checked: `Status: APPROVED by Davi — "aprovo" (2026-10-26, Batch E revision 1)`; 15 and 17 unchanged since the 2026-10-22 approval. Step 16 on hold (E-4), not touched. Step 17 does not depend on step 16 code (only "same style"). DB target: `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`.

### Step 15 — NOT DONE (plan defect, stopped)
- The plan's assertion runs at preload time, right after `Object.assign` sets the sentinel, so it is always true. `src/env.ts` loads `dotenv` later, when the test file imports it. A doctored `override: true` there would replace the sentinel after the check. So the claim "a doctored `override: true` would now abort" is false.
- Probe (temp `.env` with a fake URL, no Neon): with the unit preload, the sentinel was intact at preload time; a later `dotenv.config({override:true})` replaced it with `postgresql://doctored@127.0.0.1:2/override`, and nothing aborted.
- Planner must choose a design that runs the check after `env.ts` loads (for example a test, or a check inside `env.ts` under `NODE_ENV=test`). No file changed.

### Step 17 — DONE
- Files: new `src/tests/support/test-network-egress-guard.ts` (pure `isForbiddenTestEgress`, `assertTestEgressAllowed`, `resolveTestNetworkPolicy`, `installTestNetworkGuard`); `unit-test-preload.ts` and `db-test-preload.ts` call `installTestNetworkGuard(process.env)` after the env assign; new `src/tests/test-network-egress-guard.test.ts`, registered in `package.json` `test:unit`; `docs/CODEMAP.md` support line.
- Patched: `net.Socket.prototype.connect` (covers `net.connect`, tls, HTTP agents, undici), `dns.lookup`, `dns.promises.lookup`, `http/https.request/get`, `globalThis.fetch`. Allowed: `localhost`, `127.0.0.1`, `::1`, `[::1]` and IPC paths. `ALLOW_TEST_NETWORK=1` permits all and prints one loud warning.
- Red: `Cannot find module './support/test-network-egress-guard'`. Green: 5/5. Wiring test (fake `lookup`, so no real DNS even when red) red: `Missing expected exception (isEgressError)`, fake lookup reached; green after wiring: 6/6. With the hatch: 5 pass, 1 skipped, warning printed. Manual: `fetch(Gemini URL)` under the preload rejects with `TestNetworkEgressError`.
- Deviation: the plan names `net.connect`; I patched `Socket#connect`, which `net.connect` calls, so tls and agents are covered too. Added the wiring test beyond the predicate tests.
- Finding: `src/tests/routes/webhook-whatsapp.test.ts` makes an un-mocked WhatsApp send to `graph.facebook.com`. The guard now blocks it locally. The test still passes, because the client logs the network error. Not fixed (out of scope).

### Batch verification
- `npm run test:unit`: 286 tests, 284 pass / 0 fail / 2 todo (E-4, E-5). `npx tsc --noEmit`: exit 0. `npm run build`: success. Biome on the 5 changed code files: clean.
- `npm run test:db` (`[setup-test-db] target localhost:5432/mariana_test`): run 1 had 540 pass / 1 fail, the known flake `autonomous-task-executor.test.ts:275`. Run 2: 541 pass / 0 fail / 2 todo. Run 3: 541 pass / 0 fail.

## Batch E-R2a — steps 14c and 14d (2026-10-26)

Plan status checked: line 1 `Status: APPROVED by Davi — "aprovo" (2026-10-26, Batch E revision 2)`; 14c/14d are in Revision 2 (decisions 2 and 3). DB target `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`.

### Step 14c — DONE (E-4)
- Files: `src/tests/support/test-database-guard.ts` (new private `assertDriverReadsSameHost`, called in `checkTestDatabaseUrl` after the neon and query checks, before the local-host check; neon/query order and messages unchanged); `src/tests/test-database-guard.test.ts` (+2 tests); `src/tests/test-database-guard-adversarial.test.ts` (E-4 `todo` removed, header comment updated, +1 agreement test, `import postgres`).
- Rule (D-2): authority read postgres.js-style (after `://`, up to first `/`, `?`, `#`); refuse >1 raw `@`; refuse `,` or `@` in the decoded host part; refuse when that host (port stripped, lower-cased) differs from `URL.hostname`. Messages carry no userinfo. No driver import in the guard.
- Red: E-4 `Missing expected exception (UnsafeTestDatabaseError)`; "recusa @ a mais…" `Missing expected exception: postgresql://u:p@x@localhost:5432/db`; agreement test failed on `u:p@x%2Cdb.example.com@localhost` (accepted by guard, postgres.js reads a host list). "aceita senha com %40" green before and after.
- Green: both guard files 37/39 after 14c (remaining 2 = 14d red), 39/39 after 14d.
- Agreement corpus: the tester's "Bypass attempts" table plus E-4/E-5 URLs and the plain local URLs; asserts `postgres(url).options.host` is `[guardHost]` and local for every accepted URL. No `sql` call.
- Note (no change): `[::1]` stays accepted (existing test "aceita localhost, 127.0.0.1 e ::1"); postgres.js reads it as host `"["` (tester observation, fails safe). Not in the corpus, so the agreement test does not cover it. `[0:0:0:0:0:0:0:1]` is now refused (raw host differs from `URL.hostname` `[::1]`).

### Step 14d — DONE (E-5)
- Files: same guard (`SINGLE_PATH_SEGMENT`; port and database checks); E-5 `todo` removed; +1 test "a mensagem de porta ou banco ausente nomeia o que falta" (5 URLs; message names `port`/`database`, never the password).
- Order: non-local refusal (no hatch) → port → database → remote warning. The local check now runs first so "recusa um host remoto que não é neon.tech" (port-less fixture, `test-database-guard.test.ts:129`) is still refused for being remote, not for the port.
- Fixture edit: adversarial "ALLOW_REMOTE_TEST_DB=1 não libera RELIABILITY_WORKERS_ENABLED=true" `db.example.com/t` → `db.example.com:5432/t`, so it is still refused by the workers rule and not by the new port rule. No accepted fixture needed a port (all already had `:5432`).
- Red: E-5 `Missing expected exception (UnsafeTestDatabaseError): postgresql://mariana:pw@localhost/mariana_test`; message test `Missing expected exception: postgresql://mariana:segredo@localhost/mariana_test`. Green: 39/39.

### Batch verification
- `npm run test:unit`: 290 pass / 0 fail / 0 todo. `npx tsc --noEmit`: exit 0. `npm run build`: exit 0. Biome on the 3 changed files: clean (fixed `noIncrementDecrement`, `useArrayDestructuring`, formatting).
- `npm run test:db` (`[setup-test-db] target localhost:5432/mariana_test (seed v1)`): 563 tests, 558 pass / 0 fail / 5 todo (E-6/E-7/E-8 egress todos, batch E-R2c). Flake did not occur.
- Risk (from plan): Davi's `.env` `TEST_DATABASE_URL` must name port and database; if not, `test:db` now refuses it before any statement.
- Deviations: none from D-2/D-3. Agreement corpus contents chosen by me (listed above).

## Batch E-R2b — steps 15 (revised) and 16 (amended) (2026-10-26)

Plan status checked: line 1 `Status: APPROVED by Davi — "aprovo" (2026-10-26, Batch E revision 2)`; D-1 (decision 1) covers 15, D-4 (decision 4) covers 16. DB target `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`. The Skill tool was not available in this session; TDD followed by hand.

### Step 15 (revised) — DONE (D-1)
- Files: new `src/tests/test-env-isolation.test.ts` (5 tests), registered in `package.json` `test:unit`; comments only in `unit-test-preload.ts` and `db-test-preload.ts` (dependency on `override: false`); `docs/CODEMAP.md` Tests/Support line. `src/env.ts` and `fake-external-env.ts` unchanged.
- Harness: temp dir per case with fake `.env` (`DATABASE_URL=postgresql://doctored@127.0.0.1:2/override`, `canary-<KEY>` for every `FAKE_EXTERNAL_ENV` key); child = `process.execPath --import <abs tsx loader> --import <abs preload> probe.cjs`, cwd = temp dir, env = `PATH` (+ `TEST_DATABASE_URL=…localhost:5432/env_isolation_probe` for the DB case); child prints only booleans and key names; temp dir removed. No connection, no network.
- Red evidence: the control "o harness detecta um dotenv com override" passes, i.e. with `dotenv.config({override:true})` after `env.ts` the URL check is false and the canary list names all 16 keys — the two main tests would fail. Coverage control (map without `GEMINI_API_KEY`) names `GEMINI_API_KEY`. `env.ts` was not edited (the optional red is the tester's).
- Deviation: the D-1 regex `/KEY|TOKEN|SECRET|CLIENT_ID|EMAIL|PHONE_NUMBER_ID|WABA_ID/` matches `GEMINI_MAX_OUTPUT_TOKENS` (config, not a credential). Run with the plan regex: `actual: [ 'GEMINI_MAX_OUTPUT_TOKENS' ], expected: []`. Anchored at the end (`…WABA_ID)$/`); every credential key still matches. Cost: a future key with a suffix after the word (e.g. `X_TOKEN_V2`) would escape the check.
- Green: 5/5.

### Step 16 (amended) — DONE (D-4)
- Files: `src/tests/support/test-database-guard.ts` (rules of `checkTestDatabaseUrl` moved into exported `assertSafeTestDatabaseUrl(name, value, source)`; messages now use `${name}`, unchanged text for `TEST_DATABASE_URL`; new pure `isForbiddenTestConnection({ url, env, argv, execArgv })`: test process = `NODE_TEST_CONTEXT` set or `--test` in `execArgv`/`argv`; then forbidden iff the shared helper throws — 14a/14b/14c/14d/local; `ALLOW_REMOTE_TEST_DB=1` frees remote, never neon); `src/db/connections.ts` (calls it before `postgres(...)`, throws `UnsafeTestDatabaseError` without the URL); `src/tests/test-database-guard.test.ts` (+5 tests).
- Red: 5 new tests `TypeError: … isForbiddenTestConnection is not a function`. Green: guard files 48 pass / 0 fail / 1 todo (E-11).
- Manual wiring probe (temp dir, `env -i`, fake values, fake host `ep-fake.neon.tech`, no connection): with `NODE_TEST_CONTEXT=child-v8` import of `connections.ts` throws `UnsafeTestDatabaseError`; without it, imports.
- Deviation: none. Note: with the hatch, the helper's remote warning also prints when `connections.ts` loads.

### Batch verification
- `npm run test:unit`: 305 tests, 304 pass / 0 fail / 1 todo (E-11). `npx tsc --noEmit`: exit 0. `npm run build`: success. Biome on the 7 changed code files: clean.
- `npm run test:db` (`[setup-test-db] target localhost:5432/mariana_test (seed v1)`): 578 tests, 572 pass / 0 fail / 6 todo. Flake did not occur.

## Batch E-R2c — E-13, steps 18a, 18, 19 (2026-10-26, implementer)

DB target for every DB run: `localhost:5432/mariana_test`, `RELIABILITY_WORKERS_ENABLED=false`.

### E-13 (implementer defect in step 15)
- File: `src/tests/test-env-isolation.test.ts` — `canaryValue(key)`: `*_EMAIL` keys get `canary-<KEY>@example.test`; the probe compares against the same map. New option `overrideBeforeImport` (dotenv `override: true` before `env.ts` parses = a doctored `env.ts:1`).
- Test added: "o harness detecta um override antes do parse do env.ts pelo canário". Red: `probe child failed … GOOGLE_ACCOUNT_EMAIL: Invalid email address`. Green after the canary fix (6/6).
- Control proof (temporary flip of the first test to `overrideBeforeImport`, reverted): fails on `canaryKeys: [ 'GEMINI_API_KEY', 'GOOGLE_ACCOUNT_EMAIL', … all 16 ]`, `envDatabaseUrlMatches: false` — the canary message, not the email error.

### Step 18a — E-6, E-7, E-8 closed; adversarial file registered
- Files: `test-network-egress-guard.ts` (socket path reads `host`; `guardDnsQueries` over `dns`, `dns.Resolver.prototype`, `dns.promises`, `dns.promises.Resolver.prototype`; `dgram.Socket#send/connect`), adversarial file (3 `todo` removed + new test "E-7/E-8: dns.resolve* do módulo, Resolver de callback, reverse e dgram.connect também são bloqueados"), `package.json` `test:unit`.
- Red: 4 ✖ (E-6 `false !== true`; E-7, E-8, new test: validation returned false). Green: 17 tests, 15 pass, 2 todo (E-9, E-9b stay).
- Size rule: E-7 = one generic wrapper over a method list; E-8 = two small wrappers. Within D-5.
- Registration: `test:unit` 311 → 328 tests (+17).
- Note: the red run of the new test sent one real DNS query for `egress-probe.invalid` (`.invalid` TLD, no payload) via the system resolver before the guard existed.

### Step 18 — blocked egress fails the file
- Files: guard (`globalThis` counter — preload ESM and test CJS load separate module copies; `takeBlockedEgressAttempts`; `guardTestEgress`; exit hook writes `[test-network-guard] FAIL: blocked egress to "<host>" (Nx)` and sets `exitCode = 1`), `test-network-egress-guard.test.ts` (3 tests + drain in the wiring test), adversarial file (`test.afterEach` drains).
- Red: fixture child exit `0`; `takeBlockedEgressAttempts is not a function`. Green: all pass.
- Deviation: extra export `guardTestEgress` (assert + count) so the hatch test can exercise the counter without a real request; `assertTestEgressAllowed` stays non-counting. The hatch test also spawns a fixture with `ALLOW_TEST_NETWORK=1` + fake `lookup` → exit 0.
- `test:db` red as planned: exit 1, `fail 2` — files `session-choice-invalid-replies.test.ts` (`generativelanguage.googleapis.com` 3x) and `webhook-whatsapp.test.ts` (`graph.facebook.com` 1x). No other file flagged (unit run: none after the drain).

### Step 19 — mock the flagged leaks
- `webhook-whatsapp.test.ts:1830`: `WhatsAppService.prototype.sendTextMessage`/`sendReplyButtonsMessage` mocked with restore; asserts `sentTo` = `[testPhone]` and zero blocked egress. Existing assertions unchanged.
- `session-choice-invalid-replies.test.ts:473`: `t.mock.method(ai.models, "generateContent")`; turn trace captured from `console.info`; asserts mock called, outcome list non-empty and without `model_error`, zero blocked egress. Existing assertions unchanged.
- Biome: 2 pre-existing `noAwaitInLoops` errors in `session-choice-invalid-replies.test.ts:156,279` (untouched lines).

### Final suites
- `npm run test:unit`: exit 0 — 331 tests, 327 pass, 0 fail, 4 todo.
- `npm run test:db`: exit 0 — 588 tests, 584 pass, 0 fail, 4 todo; no blocked-egress line. Flaky `autonomous-task-executor.test.ts:275` did not fail.
- `npx tsc --noEmit`: exit 0. `npm run build`: success.
- No file added/moved under `src/` → `docs/CODEMAP.md` unchanged in this batch.

## Batch E-R3a (implementer, 2026-10-27) — step 20 (E-12) + E-14

Gate: plan line 1 `Status: APPROVED by Davi — "ok eu aprovo" (2026-10-27, Batch E revision 3)`, decisions 1–4. E-R2c report: PASS.

### Step 20 — E-12: a test file run directly is a test process
- Files: `test-database-guard.ts` (`isTestEntryScript` + `TEST_ENTRY_BASENAME`/`PATH_SEPARATOR` top-level regexes; third trigger in `isForbiddenTestConnection`; doc comment), `connections.ts:12-14` (comment only), `test-database-guard.test.ts` (4 tests), adversarial file (E-12 `todo` removed; `importConnectionsInChild` gains `{ directTestFile }`: writes `f.test.mjs` in the temp cwd with fake `.env` `ep-fake-1…neon.tech`, runs `node <tsx/cli> f.test.mjs`, env only `PATH`; probe script now uses `import("node:url")` so it runs as CJS and ESM).
- Red: 4 fail — E-12 (`actual false`), wiring (`outcome: 'imported'`), `.test.*` entry, `src/tests/` entry. Production-entries and local-DB tests green before and after.
- Green: 59 tests, 58 pass, 0 fail, 1 todo (E-11, step 21).

### E-14 — E-7/E-8 test never uses the system resolver
- File: `test-network-egress-guard-adversarial.test.ts`. Test body moved to `probeModuleDnsAndDgram()`; the test does `dns.setServers(["127.0.0.1:1"])` (covers `dns.promises` too, probed) and restores the previous servers in `finally`. Added "E-14: o teste E-7/E-8 restaura os servidores DNS do sistema".
- Red: `actual: [ '127.0.0.53' ], expected: [ '127.0.0.1:1' ]` (assert runs before any probe, so no query was sent). Green: 21 tests, 18 pass, 0 fail, 3 todo. The restore test cannot be red before the fix (nothing changed the servers); it pins the `finally`.

### Final suites
- `npm run test:unit`: 340 tests, 336 pass, 0 fail, 4 todo. `npm run test:db` (localhost:5432/mariana_test): 597 tests, 593 pass, 0 fail, 4 todo; flaky `:275` did not fail.
- `npx tsc --noEmit`: exit 0. `npm run build`: success. Biome on the 5 changed files: clean (formatter applied to the adversarial DB guard file only).
- No file added/moved under `src/` → `docs/CODEMAP.md` unchanged. Step 21 not done (batch E-R3b).

## Batch E-R3b (implementer, 2026-10-27) — step 21 (E-11)

Gate: plan line 1 `Status: APPROVED by Davi — "ok eu aprovo" (2026-10-27, Batch E revision 3)`, decision 2 (step 21 now). E-R3a report: PASS.

### Step 21 — E-11: refuse URL forms the drivers read differently
- Files: `test-database-guard.ts` (new `assertNoAmbiguousCharacters`, called in `assertSafeTestDatabaseUrl` after the empty check, before `parsePostgresUrl`; raw text: any `\s` or code ≤0x1f / 0x7f refused; `%` refused in host (after the authority's first `@`) and path; userinfo untouched), `test-database-guard.test.ts` (1 test), adversarial file (E-11 `todo` removed). No fixture edits. E-12c/E-12d todos untouched.
- Red: 2 fail — E-11 adversarial (`Missing expected exception … " postgresql://…"`), new "recusa espaço, caractere de controle e % no host ou no banco". Pre-fix probe: leading/trailing space, `\n`, `mariana%5Ftest` accepted; tab-in-host and `local%68ost` already refused by 14c (plan expected tab red — deviation, harmless).
- Green: 64 tests, 62 pass, 0 fail, 2 todo (E-12c, E-12d). `%40` password test and three-way agreement test green (no exception list).
- Deviation: biome `noControlCharactersInRegex` refused `/[\s\x00-\x1f\x7f]/`; same rule written as `/\s/` + char-code check. No suppression.

### Final suites
- `npm run test:unit`: 345 tests, 340 pass, 0 fail, 5 todo. `npm run test:db` (localhost:5432/mariana_test): exit 0, 602 tests, 597 pass, 0 fail, 5 todo; flaky `:275` did not fail.
- `npx tsc --noEmit`: exit 0. `npm run build`: success. Biome on the 3 changed files: clean.
- No file added/moved under `src/` → `docs/CODEMAP.md` unchanged.

## E-16 fix (implementer, 2026-10-27) — step 14 defect from "E-R3b + final"

Gate: plan line 1 `Status: APPROVED by Davi — "ok eu aprovo" (2026-10-27, Batch E revision 3)`.
- Files: `test-database-guard.ts` (`parsePostgresUrl`: refuse a value not matching `SCHEME_WITH_AUTHORITY` (`<scheme>://`) before `new URL`; refuse empty `hostname` (`postgresql:///u:pw@…`); clear `input` on the `new URL` TypeError kept as `cause`, since `inspect(error)` printed the full URL). Covers `resolveTestDatabaseEnv`, `assertAppliedTestDatabaseEnv`, `describeDatabaseHost` and the `DATABASE_URL` compare. Adversarial file: E-16 `todo` removed; new test "E-16: nenhum caminho de recusa imprime a senha (canário)" (every refusal path, with and without `ALLOW_REMOTE_TEST_DB=1`, plus the remote warning; checks message, `inspect(error)` and `console.warn`). E-11b `todo` untouched.
- Red: E-16 (`non-local host (:5432/mariana:SEGREDO@localhost…)`), canary test (`Missing expected exception: postgresql:u:C4n4ryPw9x@…`, DATABASE_URL without `//` accepted). Probe before fix: no-`//` and `///` leak in message; `ho^st` leaks via `cause.input`; `describeDatabaseHost` returned the password.
- Green: guard files 70 tests, 67 pass, 0 fail, 3 todo.
- Deviations: beyond the no-`//` case, also empty host and `cause.input` (both proven leaks, same defect class). A `DATABASE_URL` without `//` is now refused in DB tests (stricter only). Biome `useErrorCause` forbade dropping `cause`, so `input` is cleared instead.
- Suites: `test:unit` 351 tests, 345 pass, 0 fail, 6 todo. `test:db` (localhost:5432/mariana_test) 608 tests, 602 pass, 0 fail, 6 todo; flaky `:275` did not fail. `tsc` exit 0. `build` success. Biome on the 2 files: clean. CODEMAP unchanged.

## E-16b fix (implementer, 2026-10-27) — from "E-16 fix verification"

Gate: plan line 1 `Status: APPROVED by Davi — "ok eu aprovo" (2026-10-27, Batch E revision 3)`.
- Files: `test-database-guard.ts` (`parsePostgresUrl`, after the `://` check: any raw `@` after the authority end (first `/`, `?` or `#` after `://`) is refused with a constant message, before `new URL` and before any message cites path or query; covers `describeDatabaseHost`). Adversarial file: E-16b `todo` marker removed (`:930`).
- Red: E-16b failed with `non-local host (u:1234/C4n4ryPw9x@localhost:5432/db)`. Green: guard files 72 tests, 69 pass, 0 fail, 3 todo; `:971` green.
- Deviations: none. The rule also refuses `#…@` (was already clean, now refused earlier).
- Suites: `test:unit` 353 tests, 347 pass, 0 fail, 6 todo. `test:db` (localhost:5432/mariana_test) 610 tests, 604 pass, 0 fail, 6 todo; flaky tests did not fail. `tsc` exit 0. `build` success. Biome on the 2 files: clean.
