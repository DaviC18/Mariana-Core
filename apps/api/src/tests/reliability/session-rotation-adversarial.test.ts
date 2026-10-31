/** biome-ignore-all lint/suspicious/useAwait: mocks assíncronos */
/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/**
 * Tester V1-b (flow-review Rev1, steps 20–21) — casos adversariais da rotação
 * automática após 4h (R-SES-02 v1.3, K-1 a K-8).
 *
 * Só Gemini e o transporte WhatsApp são mockados; Postgres é o local de teste.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { and, eq, inArray } from "drizzle-orm";
import fastify from "fastify";
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { ai } from "../../ai/client";
import { closeDatabase, db } from "../../db/connections";
import { appointments } from "../../db/schema/appointments";
import { autonomousTasks } from "../../db/schema/autonomous-tasks";
import { consultants } from "../../db/schema/consultants";
import { conversations } from "../../db/schema/conversations";
import { leads } from "../../db/schema/leads";
import { messages } from "../../db/schema/messages";
import { outboundMessages } from "../../db/schema/outbound-messages";
import { schedulingSessions } from "../../db/schema/scheduling-sessions";
import { schedulingSlots } from "../../db/schema/scheduling-slots";
import { whatsappWebhookEvents } from "../../db/schema/whatsapp-webhook-events";
import { env } from "../../env";
import { GoogleCalendarService } from "../../integrations/google-calendar/google-calendar-service";
import { webhookWhatsApp } from "../../routes/whatsapp/webhook-whatsapp";
import { SchedulingAvailabilityService } from "../../services/calendar/scheduling-availability";
import { SchedulingCancellationService } from "../../services/calendar/scheduling-cancellation-service";
import { SchedulingChoiceService } from "../../services/calendar/scheduling-choice-service";
import { SchedulingConfirmationOrchestrator } from "../../services/calendar/scheduling-confirmation-orchestrator";
import {
	PROCESS_BUTTON_REPLY_TASK,
	PROCESS_CONSULTANT_SELECTION_TASK,
	PROCESS_INBOUND_MESSAGE_TASK,
} from "../../services/conversations/autonomous-task-handlers";
import { SESSION_INACTIVITY_MS } from "../../services/conversations/session-choice-policy";
import {
	resolveConversationForInbound,
	sessionRotationSnapshotKey,
} from "../../services/conversations/session-rotation";
import type { OutboundSender } from "../../services/messaging/outbound-messages";
import { drainConversationWork } from "../../services/reliability/background-workers";
import { backendPid, waitForLockWait } from "../support/lock-wait";

const SIMULATED_FAILURE = /simulated insert failure/;
const MARIANA_TURN_EVENT = '"event":"mariana_turn"';

test.after(async () => {
	await closeDatabase();
});

function buildApp() {
	const app = fastify().withTypeProvider<ZodTypeProvider>();
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.register(webhookWhatsApp);
	return app;
}

function sign(payload: string): string {
	return `sha256=${crypto
		.createHmac("sha256", env.WHATSAPP_APP_SECRET)
		.update(payload)
		.digest("hex")}`;
}

function envelope(phone: string, message: Record<string, unknown>): string {
	return JSON.stringify({
		entry: [
			{
				changes: [
					{
						field: "messages",
						value: {
							contacts: [{ profile: { name: "Cliente" }, wa_id: phone }],
							messages: [
								{
									from: phone,
									timestamp: String(Math.floor(Date.now() / 1000)),
									...message,
								},
							],
							messaging_product: "whatsapp",
							metadata: {
								display_phone_number: "5511999999999",
								phone_number_id: "12345",
							},
						},
					},
				],
				id: "entry_1",
			},
		],
		object: "whatsapp_business_account",
	});
}

function textWebhook(phone: string, body: string, id: string): string {
	return envelope(phone, { id, text: { body }, type: "text" });
}

function tapWebhook(phone: string, buttonId: string, id: string): string {
	return envelope(phone, {
		id,
		interactive: {
			button_reply: { id: buttonId, title: "Horário" },
			type: "button_reply",
		},
		type: "interactive",
	});
}

async function post(app: ReturnType<typeof buildApp>, payload: string) {
	const res = await app.inject({
		headers: {
			"content-type": "application/json",
			"x-hub-signature-256": sign(payload),
		},
		method: "POST",
		payload,
		url: "/webhooks/whatsapp",
	});
	assert.equal(res.statusCode, 200);
}

function mockGemini(t: test.TestContext) {
	t.mock.method(ai.models, "generateContent", async () => ({
		text: JSON.stringify({
			businessAction: "ask_next_qualification_question",
			evidenceUsed: [],
			leadUpdate: { status: "qualifying" },
			nextAction: "continue_qualification",
			reply: "Oi! Me conta o que você procura no consórcio?",
		}),
	}));
}

function fakeSender(sent: string[]): OutboundSender {
	return {
		sendReplyButtonsMessage: async (_to, body) => {
			sent.push(`buttons:${body}`);
			return { messages: [{ id: `wamid.out_${crypto.randomUUID()}` }] };
		},
		sendTextMessage: async (_to, text) => {
			sent.push(`text:${text}`);
			return { messages: [{ id: `wamid.out_${crypto.randomUUID()}` }] };
		},
	} as OutboundSender;
}

function newPhone(): string {
	return `551194${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}

/** Lead com conversa A; `lastAt` explícito (null = cliente nunca escreveu). */
async function createFixture(lastAt: Date | null) {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const phone = newPhone();
	const [lead] = await db
		.insert(leads)
		.values({ name: `Lead RotAdv ${suffix}`, phone })
		.returning({ id: leads.id });
	assert.ok(lead);
	const [conversation] = await db
		.insert(conversations)
		.values({ lastCustomerMessageAt: lastAt, leadId: lead.id })
		.returning({ id: conversations.id });
	assert.ok(conversation);
	return { conversationId: conversation.id, leadId: lead.id, phone, suffix };
}

async function cleanup(leadId: string | undefined, phone: string) {
	await db
		.delete(whatsappWebhookEvents)
		.where(eq(whatsappWebhookEvents.phone, phone));
	if (!leadId) {
		return;
	}
	const convIds = (
		await db
			.select({ id: conversations.id })
			.from(conversations)
			.where(eq(conversations.leadId, leadId))
	).map((c) => c.id);
	if (convIds.length > 0) {
		await db
			.delete(outboundMessages)
			.where(inArray(outboundMessages.conversationId, convIds));
		await db
			.delete(autonomousTasks)
			.where(inArray(autonomousTasks.conversationId, convIds));
		await db.delete(messages).where(inArray(messages.conversationId, convIds));
	}
	await db.delete(appointments).where(eq(appointments.leadId, leadId));
	await db
		.delete(schedulingSessions)
		.where(eq(schedulingSessions.leadId, leadId));
	await db.delete(conversations).where(eq(conversations.leadId, leadId));
	await db.delete(leads).where(eq(leads.id, leadId));
}

async function conversationsOf(leadId: string) {
	return await db
		.select()
		.from(conversations)
		.where(eq(conversations.leadId, leadId));
}

async function snapshotOf(conversationId: string) {
	const [row] = await db
		.select({ id: autonomousTasks.id })
		.from(autonomousTasks)
		.where(
			eq(
				autonomousTasks.idempotencyKey,
				sessionRotationSnapshotKey(conversationId)
			)
		);
	return row;
}

