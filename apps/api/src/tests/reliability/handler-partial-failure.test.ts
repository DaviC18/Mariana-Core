/** biome-ignore-all lint/suspicious/useAwait: mocks assíncronos do Calendar */
/**
 * Falhas parciais nos handlers de agendamento: a transição de estado da
 * sessão e o enfileiramento da mensagem no outbox precisam ser atômicos.
 * Se o INSERT no outbox falhar, a nova tentativa da tarefa ainda deve
 * produzir a mensagem para o cliente, em vez de encontrar a sessão já
 * avançada e encerrar a tarefa sem resposta.
 *
 * A falha é injetada no próprio Postgres (trigger que rejeita o INSERT de uma
 * idempotencyKey específica), sem mocks dos serviços.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { eq, sql } from "drizzle-orm";

import { ai } from "../../ai/client";
import { closeDatabase, db } from "../../db/connections";
import {
	appointments,
	autonomousTasks,
	consultants,
	conversations,
	leads,
	messages,
	outboundMessages,
	schedulingSessions,
	schedulingSlots,
} from "../../db/schema";
import { GoogleCalendarService } from "../../integrations/google-calendar/google-calendar-service";
import { enqueueTask as enqueueWebhookTask } from "../../routes/whatsapp/webhook-whatsapp";
import { executeNextAutonomousTask } from "../../services/conversations/autonomous-task-executor";
import {
	createAutonomousTaskHandlers,
	INBOUND_TASK_MAX_ATTEMPTS,
	PROCESS_BUTTON_REPLY_TASK,
	PROCESS_CONSULTANT_PREFERENCE_REPLY_TASK,
	PROCESS_CONSULTANT_SELECTION_TASK,
	PROCESS_INBOUND_MESSAGE_TASK,
	SEND_CONFIRMATION_REQUEST_TASK,
	SEND_CONSULTANT_PREFERENCE_QUESTION_TASK,
} from "../../services/conversations/autonomous-task-handlers";
import { MODEL_FAILURE_NOTICE } from "../../services/conversations/model-failure-notice";

type WorkflowStage =
	| "awaiting_availability"
	| "awaiting_consultant_preference"
	| "awaiting_consultant_selection"
	| "awaiting_slot_selection"
	| "awaiting_confirmation";

test.before(async () => {
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS "test_outbound_insert_faults" (
			"idempotencyKey" text PRIMARY KEY
		)
	`);
	await db.execute(sql`
		CREATE OR REPLACE FUNCTION test_reject_faulty_outbound_insert()
		RETURNS trigger AS $$
		BEGIN
			IF EXISTS (
				SELECT 1 FROM "test_outbound_insert_faults"
				WHERE "idempotencyKey" = NEW."idempotencyKey"
			) THEN
				RAISE EXCEPTION 'injected outbox insert failure';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql
	`);
	await db.execute(sql`
		DROP TRIGGER IF EXISTS test_reject_faulty_outbound_insert
		ON "outbound_messages"
	`);
	await db.execute(sql`
		CREATE TRIGGER test_reject_faulty_outbound_insert
		BEFORE INSERT ON "outbound_messages"
		FOR EACH ROW EXECUTE FUNCTION test_reject_faulty_outbound_insert()
	`);
});

test.after(async () => {
	await db.execute(sql`
		DROP TRIGGER IF EXISTS test_reject_faulty_outbound_insert
		ON "outbound_messages"
	`);
	await db.execute(
		sql`DROP FUNCTION IF EXISTS test_reject_faulty_outbound_insert()`
	);
	await db.execute(sql`DROP TABLE IF EXISTS "test_outbound_insert_faults"`);
	await closeDatabase();
});

async function failOutboundInsert(idempotencyKey: string) {
	await db.execute(
		sql`INSERT INTO "test_outbound_insert_faults" VALUES (${idempotencyKey})`
	);
}

async function allowOutboundInsert(idempotencyKey: string) {
	await db.execute(
		sql`DELETE FROM "test_outbound_insert_faults" WHERE "idempotencyKey" = ${idempotencyKey}`
	);
}

async function createFixture(workflowStage: WorkflowStage) {
	const [consultant] = await db
		.select({ id: consultants.id, name: consultants.name })
		.from(consultants)
		.where(eq(consultants.active, true))
		.limit(1);
	assert.ok(consultant);

	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const [lead] = await db
		.insert(leads)
		.values({
			name: `Lead Falha Parcial ${suffix}`,
			phone: `5511${suffix.slice(-9)}`,
			status: "qualified",
		})
		.returning({ id: leads.id });
	assert.ok(lead);

	const [conversation] = await db
		.insert(conversations)
		.values({ lastCustomerMessageAt: new Date(), leadId: lead.id })
		.returning({ id: conversations.id });
	assert.ok(conversation);

	const now = new Date();
	const [session] = await db
		.insert(schedulingSessions)
		.values({
			conversationId: conversation.id,
			expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
			leadId: lead.id,
			status: "active",
			workflowStage,
		})
		.returning();
	assert.ok(session);

	const startAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
	const [slot] = await db
		.insert(schedulingSlots)
		.values({
			calendarId: "audit@example.com",
			consultantId: consultant.id,
			consultantName: consultant.name,
			endAt: new Date(startAt.getTime() + 30 * 60 * 1000),
			position: 1,
			schedulingSessionId: session.id,
			startAt,
		})
		.returning();
	assert.ok(slot);

	return { consultant, conversation, lead, session, slot };
}

async function cleanup(fixture: Awaited<ReturnType<typeof createFixture>>) {
	await db.delete(appointments).where(eq(appointments.leadId, fixture.lead.id));
	await db
		.delete(schedulingSessions)
		.where(eq(schedulingSessions.id, fixture.session.id));
	await db
		.delete(conversations)
		.where(eq(conversations.id, fixture.conversation.id));
	await db.delete(leads).where(eq(leads.id, fixture.lead.id));
}

async function enqueueTask(
	conversationId: string,
	taskType: string,
	payload: Record<string, unknown>
) {
	await db.insert(autonomousTasks).values({
		conversationId,
		idempotencyKey: `test:partial-failure:${taskType}:${Date.now()}:${Math.random()}`,
		payload,
		taskType,
	});
}

/** Executa a tarefa, que deve falhar no outbox, e depois a nova tentativa. */
async function runWithOneOutboxFailure(
	conversationId: string,
	outboundKey: string
) {
	const handlers = createAutonomousTaskHandlers();

	await failOutboundInsert(outboundKey);
	try {
		const firstAttempt = await executeNextAutonomousTask({
			conversationId,
			handlers,
		});
		assert.equal(firstAttempt.status, "retry_scheduled");
	} finally {
		await allowOutboundInsert(outboundKey);
	}

	// Antecipa o backoff para executar a nova tentativa imediatamente.
	await db
		.update(autonomousTasks)
		.set({ availableAt: new Date(0) })
		.where(eq(autonomousTasks.conversationId, conversationId));

	const retry = await executeNextAutonomousTask({ conversationId, handlers });
	assert.equal(retry.status, "completed");

	const [outbound] = await db
		.select()
		.from(outboundMessages)
		.where(eq(outboundMessages.idempotencyKey, outboundKey));

	return outbound;
}

