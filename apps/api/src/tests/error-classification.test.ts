/**
 * 2026-10-27-scheduling-loop, correções do Batch A (F-A1, F-A2, F-A2b):
 * `describeError` corta a query e os params do Drizzle, mascara segredos e
 * classifica as falhas comuns do Google.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { DrizzleQueryError } from "drizzle-orm/errors";

import { classifyError, describeError } from "../lib/error-classification";

test("Drizzle: corta a query e tudo a partir de \\nparams:, mantém a causa", () => {
	const error = new DrizzleQueryError(
		'update "leads" set "name" = $1 where "leads"."id" = $2',
		["Fulana Sigilosa", "98a5ad44-0000-4000-8000-000000000000"],
		Object.assign(new Error("deadlock detected"), { code: "40P01" })
	);
	const described = describeError(error);

	assert.equal(described.errorCode, "pg_40P01");
	assert.equal(described.errorMessage, "Failed query: deadlock detected");
});

test("mensagem com \\nparams: fora do Drizzle também é cortada", () => {
	const { errorMessage } = describeError(
		new Error("algo falhou\nparams: Fulana Sigilosa,quero um carro")
	);

	assert.equal(errorMessage, "algo falhou");
});

test("valores citados pelo Postgres são mascarados, nomes de constraint ficam", () => {
	const enumValue =
		describeError(
			new Error('invalid input value for enum lead_status: "Fulana Sigilosa"')
		).errorMessage ?? "";
	const key =
		describeError(new Error("Key (name)=(Fulana Sigilosa) already exists."))
			.errorMessage ?? "";
	const constraint =
		describeError(
			new Error(
				'duplicate key value violates unique constraint "leads_phone_unique"'
			)
		).errorMessage ?? "";

	assert.equal(enumValue.includes("Fulana"), false, enumValue);
	assert.equal(key.includes("Fulana"), false, key);
	assert.ok(constraint.includes("leads_phone_unique"), constraint);
});

test("Bearer, segredo hex e base64 longos são mascarados", () => {
	const hex = "a3f9".repeat(10);
	const base64 = "QWxhZGRpbjpvcGVuIHNlc2FtZQ9x2Kq7Zp4Lm8Rt";
	const { errorMessage = "" } = describeError(
		new Error(`Authorization: Bearer abc.def-ghi_jkl hex=${hex} blob ${base64}`)
	);

	assert.ok(errorMessage.includes("Bearer ***"), errorMessage);

	assert.equal(errorMessage.includes("abc.def-ghi_jkl"), false, errorMessage);
	assert.equal(errorMessage.includes(hex), false, errorMessage);
	assert.equal(errorMessage.includes(base64), false, errorMessage);
});

test("mensagem que não fica segura sai sem errorMessage", () => {
	const described = describeError(
		new Error("config inválida: client_secret: nao-sei-o-formato")
	);

	assert.equal(described.errorMessage, undefined);
	assert.equal(described.errorName, "Error");
	assert.equal(typeof described.errorCode, "string");
});

test("classifica 403, timeout e DNS do Google", () => {
	assert.equal(
		classifyError(
			Object.assign(new Error("The caller does not have permission"), {
				code: 403,
				response: { status: 403 },
			})
		),
		"google_forbidden"
	);
	assert.equal(
		classifyError(
			Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })
		),
		"google_timeout"
	);
	assert.equal(
		classifyError(
			Object.assign(new Error("getaddrinfo ENOTFOUND www.googleapis.com"), {
				code: "ENOTFOUND",
			})
		),
		"network_dns"
	);
	assert.equal(
		classifyError(
			Object.assign(new Error("getaddrinfo EAI_AGAIN x"), { code: "EAI_AGAIN" })
		),
		"network_dns"
	);
});
