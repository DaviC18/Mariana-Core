/** biome-ignore-all lint/suspicious/useAwait: <> */
/** biome-ignore-all assist/source/useSortedKeys: <> */
/** biome-ignore-all lint/style/useThrowOnlyError: o teste lança string e objeto de propósito */
/**
 * 2026-10-27-scheduling-loop, Batch A re-check (tester): falhas reais do
 * Postgres e throws que não são Error, passados pelo executor de tarefas,
 * não podem levar nome, telefone, e-mail ou payload do cliente para as linhas
 * `autonomous_task_*` (R-REL-07). Sem rede: só o Postgres local.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq } from "drizzle-orm";

import { closeDatabase, db } from "../../db/connections";
import { autonomousTasks } from "../../db/schema/autonomous-tasks";
import { conversations } from "../../db/schema/conversations";
import { leads } from "../../db/schema/leads";
import { executeNextAutonomousTask } from "../../services/conversations/autonomous-task-executor";

const NAME = "José Ñandú da Conceição";
const EMAIL = "jose.conceicao@exemplo.com.br";
const PHONE = "5521987654321";
const PAIN = "Quero quitar a dívida do cartão até março";

test.after(async () => {
	await closeDatabase();
});

async function createConversationFixture() {
	const [lead] = await db
		.insert(leads)
		.values({
			consortiumType: "geral",
			name: "Lead Teste PII",
			phone: `551199${Date.now()}${Math.floor(Math.random() * 1000)}`,
			status: "qualified",
		})
		.returning({ id: leads.id });

	assert.ok(lead);

	const [conversation] = await db
		.insert(conversations)
		.values({ leadId: lead.id })
		.returning({ id: conversations.id });

	assert.ok(conversation);

	return { conversationId: conversation.id, leadId: lead.id };
}

async function cleanup(
	leadId: string,
	conversationId: string,
	sourceLeadId?: string
) {
	await db
		.delete(autonomousTasks)
		.where(eq(autonomousTasks.conversationId, conversationId));
	await db.delete(conversations).where(eq(conversations.id, conversationId));
	await db.delete(leads).where(eq(leads.id, leadId));

	if (sourceLeadId) {
		await db.delete(leads).where(eq(leads.sourceLeadId, sourceLeadId));
	}
}

function captureConsoleErrorLines() {
	const lines: string[] = [];
	const original = console.error;

	console.error = (...args: unknown[]) => {
		lines.push(typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]));
	};

	return {
		lines,
		restore: () => {
			console.error = original;
		},
	};
}

async function runFailingTask(
	conversationId: string,
	handler: () => Promise<Record<string, unknown> | undefined>
) {
	await db.insert(autonomousTasks).values({
		conversationId,
		idempotencyKey: `pii:${conversationId}:${Math.random()}`,
		maxAttempts: 1,
		payload: { name: NAME, email: EMAIL, phone: PHONE, painPoint: PAIN },
		taskType: "test_task",
	});

	const capture = captureConsoleErrorLines();

	try {
		const result = await executeNextAutonomousTask({
			conversationId,
			handlers: { test_task: handler },
		});

		assert.equal(result.status, "failed");
	} finally {
		capture.restore();
	}

	const lines = capture.lines.filter((line) =>
		line.includes('"event":"autonomous_task_failed"')
	);

	assert.equal(lines.length, 1, capture.lines.join("\n"));

	return {
		line: lines[0],
		log: JSON.parse(lines[0]) as Record<string, unknown>,
	};
}

function assertNoPii(line: string) {
	for (const secret of [
		NAME,
		"José",
		"Ñandú",
		"Conceição",
		EMAIL,
		"jose.conceicao",
		PHONE,
		"987654321",
		PAIN,
		"cartão",
	]) {
		assert.equal(line.includes(secret), false, `${secret} em ${line}`);
	}
}

test("unique violation real (23505) com nome unicode, e-mail e telefone nos params", async () => {
	const { conversationId, leadId } = await createConversationFixture();
	const sourceLeadId = `pii-${randomUUID()}`;

	try {
		const { line, log } = await runFailingTask(conversationId, async () => {
			const row = {
				consortiumType: "geral" as const,
				email: EMAIL,
				name: NAME,
				painPoint: PAIN,
				phone: PHONE,
				source: "whatsapp" as const,
				sourceLeadId,
			};

			await db.insert(leads).values(row);
			await db.insert(leads).values(row);
		});

		assert.equal(log.errorCode, "pg_23505");
		assert.equal(log.errorName, "DrizzleQueryError");
		assert.equal(
			log.errorMessage,
			'Failed query: duplicate key value violates unique constraint "leads_source_source_lead_id_unique"'
		);
		assertNoPii(line);
		assert.equal(line.includes(sourceLeadId), false);
	} finally {
		await cleanup(leadId, conversationId, sourceLeadId);
	}
});

test("FK violation real (23503) com payload JSON do cliente nos params", async () => {
	const { conversationId, leadId } = await createConversationFixture();

	try {
		const { line, log } = await runFailingTask(conversationId, async () => {
			await db.insert(autonomousTasks).values({
				conversationId: randomUUID(),
				idempotencyKey: `pii-fk:${randomUUID()}`,
				payload: { name: NAME, email: EMAIL, phone: PHONE, text: PAIN },
				taskType: "test_task",
			});
		});

		assert.equal(log.errorCode, "pg_23503");
		assertNoPii(line);
		assert.equal(line.includes("Key ("), false, line);
	} finally {
		await cleanup(leadId, conversationId);
	}
});

test("erro real do Drizzle embrulhado em cause: código vem da cadeia, mensagem do topo", async () => {
	const { conversationId, leadId } = await createConversationFixture();

	try {
		const { line, log } = await runFailingTask(conversationId, async () => {
			try {
				await db
					.update(leads)
					.set({ name: NAME, email: EMAIL, status: "bogus" as "qualified" })
					.where(eq(leads.id, randomUUID()));
			} catch (error) {
				throw new Error("falha ao salvar o lead", { cause: error });
			}
		});

		assert.equal(log.errorCode, "pg_22P02");
		assert.equal(log.errorMessage, "falha ao salvar o lead");
		assertNoPii(line);
	} finally {
		await cleanup(leadId, conversationId);
	}
});

test("throw de string com e-mail e telefone: mascarados no log", async () => {
	const { conversationId, leadId } = await createConversationFixture();

	try {
		const { line, log } = await runFailingTask(conversationId, async () => {
			throw `falhou para ${EMAIL} no ${PHONE}`;
		});

		assert.equal(log.errorName, "NonError");
		assert.equal(log.errorCode, "unknown");
		assertNoPii(line);
	} finally {
		await cleanup(leadId, conversationId);
	}
});

test("throw de objeto com dados do cliente: nada do objeto no log", async () => {
	const { conversationId, leadId } = await createConversationFixture();

	try {
		const { line, log } = await runFailingTask(conversationId, async () => {
			throw { email: EMAIL, name: NAME, phone: PHONE };
		});

		assert.equal(log.errorName, "NonError");
		assert.equal(log.errorMessage, "[object Object]");
		assertNoPii(line);
	} finally {
		await cleanup(leadId, conversationId);
	}
});
