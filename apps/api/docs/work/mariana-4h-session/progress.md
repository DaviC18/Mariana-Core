Steps done:
1. Update policy constant and question text (src/services/conversations/session-choice-policy.ts) - changed SESSION_INACTIVITY_MS from 24h to 4h, updated question text.
2. Update policy unit tests (src/tests/session-choice-policy.test.ts) - updated for 4h.
3. Update webhook tests that assumed 24h gaps (src/tests/routes/webhook-whatsapp.test.ts) - updated test names and timings.

Tests run:
- DB: TEST_DATABASE_URL=postgresql://mariana:mariana@localhost:5432/mariana_test npx tsx --import ./src/tests/support/db-test-preload.ts --test --test-reporter=dot src/tests/session-choice-policy.test.ts → pass
- DB: TEST_DATABASE_URL=postgresql://mariana:mariana@localhost:5432/mariana_test npx tsx --import ./src/tests/support/db-test-preload.ts --test --test-reporter=dot src/tests/routes/webhook-whatsapp.test.ts → pass (14/14)
- DB: TEST_DATABASE_URL=postgresql://mariana:mariana@localhost:5432/mariana_test npx tsx --import ./src/tests/support/db-test-preload.ts --test --test-reporter=dot src/tests/reliability/session-choice-gate.test.ts → pass

Deviations: none