// ---------------------------------------------------------------------------
// Fronteira exata (sem relógio de parede: receivedAt explícito)
// ---------------------------------------------------------------------------

test("fronteira: 4h − 1 ms não rotaciona; 4h exatas rotacionam (módulo)", async () => {
	const lastAt = new Date(Date.now() - 10 * SESSION_INACTIVITY_MS);
	const under = await createFixture(lastAt);
	const exact = await createFixture(lastAt);
	try {
		const r1 = await db.transaction((tx) =>
			resolveConversationForInbound(tx, {
				leadId: under.leadId,
				receivedAt: new Date(lastAt.getTime() + SESSION_INACTIVITY_MS - 1),
			})
		);
		assert.equal(r1.rotated, false);
		assert.equal(r1.conversation.id, under.conversationId);
		assert.equal(await snapshotOf(under.conversationId), undefined);

		const r2 = await db.transaction((tx) =>
			resolveConversationForInbound(tx, {
				leadId: exact.leadId,
				receivedAt: new Date(lastAt.getTime() + SESSION_INACTIVITY_MS),
			})
		);
		assert.equal(r2.rotated, true);
		assert.equal(r2.previousConversationId, exact.conversationId);
		assert.notEqual(r2.conversation.id, exact.conversationId);
	} finally {
		await cleanup(under.leadId, under.phone);
		await cleanup(exact.leadId, exact.phone);
	}
});

test("lastCustomerMessageAt null nunca rotaciona, mesmo muito antiga", async () => {
	const fx = await createFixture(null);
	try {
		const r = await db.transaction((tx) =>
			resolveConversationForInbound(tx, {
				leadId: fx.leadId,
				receivedAt: new Date(Date.now() + 365 * 86_400_000),
			})
		);
		assert.equal(r.rotated, false);
		assert.equal(r.conversation.id, fx.conversationId);
		assert.equal((await conversationsOf(fx.leadId)).length, 1);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Atomicidade: A nunca fecha sem B (rollback leva tudo junto)
// ---------------------------------------------------------------------------

test("falha depois da rotação na mesma transação desfaz tudo: A ativa, sem B, estado intacto", async () => {
	const fx = await createFixture(
		new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000)
	);
	try {
		await db
			.update(leads)
			.set({ objective: "comprar carro", status: "qualified" })
			.where(eq(leads.id, fx.leadId));
		const [session] = await db
			.insert(schedulingSessions)
			.values({
				conversationId: fx.conversationId,
				expiresAt: new Date(Date.now() + 3_600_000),
				leadId: fx.leadId,
				status: "active",
				workflowStage: "awaiting_slot_selection",
			})
			.returning({ id: schedulingSessions.id });
		assert.ok(session);

		let rotatedInside = false;
		await assert.rejects(
			db.transaction(async (tx) => {
				const r = await resolveConversationForInbound(tx, {
					leadId: fx.leadId,
					receivedAt: new Date(),
				});
				rotatedInside = r.rotated;
				throw new Error("simulated insert failure");
			}),
			SIMULATED_FAILURE
		);
		assert.equal(rotatedInside, true);

		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 1, "no B left behind");
		assert.equal(all[0]?.status, "active", "A not closed");
		const [lead] = await db.select().from(leads).where(eq(leads.id, fx.leadId));
		assert.equal(lead?.objective, "comprar carro");
		assert.equal(lead?.status, "qualified");
		const [sessionAfter] = await db
			.select({ status: schedulingSessions.status })
			.from(schedulingSessions)
			.where(eq(schedulingSessions.id, session.id));
		assert.equal(sessionAfter?.status, "active");
		assert.equal(await snapshotOf(fx.conversationId), undefined);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Lead sem conversa anterior
// ---------------------------------------------------------------------------

test("lead novo (sem conversa anterior) cria uma conversa, sem rotação nem snapshot", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const phone = newPhone();
	let leadId: string | undefined;
	try {
		await post(app, textWebhook(phone, "oi", `wamid.fresh_${Date.now()}`));
		const [lead] = await db
			.select({ id: leads.id })
			.from(leads)
			.where(eq(leads.phone, phone));
		assert.ok(lead);
		leadId = lead.id;
		const all = await conversationsOf(lead.id);
		assert.equal(all.length, 1);
		assert.equal(all[0]?.status, "active");
		assert.ok(all[0]?.lastCustomerMessageAt);
		assert.equal(await snapshotOf(all[0]?.id as string), undefined);
		const tasks = await db
			.select({ taskType: autonomousTasks.taskType })
			.from(autonomousTasks)
			.where(eq(autonomousTasks.conversationId, all[0]?.id as string));
		assert.deepEqual(
			tasks.map((x) => x.taskType),
			[PROCESS_INBOUND_MESSAGE_TASK]
		);
	} finally {
		await cleanup(leadId, phone);
	}
});

// ---------------------------------------------------------------------------
// Tarefa de A já em execução durante a rotação
// ---------------------------------------------------------------------------

test("rotação só supera tarefas pending de A; tarefa em processing não é tocada; B recebe o inbound", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(
		new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000)
	);
	try {
		const [running] = await db
			.insert(autonomousTasks)
			.values({
				conversationId: fx.conversationId,
				idempotencyKey: `running-a:${fx.suffix}`,
				leaseExpiresAt: new Date(Date.now() + 60_000),
				leaseToken: crypto.randomUUID(),
				payload: { kind: "text" },
				status: "processing",
				taskType: PROCESS_INBOUND_MESSAGE_TASK,
			})
			.returning({ id: autonomousTasks.id });
		assert.ok(running);

		const externalId = `wamid.run_${fx.suffix}`;
		await post(app, textWebhook(fx.phone, "voltei", externalId));

		const [after] = await db
			.select({ status: autonomousTasks.status })
			.from(autonomousTasks)
			.where(eq(autonomousTasks.id, running.id));
		assert.equal(after?.status, "processing", "lease owner keeps its task");

		const active = (await conversationsOf(fx.leadId)).filter(
			(c) => c.status === "active"
		);
		assert.equal(active.length, 1);
		assert.notEqual(active[0]?.id, fx.conversationId);
		const bTasks = await db
			.select({ key: autonomousTasks.idempotencyKey })
			.from(autonomousTasks)
			.where(eq(autonomousTasks.conversationId, active[0]?.id as string));
		assert.deepEqual(bTasks, [{ key: `inbound:${externalId}` }]);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Reunião futura cancelada não segura o status
// ---------------------------------------------------------------------------

test("reunião futura cancelada não conta: lead scheduled volta a new na rotação", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(
		new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000)
	);
	try {
		const [consultant] = await db
			.select({ id: consultants.id })
			.from(consultants)
			.where(eq(consultants.active, true))
			.limit(1);
		assert.ok(consultant);
		await db
			.update(leads)
			.set({ qualifiedAt: new Date(), status: "scheduled" })
			.where(eq(leads.id, fx.leadId));
		await db.insert(appointments).values({
			consultantId: consultant.id,
			endAt: new Date(Date.now() + 9_000_000),
			externalEventId: `evt-rotadv-cancel-${fx.suffix}`,
			leadId: fx.leadId,
			startAt: new Date(Date.now() + 7_200_000),
			status: "cancelled",
		});

		await post(app, textWebhook(fx.phone, "oi", `wamid.cxl_${fx.suffix}`));

		const [lead] = await db
			.select({ qualifiedAt: leads.qualifiedAt, status: leads.status })
			.from(leads)
			.where(eq(leads.id, fx.leadId));
		assert.equal(lead?.status, "new");
		assert.equal(lead?.qualifiedAt, null);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Texto e toque concorrentes após 4h (K-1)
// ---------------------------------------------------------------------------

test("texto e toque de horário concorrentes após 4h: uma única conversa ativa e o texto nunca fica numa conversa fechada", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);

	for (let round = 0; round < 4; round += 1) {
		const fx = await createFixture(
			new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000)
		);
		try {
			const textId = `wamid.ct_text_${round}_${fx.suffix}`;
			const tapId = `wamid.ct_tap_${round}_${fx.suffix}`;
			const pair = [
				post(app, textWebhook(fx.phone, "quero remarcar", textId)),
				post(app, tapWebhook(fx.phone, crypto.randomUUID(), tapId)),
			];
			await Promise.all(round % 2 === 0 ? pair : pair.reverse());

			const all = await conversationsOf(fx.leadId);
			const active = all.filter((c) => c.status === "active");
			assert.equal(active.length, 1, `round ${round}: one active`);
			assert.ok(all.length <= 2, `round ${round}: at most A and one B`);

			const [textMsg] = await db
				.select({ conversationId: messages.conversationId })
				.from(messages)
				.where(eq(messages.externalId, textId));
			assert.equal(
				textMsg?.conversationId,
				active[0]?.id,
				`round ${round}: text stored in the active conversation`
			);

			const events = await db
				.select({
					externalId: whatsappWebhookEvents.externalId,
					status: whatsappWebhookEvents.status,
				})
				.from(whatsappWebhookEvents)
				.where(inArray(whatsappWebhookEvents.externalId, [textId, tapId]));
			assert.equal(events.length, 2);
			for (const e of events) {
				assert.notEqual(e.status, "failed", `round ${round}: ${e.externalId}`);
			}

			// Nenhuma tarefa pendente ficou presa numa conversa fechada.
			const closedIds = all
				.filter((c) => c.status === "closed")
				.map((c) => c.id);
			if (closedIds.length > 0) {
				const stuck = await db
					.select({ key: autonomousTasks.idempotencyKey })
					.from(autonomousTasks)
					.where(
						and(
							inArray(autonomousTasks.conversationId, closedIds),
							eq(autonomousTasks.status, "pending")
						)
					);
				assert.deepEqual(stuck, [], `round ${round}: pending task in closed A`);
			}
		} finally {
			await cleanup(fx.leadId, fx.phone);
		}
	}
});

// ---------------------------------------------------------------------------
// Reentrega tardia (≥ 4h) de uma mensagem já gravada em A e ainda não processada
// ---------------------------------------------------------------------------

// F-V1b-1 (Rev2 step 26, D-R2-1 a): a mensagem fica na conversa onde foi
// gravada pela primeira vez, e é essa conversa que responde (R-SES-02 v1.4 /
// S-22, R-REL-02).
test("reentrega ≥ 4h depois de mensagem gravada e não processada em A ainda responde uma vez", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000);
	const fx = await createFixture(lastAt);
	try {
		const externalId = `wamid.late_${fx.suffix}`;
		// Estado deixado pela 1ª entrega commitada (servidor caiu antes do 200
		// e os workers ficaram parados): mensagem em A, task pendente, evento
		// em processing com lease vencido.
		const [msg] = await db
			.insert(messages)
			.values({
				content: "é para carro",
				conversationId: fx.conversationId,
				createdAt: lastAt,
				externalId,
				role: "user",
			})
			.returning({ id: messages.id });
		assert.ok(msg);
		const [event] = await db
			.insert(whatsappWebhookEvents)
			.values({
				conversationId: fx.conversationId,
				eventType: "text",
				externalId,
				leaseExpiresAt: new Date(lastAt.getTime() + 60_000),
				payload: {},
				phone: fx.phone,
				status: "processing",
			})
			.returning({ id: whatsappWebhookEvents.id });
		assert.ok(event);
		// Payload igual ao gravado pela 1ª entrega (webhook-whatsapp.ts).
		await db.insert(autonomousTasks).values({
			availableAt: lastAt,
			conversationId: fx.conversationId,
			idempotencyKey: `inbound:${externalId}`,
			payload: {
				batchCutoffAt: lastAt.toISOString(),
				eventExternalId: externalId,
				eventId: event.id,
				kind: "text",
			},
			taskType: PROCESS_INBOUND_MESSAGE_TASK,
			triggerMessageId: msg.id,
		});

		await post(app, textWebhook(fx.phone, "é para carro", externalId));

		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 1, "no new conversation");
		assert.equal(all[0]?.id, fx.conversationId);
		assert.equal(all[0]?.status, "active", "A stays active");
		const snapshot = await db
			.select({ id: autonomousTasks.id })
			.from(autonomousTasks)
			.where(
				eq(
					autonomousTasks.idempotencyKey,
					sessionRotationSnapshotKey(fx.conversationId)
				)
			);
		assert.deepEqual(snapshot, [], "no rotation snapshot");

		const sent: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});
		assert.equal(sent.length, 1, "the message is answered exactly once");
		const outbound = await db
			.select({ conversationId: outboundMessages.conversationId })
			.from(outboundMessages)
			.where(
				inArray(
					outboundMessages.conversationId,
					(await conversationsOf(fx.leadId)).map((c) => c.id)
				)
			);
		assert.deepEqual(
			outbound.map((o) => o.conversationId),
			[fx.conversationId],
			"the reply is in A"
		);
		const [eventAfter] = await db
			.select({ status: whatsappWebhookEvents.status })
			.from(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.id, event.id));
		assert.equal(eventAfter?.status, "processed");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Turno velho (R-V1b-1, passo 28): turno de A que termina depois da rotação
