import assert from "node:assert/strict";
import test from "node:test";
import { parseAgeOrBirthDate } from "../../../services/flow-v2/lead-fields";
import { isAtLeast18 } from "../../../services/leads/lead-qualification";

const NOW = new Date("2026-10-28T15:00:00.000Z");

test("age is parsed by the backend: '16', '16 anos', 'tenho 16 anos', dd/mm/aaaa", () => {
	for (const value of [
		"16",
		"16 anos",
		"tenho 16 anos",
		"Tenho 16 anos de idade",
	]) {
		const birthDate = parseAgeOrBirthDate(value, NOW);
		assert.ok(birthDate, value);
		assert.equal(isAtLeast18(birthDate, NOW), false, value);
	}
	const adult = parseAgeOrBirthDate("18", NOW);
	assert.ok(adult);
	assert.equal(isAtLeast18(adult, NOW), true);

	assert.deepEqual(
		parseAgeOrBirthDate("10/05/2009", NOW),
		new Date("2009-05-10T00:00:00.000Z")
	);
	assert.equal(
		isAtLeast18(parseAgeOrBirthDate("29/10/2008", NOW) as Date, NOW),
		false
	);
});

test("anything else is not an age: the AI text never becomes a birth date", () => {
	for (const value of [
		"",
		"jovem",
		"uns 16 ou 17",
		"0",
		"130",
		"31/02/2000",
		"10/05/2030",
		"quero 100 mil",
		"16 meses",
	]) {
		assert.equal(parseAgeOrBirthDate(value, NOW), null, value);
	}
});

// Tester (Batch B).
test("tester B: age edge cases", () => {
	// Exatamente 18 hoje é adulto; 17 nunca vira adulto.
	const eighteen = parseAgeOrBirthDate("18", NOW);
	assert.ok(eighteen && isAtLeast18(eighteen, NOW));
	const seventeen = parseAgeOrBirthDate("17 anos de idade", NOW);
	assert.ok(seventeen && !isAtLeast18(seventeen, NOW));
	// Nascido amanhã há 18 anos: ainda 17.
	const almost = parseAgeOrBirthDate("29/10/2008", NOW);
	assert.ok(almost && !isAtLeast18(almost, NOW));
	for (const value of [
		"0",
		"121",
		"999",
		"-16",
		"16.5",
		"dezesseis",
		"31/02/2000",
		"10/10/2030",
		"10/10/1800",
		"tenho 2 filhos",
		"16 ou 17",
		"",
	]) {
		assert.equal(parseAgeOrBirthDate(value, NOW), null, value);
	}
});