async function sessionStage(sessionId: string) {
	const [session] = await db
		.select({ workflowStage: schedulingSessions.workflowStage })
		.from(schedulingSessions)
		.where(eq(schedulingSessions.id, sessionId));
	return session?.workflowStage;
}

// Passo 32 (S-25, uma release): os tipos legados do fluxo de consultor. A
// pergunta de preferência não envia nada; um toque antigo enfileirado antes do
// deploy recebe o aviso de botão antigo com os horários, e a etapa vai para
// awaiting_slot_selection na mesma transação do outbox.
test("tarefa legada de pergunta de preferência conclui sem enviar nada (passo 32)", async () => {
	const fixture = await createFixture("awaiting_availability");
	try {
		await enqueueTask(
			fixture.conversation.id,
			SEND_CONSULTANT_PREFERENCE_QUESTION_TASK,
			{ schedulingSessionId: fixture.session.id }
		);

		const result = await executeNextAutonomousTask({
			conversationId: fixture.conversation.id,
			handlers: createAutonomousTaskHandlers(),
		});

		assert.equal(result.status, "completed");
		const outbound = await db
			.select({ id: outboundMessages.id })
			.from(outboundMessages)
			.where(eq(outboundMessages.conversationId, fixture.conversation.id));
		assert.equal(outbound.length, 0, "no preference question");
		assert.equal(
			await sessionStage(fixture.session.id),
			"awaiting_availability"
		);
	} finally {
		await cleanup(fixture);
	}
});