// ---------------------------------------------------------------------------

/** Estado de A com uma mensagem do cliente gravada e a task dela pendente. */
async function seedPendingInboundInA(
	fx: Awaited<ReturnType<typeof createFixture>>,
	lastAt: Date,
	content: string
) {
	const externalId = `wamid.stale_${fx.suffix}`;
	const [msg] = await db
		.insert(messages)
		.values({
			content,
			conversationId: fx.conversationId,
			createdAt: lastAt,
			externalId,
			role: "user",
		})
		.returning({ id: messages.id });
	assert.ok(msg);
	const [event] = await db
		.insert(whatsappWebhookEvents)
		.values({
			conversationId: fx.conversationId,
			eventType: "text",
			externalId,
			payload: {},
			phone: fx.phone,
			status: "processing",
		})
		.returning({ id: whatsappWebhookEvents.id });
	assert.ok(event);
	const [task] = await db
		.insert(autonomousTasks)
		.values({
			availableAt: lastAt,
			conversationId: fx.conversationId,
			idempotencyKey: `inbound:${externalId}`,
			payload: {
				batchCutoffAt: lastAt.toISOString(),
				eventExternalId: externalId,
				eventId: event.id,
				kind: "text",
			},
			taskType: PROCESS_INBOUND_MESSAGE_TASK,
			triggerMessageId: msg.id,
		})
		.returning({ id: autonomousTasks.id });
	assert.ok(task);
	return { eventId: event.id, taskId: task.id };
}

