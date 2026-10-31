Status: APPROVED by Davi on 2026-10-23T20:25:02-03:00 — aprovo

## Summary
- Change session inactivity rule from 24h to 4h (4 * 60 * 60 * 1000).
- Update texts that mention "24 horas" to reflect 4 hours.
- Keep session choice flow intact (gap detection, pending state, buttons).

## Root causes / scope
- `src/services/conversations/session-choice-policy.ts:5` — `SESSION_INACTIVITY_MS = 24*60*60*1000`. **Confirmed** (root of gap rule).
- `src/services/conversations/session-choice-policy.ts:40` — `SESSION_CHOICE_QUESTION_TEXT` says "mais de 24 horas". **Confirmed** (user-facing text).
- `src/services/conversations/session-choice-policy.ts` — other texts do not hardcode 24h. **Confirmed**.
- `src/routes/whatsapp/webhook-whatsapp.ts` uses `isSessionInactivityGap` — no change needed. **Confirmed**.
- `src/services/conversations/autonomous-task-handlers.ts` uses policy texts/functions — no change needed. **Confirmed**.
- `src/tests/session-choice-policy.test.ts` hardcodes 24h assumptions (DAY_MS, expected texts). **Confirmed** — will need updating.
- `src/tests/reliability/*session-choice*` tests may assume 24h behavior. **Unclear** — check if they construct gaps with 24h; better to scan and update only if necessary.

## Design
- Change `SESSION_INACTIVITY_MS` to `4 * 60 * 60 * 1000`.
- Update `SESSION_CHOICE_QUESTION_TEXT` to say "mais de 4 horas".
- Update tests in `src/tests/session-choice-policy.test.ts` to use 4h (or keep helper but expect 4h). The test "24h exatas contam..." should become "4h exatas contam...".
- Do not change `WHATSAPP_CUSTOMER_WINDOW_MS` or whatsapp-compliance (rules must remain independent per existing test).
- No schema/migration changes.

## Steps
1. **Update policy constant and question text**
- Files: `src/services/conversations/session-choice-policy.ts`
- Change: `SESSION_INACTIVITY_MS = 4 * 60 * 60 * 1000`; update `SESSION_CHOICE_QUESTION_TEXT` to mention "4 horas".
- Acceptance: unit tests for policy still compile; no import of whatsapp-compliance.

2. **Update policy unit tests**
- Files: `src/tests/session-choice-policy.test.ts`
- Change: replace DAY_MS with 4h equivalent, update test names/descriptions and expectations to 4h. Update question text assertion.
- Acceptance: `npx tsx --import ./src/tests/support/unit-test-preload.ts --test --test-reporter=dot src/tests/session-choice-policy.test.ts` passes.

3. **Scan other tests for 24h assumptions related to session choice**
- Files: grep results under `src/tests/reliability/*session-choice*`
- Change: only if they hardcode 24h gaps/texts. If not, leave as-is.
- Acceptance: targeted tests still pass if run.

## Out of scope
- Changing whatsapp window/compliance.
- Changing session choice flow logic.
- Migrations/schema.
- Other "24h" mentions not related to session inactivity gap.

## Questions for the owner
- None. Change is straightforward.