for (const legacy of [
	{
		buttonId: (fixture: Awaited<ReturnType<typeof createFixture>>) =>
			`pref:${fixture.session.id}:no_preference`,
		name: "resposta 'sem preferência'",
		stage: "awaiting_consultant_preference",
		taskType: PROCESS_CONSULTANT_PREFERENCE_REPLY_TASK,
	},
	{
		buttonId: (fixture: Awaited<ReturnType<typeof createFixture>>) =>
			`pref:${fixture.session.id}:has_preference`,
		name: "resposta 'tenho preferência'",
		stage: "awaiting_consultant_preference",
		taskType: PROCESS_CONSULTANT_PREFERENCE_REPLY_TASK,
	},
	{
		buttonId: (fixture: Awaited<ReturnType<typeof createFixture>>) =>
			`consultant:${fixture.session.id}:${fixture.consultant.id}`,
		name: "seleção de consultor",
		stage: "awaiting_consultant_selection",
		taskType: PROCESS_CONSULTANT_SELECTION_TASK,
	},
] as const) {
	test(`${legacy.name} legada: aviso + horários na nova tentativa após falha no outbox (passo 32)`, async () => {
		const fixture = await createFixture(legacy.stage);
		try {
			const externalId = `wamid.partial.legacy.${Date.now()}${Math.random()}`;
			await enqueueTask(fixture.conversation.id, legacy.taskType, {
				buttonId: legacy.buttonId(fixture),
				eventExternalId: externalId,
			});

			const outbound = await runWithOneOutboxFailure(
				fixture.conversation.id,
				`stale-tap:${externalId}`
			);

			assert.ok(outbound, "o aviso com os horários nunca foi enfileirado");
			assert.deepEqual(
				(outbound.payload as { buttons: Array<{ id: string }> }).buttons.map(
					(button) => button.id
				),
				[fixture.slot.id]
			);
			assert.equal(
				await sessionStage(fixture.session.id),
				"awaiting_slot_selection"
			);
		} finally {
			await cleanup(fixture);
		}
	});
}

test("pedido de confirmação é enfileirado na nova tentativa após falha no outbox", async () => {
	const fixture = await createFixture("awaiting_slot_selection");
	try {
		const externalId = `wamid.partial.slot.${Date.now()}`;
		await enqueueTask(fixture.conversation.id, SEND_CONFIRMATION_REQUEST_TASK, {
			buttonId: fixture.slot.id,
			eventExternalId: externalId,
		});

		const outbound = await runWithOneOutboxFailure(
			fixture.conversation.id,
			`confirmation-request:${fixture.conversation.id}:${externalId}`
		);

		assert.ok(outbound, "o pedido de confirmação nunca foi enfileirado");
		assert.equal(
			await sessionStage(fixture.session.id),
			"awaiting_confirmation"
		);
	} finally {
		await cleanup(fixture);
	}
});

test("confirmação de agendamento é enfileirada na nova tentativa sem criar outro evento", async (t) => {
	const fixture = await createFixture("awaiting_confirmation");
	await db
		.update(schedulingSessions)
		.set({ selectedSlotId: fixture.slot.id })
		.where(eq(schedulingSessions.id, fixture.session.id));

	let createdEvents = 0;
	t.mock.method(GoogleCalendarService.prototype, "getBusyPeriods", async () => [
		{ busy: [], calendarId: "audit@example.com" },
	]);
	t.mock.method(GoogleCalendarService.prototype, "createEvent", async () => {
		createdEvents += 1;
		return {
			end: fixture.slot.endAt.toISOString(),
			id: `audit-event-${createdEvents}`,
			start: fixture.slot.startAt.toISOString(),
		};
	});
	t.mock.method(GoogleCalendarService.prototype, "deleteEvent", async () => {
		createdEvents -= 1;
	});

	try {
		const externalId = `wamid.partial.confirm.${Date.now()}`;
		await enqueueTask(fixture.conversation.id, PROCESS_BUTTON_REPLY_TASK, {
			buttonId: `confirm:${fixture.slot.id}`,
			eventExternalId: externalId,
		});

		const outbound = await runWithOneOutboxFailure(
			fixture.conversation.id,
			`button-reply:${fixture.conversation.id}:${externalId}`
		);

		assert.ok(outbound, "a confirmação do agendamento nunca foi enfileirada");
		assert.equal(createdEvents, 1);

		const leadAppointments = await db
			.select({ id: appointments.id })
			.from(appointments)
			.where(eq(appointments.leadId, fixture.lead.id));
		assert.equal(leadAppointments.length, 1);
	} finally {
		await cleanup(fixture);
	}
});