const STALE_TURN_REPLY = JSON.stringify({
	businessAction: "ask_next_qualification_question",
	evidenceUsed: [],
	leadUpdate: {
		consortiumType: "auto",
		objective: "comprar carro",
		status: "qualifying",
	},
	nextAction: "continue_qualification",
	reply: "Legal, carro! Qual o valor que você imagina?",
});

test("turno em andamento em A quando a rotação acontece não grava no lead nem responde", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	let releaseGemini: () => void = () => undefined;
	const geminiGate = new Promise<void>((resolve) => {
		releaseGemini = resolve;
	});
	let signalStarted: () => void = () => undefined;
	const geminiStarted = new Promise<void>((resolve) => {
		signalStarted = resolve;
	});
	let calls = 0;
	t.mock.method(ai.models, "generateContent", async () => {
		calls += 1;
		if (calls === 1) {
			signalStarted();
			await geminiGate;
		}
		return { text: STALE_TURN_REPLY };
	});
	const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000);
	const fx = await createFixture(lastAt);
	try {
		const seeded = await seedPendingInboundInA(fx, lastAt, "é para carro");
		// Rev3 passo 38 (R-REL-07): rastro do turno, como em
		// generate-mariana-response.test.ts.
		const traces: string[] = [];
		const originalInfo = console.info;
		console.info = (...args: unknown[]) => {
			if (typeof args[0] === "string" && args[0].includes(MARIANA_TURN_EVENT)) {
				traces.push(args[0]);
				return;
			}
			originalInfo(...(args as []));
		};
		t.after(() => {
			console.info = originalInfo;
		});
		const sentA: string[] = [];
		const turnA = drainConversationWork(fx.conversationId, {
			sender: fakeSender(sentA),
		});
		await geminiStarted;

		// Rotação commita enquanto o modelo de A ainda pensa.
		await post(
			app,
			textWebhook(fx.phone, "oi de novo", `wamid.new_${fx.suffix}`)
		);
		releaseGemini();
		await turnA;
		console.info = originalInfo;

		const turnTraces = traces
			.map((line) => JSON.parse(line))
			.filter((trace) => trace.turnId === seeded.taskId);
		assert.deepEqual(
			turnTraces.map((trace) => trace.outcome),
			["superseded"],
			"one trace, outcome superseded"
		);

		const [lead] = await db.select().from(leads).where(eq(leads.id, fx.leadId));
		assert.equal(lead?.consortiumType, null, "consortiumType reset kept");
		assert.equal(lead?.objective, null, "objective reset kept");
		assert.equal(lead?.interestedInConsultant, false);

		const assistantInA = await db
			.select({ id: messages.id })
			.from(messages)
			.where(
				and(
					eq(messages.conversationId, fx.conversationId),
					eq(messages.role, "assistant")
				)
			);
		assert.deepEqual(assistantInA, [], "no assistant row in A");
		const outboxA = await db
			.select({ id: outboundMessages.id })
			.from(outboundMessages)
			.where(eq(outboundMessages.conversationId, fx.conversationId));
		assert.deepEqual(outboxA, [], "no outbox from A");
		assert.deepEqual(sentA, [], "nothing sent from A");

		const [taskA] = await db
			.select({
				result: autonomousTasks.result,
				status: autonomousTasks.status,
			})
			.from(autonomousTasks)
			.where(eq(autonomousTasks.id, seeded.taskId));
		assert.equal(taskA?.status, "completed");
		assert.deepEqual(taskA?.result, {
			reason: "conversation_not_active",
			skipped: true,
		});

		const active = (await conversationsOf(fx.leadId)).filter(
			(c) => c.status === "active"
		);
		assert.equal(active.length, 1);
		const bId = active[0]?.id as string;
		assert.notEqual(bId, fx.conversationId);
		const bTasks = await db
			.select({ id: autonomousTasks.id })
			.from(autonomousTasks)
			.where(
				and(
					eq(autonomousTasks.conversationId, bId),
					eq(autonomousTasks.taskType, PROCESS_INBOUND_MESSAGE_TASK)
				)
			);
		assert.equal(bTasks.length, 1, "B has 1 inbound task");
		const sentB: string[] = [];
		await drainConversationWork(bId, { sender: fakeSender(sentB) });
		assert.equal(sentB.length, 1, "B answered once");
	} finally {
		releaseGemini();
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tarefa de A executada depois da rotação não responde em B", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	let calls = 0;
	t.mock.method(ai.models, "generateContent", async () => {
		calls += 1;
		return { text: STALE_TURN_REPLY };
	});
	const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000);
	const fx = await createFixture(lastAt);
	try {
		const seeded = await seedPendingInboundInA(fx, lastAt, "é para carro");
		await post(
			app,
			textWebhook(fx.phone, "oi de novo", `wamid.new_${fx.suffix}`)
		);
		const active = (await conversationsOf(fx.leadId)).filter(
			(c) => c.status === "active"
		);
		const bId = active[0]?.id as string;
		assert.notEqual(bId, fx.conversationId, "rotation done");

		// Tarefa de A volta a pending (ex.: recuperação de lease).
		await db
			.update(autonomousTasks)
			.set({ completedAt: null, result: null, status: "pending" })
			.where(eq(autonomousTasks.id, seeded.taskId));

		const sent: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});

		assert.equal(calls, 0, "no Gemini call");
		assert.deepEqual(sent, [], "nothing sent");
		const assistantInB = await db
			.select({ id: messages.id })
			.from(messages)
			.where(
				and(eq(messages.conversationId, bId), eq(messages.role, "assistant"))
			);
		assert.deepEqual(assistantInB, [], "no message written into B");
		const [taskA] = await db
			.select({
				result: autonomousTasks.result,
				status: autonomousTasks.status,
			})
			.from(autonomousTasks)
			.where(eq(autonomousTasks.id, seeded.taskId));
		assert.equal(taskA?.status, "completed");
		assert.deepEqual(taskA?.result, {
			reason: "conversation_not_active",
			skipped: true,
		});
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Rev3 passo 37 (janela do passo 28): o turno de A já commitou, a rotação
// acontece durante a busca de horários; a oferta e a resposta de A não podem
// ser gravadas nem enviadas.
// ---------------------------------------------------------------------------

const OFFER_TURN_REPLY = JSON.stringify({
	businessAction: "offer_appointment",
	evidenceUsed: [],
	leadUpdate: { status: "qualified" },
	nextAction: "offer_meeting",
	reply: "Vou consultar os horários.",
});

/** Calendar fake que segura a primeira consulta até `release()`. */
function blockingCalendar(t: test.TestContext, busyAll: boolean) {
	let release: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let signalStarted: () => void = () => undefined;
	const started = new Promise<void>((resolve) => {
		signalStarted = resolve;
	});
	let calls = 0;
	t.mock.method(
		GoogleCalendarService.prototype,
		"getBusyPeriods",
		async (calendarIds: string[], timeMin: Date, timeMax: Date) => {
			calls += 1;
			if (calls === 1) {
				signalStarted();
				await gate;
			}
			return calendarIds.map((calendarId) => ({
				busy: busyAll
					? [{ end: timeMax.toISOString(), start: timeMin.toISOString() }]
					: [],
				calendarId,
			}));
		}
	);
	return { release, started };
}

