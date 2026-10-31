/**
 * Aceitação do tester (flow-review R1-a passo 1) para R-REL-05 e S-17 da
 * spec v1.2: "o cliente recebe a mensagem curta de falha; o erro aparece no
 * log; nada fica em silêncio".
 *
 * Cobre o que `model-failure.test.ts` não afirma: a linha
 * `mariana_model_failure` no log de erro (sem texto do cliente nem telefone),
 * o evento do webhook marcado como processado, e os tipos `empty_response` e
 * `invalid_json` passando pelo handler real, não só pelo agente.
 *
 * Só o Gemini é mockado; o claim, os handlers e o outbox são os reais.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import { ai } from "../../ai/client";
import { closeDatabase, db } from "../../db/connections";
import {
	autonomousTasks,
	conversations,
	leads,
	messages,
	outboundMessages,
	whatsappWebhookEvents,
} from "../../db/schema";
import { env } from "../../env";
import { runAutonomousTasksUntilIdle } from "../../services/conversations/autonomous-task-executor";
import {
	createAutonomousTaskHandlers,
	PROCESS_INBOUND_MESSAGE_TASK,
} from "../../services/conversations/autonomous-task-handlers";
import { MODEL_FAILURE_NOTICE } from "../../services/conversations/model-failure-notice";

const CLIENT_TEXT = "meu cpf é 12345678900, quero fazer um consórcio";
const ELEVEN_DIGITS = /\d{11}/;
// UUIDs aleatórios podem conter 11 dígitos seguidos; saem antes da busca.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

test.after(async () => {
	await closeDatabase();
});

interface TestContextLike {
	after: (fn: () => Promise<void>) => void;
	mock: {
		method: (
			target: object,
			name: string,
			implementation: (...args: never[]) => unknown
		) => unknown;
	};
}

async function seedInboundTaskWithEvent(t: TestContextLike, label: string) {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const phone = `5524${suffix.slice(-9)}`;
	const [lead] = await db
		.insert(leads)
		.values({ name: `Lead S17 ${label} ${suffix}`, phone })
		.returning({ id: leads.id });

	assert.ok(lead);
	t.after(async () => {
		await db.delete(leads).where(eq(leads.id, lead.id));
	});

	const [conversation] = await db
		.insert(conversations)
		.values({ lastCustomerMessageAt: new Date(), leadId: lead.id })
		.returning({ id: conversations.id });

	assert.ok(conversation);

	const externalId = `wamid.s17_${label}_${suffix}`;
	const [event] = await db
		.insert(whatsappWebhookEvents)
		.values({
			conversationId: conversation.id,
			eventType: "message",
			externalId,
			phone,
			status: "processing",
		})
		.returning({ id: whatsappWebhookEvents.id });

	assert.ok(event);
	t.after(async () => {
		await db
			.delete(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.id, event.id));
	});

	const createdAt = new Date(Date.now() - 60_000);
	const cutoffAt = new Date(createdAt.getTime() + 25_000);

	const [inbound] = await db
		.insert(messages)
		.values({
			content: CLIENT_TEXT,
			conversationId: conversation.id,
			createdAt,
			externalId,
			role: "user",
		})
		.returning({ id: messages.id });

	assert.ok(inbound);

	await db.insert(autonomousTasks).values({
		availableAt: cutoffAt,
		conversationId: conversation.id,
		createdAt,
		idempotencyKey: `inbound:s17_${label}_${suffix}`,
		payload: {
			batchCutoffAt: cutoffAt.toISOString(),
			eventId: event.id,
			kind: "text",
		},
		taskType: PROCESS_INBOUND_MESSAGE_TASK,
		triggerMessageId: inbound.id,
	});

	return { conversationId: conversation.id, eventId: event.id, phone };
}

function captureConsoleError() {
	const entries: unknown[] = [];
	const original = console.error;

	console.error = (...args: unknown[]) => {
		entries.push(args[0]);
	};

	return {
		entries,
		restore: () => {
			console.error = original;
		},
	};
}

async function outboxTexts(conversationId: string) {
	const rows = await db
		.select({ payload: outboundMessages.payload })
		.from(outboundMessages)
		.where(eq(outboundMessages.conversationId, conversationId));

	return rows.map((row) => (row.payload as { text?: string }).text);
}

test("S-17: a falha do modelo aparece no log de erro, sem texto do cliente, e o evento fica processado", async (t) => {
	t.mock.method(ai.models, "generateContent", () =>
		Promise.reject(
			Object.assign(new Error("models/gemini-3.6-flash-lite not found"), {
				status: 404,
			})
		)
	);

	const seeded = await seedInboundTaskWithEvent(
		t as unknown as TestContextLike,
		"log"
	);
	const capture = captureConsoleError();

	try {
		await runAutonomousTasksUntilIdle({
			conversationId: seeded.conversationId,
			handlers: createAutonomousTaskHandlers(),
		});
	} finally {
		capture.restore();
	}

	assert.deepEqual(await outboxTexts(seeded.conversationId), [
		MODEL_FAILURE_NOTICE,
	]);

	const failureLogs = capture.entries.filter(
		(entry) =>
			typeof entry === "object" &&
			entry !== null &&
			(entry as { event?: string }).event === "mariana_model_failure"
	) as Record<string, unknown>[];

	assert.equal(failureLogs.length, 1);
	assert.equal(failureLogs[0].kind, "transport");
	assert.equal(failureLogs[0].model, env.GEMINI_MODEL);
	assert.equal(failureLogs[0].conversationId, seeded.conversationId);

	const serialised = JSON.stringify(failureLogs[0]);

	assert.equal(serialised.includes("consórcio"), false);
	assert.equal(serialised.includes(seeded.phone), false);
	assert.equal(ELEVEN_DIGITS.test(serialised.replace(UUID, "")), false);

	const [event] = await db
		.select({ status: whatsappWebhookEvents.status })
		.from(whatsappWebhookEvents)
		.where(eq(whatsappWebhookEvents.id, seeded.eventId));

	assert.equal(event?.status, "processed");
});

for (const [kind, response] of [
	["empty_response", { text: "" }],
	["invalid_json", { text: "isto não é JSON" }],
] as const) {
	test(`S-17: ${kind} pelo handler real também envia o aviso uma única vez`, async (t) => {
		t.mock.method(ai.models, "generateContent", () =>
			Promise.resolve(response)
		);

		const seeded = await seedInboundTaskWithEvent(
			t as unknown as TestContextLike,
			kind
		);
		const capture = captureConsoleError();

		try {
			await runAutonomousTasksUntilIdle({
				conversationId: seeded.conversationId,
				handlers: createAutonomousTaskHandlers(),
			});
		} finally {
			capture.restore();
		}

		assert.deepEqual(await outboxTexts(seeded.conversationId), [
			MODEL_FAILURE_NOTICE,
		]);

		const kinds = capture.entries
			.filter(
				(entry) =>
					typeof entry === "object" &&
					entry !== null &&
					(entry as { event?: string }).event === "mariana_model_failure"
			)
			.map((entry) => (entry as { kind?: string }).kind);

		assert.deepEqual(kinds, [kind]);

		const tasks = await db
			.select({ status: autonomousTasks.status })
			.from(autonomousTasks)
			.where(eq(autonomousTasks.conversationId, seeded.conversationId));

		assert.deepEqual(
			tasks.map((row) => row.status),
			["completed"]
		);
	});
}
