/** biome-ignore-all lint/performance/noAwaitInLoops: sequência de linhas */
import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import { closeDatabase, db } from "../../../db/connections";
import { appointments, conversations, messages } from "../../../db/schema";
import { loadTurnState } from "../../../services/flow-v2/state";
import {
	T_AI_FALLBACK,
	T_ASK_OBJECTIVE,
	T_SENSITIVE,
} from "../../../services/flow-v2/texts";
import {
	cleanupConversationFixture,
	createConversationFixture,
	listActiveConsultants,
	seedHistory,
} from "../../support/conversation-harness";

test.after(async () => {
	await closeDatabase();
});

let clock = Date.now() - 60 * 60_000;

/** Distinct, increasing timestamps: no tie on `createdAt`. */
async function addAssistant(conversationId: string, content: string) {
	clock += 1000;
	await db.insert(messages).values({
		content,
		conversationId,
		createdAt: new Date(clock),
		role: "assistant",
	});
}

test("pending offer only from exact fixed text of the current conversation", async (t) => {
	const fx = await createConversationFixture();
	t.after(() => cleanupConversationFixture(fx.leadId));

	const empty = await loadTurnState(fx);
	assert.equal(empty.pendingOffer, null);
	assert.equal(empty.assistantReplyCount, 0);

	const cases: [string, string | null][] = [
		[`${T_SENSITIVE} Posso ajudar?`, null],
		[`Olá! ${T_SENSITIVE}`, null],
		[T_SENSITIVE.toUpperCase(), null],
		[T_SENSITIVE, "consultant_offer"],
		["Resposta livre do modelo. Quer que eu veja os horários?", null],
		[T_AI_FALLBACK, "consultant_offer"],
		[T_ASK_OBJECTIVE, "objective_question"],
		["Outra resposta.", null],
	];

	for (const [content, expected] of cases) {
		await addAssistant(fx.conversationId, content);
		const state = await loadTurnState(fx);
		assert.equal(state.pendingOffer, expected, content);
	}

	const state = await loadTurnState(fx);
	assert.equal(state.assistantReplyCount, cases.length);
	assert.equal(state.askedObjective, true);
});

test("past appointment is not future (S-11)", async (t) => {
	const fx = await createConversationFixture();
	t.after(() => cleanupConversationFixture(fx.leadId));
	const [consultant] = await listActiveConsultants();
	assert.ok(consultant);
	const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

	await db.insert(appointments).values([
		{
			consultantId: consultant.id,
			endAt: new Date(Date.now() - 30 * 60_000),
			externalEventId: `flow-v2-past-${suffix}`,
			leadId: fx.leadId,
			startAt: new Date(Date.now() - 60 * 60_000),
			status: "confirmed",
		},
		{
			consultantId: consultant.id,
			endAt: new Date(Date.now() + 26 * 3_600_000),
			externalEventId: `flow-v2-cancelled-${suffix}`,
			leadId: fx.leadId,
			startAt: new Date(Date.now() + 25 * 3_600_000),
			status: "cancelled",
		},
	]);

	assert.equal((await loadTurnState(fx)).futureAppointment, null);

	const startAt = new Date(Date.now() + 48 * 3_600_000);
	const [future] = await db
		.insert(appointments)
		.values({
			consultantId: consultant.id,
			endAt: new Date(startAt.getTime() + 30 * 60_000),
			externalEventId: `flow-v2-future-${suffix}`,
			leadId: fx.leadId,
			startAt,
			status: "scheduled",
		})
		.returning({ id: appointments.id });
	assert.ok(future);

	assert.deepEqual((await loadTurnState(fx)).futureAppointment, {
		calendarId: consultant.calendarId,
		consultantId: consultant.id,
		consultantName: consultant.name,
		externalEventId: `flow-v2-future-${suffix}`,
		id: future.id,
		startAt,
	});
});

test("rotated conversation inherits no pending offer", async (t) => {
	const fx = await createConversationFixture();
	t.after(() => cleanupConversationFixture(fx.leadId));

	await seedHistory(fx.conversationId, [
		{ content: "quanto fica a parcela?", role: "user" },
		{ content: T_ASK_OBJECTIVE, role: "assistant" },
		{ content: "carro", role: "user" },
		{ content: T_SENSITIVE, role: "assistant" },
	]);
	await db
		.update(conversations)
		.set({ status: "closed" })
		.where(eq(conversations.id, fx.conversationId));
	const [next] = await db
		.insert(conversations)
		.values({ leadId: fx.leadId })
		.returning({ id: conversations.id });
	assert.ok(next);

	const state = await loadTurnState({
		conversationId: next.id,
		leadId: fx.leadId,
	});

	assert.equal(state.pendingOffer, null);
	assert.equal(state.assistantReplyCount, 0);
	assert.equal(state.askedObjective, false);
	assert.equal(state.lastAssistantContent, null);
	assert.equal(state.activeSession, null);
	assert.equal(state.conversation.status, "active");
});
