/**
 * Throwaway repro for task 2026-10-27-scheduling-loop. NOT a product test.
 * Run (local DB only):
 *   TEST_DATABASE_URL=postgresql://mariana:mariana@localhost:5432/mariana_test \
 *   RELIABILITY_WORKERS_ENABLED=false DOTENV_CONFIG_PATH=/dev/null \
 *   npx tsx --import ./src/tests/support/db-test-preload.ts \
 *     docs/work/2026-10-27-scheduling-loop/repro/scheduling-loop.repro.ts
 * Gemini, Google Calendar and WhatsApp are mocked. REPRO_CALENDAR=fail makes
 * getBusyPeriods throw (the Google error case).
 */
import { eq } from "drizzle-orm";

import { ai } from "../../../../src/ai/client";
import { closeDatabase, db } from "../../../../src/db/connections";
import {
	autonomousTasks,
	consultants,
	conversations,
	leads,
	messages,
	outboundMessages,
	schedulingSessions,
	schedulingSlots,
} from "../../../../src/db/schema";
import { GoogleCalendarService } from "../../../../src/integrations/google-calendar/google-calendar-service";
import {
	executeNextAutonomousTask,
	PermanentAutonomousTaskError,
} from "../../../../src/services/conversations/autonomous-task-executor";
import {
	createAutonomousTaskHandlers,
	PROCESS_INBOUND_MESSAGE_TASK,
} from "../../../../src/services/conversations/autonomous-task-handlers";

const url = new URL(process.env.DATABASE_URL ?? "");
console.error(`[repro] target ${url.hostname}/${url.pathname.slice(1)}`);
if (url.hostname.includes("neon.tech") || url.hostname !== "localhost") {
	throw new Error("refusing non-local DB");
}

const modelReplies = [
	{
		leadUpdate: { name: "Davi", status: "qualifying" },
		nextAction: "ask_next_qualification_question",
		reply:
			"Olá, Davi! Sou a Mariana. O que você está buscando hoje, por exemplo, um carro, um imóvel ou outro bem?",
	},
	{
		leadUpdate: {
			consortiumType: "automovel",
			objective: "carro",
			status: "qualifying",
		},
		nextAction: "answer_basic_question",
		reply: "O consórcio reúne pessoas que contribuem mensalmente.",
	},
	{
		leadUpdate: { interestedInConsultant: true, status: "qualified" },
		nextAction: "offer_appointment",
		reply: "Ótimo! Vou procurar um horário.",
	},
	{
		leadUpdate: { interestedInConsultant: true, status: "qualified" },
		nextAction: "wait_for_schedule",
		reply: "Vou ver os horários.",
	},
];
let modelCalls = 0;
// biome-ignore lint/suspicious/noExplicitAny: repro
(ai.models as any).generateContent = async () => {
	const base =
		modelReplies[Math.min(modelCalls, modelReplies.length - 1)] ??
		modelReplies[0];
	const shape =
		modelCalls >= 4
			? { ...base, nextAction: "schedule_meeting" }
			: base;
	modelCalls += 1;
	return { text: JSON.stringify({ evidenceUsed: [], ...shape }) };
};

let firstCalendarId: string | undefined;
GoogleCalendarService.prototype.getBusyPeriods = (async (
	calendarIds: string[]
) => {
	if (process.env.REPRO_CALENDAR === "fail") {
		throw Object.assign(new Error("invalid_grant"), { code: 400 });
	}
	if (process.env.REPRO_CALENDAR === "fail_one" && calendarIds[0] === firstCalendarId) {
		throw Object.assign(new Error("invalid_grant"), { code: 400 });
	}
	return calendarIds.map((calendarId) => ({ busy: [], calendarId }));
}) as unknown as typeof GoogleCalendarService.prototype.getBusyPeriods;

const traces: string[] = [];
const originalInfo = console.info;
console.info = (...args: unknown[]) => {
	const first = args[0];
	if (typeof first === "string" && first.includes('"event":"mariana_turn"')) {
		const parsed = JSON.parse(first);
		traces.push(
			`trace outcome=${parsed.outcome} stage=${parsed.stage} post=${parsed.postTurnStage} req=${parsed.requestedNextAction} exec=${parsed.executedAction} turnId=${String(parsed.turnId).slice(0, 8)}`
		);
		return;
	}
	if (first && typeof first === "object" && "event" in first) {
		const e = first as Record<string, unknown>;
		if (String(e.event).startsWith("agent_action")) {
			traces.push(`${e.event} ${e.nextAction} ${e.reason ?? ""}`);
		}
		return;
	}
	originalInfo(...(args as []));
};

const handlers = createAutonomousTaskHandlers();
const errors: unknown[] = [];

