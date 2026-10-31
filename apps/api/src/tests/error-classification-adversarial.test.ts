/**
 * 2026-10-27-scheduling-loop, Batch A (tester): `describeError` com mensagens
 * reais de Google, Drizzle/pg e Gemini que embutem dados sensíveis.
 * R-REL-07: log nunca carrega telefone, token, e-mail ou payload.
 *
 * Os casos com `todo` falham hoje (F-A1/F-A2 em
 * docs/work/2026-10-27-scheduling-loop/test-report.md). Remover o `todo`
 * quando corrigidos.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { DrizzleQueryError } from "drizzle-orm/errors";

import { describeError } from "../lib/error-classification";

const PHONE = "5511987654321";
const EMAIL = "cliente.teste@example.com";
const REFRESH = "1//0gAbCdEfGhIjKlMnOpQrStUvWxYz-AbCdEfGhIjKlMnOp";
const ACCESS = "ya29.a0AfH6SMBxYzAbCdEfGhIjKlMnOpQrStUv";
const API_KEY = "AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz0123456";
const CUSTOMER_TEXT = "quero um carro e ganho pouco";

function leaks(message: string): string[] {
	return [PHONE, EMAIL, REFRESH, ACCESS, API_KEY, CUSTOMER_TEXT].filter((s) =>
		message.includes(s)
	);
}

test("pg: telefone na mensagem é mascarado", () => {
	const { errorMessage } = describeError(
		Object.assign(new Error(`Key (phone)=(${PHONE}) already exists.`), {
			code: "23505",
		})
	);
	assert.deepEqual(leaks(errorMessage ?? ""), []);
});

test("Drizzle: params do Failed query não vazam e-mail nem texto do cliente", () => {
	const error = new DrizzleQueryError(
		'insert into "messages" ("content", "email") values ($1, $2)',
		[CUSTOMER_TEXT, EMAIL],
		Object.assign(new Error("deadlock detected"), { code: "40P01" })
	);
	const { errorMessage } = describeError(error);
	assert.deepEqual(leaks(errorMessage ?? ""), [], String(errorMessage));
});

test("Google: token na mensagem do gaxios não vaza", () => {
	const { errorMessage } = describeError(
		new Error(`invalid_grant: refresh_token=${REFRESH} access_token=${ACCESS}`)
	);
	assert.deepEqual(leaks(errorMessage ?? ""), [], String(errorMessage));
});

test("Google: e-mail da conta na mensagem não vaza", () => {
	const { errorMessage } = describeError(
		new Error(`Not Found: calendar ${EMAIL} is not accessible`)
	);
	assert.deepEqual(leaks(errorMessage ?? ""), [], String(errorMessage));
});

test("Gemini: API key numa URL de erro não vaza", () => {
	const { errorMessage } = describeError(
		new Error(
			`got status: 400. https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=${API_KEY}`
		)
	);
	assert.deepEqual(leaks(errorMessage ?? ""), [], String(errorMessage));
});
