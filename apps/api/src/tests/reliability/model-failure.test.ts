/**
 * Passo 11: uma falha do modelo não pode deixar o cliente em silêncio. O
 * handler envia o aviso aprovado, conclui a task e nunca manda duas vezes —
 * reusando o `runKey` que já existe, sem inventar uma segunda chave.
 *
 * Só o Gemini é mockado; o claim, os handlers e o outbox são os reais.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import { ai } from "../../ai/client";
import { ModelUnavailableError } from "../../ai/model-errors";
import { closeDatabase, db } from "../../db/connections";
import {
	autonomousTasks,
	conversations,
	leads,
	messages,
	outboundMessages,
} from "../../db/schema";
import { runAutonomousTasksUntilIdle } from "../../services/conversations/autonomous-task-executor";
import {
	createAutonomousTaskHandlers,
	PROCESS_INBOUND_MESSAGE_TASK,
} from "../../services/conversations/autonomous-task-handlers";
import { mapAutonomousTaskRow } from "../../services/conversations/autonomous-task-row";
import { generateMarianaResponse } from "../../services/conversations/generateMarianaResponse";
import { MODEL_FAILURE_NOTICE } from "../../services/conversations/model-failure-notice";

const GUARDRAIL_MESSAGE = /guardrails/;

test.after(async () => {
	await closeDatabase();
});

async function seedInboundTask(t: TestContextLike, label: string) {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const [lead] = await db
		.insert(leads)
		.values({
			name: `Lead ${label} ${suffix}`,
			phone: `5523${suffix.slice(-9)}`,
		})
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

	const createdAt = new Date(Date.now() - 60_000);
	const cutoffAt = new Date(createdAt.getTime() + 25_000);

	const [inbound] = await db
		.insert(messages)
		.values({
			content: "quero fazer um consórcio",
			conversationId: conversation.id,
			createdAt,
			externalId: `wamid.${label}_${suffix}`,
			role: "user",
		})
		.returning({ id: messages.id });

	assert.ok(inbound);

	const [task] = await db
		.insert(autonomousTasks)
		.values({
			availableAt: cutoffAt,
			conversationId: conversation.id,
			createdAt,
			idempotencyKey: `inbound:${label}_${suffix}`,
			payload: { batchCutoffAt: cutoffAt.toISOString(), kind: "text" },
			taskType: PROCESS_INBOUND_MESSAGE_TASK,
			triggerMessageId: inbound.id,
		})
		.returning();

	assert.ok(task);

	return {
		conversationId: conversation.id,
		inboundId: inbound.id,
		leadId: lead.id,
		task,
	};
}

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

function failTheModel(t: TestContextLike) {
	// O erro do incidente N6, antes de qualquer JSON.
	t.mock.method(ai.models, "generateContent", () =>
		Promise.reject(
			Object.assign(new Error("models/gemini-3.6-flash-lite not found"), {
				status: 404,
			})
		)
	);
}

test("falha do modelo enfileira o aviso e conclui a task", async (t) => {
	failTheModel(t as unknown as TestContextLike);

	const seeded = await seedInboundTask(t as unknown as TestContextLike, "fail");

	// Rev3.1 passo 40 (S-17, D-R3-5 a): conversa ativa → o rastro continua
	// `model_error`, não `superseded`.
	const traces: string[] = [];
	const originalInfo = console.info;
	console.info = (...args: unknown[]) => {
		if (
			typeof args[0] === "string" &&
			args[0].includes('"event":"mariana_turn"')
		) {
			traces.push(args[0]);
			return;
		}
		originalInfo(...(args as []));
	};
	try {
		await runAutonomousTasksUntilIdle({
			conversationId: seeded.conversationId,
			handlers: createAutonomousTaskHandlers(),
		});
	} finally {
		console.info = originalInfo;
	}

	assert.deepEqual(
		traces
			.map((line) => JSON.parse(line))
			.filter((trace) => trace.turnId === seeded.task.id)
			.map((trace) => trace.outcome),
		["model_error"]
	);

	// (a) exatamente uma linha de outbox, com a chave que já existia.
	const outbox = await db
		.select({
			idempotencyKey: outboundMessages.idempotencyKey,
			payload: outboundMessages.payload,
		})
		.from(outboundMessages)
		.where(eq(outboundMessages.conversationId, seeded.conversationId));

	assert.equal(outbox.length, 1);
	assert.equal(
		(outbox[0].payload as { text?: string }).text,
		MODEL_FAILURE_NOTICE
	);
	assert.equal(
		outbox[0].idempotencyKey,
		`mariana-reply:${seeded.conversationId}:${seeded.inboundId}`
	);

	// (b) a conversa guarda o que foi dito ao cliente.
	const assistant = await db
		.select({ content: messages.content })
		.from(messages)
		.where(eq(messages.conversationId, seeded.conversationId));

	assert.equal(
		assistant.filter((row) => row.content === MODEL_FAILURE_NOTICE).length,
		1
	);

	// (c) a task concluiu em vez de falhar.
	const tasks = await db
		.select({ status: autonomousTasks.status })
		.from(autonomousTasks)
		.where(eq(autonomousTasks.conversationId, seeded.conversationId));

	assert.deepEqual(
		tasks.map((row) => row.status),
		["completed"]
	);

	// (d) a mensagem do cliente está marcada como processada.
	const [processed] = await db
		.select({ processedAt: messages.processedAt })
		.from(messages)
		.where(eq(messages.id, seeded.inboundId));

	assert.ok(processed?.processedAt);
});

test("o aviso de falha nunca é enviado duas vezes", async (t) => {
	failTheModel(t as unknown as TestContextLike);

	const seeded = await seedInboundTask(
		t as unknown as TestContextLike,
		"twice"
	);
	const handler = createAutonomousTaskHandlers()[PROCESS_INBOUND_MESSAGE_TASK];
	const context = {
		leaseToken: "test-lease",
		renewLease: () => Promise.resolve(true),
		task: mapAutonomousTaskRow(seeded.task),
	};

	await handler(context);
	// Reexecução da mesma task: o `runKey` já está no outbox.
	const second = await handler(context);

	const outbox = await db
		.select({ id: outboundMessages.id })
		.from(outboundMessages)
		.where(eq(outboundMessages.conversationId, seeded.conversationId));

	assert.equal(outbox.length, 1);
	// A segunda execução para antes do `runKey`: as mensagens já estão
	// marcadas como processadas, então o lote vem vazio.
	assert.deepEqual(second, { skipped: true });

	// Segunda linha de defesa: mesmo se a marcação tivesse falhado, o
	// `runKey` reusado barra o reenvio — nenhuma chave nova foi inventada.
	await db
		.update(messages)
		.set({ processedAt: null })
		.where(eq(messages.id, seeded.inboundId));

	const third = await handler(context);

	const outboxAfterRetry = await db
		.select({ id: outboundMessages.id })
		.from(outboundMessages)
		.where(eq(outboundMessages.conversationId, seeded.conversationId));

	assert.equal(outboxAfterRetry.length, 1);
	assert.deepEqual(third, { deduplicated: true });
});

test("uma falha que não é do modelo continua falhando a task", async (t) => {
	// Resposta válida do modelo, mas com identidade proibida: guardrail L4.
	t.mock.method(ai.models, "generateContent", () =>
		Promise.resolve({
			text: JSON.stringify({
				evidenceUsed: [],
				leadUpdate: { status: "qualifying" },
				nextAction: "continue_qualification",
				reply: "Somos a Ademicon. Seja bem-vindo à Ademicon.",
			}),
		})
	);

	const seeded = await seedInboundTask(
		t as unknown as TestContextLike,
		"guardrail"
	);
	const handler = createAutonomousTaskHandlers()[PROCESS_INBOUND_MESSAGE_TASK];

	await assert.rejects(
		() =>
			handler({
				leaseToken: "test-lease",
				renewLease: () => Promise.resolve(true),
				task: mapAutonomousTaskRow(seeded.task),
			}),
		GUARDRAIL_MESSAGE
	);

	const outbox = await db
		.select({ id: outboundMessages.id })
		.from(outboundMessages)
		.where(eq(outboundMessages.conversationId, seeded.conversationId));

	assert.equal(outbox.length, 0);
});

test("passo 40 (R-REL-07): banco fora na releitura do status não mascara a falha do modelo e o rastro sai `model_error`", async (t) => {
	const seeded = await seedInboundTask(
		t as unknown as TestContextLike,
		"statusdown"
	);

	const traces: string[] = [];
	const originalInfo = console.info;
	console.info = (...args: unknown[]) => {
		if (
			typeof args[0] === "string" &&
			args[0].includes('"event":"mariana_turn"')
		) {
			traces.push(args[0]);
			return;
		}
		originalInfo(...(args as []));
	};
	let selectMock: { mock: { restore: () => void } } | undefined;
	try {
		await assert.rejects(
			() =>
				generateMarianaResponse({
					currentMessages: ["quero fazer um consórcio"],
					expectedConversationId: seeded.conversationId,
					// O modelo falha e, a partir daí, o banco cai: a releitura do
					// status no catch lança.
					generateMarianaReplyFn: () => {
						selectMock = t.mock.method(db, "select", () => {
							throw new Error("db down");
						}) as unknown as { mock: { restore: () => void } };
						return Promise.reject(
							new ModelUnavailableError("model down", { kind: "transport" })
						);
					},
					leadId: seeded.leadId,
					messageIds: [seeded.inboundId],
					persistUserMessage: false,
					traceTurnId: seeded.task.id,
				}),
			(error: unknown) => error instanceof ModelUnavailableError
		);
	} finally {
		selectMock?.mock.restore();
		console.info = originalInfo;
	}

	assert.deepEqual(
		traces
			.map((line) => JSON.parse(line))
			.filter((trace) => trace.turnId === seeded.task.id)
			.map((trace) => trace.outcome),
		["model_error"]
	);
});