test("replay de confirmação não vaza appointment de outro lead", async (t) => {
	const owner = await createFixture("awaiting_confirmation");
	const intruder = await createFixture("awaiting_availability");
	await db
		.update(schedulingSessions)
		.set({ selectedSlotId: owner.slot.id })
		.where(eq(schedulingSessions.id, owner.session.id));

	t.mock.method(GoogleCalendarService.prototype, "getBusyPeriods", async () => [
		{ busy: [], calendarId: "audit@example.com" },
	]);
	t.mock.method(GoogleCalendarService.prototype, "createEvent", async () => ({
		end: owner.slot.endAt.toISOString(),
		id: `audit-event-owner-${Date.now()}`,
		start: owner.slot.startAt.toISOString(),
	}));

	try {
		const handlers = createAutonomousTaskHandlers();
		await enqueueTask(owner.conversation.id, PROCESS_BUTTON_REPLY_TASK, {
			buttonId: `confirm:${owner.slot.id}`,
			eventExternalId: `wamid.owner.${Date.now()}`,
		});
		const ownerRun = await executeNextAutonomousTask({
			conversationId: owner.conversation.id,
			handlers,
		});
		assert.equal(ownerRun.status, "completed");

		const intruderExternalId = `wamid.intruder.${Date.now()}`;
		await enqueueTask(intruder.conversation.id, PROCESS_BUTTON_REPLY_TASK, {
			buttonId: `confirm:${owner.slot.id}`,
			eventExternalId: intruderExternalId,
		});
		const intruderRun = await executeNextAutonomousTask({
			conversationId: intruder.conversation.id,
			handlers,
		});
		assert.equal(intruderRun.status, "completed");

		// Passo 34 (R-SCH-03): o toque recusado recebe só o aviso de botão
		// antigo com a etapa do próprio intruso; nada do agendamento do dono.
		const intruderOutbound = await db
			.select({
				idempotencyKey: outboundMessages.idempotencyKey,
				payload: outboundMessages.payload,
			})
			.from(outboundMessages)
			.where(eq(outboundMessages.conversationId, intruder.conversation.id));
		assert.equal(intruderOutbound.length, 1);
		assert.equal(
			intruderOutbound[0]?.idempotencyKey,
			`stale-tap:${intruderExternalId}`
		);
		const leaked = JSON.stringify(intruderOutbound[0]?.payload);
		assert.ok(!leaked.includes(owner.slot.id), leaked);
		assert.ok(!leaked.includes("Agendamento confirmado"), leaked);
		// Tester V3-a: nada do dono (nome, telefone, sessão) e só botões do
		// próprio intruso; um toque nele não alcança a sessão do dono.
		const [ownerLead] = await db
			.select({ name: leads.name, phone: leads.phone })
			.from(leads)
			.where(eq(leads.id, owner.lead.id));
		assert.ok(ownerLead?.name);
		assert.ok(!leaked.includes(ownerLead.name), leaked);
		assert.ok(!leaked.includes(ownerLead.phone), leaked);
		assert.ok(!leaked.includes(owner.session.id), leaked);
		const intruderPayload = intruderOutbound[0]?.payload as
			| { buttons?: { id: string }[] }
			| undefined;
		const intruderButtons = (intruderPayload?.buttons ?? []).map(
			(button) => button.id
		);
		assert.deepEqual(
			intruderButtons,
			[intruder.slot.id],
			"only the intruder own offer"
		);
		for (const id of intruderButtons) {
			assert.ok(id.includes(intruder.slot.id), `foreign button ${id}`);
		}
		const ownerSession = await db
			.select({ status: schedulingSessions.status })
			.from(schedulingSessions)
			.where(eq(schedulingSessions.id, owner.session.id));
		assert.notEqual(ownerSession[0]?.status, "active", "owner already booked");
		const intruderAppointments = await db
			.select({ id: appointments.id })
			.from(appointments)
			.where(eq(appointments.leadId, intruder.lead.id));
		assert.equal(intruderAppointments.length, 0);
	} finally {
		await cleanup(owner);
		await cleanup(intruder);
	}
});