for (const variant of ["com horários", "sem horários"] as const) {
	const name =
		variant === "com horários"
			? "rotação durante a busca de horários: a oferta de A não é gravada nem enviada"
			: "rotação durante a busca, sem horários: a resposta de A não é enviada";
	test(name, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		let geminiCalls = 0;
		t.mock.method(ai.models, "generateContent", async () => {
			geminiCalls += 1;
			return { text: geminiCalls === 1 ? OFFER_TURN_REPLY : STALE_TURN_REPLY };
		});
		const calendar = blockingCalendar(t, variant === "sem horários");
		const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000);
		const fx = await createFixture(lastAt);
		try {
			await db
				.update(leads)
				.set({
					consortiumType: "imóvel",
					interestedInConsultant: true,
					objective: "Comprar imóvel",
					status: "qualified",
				})
				.where(eq(leads.id, fx.leadId));
			const seeded = await seedPendingInboundInA(
				fx,
				lastAt,
				"pode marcar com o consultor"
			);
			// Tester V3-b (R-REL-07): um rastro por turno de A.
			const traces: string[] = [];
			const originalInfo = console.info;
			console.info = (...args: unknown[]) => {
				if (
					typeof args[0] === "string" &&
					args[0].includes(MARIANA_TURN_EVENT)
				) {
					traces.push(args[0]);
					return;
				}
				originalInfo(...(args as []));
			};
			t.after(() => {
				console.info = originalInfo;
			});
			const sentA: string[] = [];
			const turnA = drainConversationWork(fx.conversationId, {
				sender: fakeSender(sentA),
			});
			await calendar.started;

			// O turno de A já commitou; a rotação commita durante a busca.
			await post(
				app,
				textWebhook(fx.phone, "oi de novo", `wamid.new_${fx.suffix}`)
			);
			calendar.release();
			await turnA;
			console.info = originalInfo;

			// Com horários, `persistOffer` lança `TurnSupersededError` → `superseded`.
			// Sem horários, o turno relê o status antes do rastro (D-R3-5 a, passo
			// 40) → também `superseded`.
			const turnOutcomes = traces
				.map((line) => JSON.parse(line))
				.filter((trace) => trace.turnId === seeded.taskId)
				.map((trace) => trace.outcome);
			assert.deepEqual(turnOutcomes, ["superseded"], "one trace for A's turn");

			const sessionsInA = await db
				.select({ id: schedulingSessions.id })
				.from(schedulingSessions)
				.where(
					and(
						eq(schedulingSessions.conversationId, fx.conversationId),
						eq(schedulingSessions.status, "active")
					)
				);
			assert.deepEqual(sessionsInA, [], "no active session in A");
			const outboxA = await db
				.select({ id: outboundMessages.id })
				.from(outboundMessages)
				.where(eq(outboundMessages.conversationId, fx.conversationId));
			assert.deepEqual(outboxA, [], "no outbox from A");
			assert.deepEqual(sentA, [], "nothing sent from A");

			const [taskA] = await db
				.select({
					result: autonomousTasks.result,
					status: autonomousTasks.status,
				})
				.from(autonomousTasks)
				.where(eq(autonomousTasks.id, seeded.taskId));
			assert.equal(taskA?.status, "completed");
			assert.deepEqual(taskA?.result, {
				reason: "conversation_not_active",
				skipped: true,
			});

			const [lead] = await db
				.select()
				.from(leads)
				.where(eq(leads.id, fx.leadId));
			assert.equal(lead?.interestedInConsultant, false, "reset kept");

			const active = (await conversationsOf(fx.leadId)).filter(
				(c) => c.status === "active"
			);
			assert.equal(active.length, 1);
			const bId = active[0]?.id as string;
			assert.notEqual(bId, fx.conversationId);
			const sentB: string[] = [];
			await drainConversationWork(bId, { sender: fakeSender(sentB) });
			assert.equal(sentB.length, 1, "B answered once");
		} finally {
			calendar.release();
			await cleanup(fx.leadId, fx.phone);
		}
	});
}

// ---------------------------------------------------------------------------
// Tester V3-b: the model-failure notice is the other send of the inbound
// handler (`sendModelFailureNotice`). It runs without a lead lock and without
// re-reading `conversations.status`. Rotation commits while Gemini is still
// thinking, then Gemini fails: the notice must not go out from closed A
// (R-V1b-1, S-23). Outside the Rev3 plan (step 37 covered only TH:324-341).
// ---------------------------------------------------------------------------

