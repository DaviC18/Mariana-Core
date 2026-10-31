/** biome-ignore-all lint/suspicious/useAwait: fakes assíncronos do Gemini e do Calendar */
/** biome-ignore-all lint/performance/noAwaitInLoops: execuções e polling sequenciais de propósito */
/**
 * 2026-10-27-scheduling-loop, passo 3 (Q2/Q4), casos adversariais do tester:
 * o aviso da última tentativa sai no máximo uma vez, com o lead travado antes
 * da releitura da conversa, e não muda os outros caminhos de falha (modelo,
 * Calendar, turno superado) nem o `maxAttempts` das outras tasks.
 *
 * Gemini e Google Calendar são falsos; claim, handlers e outbox são os reais.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { eq, sql } from "drizzle-orm";

import { ai } from "../../ai/client";
import { CONSULTANT_OFFER_TEXT } from "../../ai/knowledge/commercial-policy";
import { closeDatabase, db } from "../../db/connections";
import {
	autonomousTasks,
	conversations,
	leads,
	messages,
	outboundMessages,
} from "../../db/schema";
import { GoogleCalendarService } from "../../integrations/google-calendar/google-calendar-service";
import { enqueueTask as enqueueWebhookTask } from "../../routes/whatsapp/webhook-whatsapp";
import { executeNextAutonomousTask } from "../../services/conversations/autonomous-task-executor";
import {
	createAutonomousTaskHandlers,
	INBOUND_TASK_MAX_ATTEMPTS,
	PROCESS_BUTTON_REPLY_TASK,
	PROCESS_INBOUND_MESSAGE_TASK,
} from "../../services/conversations/autonomous-task-handlers";
import { CALENDAR_UNAVAILABLE_TEXT } from "../../services/conversations/calendar-unavailable-notice";
import { MODEL_FAILURE_NOTICE } from "../../services/conversations/model-failure-notice";
import { backendPid, waitForLockWait } from "../support/lock-wait";

test.after(async () => {
	await closeDatabase();
});

type MockMethod = (
	target: object,
	name: string,
	implementation: (...args: never[]) => unknown
) => unknown;

interface Ctx {
	after: (fn: () => Promise<unknown> | unknown) => void;
	mock: { method: unknown };
}

function mockOf(t: Ctx): MockMethod {
	return (t.mock.method as MockMethod).bind(t.mock);
}

function silenceConsoleError(t: Ctx) {
	const original = console.error;
	console.error = () => {
		// Silencia as linhas de log esperadas.
	};
	t.after(() => {
		console.error = original;
	});
}

const GUARDRAIL_REPLY = {
	evidenceUsed: [],
	leadUpdate: { status: "qualifying" },
	nextAction: "continue_qualification",
	reply: "Somos a Ademicon. Seja bem-vindo à Ademicon.",
};

const VALID_REPLY = {
	evidenceUsed: [],
	leadUpdate: { status: "qualifying" },
	nextAction: "continue_qualification",
	reply: "Entendi! Qual é o seu objetivo com o consórcio?",
};

function mockModel(
	t: Ctx,
	behaviour: () => Promise<unknown>,
	onCall?: () => Promise<void>
) {
	const calls = { count: 0 };
	mockOf(t)(ai.models, "generateContent", async () => {
		calls.count += 1;
		await onCall?.();
		return await behaviour();
	});
	return calls;
}

async function seed(
	t: Ctx,
	{ attempts, afterOffer = false }: { attempts: number; afterOffer?: boolean }
) {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const [lead] = await db
		.insert(leads)
		.values(
			afterOffer
				? {
						birthDate: new Date("1995-01-01"),
						consortiumType: "automovel",
						currentSituation: "Ainda não tenho carro",
						name: `Lead Final Attempt ${suffix}`,
						objective: "carro",
						painPoint: "Preciso de um carro para trabalhar",
						phone: `5527${suffix.slice(-9)}`,
						qualifiedAt: new Date(),
						status: "qualified",
					}
				: {
						name: `Lead Final Attempt ${suffix}`,
						phone: `5527${suffix.slice(-9)}`,
					}
		)
		.returning({ id: leads.id });
	assert.ok(lead);
	t.after(() => db.delete(leads).where(eq(leads.id, lead.id)));

	const [conversation] = await db
		.insert(conversations)
		.values({ lastCustomerMessageAt: new Date(), leadId: lead.id })
		.returning({ id: conversations.id });
	assert.ok(conversation);

	const userAt = new Date(Date.now() - 60_000);
	if (afterOffer) {
		await db.insert(messages).values({
			content: `O consórcio reúne pessoas que contribuem mensalmente. ${CONSULTANT_OFFER_TEXT}`,
			conversationId: conversation.id,
			createdAt: new Date(userAt.getTime() - 10_000),
			role: "assistant",
		});
	}

	const cutoffAt = new Date(userAt.getTime() + 25_000);
	const [inbound] = await db
		.insert(messages)
		.values({
			content: afterOffer ? "sim por favor" : "quero fazer um consórcio",
			conversationId: conversation.id,
			createdAt: userAt,
			externalId: `wamid.final_attempt_${suffix}`,
			role: "user",
		})
		.returning({ id: messages.id });
	assert.ok(inbound);

	const idempotencyKey = `inbound:final_attempt_${suffix}`;
	const [task] = await db
		.insert(autonomousTasks)
		.values({
			attempts,
			availableAt: cutoffAt,
			conversationId: conversation.id,
			createdAt: userAt,
			idempotencyKey,
			maxAttempts: INBOUND_TASK_MAX_ATTEMPTS,
			payload: { batchCutoffAt: cutoffAt.toISOString(), kind: "text" },
			taskType: PROCESS_INBOUND_MESSAGE_TASK,
			triggerMessageId: inbound.id,
		})
		.returning({ id: autonomousTasks.id });
	assert.ok(task);

	return {
		conversationId: conversation.id,
		idempotencyKey,
		inboundId: inbound.id,
		leadId: lead.id,
		runKey: `mariana-reply:${conversation.id}:${inbound.id}`,
		taskId: task.id,
	};
}

async function outbox(conversationId: string) {
	const rows = await db
		.select({
			idempotencyKey: outboundMessages.idempotencyKey,
			payload: outboundMessages.payload,
			status: outboundMessages.status,
		})
		.from(outboundMessages)
		.where(eq(outboundMessages.conversationId, conversationId));
	return rows.map((row) => ({
		...row,
		text: (row.payload as { text?: string }).text,
	}));
}

async function assistantTexts(conversationId: string) {
	const rows = await db
		.select({ content: messages.content, role: messages.role })
		.from(messages)
		.where(eq(messages.conversationId, conversationId));
	return rows
		.filter((row) => row.role === "assistant")
		.map((row) => row.content);
}

async function taskState(taskId: string) {
	const [row] = await db
		.select({
			attempts: autonomousTasks.attempts,
			status: autonomousTasks.status,
		})
		.from(autonomousTasks)
		.where(eq(autonomousTasks.id, taskId));
	return row;
}

function run(conversationId: string) {
	return executeNextAutonomousTask({
		conversationId,
		handlers: createAutonomousTaskHandlers(),
	});
}

test("falha do modelo na última tentativa segue o caminho do modelo: completed, um aviso", async (t) => {
	silenceConsoleError(t);
	mockModel(t, () =>
		Promise.reject(
			Object.assign(new Error("models/x not found"), { status: 404 })
		)
	);
	const seeded = await seed(t, { attempts: INBOUND_TASK_MAX_ATTEMPTS - 1 });

	const result = await run(seeded.conversationId);

	assert.equal(result.status, "completed", JSON.stringify(result));
	assert.deepEqual(
		(await outbox(seeded.conversationId)).map((row) => row.text),
		[MODEL_FAILURE_NOTICE]
	);
	assert.deepEqual(await assistantTexts(seeded.conversationId), [
		MODEL_FAILURE_NOTICE,
	]);
});

test("Calendar fora na última tentativa: texto A, completed, sem aviso da última tentativa", async (t) => {
	silenceConsoleError(t);
	mockOf(t)(GoogleCalendarService.prototype, "getBusyPeriods", () =>
		Promise.reject(
			Object.assign(new Error("invalid_grant"), {
				code: 400,
				response: { data: { error: "invalid_grant" } },
			})
		)
	);
	const calls = mockModel(t, async () => ({
		text: JSON.stringify({
			evidenceUsed: [],
			leadUpdate: { interestedInConsultant: true, status: "qualified" },
			nextAction: "offer_appointment",
			reply: "Ótimo! Vou procurar um horário.",
		}),
	}));
	const seeded = await seed(t, {
		afterOffer: true,
		attempts: INBOUND_TASK_MAX_ATTEMPTS - 1,
	});

	const result = await run(seeded.conversationId);

	assert.equal(result.status, "completed", JSON.stringify(result));
	assert.equal(calls.count, 1);
	const texts = (await outbox(seeded.conversationId)).map((row) => row.text);
	assert.deepEqual(texts, [CALENDAR_UNAVAILABLE_TEXT]);
	assert.ok(
		!(await assistantTexts(seeded.conversationId)).includes(
			MODEL_FAILURE_NOTICE
		)
	);
});

test("turno superado na última tentativa: sem aviso e a task não falha", async (t) => {
	silenceConsoleError(t);
	let conversationId = "";
	mockModel(
		t,
		async () => ({ text: JSON.stringify(VALID_REPLY) }),
		async () => {
			await db
				.update(conversations)
				.set({ status: "closed" })
				.where(eq(conversations.id, conversationId));
		}
	);
	const seeded = await seed(t, { attempts: INBOUND_TASK_MAX_ATTEMPTS - 1 });
	({ conversationId } = seeded);

	const result = await run(seeded.conversationId);

	assert.equal(result.status, "completed", JSON.stringify(result));
	assert.equal((await outbox(seeded.conversationId)).length, 0);
	assert.ok(
		!(await assistantTexts(seeded.conversationId)).includes(
			MODEL_FAILURE_NOTICE
		)
	);
});

test("outbound da runKey já em `unknown` (talvez aceito pela Meta) não volta a pending nem é trocado pelo aviso", async (t) => {
	silenceConsoleError(t);
	let seeded: Awaited<ReturnType<typeof seed>> | undefined;
	mockModel(
		t,
		async () => ({ text: JSON.stringify(GUARDRAIL_REPLY) }),
		async () => {
			// Outra execução do mesmo turno já entregou à Meta sem confirmação.
			assert.ok(seeded);
			await db.insert(outboundMessages).values({
				conversationId: seeded.conversationId,
				idempotencyKey: seeded.runKey,
				leadId: seeded.leadId,
				messageType: "text",
				payload: { kind: "text", text: "resposta anterior" },
				status: "unknown",
			});
		}
	);
	seeded = await seed(t, { attempts: INBOUND_TASK_MAX_ATTEMPTS - 1 });

	const result = await run(seeded.conversationId);

	assert.equal(result.status, "failed", JSON.stringify(result));
	const rows = await outbox(seeded.conversationId);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.status, "unknown");
	assert.equal(rows[0]?.text, "resposta anterior");
});

test("redelivery do webhook depois da task falhar com aviso não manda segundo aviso", async (t) => {
	silenceConsoleError(t);
	const calls = mockModel(t, async () => ({
		text: JSON.stringify(GUARDRAIL_REPLY),
	}));
	const seeded = await seed(t, { attempts: INBOUND_TASK_MAX_ATTEMPTS - 1 });

	assert.equal((await run(seeded.conversationId)).status, "failed");
	assert.equal((await outbox(seeded.conversationId)).length, 1);

	// Mesmo inbound re-enfileirado (onConflictDoUpdate zera attempts).
	await enqueueWebhookTask({
		availableAt: new Date(0),
		conversationId: seeded.conversationId,
		idempotencyKey: seeded.idempotencyKey,
		payload: { kind: "text" },
		taskType: PROCESS_INBOUND_MESSAGE_TASK,
		triggerMessageId: seeded.inboundId,
	});
	for (let index = 0; index < INBOUND_TASK_MAX_ATTEMPTS + 1; index += 1) {
		await db
			.update(autonomousTasks)
			.set({ availableAt: new Date(0) })
			.where(eq(autonomousTasks.id, seeded.taskId));
		await run(seeded.conversationId);
	}

	assert.equal(calls.count, 1, "o Gemini não é chamado de novo");
	assert.deepEqual(
		(await outbox(seeded.conversationId)).map((row) => row.text),
		[MODEL_FAILURE_NOTICE]
	);
	assert.equal(
		(await assistantTexts(seeded.conversationId)).filter(
			(text) => text === MODEL_FAILURE_NOTICE
		).length,
		1
	);
});

test("o aviso da última tentativa espera o lock do lead e relê a conversa sob ele", async (t) => {
	silenceConsoleError(t);
	let seeded: Awaited<ReturnType<typeof seed>> | undefined;
	let release: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let holderPid: Promise<number> | undefined;
	let holderDone: Promise<unknown> | undefined;

	mockModel(
		t,
		async () => ({ text: JSON.stringify(GUARDRAIL_REPLY) }),
		async () => {
			// Depois das leituras do turno: outra transação trava o lead e,
			// enquanto o aviso espera, fecha a conversa (como a rotação).
			assert.ok(seeded);
			const { conversationId, leadId } = seeded;
			let resolvePid: (pid: number) => void = () => undefined;
			holderPid = new Promise<number>((resolve) => {
				resolvePid = resolve;
			});
			holderDone = db.transaction(async (tx) => {
				await tx.execute(
					sql`select id from leads where id = ${leadId} for update`
				);
				resolvePid(await backendPid(tx));
				await released;
				await tx
					.update(conversations)
					.set({ status: "closed" })
					.where(eq(conversations.id, conversationId));
			});
			await holderPid;
		}
	);
	seeded = await seed(t, { attempts: INBOUND_TASK_MAX_ATTEMPTS - 1 });

	const running = run(seeded.conversationId);
	const pid = await (async () => {
		while (!holderPid) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		return await holderPid;
	})();
	await waitForLockWait({ blockedBy: pid });
	assert.equal(
		(await outbox(seeded.conversationId)).length,
		0,
		"nada vai para o outbox enquanto o lead está travado"
	);
	release();
	await holderDone;

	const result = await running;
	assert.equal(result.status, "failed", JSON.stringify(result));
	assert.equal((await outbox(seeded.conversationId)).length, 0);
	assert.ok(
		!(await assistantTexts(seeded.conversationId)).includes(
			MODEL_FAILURE_NOTICE
		)
	);
});

test("só process_inbound_message nasce com maxAttempts = 3; as outras tasks ficam no padrão", async (t) => {
	const seeded = await seed(t, { attempts: 0 });
	const idempotencyKey = `button:max_attempts_${Date.now()}${Math.random()}`;

	await enqueueWebhookTask({
		conversationId: seeded.conversationId,
		idempotencyKey,
		payload: { kind: "button" },
		preserveExisting: true,
		taskType: PROCESS_BUTTON_REPLY_TASK,
		triggerMessageId: seeded.inboundId,
	});

	const [row] = await db
		.select({ maxAttempts: autonomousTasks.maxAttempts })
		.from(autonomousTasks)
		.where(eq(autonomousTasks.idempotencyKey, idempotencyKey));
	assert.equal(row?.maxAttempts, 5);
	assert.equal((await taskState(seeded.taskId))?.status, "pending");
});