// Passo 3 (scheduling-loop, Q2/Q4): a task de entrada para em
// INBOUND_TASK_MAX_ATTEMPTS; na última tentativa um erro que não é do modelo
// ainda responde o cliente com o aviso fixo, e a task fica `failed`.

const GUARDRAIL_ERROR = /guardrails/;

/** Resposta válida do modelo com identidade proibida: guardrail L4 lança. */
function failTheTurnWithGuardrail(
	t: { mock: { method: (...args: never[]) => unknown } },
	onCall?: () => Promise<void>
) {
	const calls = { count: 0 };
	(
		t.mock.method as unknown as (
			target: object,
			name: string,
			implementation: () => Promise<unknown>
		) => unknown
	)(ai.models, "generateContent", async () => {
		calls.count += 1;
		await onCall?.();
		return {
			text: JSON.stringify({
				evidenceUsed: [],
				leadUpdate: { status: "qualifying" },
				nextAction: "continue_qualification",
				reply: "Somos a Ademicon. Seja bem-vindo à Ademicon.",
			}),
		};
	});
	return calls;
}

async function seedInboundTask(attemptsAlreadyUsed: number) {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const [lead] = await db
		.insert(leads)
		.values({
			name: `Lead Ultima Tentativa ${suffix}`,
			phone: `5524${suffix.slice(-9)}`,
		})
		.returning({ id: leads.id });
	assert.ok(lead);

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
			externalId: `wamid.last_attempt_${suffix}`,
			role: "user",
		})
		.returning({ id: messages.id });
	assert.ok(inbound);

	const [task] = await db
		.insert(autonomousTasks)
		.values({
			attempts: attemptsAlreadyUsed,
			availableAt: cutoffAt,
			conversationId: conversation.id,
			createdAt,
			idempotencyKey: `inbound:last_attempt_${suffix}`,
			maxAttempts: INBOUND_TASK_MAX_ATTEMPTS,
			payload: { batchCutoffAt: cutoffAt.toISOString(), kind: "text" },
			taskType: PROCESS_INBOUND_MESSAGE_TASK,
			triggerMessageId: inbound.id,
		})
		.returning({ id: autonomousTasks.id });
	assert.ok(task);

	return {
		cleanup: () => db.delete(leads).where(eq(leads.id, lead.id)),
		conversationId: conversation.id,
		inboundId: inbound.id,
		runKey: `mariana-reply:${conversation.id}:${inbound.id}`,
		taskId: task.id,
	};
}

async function outboxOf(conversationId: string) {
	return await db
		.select({
			idempotencyKey: outboundMessages.idempotencyKey,
			payload: outboundMessages.payload,
		})
		.from(outboundMessages)
		.where(eq(outboundMessages.conversationId, conversationId));
}

async function noticeRowsOf(conversationId: string) {
	const rows = await db
		.select({ content: messages.content })
		.from(messages)
		.where(eq(messages.conversationId, conversationId));
	return rows.filter((row) => row.content === MODEL_FAILURE_NOTICE).length;
}

async function taskRow(taskId: string) {
	const [row] = await db
		.select({
			attempts: autonomousTasks.attempts,
			lastError: autonomousTasks.lastError,
			maxAttempts: autonomousTasks.maxAttempts,
			status: autonomousTasks.status,
		})
		.from(autonomousTasks)
		.where(eq(autonomousTasks.id, taskId));
	return row;
}