// Rev3.1 passo 40 (F-V3b-1, D-R3-5 a): aviso com lead travado + re-check; o
// rastro do turno de A é `superseded`.
test("tester V3-b: rotação durante a chamada ao Gemini que falha: o aviso de falha de A não é enviado", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	let releaseGemini: () => void = () => undefined;
	const geminiGate = new Promise<void>((resolve) => {
		releaseGemini = resolve;
	});
	let signalStarted: () => void = () => undefined;
	const geminiStarted = new Promise<void>((resolve) => {
		signalStarted = resolve;
	});
	let calls = 0;
	t.mock.method(ai.models, "generateContent", async () => {
		calls += 1;
		if (calls === 1) {
			signalStarted();
			await geminiGate;
			// Empty text → ModelUnavailableError (kind empty_response).
			return { text: "" };
		}
		return { text: STALE_TURN_REPLY };
	});
	const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000);
	const fx = await createFixture(lastAt);
	try {
		const seeded = await seedPendingInboundInA(fx, lastAt, "é para carro");
		const traces: string[] = [];
		const originalInfo = console.info;
		console.info = (...args: unknown[]) => {
			if (typeof args[0] === "string" && args[0].includes(MARIANA_TURN_EVENT)) {
				traces.push(args[0]);
				return;
			}
			originalInfo(...(args as []));
		};
		t.after(() => {
			console.info = originalInfo;
		});
		const sentA: string[] = [];
		const turnA = drainConversationWork(fx.conversationId, {
			sender: fakeSender(sentA),
		});
		await geminiStarted;
		await post(
			app,
			textWebhook(fx.phone, "oi de novo", `wamid.new_${fx.suffix}`)
		);
		releaseGemini();
		await turnA;
		console.info = originalInfo;

		const turnOutcomes = traces
			.map((line) => JSON.parse(line))
			.filter((trace) => trace.turnId === seeded.taskId)
			.map((trace) => trace.outcome);
		assert.deepEqual(turnOutcomes, ["superseded"], "one trace for A's turn");

		const outboxA = await db
			.select({ id: outboundMessages.id })
			.from(outboundMessages)
			.where(eq(outboundMessages.conversationId, fx.conversationId));
		assert.deepEqual(outboxA, [], "no outbox from A");
		assert.deepEqual(sentA, [], "nothing sent from A");
		const [taskA] = await db
			.select({ result: autonomousTasks.result })
			.from(autonomousTasks)
			.where(eq(autonomousTasks.id, seeded.taskId));
		assert.deepEqual(taskA?.result, {
			reason: "conversation_not_active",
			skipped: true,
		});
	} finally {
		releaseGemini();
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Rev3.1 passo 41: todo envio do fluxo de botões confere a conversa sob o lock
// do lead. A rotação commita entre o serviço (sessão ainda ativa) e o envio.
// Para simular a janela, `lastCustomerMessageAt` de A volta para ≥ 4h antes do
// texto novo (o toque grava `now` nela; o webhook concorrente leu o valor
// antigo).
// ---------------------------------------------------------------------------

type Fixture = Awaited<ReturnType<typeof createFixture>>;

const DAY_MS = 86_400_000;
const BOOKING_CONFIRMED_TEXT = /^Agendamento confirmado para .+ com .+\.$/;

/** Sessão ativa em A com `slotCount` horários; `selected` marca o primeiro. */
async function seedSessionInA(
	fx: Fixture,
	workflowStage:
		| "awaiting_confirmation"
		| "awaiting_slot_selection"
		| "awaiting_consultant_preference",
	{ selected, slotCount = 1 }: { selected: boolean; slotCount?: number }
) {
	// Agendar exige lead `qualified` (appointment-service).
	await db
		.update(leads)
		.set({ status: "qualified" })
		.where(eq(leads.id, fx.leadId));
	const [consultant] = await db
		.select()
		.from(consultants)
		.where(eq(consultants.active, true))
		.limit(1);
	assert.ok(consultant);
	const [session] = await db
		.insert(schedulingSessions)
		.values({
			conversationId: fx.conversationId,
			expiresAt: new Date(Date.now() + 3_600_000),
			leadId: fx.leadId,
			status: "active",
			workflowStage,
		})
		.returning({ id: schedulingSessions.id });
	assert.ok(session);
	// Horário longe e aleatório: não colide com reuniões de outros testes.
	const base =
		Date.now() + 400 * DAY_MS + Math.floor(Math.random() * 500_000) * 60_000;
	const slotIds: string[] = [];
	for (let position = 1; position <= slotCount; position += 1) {
		const startAt = new Date(base + (position - 1) * 3_600_000);
		const [slot] = await db
			.insert(schedulingSlots)
			.values({
				calendarId: consultant.calendarId,
				consultantId: consultant.id,
				consultantName: consultant.name,
				endAt: new Date(startAt.getTime() + 1_800_000),
				position,
				schedulingSessionId: session.id,
				startAt,
			})
			.returning({ id: schedulingSlots.id });
		assert.ok(slot);
		slotIds.push(slot.id);
	}
	if (selected) {
		await db
			.update(schedulingSessions)
			.set({ selectedSlotId: slotIds[0] })
			.where(eq(schedulingSessions.id, session.id));
	}
	return { sessionId: session.id, slotId: slotIds[0] as string };
}

/** Toque de A como task pendente (evento + task), como o webhook grava. */
async function seedTapTaskInA(fx: Fixture, taskType: string, buttonId: string) {
	const externalId = `wamid.tap41_${crypto.randomUUID()}`;
	const [event] = await db
		.insert(whatsappWebhookEvents)
		.values({
			conversationId: fx.conversationId,
			eventType: "button_reply",
			externalId,
			payload: {},
			phone: fx.phone,
			status: "processing",
		})
		.returning({ id: whatsappWebhookEvents.id });
	assert.ok(event);
	const [task] = await db
		.insert(autonomousTasks)
		.values({
			availableAt: new Date(),
			conversationId: fx.conversationId,
			idempotencyKey: `tap41:${externalId}`,
			maxAttempts: 1,
			payload: { buttonId, eventExternalId: externalId, eventId: event.id },
			status: "pending",
			taskType,
		})
		.returning({ id: autonomousTasks.id });
	assert.ok(task);
	return { eventId: event.id, taskId: task.id };
}

/** Rotação real pelo webhook; devolve o id de B. */
async function rotateNow(app: ReturnType<typeof buildApp>, fx: Fixture) {
	await db
		.update(conversations)
		.set({
			lastCustomerMessageAt: new Date(
				Date.now() - SESSION_INACTIVITY_MS - 60_000
			),
		})
		.where(eq(conversations.id, fx.conversationId));
	await post(
		app,
		textWebhook(fx.phone, "oi de novo", `wamid.rot41_${crypto.randomUUID()}`)
	);
	const active = (await conversationsOf(fx.leadId)).filter(
		(c) => c.status === "active"
	);
	assert.equal(active.length, 1);
	const bId = active[0]?.id as string;
	assert.notEqual(bId, fx.conversationId, "rotation done");
	return bId;
}

/** Depois de `original`, a rotação commita; depois o handler segue. */
function rotateAfter<T extends object>(
	t: test.TestContext,
	target: T,
	method: keyof T & string,
	rotate: () => Promise<unknown>
) {
	const original = target[method] as unknown as (
		...args: unknown[]
	) => Promise<unknown>;
	t.mock.method(
		target,
		method as never,
		async function (this: unknown, ...args: unknown[]) {
			const result = await original.apply(this, args);
			await rotate();
			return result;
		} as never
	);
}

/** Calendar fake: a 1ª consulta (revalidação) diz ocupado; as outras, livre. */
function calendarBusyOnce(t: test.TestContext, busyFirst: boolean) {
	let calls = 0;
	t.mock.method(
		GoogleCalendarService.prototype,
		"getBusyPeriods",
		async (calendarIds: string[], timeMin: Date, timeMax: Date) => {
			calls += 1;
			return calendarIds.map((calendarId) => ({
				busy:
					busyFirst && calls === 1
						? [{ end: timeMax.toISOString(), start: timeMin.toISOString() }]
						: [],
				calendarId,
			}));
		}
	);
	t.mock.method(GoogleCalendarService.prototype, "createEvent", async () => ({
		id: `rot41-event-${crypto.randomUUID()}`,
	}));
	t.mock.method(
		GoogleCalendarService.prototype,
		"deleteEvent",
		async () => undefined
	);
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

async function assertBUntouched(bId: string) {
	assert.deepEqual(await outboxOf(bId), [], "no outbox in B");
	const assistantInB = await db
		.select({ id: messages.id })
		.from(messages)
		.where(
			and(eq(messages.conversationId, bId), eq(messages.role, "assistant"))
		);
	assert.deepEqual(assistantInB, [], "no assistant message in B");
}

test("Confirmar de A com o horário ocupado, depois da rotação: nenhuma reoferta em A", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	calendarBusyOnce(t, true);
	const fx = await createFixture(new Date(Date.now() - 60_000));
	try {
		const { slotId } = await seedSessionInA(fx, "awaiting_confirmation", {
			selected: true,
		});
		await seedTapTaskInA(fx, PROCESS_BUTTON_REPLY_TASK, `confirm:${slotId}`);
		let bId = "";
		// A rotação commita depois da busca de horários novos (fora da tx) e
		// antes da tx da reoferta. Antes disso a rotação zera `qualified` e a
		// busca recusa (a task falha, nada é enviado).
		rotateAfter(
			t,
			SchedulingAvailabilityService.prototype,
			"getAvailableSlots",
			async () => {
				bId = await rotateNow(app, fx);
			}
		);
		const sentA: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sentA),
		});

		const [tapTask] = await db
			.select({ result: autonomousTasks.result })
			.from(autonomousTasks)
			.where(
				and(
					eq(autonomousTasks.conversationId, fx.conversationId),
					eq(autonomousTasks.taskType, PROCESS_BUTTON_REPLY_TASK)
				)
			);
		assert.deepEqual(tapTask?.result, { action: "reoffer" }, "re-offer path");
		assert.deepEqual(await outboxOf(fx.conversationId), [], "no outbox from A");
		assert.deepEqual(sentA, [], "nothing sent from A");
		const sessionsInA = await db
			.select({ id: schedulingSessions.id })
			.from(schedulingSessions)
			.where(
				and(
					eq(schedulingSessions.conversationId, fx.conversationId),
					eq(schedulingSessions.status, "active")
				)
			);
		assert.deepEqual(sessionsInA, [], "no active session in A");
		await assertBUntouched(bId);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

for (const slotCount of [1, 2]) {
	test(`Não (cancel:) de A depois da rotação não responde (${slotCount} horário(s), rotação antes da task)`, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		mockGemini(t);
		const fx = await createFixture(new Date(Date.now() - 60_000));
		try {
			const { slotId } = await seedSessionInA(fx, "awaiting_confirmation", {
				selected: true,
				slotCount,
			});
			const bId = await rotateNow(app, fx);
			// Tarefa de A que só roda depois da rotação (workers parados).
			await seedTapTaskInA(fx, PROCESS_BUTTON_REPLY_TASK, `cancel:${slotId}`);
			const sentA: string[] = [];
			await drainConversationWork(fx.conversationId, {
				sender: fakeSender(sentA),
			});
			assert.deepEqual(
				await outboxOf(fx.conversationId),
				[],
				"no outbox from A"
			);
			assert.deepEqual(sentA, [], "nothing sent from A");
			await assertBUntouched(bId);
		} finally {
			await cleanup(fx.leadId, fx.phone);
		}
	});

	test(`Não (cancel:) de A com a rotação logo depois do cancelamento não responde (${slotCount} horário(s))`, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		mockGemini(t);
		const fx = await createFixture(new Date(Date.now() - 60_000));
		try {
			const { slotId } = await seedSessionInA(fx, "awaiting_confirmation", {
				selected: true,
				slotCount,
			});
			await seedTapTaskInA(fx, PROCESS_BUTTON_REPLY_TASK, `cancel:${slotId}`);
			let bId = "";
			rotateAfter(
				t,
				SchedulingCancellationService.prototype,
				"resolveCancellation",
				async () => {
					bId = await rotateNow(app, fx);
				}
			);
			const sentA: string[] = [];
			await drainConversationWork(fx.conversationId, {
				sender: fakeSender(sentA),
			});
			assert.deepEqual(
				await outboxOf(fx.conversationId),
				[],
				"no outbox from A"
			);
			assert.deepEqual(sentA, [], "nothing sent from A");
			await assertBUntouched(bId);
		} finally {
			await cleanup(fx.leadId, fx.phone);
		}
	});
}

