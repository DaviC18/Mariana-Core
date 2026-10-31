import assert from "node:assert/strict";
import test from "node:test";
import { isSessionInactivityGap } from "../services/conversations/session-choice-policy";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

test("regressão: inatividade exata de 4h, 4h − 1 ms e conversas sem histórico prévio", () => {
	const now = new Date("2026-10-23T10:00:00.000Z");
	const exactly4hAgo = new Date(now.getTime() - FOUR_HOURS_MS);
	const justUnder4hAgo = new Date(now.getTime() - FOUR_HOURS_MS + 1);

	assert.equal(
		isSessionInactivityGap({
			lastCustomerMessageAt: exactly4hAgo,
			now,
		}),
		true
	);

	assert.equal(
		isSessionInactivityGap({
			lastCustomerMessageAt: justUnder4hAgo,
			now,
		}),
		false
	);

	// Caso de conversa nova sem lastCustomerMessageAt
	assert.equal(
		isSessionInactivityGap({
			lastCustomerMessageAt: null,
			now,
		}),
		false
	);
});
