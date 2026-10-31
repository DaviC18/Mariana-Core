/** biome-ignore-all lint/suspicious/useAwait: fakes assíncronos do Calendar */
/**
 * 2026-10-27-scheduling-loop, passo 2 (R-REL-05, R-REL-02): quando nenhum
 * consultor responde no Calendar (ex.: `invalid_grant`), a oferta responde o
 * texto fixo aprovado na 1ª tentativa, sem nova chamada ao Gemini.
 *
 * Gemini e Google Calendar são falsos; claim, handlers e outbox são os reais.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { eq, inArray } from "drizzle-orm";

import { ai } from "../../ai/client";
import { CONSULTANT_OFFER_TEXT } from "../../ai/knowledge/commercial-policy";
import { closeDatabase, db } from "../../db/connections";
import {
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
import { executeNextAutonomousTask } from "../../services/conversations/autonomous-task-executor";
import {
	createAutonomousTaskHandlers,
	PROCESS_INBOUND_MESSAGE_TASK,
} from "../../services/conversations/autonomous-task-handlers";
import { CALENDAR_UNAVAILABLE_TEXT } from "../../services/conversations/calendar-unavailable-notice";

test.after(async () => {
	await closeDatabase();
});

interface TestContextLike {
	after: (fn: () => Promise<void> | void) => void;
	mock: {
		method: (
			target: object,
			name: string,
			implementation: (...args: never[]) => unknown
		) => unknown;
	};
}

function invalidGrant() {
	return Object.assign(new Error("invalid_grant"), {
		code: 400,
		response: { data: { error: "invalid_grant" } },
	});
}

/** Todo consultor falha no Calendar; conta as chamadas ao modelo. */
function mockCalendarDownAndModel(t: TestContextLike) {
	const counters = { calendarCalls: 0, modelCalls: 0 };

	t.mock.method(GoogleCalendarService.prototype, "getBusyPeriods", () => {
		counters.calendarCalls += 1;
		return Promise.reject(invalidGrant());
	});
	t.mock.method(ai.models, "generateContent", () => {
		counters.modelCalls += 1;
		return Promise.resolve({
			text: JSON.stringify({
				evidenceUsed: [],
				leadUpdate: { interestedInConsultant: true, status: "qualified" },
				nextAction: "offer_appointment",
				reply: "Ótimo! Vou procurar um horário.",
			}),
		});
	});

	return counters;
}

