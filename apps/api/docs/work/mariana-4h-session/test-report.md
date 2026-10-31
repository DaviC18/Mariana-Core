# Test report — mariana-4h-session

**Verdict: PASS** (verified in flow-review R1-c step 6, 2026-10-27). Full section: `docs/work/2026-10-26-flow-review/test-report.md` § "R1 final".

| Criterion (plan.md "Design") | Test / evidence | Result |
|---|---|---|
| `SESSION_INACTIVITY_MS = 4 * 60 * 60 * 1000` | `session-choice-policy.ts:5`; `session-choice-policy.test.ts:24` | PASS |
| Exactly 4h asks; 4h − 1 ms does not; null does not | `session-choice-policy.test.ts:24`, `:43`; `session-inactivity-regression.test.ts:7` (red with a 24h mutation, flow-review step 2) | PASS |
| Webhook asks at 4h before processing; processes normally at 4h − 1 ms | `routes/webhook-whatsapp.test.ts:1831`, `:1658` | PASS |
| Question text says "mais de 4 horas" | `session-choice-policy.ts:40`; `session-choice-policy.test.ts:109` | PASS |
| WhatsApp 24h window unchanged and independent | `session-choice-policy.test.ts:139` | PASS |
| No schema or migration change | `git show --stat 89dacbf`: no `drizzle/` file | PASS |
| Docs at 4h (spec D6/AC11/AC12, ROADMAP WP-4, CODEMAP) | flow-review step 5, verified in "R1 final" | PASS |

Suites (2026-10-27): `test:unit` 357/351/0 (6 todo); `test:db` on `localhost:5432/mariana_test` 620/614/0 twice; `tsc` 0; `build` 0.

Risks: a second 4h gap after "Continuar" does not re-open the choice (F2-01, flow-review R2 step 8). Leftover "24h" in two test titles (`session-choice-policy.test.ts:98`, `session-choice-continue.test.ts:243`).
