import assert from "node:assert/strict";
import test from "node:test";

import { safeEqual } from "../../lib/security/constant-time";

test("safeEqual: strings iguais → true", () => {
	assert.equal(safeEqual("abc-123", "abc-123"), true);
	assert.equal(safeEqual("çãé-🔑", "çãé-🔑"), true);
});

test("safeEqual: diferentes, tamanhos diferentes, vazio e unicode → false sem lançar", () => {
	const cases: [string, string][] = [
		["abc-123", "abc-124"],
		["abc", "abcd"],
		["abcd", "abc"],
		["", "abc"],
		["abc", ""],
		["é", "é"],
		["🔑", "🔒"],
	];
	for (const [a, b] of cases) {
		assert.doesNotThrow(() => safeEqual(a, b));
		assert.equal(safeEqual(a, b), false, `${a} vs ${b}`);
	}
});

test("safeEqual: valor que não é string → false sem lançar", () => {
	assert.equal(safeEqual(undefined as unknown as string, "abc"), false);
	assert.equal(safeEqual("abc", null as unknown as string), false);
});