/** Lead qualificado; a última fala da Mariana é a oferta do backend. */
async function seedAfterOffer(t: TestContextLike, label: string) {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const phone = `5521${suffix.slice(-9)}`;
	const [lead] = await db
		.insert(leads)
		.values({
			birthDate: new Date("1995-01-01"),
			consortiumType: "automovel",
			currentSituation: "Ainda não tenho carro",
			name: `Lead Calendar ${label}`,
			objective: "carro",
			painPoint: "Preciso de um carro para trabalhar",
			phone,
			qualifiedAt: new Date(),
			status: "qualified",
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

	const offerAt = new Date(Date.now() - 60_000);

	await db.insert(messages).values({
		content: `O consórcio reúne pessoas que contribuem mensalmente. ${CONSULTANT_OFFER_TEXT}`,
		conversationId: conversation.id,
		createdAt: offerAt,
		role: "assistant",
	});

	const userAt = new Date(offerAt.getTime() + 10_000);
	const cutoffAt = new Date(userAt.getTime() + 25_000);
	const [inbound] = await db
		.insert(messages)
		.values({
			content: "sim por favor",
			conversationId: conversation.id,
			createdAt: userAt,
			externalId: `wamid.calendar_${label}_${suffix}`,
			role: "user",
		})
		.returning({ id: messages.id });

	assert.ok(inbound);

	const [task] = await db
		.insert(autonomousTasks)
		.values({
			availableAt: cutoffAt,
			conversationId: conversation.id,
			createdAt: userAt,
			idempotencyKey: `inbound:calendar_${label}_${suffix}`,
			payload: { batchCutoffAt: cutoffAt.toISOString(), kind: "text" },
			taskType: PROCESS_INBOUND_MESSAGE_TASK,
			triggerMessageId: inbound.id,
		})
		.returning({ id: autonomousTasks.id });

	assert.ok(task);

	return {
		conversationId: conversation.id,
		leadId: lead.id,
		taskId: task.id,
	};
}

async function turnState(seeded: { conversationId: string; leadId: string }) {
	const [task] = await db
		.select({
			attempts: autonomousTasks.attempts,
			status: autonomousTasks.status,
		})
		.from(autonomousTasks)
		.where(eq(autonomousTasks.conversationId, seeded.conversationId));
	const outbox = await db
		.select({ payload: outboundMessages.payload })
		.from(outboundMessages)
		.where(eq(outboundMessages.conversationId, seeded.conversationId));
	const assistantRows = await db
		.select({ content: messages.content, createdAt: messages.createdAt })
		.from(messages)
		.where(eq(messages.conversationId, seeded.conversationId))
		.orderBy(messages.createdAt);
	const sessions = await db
		.select({ id: schedulingSessions.id })
		.from(schedulingSessions)
		.where(eq(schedulingSessions.leadId, seeded.leadId));
	const [lead] = await db
		.select({ interested: leads.interestedInConsultant })
		.from(leads)
		.where(eq(leads.id, seeded.leadId));

	return {
		lead,
		// A 1ª linha da assistente é a oferta semeada; o resto é deste turno.
		newAssistantRows: assistantRows
			.filter((row) => !row.content.includes(CONSULTANT_OFFER_TEXT))
			.filter((row) => row.content !== "sim por favor")
			.map((row) => row.content),
		outboxTexts: outbox.map((row) => (row.payload as { text?: string }).text),
		sessions,
		task,
	};
}

function silenceConsoleError(t: TestContextLike) {
	const original = console.error;
	console.error = () => {
		// Silencia as linhas de log esperadas.
	};
	t.after(() => {
		console.error = original;
	});
}

test("Calendar invalid_grant na oferta responde texto fixo na 1ª tentativa", async (t) => {
	const counters = mockCalendarDownAndModel(t as unknown as TestContextLike);
	const seeded = await seedAfterOffer(t as unknown as TestContextLike, "first");
	silenceConsoleError(t as unknown as TestContextLike);

	const result = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers: createAutonomousTaskHandlers(),
	});

	assert.equal(result.status, "completed", JSON.stringify(result));
	assert.ok(counters.calendarCalls > 0, "o Calendar foi consultado");
	assert.equal(counters.modelCalls, 1);

	const state = await turnState(seeded);

	assert.deepEqual(state.task, { attempts: 1, status: "completed" });
	assert.deepEqual(state.outboxTexts, [CALENDAR_UNAVAILABLE_TEXT]);
	assert.deepEqual(state.newAssistantRows, [CALENDAR_UNAVAILABLE_TEXT]);
	assert.equal(state.sessions.length, 0);
	assert.equal(state.lead?.interested, true);
});

test("redelivery do mesmo turno não duplica o aviso", async (t) => {
	const counters = mockCalendarDownAndModel(t as unknown as TestContextLike);
	const seeded = await seedAfterOffer(
		t as unknown as TestContextLike,
		"redelivery"
	);
	silenceConsoleError(t as unknown as TestContextLike);
	const handlers = createAutonomousTaskHandlers();

	const first = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers,
	});

	assert.equal(first.status, "completed", JSON.stringify(first));

	// Pior caso: a task volta a `pending` (ex.: lease perdido depois do
	// outbox) e o mesmo turno roda de novo.
	await db
		.update(autonomousTasks)
		.set({ availableAt: new Date(Date.now() - 1000), status: "pending" })
		.where(eq(autonomousTasks.id, seeded.taskId));

	const second = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers,
	});

	assert.equal(second.status, "completed", JSON.stringify(second));
	assert.equal(
		counters.modelCalls,
		1,
		"o mesmo turno não chama o modelo de novo"
	);

	const state = await turnState(seeded);

	assert.deepEqual(state.outboxTexts, [CALENDAR_UNAVAILABLE_TEXT]);
	assert.deepEqual(state.newAssistantRows, [CALENDAR_UNAVAILABLE_TEXT]);
});

