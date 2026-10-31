/** biome-ignore-all lint/suspicious/useAwait: fakes assíncronos do Calendar */
/**
 * 2026-10-27-scheduling-loop, Batch A (tester): casos adversariais do texto
 * fixo de Calendar indisponível — conversa fechada durante o Calendar (passos
 * 28/37/40), duas mensagens na mesma janela de debounce, e o turno seguinte
 * não arma `accepted_pending_offer`.
 *
 * Gemini e Google Calendar são falsos; claim, handlers e outbox são os reais.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

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

test("conversa fechada durante o Calendar: nenhum aviso vai para o outbox", async (t) => {
	const tt = t as unknown as TestContextLike;
	const counters = { modelCalls: 0 };
	const seeded = await seedAfterOffer(tt, "closed");
	silenceConsoleError(tt);

	t.mock.method(GoogleCalendarService.prototype, "getBusyPeriods", async () => {
		// Rotação comita no meio do Calendar.
		await db
			.update(conversations)
			.set({ status: "closed" })
			.where(eq(conversations.id, seeded.conversationId));
		throw invalidGrant();
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

	const result = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers: createAutonomousTaskHandlers(),
	});

	assert.equal(result.status, "completed", JSON.stringify(result));
	assert.equal(counters.modelCalls, 1);

	const state = await turnState(seeded);

	assert.deepEqual(state.outboxTexts, []);
	assert.equal(state.task?.attempts, 1);
});

test("duas mensagens na mesma janela: um único aviso e uma chamada ao modelo", async (t) => {
	const tt = t as unknown as TestContextLike;
	const counters = mockCalendarDownAndModel(tt);
	const seeded = await seedAfterOffer(tt, "window");
	silenceConsoleError(tt);

	const [first] = await db
		.select({ createdAt: messages.createdAt })
		.from(messages)
		.where(eq(messages.content, "sim por favor"))
		.orderBy(messages.createdAt);
	assert.ok(first);

	await db.insert(messages).values({
		content: "pode marcar",
		conversationId: seeded.conversationId,
		createdAt: new Date(Date.now() - 40_000),
		externalId: `wamid.calendar_window2_${Date.now()}`,
		role: "user",
	});

	const result = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers: createAutonomousTaskHandlers(),
	});

	assert.equal(result.status, "completed", JSON.stringify(result));
	assert.equal(counters.modelCalls, 1);

	const state = await turnState(seeded);

	assert.deepEqual(state.outboxTexts, [CALENDAR_UNAVAILABLE_TEXT]);
	assert.deepEqual(
		state.newAssistantRows.filter((row) => row !== "pode marcar"),
		[CALENDAR_UNAVAILABLE_TEXT]
	);
});

test("Calendar falha para todos: uma chamada por consultor ativo, sem retry", async (t) => {
	const tt = t as unknown as TestContextLike;
	const counters = mockCalendarDownAndModel(tt);
	const seeded = await seedAfterOffer(tt, "count");
	silenceConsoleError(tt);
	const active = await db
		.select({ id: consultants.id })
		.from(consultants)
		.where(eq(consultants.active, true));

	assert.ok(active.length > 0, "o seed precisa de consultor ativo");

	const result = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers: createAutonomousTaskHandlers(),
	});

	assert.equal(result.status, "completed");
	assert.equal(counters.calendarCalls, active.length);
	assert.equal(counters.modelCalls, 1);

	const again = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers: createAutonomousTaskHandlers(),
	});

	assert.equal(again.status, "idle", JSON.stringify(again));
	assert.equal(counters.modelCalls, 1);
});

test("Calendar indisponível por erro não-OAuth: o erro real aparece no log (R-REL-05)", async (t) => {
	const tt = t as unknown as TestContextLike;
	const seeded = await seedAfterOffer(tt, "enotfound");
	const lines: string[] = [];
	const original = console.error;

	console.error = (...args: unknown[]) => {
		lines.push(args.map(String).join(" "));
	};
	t.after(() => {
		console.error = original;
	});
	t.mock.method(GoogleCalendarService.prototype, "getBusyPeriods", () =>
		Promise.reject(
			Object.assign(new Error("getaddrinfo ENOTFOUND www.googleapis.com"), {
				code: "ENOTFOUND",
			})
		)
	);
	t.mock.method(ai.models, "generateContent", () =>
		Promise.resolve({
			text: JSON.stringify({
				evidenceUsed: [],
				leadUpdate: { interestedInConsultant: true, status: "qualified" },
				nextAction: "offer_appointment",
				reply: "Ótimo! Vou procurar um horário.",
			}),
		})
	);

	const result = await executeNextAutonomousTask({
		conversationId: seeded.conversationId,
		handlers: createAutonomousTaskHandlers(),
	});

	assert.equal(result.status, "completed");
	assert.ok(
		lines.some((line) => line.includes("ENOTFOUND")),
		lines.join("\n")
	);
});
