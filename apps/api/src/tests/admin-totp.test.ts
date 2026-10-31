import assert from "node:assert/strict";
import test from "node:test";

import {
	createAdminSession,
	verifyAdminSession,
	verifyTotp,
} from "../lib/security/admin-totp";

test("verifica o vetor RFC 6238 e tolera somente uma janela adjacente", () => {
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
	assert.equal(verifyTotp(secret, "287082", 59_000), true);
	assert.equal(verifyTotp(secret, "287082", 119_000), false);
	assert.equal(verifyTotp(secret, "287082", 89_000), true);
});

test("sessão TOTP expira e não pode ser alterada", () => {
	const secret = "session-signing-secret-0123456789abcdef";
	const token = createAdminSession(secret, 10_000);
	assert.equal(verifyAdminSession(secret, token, 10_001), true);
	assert.equal(verifyAdminSession(secret, `${token}x`, 10_001), false);
	assert.equal(
		verifyAdminSession(secret, token, 10_000 + 8 * 60 * 60 * 1000),
		false
	);
});