test("o log scheduling_calendar_unavailable traz o erro mascarado de cada consultor", async (t) => {
	mockCalendarDownAndModel(t as unknown as TestContextLike);
	const seeded = await seedAfterOffer(t as unknown as TestContextLike, "log");
	const lines: string[] = [];
	const original = console.error;

	console.error = (...args: unknown[]) => {
		if (typeof args[0] === "string") {
			lines.push(args[0]);
		}
	};
	t.after(() => {
		console.error = original;
	});

	await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers: createAutonomousTaskHandlers(),
	});

	const active = await db
		.select({ id: consultants.id })
		.from(consultants)
		.where(eq(consultants.active, true));
	const logs = lines
		.filter((line) =>
			line.includes('"event":"scheduling_calendar_unavailable"')
		)
		.map((line) => JSON.parse(line));

	assert.equal(logs.length, 1, lines.join("\n"));
	assert.equal(logs[0].failureCount, active.length);
	assert.deepEqual(
		[
			...logs[0].failures.map((f: { consultantId: string }) => f.consultantId),
		].sort(),
		active.map((row) => row.id).sort()
	);
	for (const failure of logs[0].failures) {
		assert.equal(failure.errorCode, "google_invalid_grant");
		assert.equal(failure.errorName, "Error");
		assert.equal(failure.errorMessage, "invalid_grant");
	}
});

// Passo 5 (fail_one): um consultor com invalid_grant sai do sorteio e a
// oferta segue com os saudáveis, na 1ª tentativa e com 1 chamada ao modelo.
test("2 consultores, 1 com invalid_grant: oferta só com o saudável, 1 chamada ao modelo", async (t) => {
	const tt = t as unknown as TestContextLike;
	const active = await db
		.select({ calendarId: consultants.calendarId, id: consultants.id })
		.from(consultants)
		.where(eq(consultants.active, true));

	assert.ok(active.length >= 2, "o seed tem ao menos 2 consultores ativos");
	const [broken] = active;
	assert.ok(broken);

	const counters = { modelCalls: 0 };
	t.mock.method(
		GoogleCalendarService.prototype,
		"getBusyPeriods",
		(calendarIds: string[]) =>
			calendarIds[0] === broken.calendarId
				? Promise.reject(invalidGrant())
				: Promise.resolve(
						calendarIds.map((calendarId) => ({ busy: [], calendarId }))
					)
	);
	t.mock.method(ai.models, "generateContent", () => {
		counters.modelCalls += 1;
		return Promise.resolve({
			text: JSON.stringify({
				evidenceUsed: [],
				leadUpdate: { interestedInConsultant: true, status: "qualified" },
				nextAction: "offer_appointment",
				reply: "Ótimo! Vou procurar um horário.",
			}),
		});
	});
	const seeded = await seedAfterOffer(tt, "fail_one");
	silenceConsoleError(tt);

	try {
		const result = await executeNextAutonomousTask({
			conversationId: seeded.conversationId,
			handlers: createAutonomousTaskHandlers(),
		});

		assert.equal(result.status, "completed", JSON.stringify(result));
		assert.equal(counters.modelCalls, 1);

		const state = await turnState(seeded);

		assert.deepEqual(state.task, { attempts: 1, status: "completed" });
		assert.equal(state.sessions.length, 1, "a oferta abriu a sessão");
		assert.equal(state.outboxTexts.length, 1);
		assert.notEqual(state.outboxTexts[0], CALENDAR_UNAVAILABLE_TEXT);

		const slots = await db
			.select({ consultantId: schedulingSlots.consultantId })
			.from(schedulingSlots)
			.where(
				inArray(
					schedulingSlots.schedulingSessionId,
					state.sessions.map((session) => session.id)
				)
			);

		assert.ok(slots.length > 0, "horários ofertados");
		for (const slot of slots) {
			assert.notEqual(slot.consultantId, broken.id, "nunca o quebrado");
		}
	} finally {
		// A sessão aberta pela oferta prende o lead (FK RESTRICT).
		await db
			.delete(schedulingSessions)
			.where(eq(schedulingSessions.leadId, seeded.leadId));
	}
});