test("toque de horário de A (process_button_reply) com a rotação logo depois da escolha não responde", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(new Date(Date.now() - 60_000));
	try {
		const { slotId } = await seedSessionInA(fx, "awaiting_slot_selection", {
			selected: false,
		});
		await seedTapTaskInA(fx, PROCESS_BUTTON_REPLY_TASK, slotId);
		let bId = "";
		rotateAfter(
			t,
			SchedulingChoiceService.prototype,
			"resolveChoice",
			async () => {
				bId = await rotateNow(app, fx);
			}
		);
		const sentA: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sentA),
		});
		assert.deepEqual(await outboxOf(fx.conversationId), [], "no outbox from A");
		assert.deepEqual(sentA, [], "nothing sent from A");
		await assertBUntouched(bId);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque pref:* legado de A com a rotação entre a leitura e o lock não responde", async () => {
	const fx = await createFixture(new Date(Date.now() - 60_000));
	let release: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let t0Done: Promise<unknown> = Promise.resolve();
	try {
		await seedSessionInA(fx, "awaiting_consultant_preference", {
			selected: false,
		});
		await seedTapTaskInA(fx, PROCESS_CONSULTANT_SELECTION_TASK, "pref:none");
		// T0 faz o que a rotação faz (lead primeiro; fecha A, expira as sessões
		// de A, abre B). O toque lê o status antes (A ainda ativa) e espera o
		// lead; T0 commita; só então o toque segue.
		let pidReady: (pid: number) => void = () => undefined;
		const pid = new Promise<number>((resolve) => {
			pidReady = resolve;
		});
		let lockedReady: () => void = () => undefined;
		const locked = new Promise<void>((resolve) => {
			lockedReady = resolve;
		});
		let bId = "";
		t0Done = db.transaction(async (tx) => {
			pidReady(await backendPid(tx));
			await tx
				.select({ id: leads.id })
				.from(leads)
				.where(eq(leads.id, fx.leadId))
				.for("update");
			lockedReady();
			await released;
			await tx
				.update(conversations)
				.set({ status: "closed", updatedAt: new Date() })
				.where(eq(conversations.id, fx.conversationId));
			await tx
				.update(schedulingSessions)
				.set({ status: "expired", updatedAt: new Date() })
				.where(eq(schedulingSessions.conversationId, fx.conversationId));
			const [b] = await tx
				.insert(conversations)
				.values({ lastCustomerMessageAt: new Date(), leadId: fx.leadId })
				.returning({ id: conversations.id });
			bId = b?.id ?? "";
		});
		const t0Pid = await pid;
		await Promise.race([locked, t0Done]);
		const sentA: string[] = [];
		const tap = drainConversationWork(fx.conversationId, {
			sender: fakeSender(sentA),
		});
		await waitForLockWait({ blockedBy: t0Pid });
		release();
		await t0Done;
		await tap;

		assert.ok(bId, "rotation done");
		assert.deepEqual(await outboxOf(fx.conversationId), [], "no outbox from A");
		assert.deepEqual(sentA, [], "nothing sent from A");
		await assertBUntouched(bId);
	} finally {
		release();
		await t0Done.catch(() => undefined);
		await cleanup(fx.leadId, fx.phone);
	}
});

test("D-R3-6: agendamento confirmado antes da rotação ainda avisa o cliente", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	calendarBusyOnce(t, false);
	const fx = await createFixture(new Date(Date.now() - 60_000));
	try {
		const { slotId } = await seedSessionInA(fx, "awaiting_confirmation", {
			selected: true,
		});
		await seedTapTaskInA(fx, PROCESS_BUTTON_REPLY_TASK, `confirm:${slotId}`);
		let bId = "";
		rotateAfter(
			t,
			SchedulingConfirmationOrchestrator.prototype,
			"execute",
			async () => {
				bId = await rotateNow(app, fx);
			}
		);
		const sentA: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sentA),
		});

		const outboxA = await outboxOf(fx.conversationId);
		assert.equal(outboxA.length, 1, "exactly one message from A");
		assert.match(
			(outboxA[0]?.payload as { text?: string } | undefined)?.text ?? "",
			BOOKING_CONFIRMED_TEXT
		);
		const booked = await db
			.select({ id: appointments.id })
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.equal(booked.length, 1, "appointment is real");
		await assertBUntouched(bId);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Tester V3-b'' (deviation 3): the legacy pref:* tap against the REAL rotation
// code (resolveConversationForInbound), not a hand-written copy of its writes.
// The tap task must already be claimed (processing) before the rotation: a
// pending task of A is completed by the rotation itself (supersededBy).
// T0 holds the lead, the tap blocks on it, then T0 runs the real rotation and
// commits. (A webhook-ordered variant is not deterministic: lead ingestion and
// the rotation are two transactions, so the tap can legitimately win in between.)
// ---------------------------------------------------------------------------