test("erro não-modelo na última tentativa envia aviso fixo uma vez e a task fica failed", async (t) => {
	const calls = failTheTurnWithGuardrail(t as never);
	const seeded = await seedInboundTask(INBOUND_TASK_MAX_ATTEMPTS - 1);
	t.after(seeded.cleanup);
	const handlers = createAutonomousTaskHandlers();

	const result = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers,
	});

	assert.equal(result.status, "failed");
	assert.equal(calls.count, 1);
	const outbox = await outboxOf(seeded.conversationId);
	assert.equal(outbox.length, 1);
	const [notice] = outbox;
	assert.ok(notice);
	assert.equal(notice.idempotencyKey, seeded.runKey);
	assert.equal(
		(notice.payload as { text?: string }).text,
		MODEL_FAILURE_NOTICE
	);
	assert.equal(await noticeRowsOf(seeded.conversationId), 1);
	const row = await taskRow(seeded.taskId);
	assert.equal(row?.status, "failed");
	assert.equal(row?.attempts, INBOUND_TASK_MAX_ATTEMPTS);
	assert.match(row?.lastError ?? "", GUARDRAIL_ERROR);

	// R-REL-02: a mesma task de novo (redelivery) não manda um segundo aviso.
	await db
		.update(autonomousTasks)
		.set({
			attempts: INBOUND_TASK_MAX_ATTEMPTS - 1,
			availableAt: new Date(0),
			status: "pending",
		})
		.where(eq(autonomousTasks.id, seeded.taskId));
	await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers,
	});
	assert.equal((await outboxOf(seeded.conversationId)).length, 1);
	assert.equal(await noticeRowsOf(seeded.conversationId), 1);
});

test("erro em tentativa intermediária não envia aviso", async (t) => {
	failTheTurnWithGuardrail(t as never);
	const seeded = await seedInboundTask(0);
	t.after(seeded.cleanup);

	const result = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers: createAutonomousTaskHandlers(),
	});

	assert.equal(result.status, "retry_scheduled");
	assert.equal((await outboxOf(seeded.conversationId)).length, 0);
	assert.equal(await noticeRowsOf(seeded.conversationId), 0);
	assert.equal((await taskRow(seeded.taskId))?.status, "pending");
});

test("task de entrada nasce com maxAttempts = N", async (t) => {
	assert.equal(INBOUND_TASK_MAX_ATTEMPTS, 3);
	const seeded = await seedInboundTask(0);
	t.after(seeded.cleanup);
	const idempotencyKey = `inbound:max_attempts_${Date.now()}${Math.random()}`;

	const inserted = await enqueueWebhookTask({
		conversationId: seeded.conversationId,
		idempotencyKey,
		payload: { kind: "text" },
		preserveExisting: true,
		taskType: PROCESS_INBOUND_MESSAGE_TASK,
		triggerMessageId: seeded.inboundId,
	});
	assert.equal(inserted, true);

	const [row] = await db
		.select({ maxAttempts: autonomousTasks.maxAttempts })
		.from(autonomousTasks)
		.where(eq(autonomousTasks.idempotencyKey, idempotencyKey));
	assert.equal(row?.maxAttempts, INBOUND_TASK_MAX_ATTEMPTS);
});

test("conversa fechada na última tentativa não envia aviso", async (t) => {
	let conversationId = "";
	failTheTurnWithGuardrail(t as never, async () => {
		// A rotação fecha a conversa durante o turno.
		await db
			.update(conversations)
			.set({ status: "closed" })
			.where(eq(conversations.id, conversationId));
	});
	const seeded = await seedInboundTask(INBOUND_TASK_MAX_ATTEMPTS - 1);
	({ conversationId } = seeded);
	t.after(seeded.cleanup);

	const result = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers: createAutonomousTaskHandlers(),
	});

	// O erro do turno continua visível; só o aviso é suprimido.
	assert.equal(result.status, "failed");
	assert.equal((await outboxOf(seeded.conversationId)).length, 0);
	assert.equal(await noticeRowsOf(seeded.conversationId), 0);
	assert.match(
		(await taskRow(seeded.taskId))?.lastError ?? "",
		GUARDRAIL_ERROR
	);
});