async function turn(conversationId: string, texts: string[]) {
	// v2: user rows must be AFTER the previous assistant reply (v1 used
	// now-30s, so "sim por favor" sorted before the offer and the pending
	// offer was never detected).
	const createdAt = new Date();
	let firstTaskId: string | undefined;
	for (const [index, content] of texts.entries()) {
		const at = new Date(createdAt.getTime() + index * 10);
		const [msg] = await db
			.insert(messages)
			.values({
				content,
				conversationId,
				createdAt: at,
				externalId: `wamid.repro_${crypto.randomUUID()}`,
				role: "user",
			})
			.returning({ id: messages.id });
		const [task] = await db
			.insert(autonomousTasks)
			.values({
				availableAt: new Date(Date.now() - 1000),
				conversationId,
				createdAt: at,
				idempotencyKey: `inbound:repro_${crypto.randomUUID()}`,
				payload: {
					batchCutoffAt: new Date(createdAt.getTime() + 50).toISOString(),
					kind: "text",
				},
				taskType: PROCESS_INBOUND_MESSAGE_TASK,
				triggerMessageId: msg?.id,
			})
			.returning({ id: autonomousTasks.id });
		firstTaskId ??= task?.id;
	}

	await new Promise((resolve) => setTimeout(resolve, 120));
	const callsBefore = modelCalls;
	for (let i = 0; i < 20; i += 1) {
		const result = await executeNextAutonomousTask({
			conversationId,
			handlers,
			retryable: (error) => {
				errors.push(error);
				return !(error instanceof PermanentAutonomousTaskError);
			},
		});
		traces.push(`executor ${JSON.stringify(result).slice(0, 200)} modelCallsThisTurn=${modelCalls - callsBefore}`);
		if (result.status === "idle") break;
		// Fast-forward the backoff instead of sleeping.
		await db
			.update(autonomousTasks)
			.set({ availableAt: new Date(Date.now() - 1000) })
			.where(eq(autonomousTasks.conversationId, conversationId));
	}
}

async function main() {
	// count every log line that carries the real error text
	const origErr = console.error;
	const origWarn = console.warn;
	let errorLines = 0;
	let counting = true;
	const spy = (orig: typeof console.error) => (...args: unknown[]) => {
		const s = args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
		if (counting && s.includes("invalid_grant")) errorLines += 1;
		orig(...(args as []));
	};
	console.error = spy(origErr);
	console.warn = spy(origWarn);
	process.on("beforeExit", () => origErr(`[repro] app log lines with invalid_grant: ${errorLines}`));
	const [c] = await db.select({ calendarId: consultants.calendarId, name: consultants.name }).from(consultants).where(eq(consultants.active, true)).orderBy(consultants.name).limit(1);
	firstCalendarId = c?.calendarId;
	console.error(`[repro] fail_one target consultant: ${c?.name}`);
	const phone = `5511987${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
	const [lead] = await db
		.insert(leads)
		.values({ name: phone, phone })
		.returning({ id: leads.id });
	if (!lead) throw new Error("lead");
	const [conversation] = await db
		.insert(conversations)
		.values({ lastCustomerMessageAt: new Date(), leadId: lead.id })
		.returning({ id: conversations.id });
	if (!conversation) throw new Error("conv");

	try {
		await turn(conversation.id, [
			"ola boa noite",
			"meu nome é Davi",
			"e eu quero saber sobre consorcios",
		]);
		await turn(conversation.id, ["consorcio de carro"]);
		await turn(conversation.id, ["sim por favor"]);

		counting = false;
		for (const line of traces) console.error(line);
		console.error(`[repro] model calls: ${modelCalls}`);
		for (const error of errors) {
			console.error("[repro] handler error:", (error as Error)?.stack);
		}
		const rows = await db
			.select({
				attempts: autonomousTasks.attempts,
				lastError: autonomousTasks.lastError,
				status: autonomousTasks.status,
			})
			.from(autonomousTasks)
			.where(eq(autonomousTasks.conversationId, conversation.id));
		console.error("[repro] tasks:", JSON.stringify(rows));
		const out = await db
			.select({ key: outboundMessages.idempotencyKey, status: outboundMessages.status, payload: outboundMessages.payload })
			.from(outboundMessages)
			.where(eq(outboundMessages.conversationId, conversation.id));
		console.error("[repro] outbox:", JSON.stringify(out).slice(0, 1500));
		const msgs = await db
			.select({ role: messages.role, content: messages.content })
			.from(messages)
			.where(eq(messages.conversationId, conversation.id))
			.orderBy(messages.createdAt);
		console.error(
			"[repro] messages:",
			JSON.stringify(msgs.map((m) => `${m.role}: ${m.content.slice(0, 90)}`), null, 1)
		);
		const sessions = await db
			.select({ stage: schedulingSessions.workflowStage, status: schedulingSessions.status })
			.from(schedulingSessions)
			.where(eq(schedulingSessions.leadId, lead.id));
		console.error("[repro] sessions:", JSON.stringify(sessions));
		// Batch C: the offer now opens a session; show whose slots were offered.
		const offered = await db
			.select({ consultantName: schedulingSlots.consultantName })
			.from(schedulingSlots)
			.innerJoin(
				schedulingSessions,
				eq(schedulingSlots.schedulingSessionId, schedulingSessions.id)
			)
			.where(eq(schedulingSessions.leadId, lead.id));
		console.error(
			"[repro] offered consultants:",
			JSON.stringify([...new Set(offered.map((row) => row.consultantName))])
		);
		const [l] = await db
			.select({ status: leads.status, interested: leads.interestedInConsultant, name: leads.name })
			.from(leads)
			.where(eq(leads.id, lead.id));
		console.error("[repro] lead:", JSON.stringify(l));
	} finally {
		// The offer's session holds the lead (FK RESTRICT).
		await db.delete(schedulingSessions).where(eq(schedulingSessions.leadId, lead.id));
		await db.delete(leads).where(eq(leads.id, lead.id));
		await closeDatabase();
	}
}

main().catch(async (error) => {
	console.error("[repro] fatal", error);
	await closeDatabase();
	process.exit(1);
});