test("tester V3-b'': toque pref:* legado de A bloqueado no lead enquanto a rotação real roda não responde", async () => {
	const fx = await createFixture(
		new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000)
	);
	let release: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let t0Done: Promise<unknown> = Promise.resolve();
	try {
		await seedSessionInA(fx, "awaiting_consultant_preference", {
			selected: false,
		});
		const { taskId } = await seedTapTaskInA(
			fx,
			PROCESS_CONSULTANT_SELECTION_TASK,
			"pref:none"
		);
		let pidReady: (pid: number) => void = () => undefined;
		const pid = new Promise<number>((resolve) => {
			pidReady = resolve;
		});
		let lockedReady: () => void = () => undefined;
		const locked = new Promise<void>((resolve) => {
			lockedReady = resolve;
		});
		let bId = "";
		t0Done = db.transaction(async (tx) => {
			pidReady(await backendPid(tx));
			await tx
				.select({ id: leads.id })
				.from(leads)
				.where(eq(leads.id, fx.leadId))
				.for("update");
			lockedReady();
			await released;
			const r = await resolveConversationForInbound(tx, {
				leadId: fx.leadId,
				receivedAt: new Date(),
			});
			assert.equal(r.rotated, true, "real rotation ran");
			bId = r.conversation.id;
		});
		const t0Pid = await pid;
		await Promise.race([locked, t0Done]);
		const sentA: string[] = [];
		const tap = drainConversationWork(fx.conversationId, {
			sender: fakeSender(sentA),
		});
		await waitForLockWait({ blockedBy: t0Pid });
		release();
		await t0Done;
		await tap;

		assert.ok(bId, "rotation done");
		const [tapTask] = await db
			.select({ result: autonomousTasks.result })
			.from(autonomousTasks)
			.where(eq(autonomousTasks.id, taskId));
		assert.deepEqual(tapTask?.result, {
			reason: "conversation_not_active",
			skipped: true,
		});
		assert.deepEqual(await outboxOf(fx.conversationId), [], "no outbox from A");
		assert.deepEqual(sentA, [], "nothing sent from A");
		await assertBUntouched(bId);
	} finally {
		release();
		await t0Done.catch(() => undefined);
		await cleanup(fx.leadId, fx.phone);
	}
});

// Tester V3-b': the handler guard in sendModelFailureNotice on its own. The
// turn's status read (D-R3-5) still sees A active; the rotation commits while
// the notice waits on the lead. Trace stays `model_error` (ms window accepted
// by the plan), but nothing is sent from A.
test("tester V3-b': rotação real enquanto o aviso de falha espera o lead: o aviso de A não é enviado", async (t) => {
	let releaseGemini: () => void = () => undefined;
	const geminiGate = new Promise<void>((resolve) => {
		releaseGemini = resolve;
	});
	let signalStarted: () => void = () => undefined;
	const geminiStarted = new Promise<void>((resolve) => {
		signalStarted = resolve;
	});
	t.mock.method(ai.models, "generateContent", async () => {
		signalStarted();
		await geminiGate;
		return { text: "" };
	});
	const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 60_000);
	const fx = await createFixture(lastAt);
	let release: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let t0Done: Promise<unknown> = Promise.resolve();
	try {
		const seeded = await seedPendingInboundInA(fx, lastAt, "é para carro");
		const sentA: string[] = [];
		const turnA = drainConversationWork(fx.conversationId, {
			sender: fakeSender(sentA),
		});
		await geminiStarted;
		let pidReady: (pid: number) => void = () => undefined;
		const pid = new Promise<number>((resolve) => {
			pidReady = resolve;
		});
		let lockedReady: () => void = () => undefined;
		const locked = new Promise<void>((resolve) => {
			lockedReady = resolve;
		});
		let bId = "";
		t0Done = db.transaction(async (tx) => {
			pidReady(await backendPid(tx));
			await tx
				.select({ id: leads.id })
				.from(leads)
				.where(eq(leads.id, fx.leadId))
				.for("update");
			lockedReady();
			await released;
			const r = await resolveConversationForInbound(tx, {
				leadId: fx.leadId,
				receivedAt: new Date(),
			});
			assert.equal(r.rotated, true, "real rotation ran");
			bId = r.conversation.id;
		});
		const t0Pid = await pid;
		await Promise.race([locked, t0Done]);
		releaseGemini();
		await waitForLockWait({ blockedBy: t0Pid });
		release();
		await t0Done;
		await turnA;

		assert.ok(bId, "rotation done");
		const [taskA] = await db
			.select({ result: autonomousTasks.result })
			.from(autonomousTasks)
			.where(eq(autonomousTasks.id, seeded.taskId));
		assert.deepEqual(taskA?.result, {
			reason: "conversation_not_active",
			skipped: true,
		});
		assert.deepEqual(await outboxOf(fx.conversationId), [], "no outbox from A");
		assert.deepEqual(sentA, [], "nothing sent from A");
		const noticeRows = await db
			.select({ id: messages.id })
			.from(messages)
			.where(
				and(
					eq(messages.conversationId, fx.conversationId),
					eq(messages.role, "assistant")
				)
			);
		assert.deepEqual(noticeRows, [], "no notice row in A");
		await assertBUntouched(bId);
	} finally {
		releaseGemini();
		release();
		await t0Done.catch(() => undefined);
		await cleanup(fx.leadId, fx.phone);
	}
});

// Tester V3-b': success paths in an ACTIVE conversation are unaffected by the
// step 40/41 re-checks (handler path, with expectedConversationId).
test("tester V3-b': turno em A ativa sem rotação: rastro `replied` e exatamente uma resposta", async (t) => {
	mockGemini(t);
	const lastAt = new Date(Date.now() - 60_000);
	const fx = await createFixture(lastAt);
	const traces: string[] = [];
	const originalInfo = console.info;
	console.info = (...args: unknown[]) => {
		if (typeof args[0] === "string" && args[0].includes(MARIANA_TURN_EVENT)) {
			traces.push(args[0]);
			return;
		}
		originalInfo(...(args as []));
	};
	try {
		const seeded = await seedPendingInboundInA(fx, lastAt, "oi");
		const sentA: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sentA),
		});
		console.info = originalInfo;
		assert.deepEqual(
			traces
				.map((line) => JSON.parse(line))
				.filter((trace) => trace.turnId === seeded.taskId)
				.map((trace) => trace.outcome),
			["replied"]
		);
		assert.equal((await outboxOf(fx.conversationId)).length, 1);
		assert.equal(sentA.length, 1);
	} finally {
		console.info = originalInfo;
		await cleanup(fx.leadId, fx.phone);
	}
});

for (const kind of ["choice", "cancel"] as const) {
	test(`tester V3-b'': botão em A ativa sem rotação (${kind}) responde exatamente uma vez`, async (t) => {
		mockGemini(t);
		calendarBusyOnce(t, false);
		const fx = await createFixture(new Date(Date.now() - 60_000));
		try {
			const { slotId } = await seedSessionInA(
				fx,
				kind === "choice" ? "awaiting_slot_selection" : "awaiting_confirmation",
				{ selected: kind === "cancel", slotCount: 2 }
			);
			await seedTapTaskInA(
				fx,
				PROCESS_BUTTON_REPLY_TASK,
				kind === "choice" ? slotId : `cancel:${slotId}`
			);
			const sentA: string[] = [];
			await drainConversationWork(fx.conversationId, {
				sender: fakeSender(sentA),
			});
			const outboxA = await outboxOf(fx.conversationId);
			assert.equal(outboxA.length, 1, "exactly one reply in A");
			assert.ok(outboxA[0]?.idempotencyKey.startsWith("button-reply:"));
			assert.equal(sentA.length, 1);
		} finally {
			await cleanup(fx.leadId, fx.phone);
		}
	});
}
