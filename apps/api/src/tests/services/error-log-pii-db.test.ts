/**
 * 2026-10-27-scheduling-loop, Batch A (tester): um erro real do Postgres via
 * Drizzle, passado por `describeError`, não pode levar nome ou texto do
 * cliente para o log (R-REL-07). O Drizzle 1.0 embute `params:` na mensagem
 * (`DrizzleQueryError`), e a máscara de dígitos não cobre texto.
 *
 * `todo` até a correção: ver docs/work/2026-10-27-scheduling-loop/test-report.md
 * (Batch A, F-A1). Remover o `todo` quando o implementador corrigir.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";

import { closeDatabase, db } from "../../db/connections";
import { leads } from "../../db/schema";
import { describeError } from "../../lib/error-classification";

test.after(async () => {
	await closeDatabase();
});

test("erro real do Drizzle em leads não vaza o nome do cliente no errorMessage", async () => {
	const name = "Fulana Sigilosa da Silva";
	let caught: unknown;

	try {
		// Enum inválido: o Postgres rejeita no bind, mesmo sem linha (22P02).
		await db
			.update(leads)
			.set({ name, status: "bogus" as "qualified" })
			.where(eq(leads.id, randomUUID()));
	} catch (error) {
		caught = error;
	}

	assert.ok(caught, "a query deveria falhar");

	const described = describeError(caught);

	assert.equal(described.errorCode, "pg_22P02");
	assert.equal(
		(described.errorMessage ?? "").includes(name),
		false,
		String(described.errorMessage)
	);
});
