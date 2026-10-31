/** biome-ignore-all lint/suspicious/useAwait: mocks assíncronos */
/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/**
 * Rev1 steps 20–21 — rotação automática de conversa após 4h (R-SES-02 v1.3).
 *
 * Critérios K-1 a K-8 do plano `2026-10-26-flow-review` (Rev1):
 *   - texto após 4h fecha A, abre B e responde uma vez, sem pergunta (S-18);
 *   - duas mensagens simultâneas criam uma única B e uma resposta (K-6, S-21);
 *   - entrega repetida é idempotente (K-5, R-REL-02);
 *   - B não herda estado comercial; opt-out copiado; A fechada; snapshot (K-3, K-7, K-8);
 *   - status do lead pela data da reunião (K-2, S-19a/b, D-1, E7).
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
import { webhookWhatsApp } from "../../routes/whatsapp/webhook-whatsapp";
import { AppointmentService } from "../../services/calendar/appointment-service";
import { PROCESS_INBOUND_MESSAGE_TASK } from "../../services/conversations/autonomous-task-handlers";
import { SESSION_INACTIVITY_MS } from "../../services/conversations/session-choice-policy";
import { resolveConversationForInbound } from "../../services/conversations/session-rotation";
import {
	STALE_TAP_NO_SCHEDULING,
	STALE_TAP_NOTICE,
} from "../../services/conversations/stale-tap-reply";
import type { OutboundSender } from "../../services/messaging/outbound-messages";
import { drainConversationWork } from "../../services/reliability/background-workers";
import { backendPid, sqlStateOf, waitForLockWait } from "../support/lock-wait";

const SCHEDULED_TEXT_PATTERN = /agendad/i;
const STAGE_PATTERN = /Etapa atual: (\w+)/;
const SESSION_BUTTON_PATTERN = /sessao:/;
const STALE_CONFIRM_BODY =
	/^Esse botão é de uma mensagem antiga\.\nVocê escolheu .+\. Posso confirmar\?$/;

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

function computeSignature(payload: string): string {
	return (
		"sha256=" +
		crypto
			.createHmac("sha256", env.WHATSAPP_APP_SECRET)
			.update(payload)
			.digest("hex")
	);
}

function textWebhook(phone: string, body: string, externalId: string): string {
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
									id: externalId,
									text: { body },
									timestamp: String(Math.floor(Date.now() / 1000)),
									type: "text",
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

async function post(app: ReturnType<typeof buildApp>, payload: string) {
	const res = await app.inject({
		headers: {
			"content-type": "application/json",
			"x-hub-signature-256": computeSignature(payload),
		},
		method: "POST",
		payload,
		url: "/webhooks/whatsapp",
	});
	assert.equal(res.statusCode, 200);
	return res;
}

/** Gemini stub: segue a etapa do prompt como o modelo faria. */
function mockGemini(t: test.TestContext, stages: string[] = []) {
	t.mock.method(ai.models, "generateContent", async (args: unknown) => {
		const stage = STAGE_PATTERN.exec(JSON.stringify(args))?.[1] ?? "unknown";
		stages.push(stage);
		const confirming = stage === "confirmation";
		return {
			text: JSON.stringify({
				businessAction: "ask_next_qualification_question",
				evidenceUsed: [],
				leadUpdate: { status: confirming ? "scheduled" : "qualifying" },
				nextAction: "continue_qualification",
				reply: confirming
					? "Sua reunião já está agendada, até lá!"
					: "Oi! Me conta o que você procura no consórcio?",
			}),
		};
	});
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

/** Lead com conversa A cujo último contato do cliente foi há `gapMs`. */
async function createFixture(gapMs = SESSION_INACTIVITY_MS + 60_000) {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const phone = `551193${suffix.slice(-9)}`;
	const [lead] = await db
		.insert(leads)
		.values({ name: `Lead Rotation ${suffix}`, phone })
		.returning({ id: leads.id });
	assert.ok(lead);

	const lastAt = new Date(Date.now() - gapMs);
	const [conversation] = await db
		.insert(conversations)
		.values({ lastCustomerMessageAt: lastAt, leadId: lead.id })
		.returning({ id: conversations.id });
	assert.ok(conversation);

	await db.insert(messages).values([
		{
			content: "quero consórcio de carro",
			conversationId: conversation.id,
			createdAt: lastAt,
			externalId: `wamid.old_${suffix}`,
			processedAt: lastAt,
			role: "user",
		},
		{
			content: "Legal! Qual valor de carta você imagina?",
			conversationId: conversation.id,
			createdAt: new Date(lastAt.getTime() + 1000),
			role: "assistant",
		},
	]);

	const [consultant] = await db
		.select({ id: consultants.id })
		.from(consultants)
		.where(eq(consultants.active, true))
		.limit(1);
	assert.ok(consultant);

	return {
		consultantId: consultant.id,
		conversationId: conversation.id,
		leadId: lead.id,
		phone,
		suffix,
	};
}

async function cleanup(leadId: string, phone: string) {
	await db
		.delete(whatsappWebhookEvents)
		.where(eq(whatsappWebhookEvents.phone, phone));
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

async function activeConversationOf(leadId: string) {
	const active = (await conversationsOf(leadId)).filter(
		(c) => c.status === "active"
	);
	assert.equal(active.length, 1, "exactly one active conversation");
	return active[0] as (typeof active)[number];
}

async function inboundTasksOf(conversationId: string) {
	return await db
		.select()
		.from(autonomousTasks)
		.where(
			and(
				eq(autonomousTasks.conversationId, conversationId),
				eq(autonomousTasks.taskType, PROCESS_INBOUND_MESSAGE_TASK)
			)
		);
}

async function outboundOf(conversationIds: string[]) {
	return await db
		.select()
		.from(outboundMessages)
		.where(inArray(outboundMessages.conversationId, conversationIds));
}

async function sessionTasksOf(conversationIds: string[]) {
	return await db
		.select()
		.from(autonomousTasks)
		.where(
			and(
				inArray(autonomousTasks.conversationId, conversationIds),
				inArray(autonomousTasks.taskType, [
					"ask_session_choice",
					"remind_session_choice",
					"process_session_choice",
				])
			)
		);
}

test("texto após 4h fecha A, abre B e responde uma vez, sem pergunta", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture();

	try {
		const externalId = `wamid.rot_${fx.suffix}`;
		await post(app, textWebhook(fx.phone, "é para carro", externalId));

		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId);
		const [a] = (await conversationsOf(fx.leadId)).filter(
			(c) => c.id === fx.conversationId
		);
		assert.equal(a?.status, "closed");

		const [inbound] = await db
			.select()
			.from(messages)
			.where(eq(messages.externalId, externalId));
		assert.equal(inbound?.conversationId, b.id);
		assert.equal(b.lastCustomerMessageAt?.getTime() !== undefined, true);

		const tasks = await inboundTasksOf(b.id);
		assert.equal(tasks.length, 1);
		assert.equal(tasks[0]?.idempotencyKey, `inbound:${externalId}`);
		assert.deepEqual(
			await sessionTasksOf([fx.conversationId, b.id]),
			[],
			"no session-choice task"
		);

		const sent: string[] = [];
		await drainConversationWork(b.id, { sender: fakeSender(sent) });

		const outbound = await outboundOf([fx.conversationId, b.id]);
		assert.equal(outbound.length, 1, "exactly one reply");
		assert.equal(outbound[0]?.conversationId, b.id);
		for (const row of outbound) {
			assert.doesNotMatch(JSON.stringify(row.payload), SESSION_BUTTON_PATTERN);
		}
		assert.equal(sent.length, 1);
		assert.ok(sent[0]?.startsWith("text:"));
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("duas mensagens simultâneas após 4h criam uma única conversa nova e uma resposta", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture();

	try {
		const id1 = `wamid.par1_${fx.suffix}`;
		const id2 = `wamid.par2_${fx.suffix}`;
		await Promise.all([
			post(app, textWebhook(fx.phone, "oi, voltei", id1)),
			post(app, textWebhook(fx.phone, "quero ver imóvel", id2)),
		]);

		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 2, "A and a single B");
		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId);

		const inbound = await db
			.select({ conversationId: messages.conversationId })
			.from(messages)
			.where(inArray(messages.externalId, [id1, id2]));
		assert.equal(inbound.length, 2);
		for (const row of inbound) {
			assert.equal(row.conversationId, b.id);
		}
		assert.deepEqual(await sessionTasksOf([fx.conversationId, b.id]), []);

		const sent: string[] = [];
		await drainConversationWork(b.id, { sender: fakeSender(sent) });

		const outbound = await outboundOf([fx.conversationId, b.id]);
		assert.equal(outbound.length, 1, "one reply for both messages");
		assert.equal(sent.length, 1);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("a mesma entrega repetida após 4h não cria outra conversa nem outra resposta", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture();

	try {
		const externalId = `wamid.redeliver_${fx.suffix}`;
		const payload = textWebhook(fx.phone, "é para carro", externalId);
		await post(app, payload);
		// Meta repete a mesma entrega.
		await post(app, payload);
		// Reentrega depois de uma falha registrada no evento (caminho de reclaim).
		await db
			.update(whatsappWebhookEvents)
			.set({ status: "failed" })
			.where(eq(whatsappWebhookEvents.externalId, externalId));
		await post(app, payload);

		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 2, "A and a single B");
		const b = await activeConversationOf(fx.leadId);

		const inbound = await db
			.select()
			.from(messages)
			.where(eq(messages.externalId, externalId));
		assert.equal(inbound.length, 1);
		assert.equal(inbound[0]?.conversationId, b.id);
		assert.equal((await inboundTasksOf(b.id)).length, 1);

		const sent: string[] = [];
		await drainConversationWork(b.id, { sender: fakeSender(sent) });
		assert.equal((await outboundOf([fx.conversationId, b.id])).length, 1);
		assert.equal(sent.length, 1);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// F-V1b-1 (Rev2 step 26, D-R2-1 a): X já foi gravada em A; uma mensagem
// mais nova rotacionou para B e foi respondida. A reentrega de X não toca B.
test("reentrega de mensagem já gravada numa conversa fechada não cria conversa nem resposta", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture();

	try {
		const lateId = `wamid.late_closed_${fx.suffix}`;
		const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 30_000);
		const [msg] = await db
			.insert(messages)
			.values({
				content: "é para carro",
				conversationId: fx.conversationId,
				createdAt: lastAt,
				externalId: lateId,
				role: "user",
			})
			.returning({ id: messages.id });
		assert.ok(msg);
		const [event] = await db
			.insert(whatsappWebhookEvents)
			.values({
				conversationId: fx.conversationId,
				eventType: "text",
				externalId: lateId,
				leaseExpiresAt: new Date(lastAt.getTime() + 60_000),
				payload: {},
				phone: fx.phone,
				status: "processing",
			})
			.returning({ id: whatsappWebhookEvents.id });
		assert.ok(event);
		await db.insert(autonomousTasks).values({
			availableAt: lastAt,
			conversationId: fx.conversationId,
			idempotencyKey: `inbound:${lateId}`,
			payload: { eventExternalId: lateId, eventId: event.id, kind: "text" },
			taskType: PROCESS_INBOUND_MESSAGE_TASK,
			triggerMessageId: msg.id,
		});

		// Mensagem mais nova rotaciona para B e é respondida.
		await post(app, textWebhook(fx.phone, "oi", `wamid.newer_${fx.suffix}`));
		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId);
		const sent: string[] = [];
		await drainConversationWork(b.id, { sender: fakeSender(sent) });
		assert.equal(sent.length, 1);

		const [bBefore] = await db
			.select()
			.from(conversations)
			.where(eq(conversations.id, b.id));
		const bMessagesBefore = await db
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.conversationId, b.id));
		const bTasksBefore = await tasksOf([b.id]);

		await post(app, textWebhook(fx.phone, "é para carro", lateId));
		await drainConversationWork(b.id, { sender: fakeSender(sent) });
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});

		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 2, "A and B only");
		const [bAfter] = await db
			.select()
			.from(conversations)
			.where(eq(conversations.id, b.id));
		assert.equal(bAfter?.status, "active");
		assert.equal(
			bAfter?.lastCustomerMessageAt?.getTime(),
			bBefore?.lastCustomerMessageAt?.getTime(),
			"B lastCustomerMessageAt not bumped"
		);
		const bMessagesAfter = await db
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.conversationId, b.id));
		assert.equal(bMessagesAfter.length, bMessagesBefore.length);
		assert.equal((await tasksOf([b.id])).length, bTasksBefore.length);
		const [lateMsg] = await db
			.select({ conversationId: messages.conversationId })
			.from(messages)
			.where(eq(messages.externalId, lateId));
		assert.equal(lateMsg?.conversationId, fx.conversationId, "X stays in A");
		assert.equal(sent.length, 1, "no new reply");
		assert.equal((await outboundOf([fx.conversationId, b.id])).length, 1);
		const [eventAfter] = await db
			.select({ status: whatsappWebhookEvents.status })
			.from(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.id, event.id));
		assert.equal(eventAfter?.status, "processed");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("rotação não herda estado comercial", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture();

	try {
		const qualifiedAt = new Date(Date.now() - 6 * 3_600_000);
		const optOutAt = new Date(Date.now() - 5 * 3_600_000);
		await db
			.update(leads)
			.set({
				commercialApproach: "vehicle_renewal",
				consortiumType: "auto",
				currentSituation: "aluguel",
				interestedInConsultant: true,
				objective: "comprar carro",
				painPoint: "juros",
				qualifiedAt,
				status: "qualifying",
				urgency: "immediate",
			})
			.where(eq(leads.id, fx.leadId));
		await db
			.update(conversations)
			.set({ optOutAt })
			.where(eq(conversations.id, fx.conversationId));
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
		const [staleTask] = await db
			.insert(autonomousTasks)
			.values({
				availableAt: new Date(Date.now() + 3_600_000),
				conversationId: fx.conversationId,
				idempotencyKey: `stale-a:${fx.suffix}`,
				payload: { kind: "button_reply" },
				taskType: "process_button_reply",
			})
			.returning({ id: autonomousTasks.id });
		assert.ok(staleTask);

		const externalId = `wamid.reset_${fx.suffix}`;
		await post(app, textWebhook(fx.phone, "oi de novo", externalId));

		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId);

		// K-3: 8 campos comerciais + qualifiedAt resetados.
		const [lead] = await db.select().from(leads).where(eq(leads.id, fx.leadId));
		assert.ok(lead);
		assert.equal(lead.commercialApproach, null);
		assert.equal(lead.consortiumType, null);
		assert.equal(lead.currentSituation, null);
		assert.equal(lead.interestedInConsultant, false);
		assert.equal(lead.objective, null);
		assert.equal(lead.painPoint, null);
		assert.equal(lead.urgency, null);
		assert.equal(lead.qualifiedAt, null);

		const [sessionAfter] = await db
			.select({ status: schedulingSessions.status })
			.from(schedulingSessions)
			.where(eq(schedulingSessions.id, session.id));
		assert.equal(sessionAfter?.status, "expired");

		const [taskAfter] = await db
			.select()
			.from(autonomousTasks)
			.where(eq(autonomousTasks.id, staleTask.id));
		assert.equal(taskAfter?.status, "completed");
		assert.deepEqual(taskAfter?.result, { supersededBy: "session_rotation" });

		// B começa sem histórico: só a mensagem nova.
		const bMessages = await db
			.select({ externalId: messages.externalId })
			.from(messages)
			.where(eq(messages.conversationId, b.id));
		assert.deepEqual(bMessages, [{ externalId }]);

		// K-7: opt-out de A copiado para B.
		assert.equal(b.optOutAt?.getTime(), optOutAt.getTime());

		// K-8: A fechada, nada apagado, snapshot gravado.
		const [a] = (await conversationsOf(fx.leadId)).filter(
			(c) => c.id === fx.conversationId
		);
		assert.equal(a?.status, "closed");
		const aMessages = await db
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.conversationId, fx.conversationId));
		assert.equal(aMessages.length, 2);
		const [snapshotRow] = await db
			.select()
			.from(autonomousTasks)
			.where(
				eq(
					autonomousTasks.idempotencyKey,
					`session-rotation:${fx.conversationId}`
				)
			);
		assert.ok(snapshotRow, "snapshot row stored");
		assert.equal(snapshotRow.status, "completed");
		assert.equal(snapshotRow.conversationId, fx.conversationId);
		const { snapshot } = snapshotRow.payload as {
			snapshot?: Record<string, unknown>;
		};
		assert.ok(snapshot);
		assert.equal(snapshot.objective, "comprar carro");
		assert.equal(snapshot.interestedInConsultant, true);
		assert.equal(snapshot.status, "qualifying");
		assert.equal(snapshot.qualifiedAt, qualifiedAt.toISOString());
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("texto de opt-out após 4h rotaciona e grava optOutAt em B (E6)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture();

	try {
		await post(app, textWebhook(fx.phone, "pare", `wamid.optout_${fx.suffix}`));

		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId);
		assert.ok(b.optOutAt, "optOutAt written on B");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("S-19a na rotação: reunião passada volta a new, não diz 'agendado'", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const stages: string[] = [];
	mockGemini(t, stages);
	const fx = await createFixture();

	try {
		await db
			.update(leads)
			.set({ qualifiedAt: new Date(), status: "scheduled" })
			.where(eq(leads.id, fx.leadId));
		await db.insert(appointments).values({
			consultantId: fx.consultantId,
			endAt: new Date(Date.now() - 1_800_000),
			externalEventId: `evt-rot-s19a-${fx.suffix}`,
			leadId: fx.leadId,
			startAt: new Date(Date.now() - 3_600_000),
			status: "confirmed",
		});

		await post(
			app,
			textWebhook(
				fx.phone,
				"oi, quero saber de consórcio",
				`wamid.s19a_${fx.suffix}`
			)
		);
		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId);

		// D-1: logo após a rotação, antes do turno.
		const [lead] = await db
			.select({ qualifiedAt: leads.qualifiedAt, status: leads.status })
			.from(leads)
			.where(eq(leads.id, fx.leadId));
		assert.equal(lead?.status, "new");
		assert.equal(lead?.qualifiedAt, null);

		const sent: string[] = [];
		await drainConversationWork(b.id, { sender: fakeSender(sent) });

		assert.ok(stages.length > 0);
		assert.ok(
			stages.every((s) => ["greeting", "reason"].includes(s)),
			`stage inesperado: ${stages.join(",")}`
		);
		const [leadAfter] = await db
			.select({ status: leads.status })
			.from(leads)
			.where(eq(leads.id, fx.leadId));
		assert.notEqual(leadAfter?.status, "scheduled");
		assert.equal(sent.length, 1);
		for (const text of sent) {
			assert.doesNotMatch(text, SCHEDULED_TEXT_PATTERN);
		}
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("S-19b na rotação: reunião futura mantém scheduled", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture();

	try {
		await db
			.update(leads)
			.set({ status: "scheduled" })
			.where(eq(leads.id, fx.leadId));
		await db.insert(appointments).values({
			consultantId: fx.consultantId,
			endAt: new Date(Date.now() + 9_000_000),
			externalEventId: `evt-rot-s19b-${fx.suffix}`,
			leadId: fx.leadId,
			startAt: new Date(Date.now() + 7_200_000),
			status: "confirmed",
		});

		await post(app, textWebhook(fx.phone, "oi", `wamid.s19b_${fx.suffix}`));

		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId);
		const [lead] = await db
			.select({ status: leads.status })
			.from(leads)
			.where(eq(leads.id, fx.leadId));
		assert.equal(lead?.status, "scheduled");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("4h − 1 ms continua na mesma conversa sem rotação", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const externalId = `wamid.under_${fx.suffix}`;
		await post(app, textWebhook(fx.phone, "seguindo", externalId));

		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 1);
		assert.equal(all[0]?.id, fx.conversationId);
		assert.equal(all[0]?.status, "active");
		assert.equal((await inboundTasksOf(fx.conversationId)).length, 1);
		const [snapshotRow] = await db
			.select({ id: autonomousTasks.id })
			.from(autonomousTasks)
			.where(
				eq(
					autonomousTasks.idempotencyKey,
					`session-rotation:${fx.conversationId}`
				)
			);
		assert.equal(snapshotRow, undefined);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("segunda transação espera o lock do lead e entra na B da primeira (K-1, K-6)", async () => {
	const fx = await createFixture();

	try {
		let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let firstReady: (
			value: Awaited<ReturnType<typeof resolveConversationForInbound>>
		) => void = () => undefined;
		const firstResolved = new Promise<
			Awaited<ReturnType<typeof resolveConversationForInbound>>
		>((resolve) => {
			firstReady = resolve;
		});

		const receivedAt = new Date();
		const first = db.transaction(async (tx) => {
			const result = await resolveConversationForInbound(tx, {
				leadId: fx.leadId,
				receivedAt,
			});
			await tx
				.update(conversations)
				.set({ lastCustomerMessageAt: receivedAt })
				.where(eq(conversations.id, result.conversation.id));
			firstReady(result);
			await firstGate;
			return result;
		});

		const r1 = await firstResolved;
		let secondDone = false;
		const second = db
			.transaction((tx) =>
				resolveConversationForInbound(tx, {
					leadId: fx.leadId,
					receivedAt: new Date(),
				})
			)
			.then((result) => {
				secondDone = true;
				return result;
			});

		await new Promise((resolve) => setTimeout(resolve, 200));
		assert.equal(secondDone, false, "second waits for the lead lock");
		releaseFirst();
		await first;
		const r2 = await second;

		assert.equal(r1.rotated, true);
		assert.equal(r1.previousConversationId, fx.conversationId);
		assert.equal(r2.rotated, false, "second sees B, no second rotation");
		assert.equal(r2.conversation.id, r1.conversation.id);
		assert.equal((await conversationsOf(fx.leadId)).length, 2);
		await activeConversationOf(fx.leadId);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

for (const status of ["qualified", "qualifying"] as const) {
	test(`lead ${status} sem reunião futura volta a new na rotação (E7, N-1)`, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		mockGemini(t);
		const fx = await createFixture();

		try {
			await db
				.update(leads)
				.set({ qualifiedAt: new Date(), status })
				.where(eq(leads.id, fx.leadId));
			// Reunião passada não conta (K-2).
			await db.insert(appointments).values({
				consultantId: fx.consultantId,
				endAt: new Date(Date.now() - 1_800_000),
				externalEventId: `evt-rot-n1-${status}-${fx.suffix}`,
				leadId: fx.leadId,
				startAt: new Date(Date.now() - 3_600_000),
				status: "confirmed",
			});

			await post(
				app,
				textWebhook(fx.phone, "oi", `wamid.n1_${status}_${fx.suffix}`)
			);

			const b = await activeConversationOf(fx.leadId);
			assert.notEqual(b.id, fx.conversationId);
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
}

test("lead com reunião futura continua scheduled na rotação (regressão E7)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture();

	try {
		await db
			.update(leads)
			.set({ qualifiedAt: new Date(), status: "qualified" })
			.where(eq(leads.id, fx.leadId));
		await db.insert(appointments).values({
			consultantId: fx.consultantId,
			endAt: new Date(Date.now() + 9_000_000),
			externalEventId: `evt-rot-e7-future-${fx.suffix}`,
			leadId: fx.leadId,
			startAt: new Date(Date.now() + 7_200_000),
			status: "scheduled",
		});

		await post(app, textWebhook(fx.phone, "oi", `wamid.e7f_${fx.suffix}`));

		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId);
		const [lead] = await db
			.select({ status: leads.status })
			.from(leads)
			.where(eq(leads.id, fx.leadId));
		assert.equal(lead?.status, "scheduled");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Step 22 — toque após 4h (E1-a, S-20 v1.3)
// ---------------------------------------------------------------------------

const E1_TAP_REPLY_TEXT =
	"Oi! Já faz um tempo desde a nossa última conversa, então aqueles horários não valem mais. Me conta o que você procura agora?";

function tapWebhook(phone: string, buttonId: string, externalId: string) {
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
									id: externalId,
									interactive: {
										button_reply: { id: buttonId, title: "Horário" },
										type: "button_reply",
									},
									timestamp: String(Math.floor(Date.now() / 1000)),
									type: "interactive",
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

/** Sessão de agendamento ativa em A com um horário ofertado. */
async function offerSlotInA(fx: Awaited<ReturnType<typeof createFixture>>) {
	const [consultant] = await db
		.select()
		.from(consultants)
		.where(eq(consultants.id, fx.consultantId));
	assert.ok(consultant);
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
	const startAt = new Date(Date.now() + 24 * 3_600_000);
	const [slot] = await db
		.insert(schedulingSlots)
		.values({
			calendarId: consultant.calendarId,
			consultantId: consultant.id,
			consultantName: consultant.name,
			endAt: new Date(startAt.getTime() + 1_800_000),
			position: 1,
			schedulingSessionId: session.id,
			startAt,
		})
		.returning({ id: schedulingSlots.id });
	assert.ok(slot);
	return { sessionId: session.id, slotId: slot.id };
}

async function tasksOf(conversationIds: string[]) {
	return await db
		.select()
		.from(autonomousTasks)
		.where(inArray(autonomousTasks.conversationId, conversationIds));
}

function mockGeminiForbidden(t: test.TestContext) {
	return t.mock.method(ai.models, "generateContent", async () => {
		throw new Error("toque após 4h não pode chamar a IA");
	});
}

test("toque de horário antigo após 4h abre conversa nova, não agenda e responde uma vez (S-20 v1.3, E1-a)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const generateContent = mockGeminiForbidden(t);
	const fx = await createFixture();

	try {
		const { sessionId, slotId } = await offerSlotInA(fx);
		const externalId = `wamid.oldtap_${fx.suffix}`;
		await post(app, tapWebhook(fx.phone, slotId, externalId));

		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId, "tap after 4h rotates");
		const [a] = (await conversationsOf(fx.leadId)).filter(
			(c) => c.id === fx.conversationId
		);
		assert.equal(a?.status, "closed");
		assert.ok(b.lastCustomerMessageAt, "B records the tap time");

		const [event] = await db
			.select()
			.from(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.externalId, externalId));
		assert.equal(event?.status, "processed");
		assert.equal(event?.conversationId, b.id);

		// O toque não é roteado: nenhuma task de agendamento, em A ou B.
		const routed = (await tasksOf([fx.conversationId, b.id])).filter(
			(task) =>
				task.status === "pending" &&
				task.taskType !== "session_rotation_snapshot"
		);
		assert.deepEqual(
			routed.map((task) => task.taskType),
			[],
			"no task routes the old tap"
		);

		// F2-16: linha do assistente e outbox gravadas juntas, em B.
		const outbound = await outboundOf([fx.conversationId, b.id]);
		assert.equal(outbound.length, 1, "exactly one reply");
		assert.equal(outbound[0]?.conversationId, b.id);
		assert.equal(
			outbound[0]?.idempotencyKey,
			`session-rotation-tap:${externalId}`
		);
		assert.deepEqual(outbound[0]?.payload, {
			kind: "text",
			text: E1_TAP_REPLY_TEXT,
		});
		const assistantRows = await db
			.select()
			.from(messages)
			.where(
				and(eq(messages.conversationId, b.id), eq(messages.role, "assistant"))
			);
		assert.equal(assistantRows.length, 1);
		assert.equal(assistantRows[0]?.content, E1_TAP_REPLY_TEXT);
		assert.equal(outbound[0]?.messageId, assistantRows[0]?.id);

		const sent: string[] = [];
		await drainConversationWork(b.id, { sender: fakeSender(sent) });
		assert.deepEqual(sent, [`text:${E1_TAP_REPLY_TEXT}`]);
		assert.equal(generateContent.mock.callCount(), 0, "no AI turn");

		// Nada foi agendado nem selecionado.
		const appts = await db
			.select({ id: appointments.id })
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.equal(appts.length, 0);
		const [session] = await db
			.select()
			.from(schedulingSessions)
			.where(eq(schedulingSessions.id, sessionId));
		assert.equal(session?.status, "expired");
		assert.equal(session?.selectedSlotId, null);
		assert.equal(session?.workflowStage, "awaiting_slot_selection");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque repetido pelo Meta após 4h responde uma vez (R-REL-02)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture();

	try {
		const { slotId } = await offerSlotInA(fx);
		const externalId = `wamid.oldtapdup_${fx.suffix}`;
		const payload = tapWebhook(fx.phone, slotId, externalId);
		await post(app, payload);
		await post(app, payload);
		// Reentrega pelo caminho de reclaim: B já tem o toque, sem intervalo.
		await db
			.update(whatsappWebhookEvents)
			.set({ status: "failed" })
			.where(eq(whatsappWebhookEvents.externalId, externalId));
		await post(app, payload);

		assert.equal((await conversationsOf(fx.leadId)).length, 2, "A and one B");
		const b = await activeConversationOf(fx.leadId);
		const outbound = await outboundOf([fx.conversationId, b.id]);
		assert.equal(outbound.length, 1, "one reply");
		const assistantRows = await db
			.select({ id: messages.id })
			.from(messages)
			.where(
				and(eq(messages.conversationId, b.id), eq(messages.role, "assistant"))
			);
		assert.equal(assistantRows.length, 1);
		const routed = (await tasksOf([fx.conversationId, b.id])).filter(
			(task) => task.status === "pending"
		);
		assert.deepEqual(
			routed.map((task) => task.idempotencyKey),
			[],
			"redelivery never routes the old tap"
		);

		const sent: string[] = [];
		await drainConversationWork(b.id, { sender: fakeSender(sent) });
		assert.equal(sent.length, 1);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque com menos de 4h segue o fluxo de agendamento (regressão)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const { slotId } = await offerSlotInA(fx);
		const externalId = `wamid.freshtap_${fx.suffix}`;
		await post(app, tapWebhook(fx.phone, slotId, externalId));

		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 1, "no rotation");
		assert.equal(all[0]?.status, "active");
		const tasks = (await tasksOf([fx.conversationId])).filter(
			(task) => task.idempotencyKey === `button-reply:${externalId}`
		);
		assert.equal(tasks.length, 1);
		assert.equal(tasks[0]?.taskType, "send_confirmation_request");
		assert.equal((await outboundOf([fx.conversationId])).length, 0);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Step 23 — escolha de sessão removida; linhas legadas (E3-a)
// ---------------------------------------------------------------------------

/** Linha `session_choice_state` pendente gravada antes do deploy (E3). */
async function insertLegacyPendingChoice(
	fx: Awaited<ReturnType<typeof createFixture>>
) {
	await db.insert(autonomousTasks).values({
		conversationId: fx.conversationId,
		idempotencyKey: `session-choice-state:${fx.conversationId}`,
		payload: {
			askedAt: new Date(Date.now() - 60_000).toISOString(),
			kind: "session_choice",
			leadId: fx.leadId,
			previousConversationId: fx.conversationId,
			state: "pending",
		},
		status: "completed",
		taskType: "session_choice_state",
	});
}

// Porta o S-20 do tester ("continuar" digitado) e o `:348` ("quero começar do
// zero") de session-choice-invalid-replies: com v1.3 são casos comuns sem
// rotação (menos de 4h), respondidos uma vez pela IA (mockada).
for (const body of ["continuar", "quero começar do zero"]) {
	test(`linha session_choice_state pendente antiga não bloqueia nem lembra: texto '${body}' com menos de 4h`, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		const stages: string[] = [];
		mockGemini(t, stages);
		const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

		try {
			await insertLegacyPendingChoice(fx);
			const externalId = `wamid.legacy_text_${fx.suffix}`;
			await post(app, textWebhook(fx.phone, body, externalId));

			const all = await conversationsOf(fx.leadId);
			assert.equal(all.length, 1, "no rotation, no B");
			assert.equal(all[0]?.status, "active");
			const tasks = await inboundTasksOf(fx.conversationId);
			assert.equal(tasks.length, 1);
			assert.deepEqual(await sessionTasksOf([fx.conversationId]), []);

			const sent: string[] = [];
			await drainConversationWork(fx.conversationId, {
				sender: fakeSender(sent),
			});
			assert.equal(stages.length, 1, "one AI turn");
			assert.equal(sent.length, 1, "one reply");
			assert.ok(sent[0]?.startsWith("text:"));
			const outbound = await outboundOf([fx.conversationId]);
			for (const row of outbound) {
				assert.doesNotMatch(
					JSON.stringify(row.payload),
					SESSION_BUTTON_PATTERN
				);
			}
			const [msg] = await db
				.select({ processedAt: messages.processedAt })
				.from(messages)
				.where(eq(messages.externalId, externalId));
			assert.ok(msg?.processedAt, "message processed");
			assert.deepEqual(
				await sessionTasksOf([fx.conversationId]),
				[],
				"no reminder"
			);
		} finally {
			await cleanup(fx.leadId, fx.phone);
		}
	});
}

test("linha session_choice_state pendente antiga não bloqueia toque de horário com menos de 4h", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		await insertLegacyPendingChoice(fx);
		const { slotId } = await offerSlotInA(fx);
		const externalId = `wamid.legacy_tap_${fx.suffix}`;
		await post(app, tapWebhook(fx.phone, slotId, externalId));

		assert.equal((await conversationsOf(fx.leadId)).length, 1);
		const routed = (await tasksOf([fx.conversationId])).filter(
			(task) => task.idempotencyKey === `button-reply:${externalId}`
		);
		assert.equal(routed.length, 1, "tap follows the scheduling flow");
		assert.equal(routed[0]?.taskType, "send_confirmation_request");
		assert.deepEqual(await sessionTasksOf([fx.conversationId]), []);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

/** Toque legado `sessao:*` com menos de 4h; devolve o outbox do toque. */
async function postLegacySessionTap(
	app: ReturnType<typeof buildApp>,
	fx: Awaited<ReturnType<typeof createFixture>>,
	externalId: string
) {
	await post(app, tapWebhook(fx.phone, "sessao:continuar", externalId));
	return (await outboundOf([fx.conversationId])).filter(
		(row) => row.idempotencyKey === `stale-tap:${externalId}`
	);
}

test("toque legado sessao:* com menos de 4h responde com aviso curto, nunca silêncio (S-07, F-V1c-1)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const generateContent = mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const externalId = `wamid.legacy_${fx.suffix}`;
		const outbound = await postLegacySessionTap(app, fx, externalId);
		const text =
			"Esse botão é de uma mensagem antiga.\nMe conta o que você precisa agora?";
		assert.equal(outbound.length, 1, "one reply");
		assert.deepEqual(outbound[0]?.payload, { kind: "text", text });
		const assistant = await db
			.select({ content: messages.content, id: messages.id })
			.from(messages)
			.where(
				and(
					eq(messages.conversationId, fx.conversationId),
					eq(messages.role, "assistant"),
					eq(messages.content, text)
				)
			);
		assert.equal(assistant.length, 1, "one assistant row with the notice");
		assert.equal(outbound[0]?.messageId, assistant[0]?.id);
		const tasks = (await tasksOf([fx.conversationId])).filter(
			(task) =>
				(task.payload as { eventExternalId?: string }).eventExternalId ===
				externalId
		);
		assert.deepEqual(tasks, [], "no task");
		const [event] = await db
			.select({ status: whatsappWebhookEvents.status })
			.from(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.externalId, externalId));
		assert.equal(event?.status, "processed");
		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 1, "no new conversation");

		const sent: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});
		assert.deepEqual(sent, [`text:${text}`]);
		assert.equal(generateContent.mock.callCount(), 0, "no AI call");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque legado sessao:* com menos de 4h e horários ofertados responde aviso + botões de horário (S-07)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const { slotId } = await offerSlotInA(fx);
		const outbound = await postLegacySessionTap(
			app,
			fx,
			`wamid.legacyslot_${fx.suffix}`
		);
		assert.equal(outbound.length, 1);
		const payload = outbound[0]?.payload as {
			body: string;
			buttons: Array<{ id: string }>;
			kind: string;
		};
		assert.equal(payload.kind, "buttons");
		assert.equal(
			payload.body,
			"Esse botão é de uma mensagem antiga.\nEstes são os horários que tenho para você:"
		);
		assert.deepEqual(
			payload.buttons.map((button) => button.id),
			[slotId]
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque legado sessao:* com menos de 4h em awaiting_confirmation responde aviso + Confirmar/Não (S-07)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const { sessionId, slotId } = await offerSlotInA(fx);
		await db
			.update(schedulingSessions)
			.set({ selectedSlotId: slotId, workflowStage: "awaiting_confirmation" })
			.where(eq(schedulingSessions.id, sessionId));
		const outbound = await postLegacySessionTap(
			app,
			fx,
			`wamid.legacyconfirm_${fx.suffix}`
		);
		assert.equal(outbound.length, 1);
		const payload = outbound[0]?.payload as {
			body: string;
			buttons: Array<{ id: string; title: string }>;
			kind: string;
		};
		assert.equal(payload.kind, "buttons");
		assert.match(payload.body, STALE_CONFIRM_BODY);
		assert.deepEqual(payload.buttons, [
			{ id: `confirm:${slotId}`, title: "Confirmar" },
			{ id: `cancel:${slotId}`, title: "Não" },
		]);
		const [session] = await db
			.select({
				selectedSlotId: schedulingSessions.selectedSlotId,
				workflowStage: schedulingSessions.workflowStage,
			})
			.from(schedulingSessions)
			.where(eq(schedulingSessions.id, sessionId));
		assert.deepEqual(session, {
			selectedSlotId: slotId,
			workflowStage: "awaiting_confirmation",
		});
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque legado sessao:* repetido pelo Meta responde uma vez (R-REL-02)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const externalId = `wamid.legacydup_${fx.suffix}`;
		await postLegacySessionTap(app, fx, externalId);
		await postLegacySessionTap(app, fx, externalId);
		// Reentrega pelo caminho de reclaim.
		await db
			.update(whatsappWebhookEvents)
			.set({ status: "failed" })
			.where(eq(whatsappWebhookEvents.externalId, externalId));
		const outbound = await postLegacySessionTap(app, fx, externalId);
		assert.equal(outbound.length, 1, "one reply");
		const assistantRows = await db
			.select({ id: messages.id })
			.from(messages)
			.where(
				and(
					eq(messages.conversationId, fx.conversationId),
					eq(messages.role, "assistant"),
					eq(
						messages.content,
						"Esse botão é de uma mensagem antiga.\nMe conta o que você precisa agora?"
					)
				)
			);
		assert.equal(assistantRows.length, 1);
		const sent: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});
		assert.equal(sent.length, 1);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tarefas legadas ask/remind/process_session_choice na fila são drenadas sem resposta (E3-a)", async (t) => {
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		await insertLegacyPendingChoice(fx);
		const types = [
			"ask_session_choice",
			"remind_session_choice",
			"process_session_choice",
		];
		for (const [index, taskType] of types.entries()) {
			const [event] = await db
				.insert(whatsappWebhookEvents)
				.values({
					eventType: "text",
					externalId: `wamid.legacy_task_${index}_${fx.suffix}`,
					payload: {},
					phone: fx.phone,
					status: "processing",
				})
				.returning({ id: whatsappWebhookEvents.id });
			assert.ok(event);
			await db.insert(autonomousTasks).values({
				availableAt: new Date(Date.now() - 1000),
				conversationId: fx.conversationId,
				idempotencyKey: `legacy-${taskType}:${fx.suffix}`,
				payload: {
					buttonId: "sessao:nova",
					eventId: event.id,
					kind: "button",
				},
				taskType,
			});
		}

		const sent: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});

		assert.deepEqual(sent, [], "no question, reminder or confirmation");
		assert.equal((await outboundOf([fx.conversationId])).length, 0);
		const legacy = await sessionTasksOf([fx.conversationId]);
		assert.equal(legacy.length, 3);
		for (const task of legacy) {
			assert.equal(task.status, "completed", `${task.taskType} completed`);
		}
		const events = await db
			.select({ status: whatsappWebhookEvents.status })
			.from(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.phone, fx.phone));
		for (const event of events) {
			assert.equal(event.status, "processed");
		}
		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 1, "Nova handler gone: no B");
		assert.equal(all[0]?.status, "active");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// Portados de session-choice-{new,isolation,concurrency} (casos válidos na v1.3).

test("rotação expira a sessão de agendamento de A e não apaga a reunião futura (portado)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture();

	try {
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
		const [appt] = await db
			.insert(appointments)
			.values({
				consultantId: fx.consultantId,
				endAt: new Date(Date.now() + 9_000_000),
				externalEventId: `evt-rot-port-${fx.suffix}`,
				leadId: fx.leadId,
				startAt: new Date(Date.now() + 7_200_000),
				status: "confirmed",
			})
			.returning({ id: appointments.id });
		assert.ok(appt);

		await post(app, textWebhook(fx.phone, "oi", `wamid.port_s_${fx.suffix}`));

		assert.notEqual(
			(await activeConversationOf(fx.leadId)).id,
			fx.conversationId
		);
		const [s] = await db
			.select({ status: schedulingSessions.status })
			.from(schedulingSessions)
			.where(eq(schedulingSessions.id, session.id));
		assert.equal(s?.status, "expired");
		const [a] = await db
			.select({ status: appointments.status })
			.from(appointments)
			.where(eq(appointments.id, appt.id));
		assert.equal(a?.status, "confirmed", "appointment kept as is");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("pergunta de imóvel em B não recebe estado nem histórico de veículo de A (portado)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const prompts: string[] = [];
	t.mock.method(ai.models, "generateContent", async (args: unknown) => {
		prompts.push(JSON.stringify(args));
		return {
			text: JSON.stringify({
				businessAction: "ask_next_qualification_question",
				evidenceUsed: [],
				leadUpdate: { status: "qualifying" },
				nextAction: "continue_qualification",
				reply: "Certo! Vamos falar de imóvel.",
			}),
		};
	});
	const fx = await createFixture();

	try {
		await db
			.update(leads)
			.set({ consortiumType: "auto", objective: "trocar o Fusca azul XYZ" })
			.where(eq(leads.id, fx.leadId));

		await post(
			app,
			textWebhook(
				fx.phone,
				"quero consórcio de imóvel",
				`wamid.iso_${fx.suffix}`
			)
		);
		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId);

		await drainConversationWork(b.id, { sender: fakeSender([]) });

		assert.equal(prompts.length, 1);
		const prompt = prompts[0] as string;
		assert.equal(STAGE_PATTERN.exec(prompt)?.[1], "greeting");
		assert.ok(prompt.includes("quero consórcio de imóvel"));
		for (const leaked of [
			"quero consórcio de carro",
			"Qual valor de carta você imagina?",
			"trocar o Fusca azul XYZ",
			"(não pergunte o tipo)",
		]) {
			assert.equal(prompt.includes(leaked), false, `leaked: ${leaked}`);
		}
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("três mensagens seguidas dentro de 4h continuam na mesma conversa (portado)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(60_000);

	try {
		for (let i = 0; i < 3; i += 1) {
			await post(
				app,
				textWebhook(fx.phone, `msg ${i}`, `wamid.three_${i}_${fx.suffix}`)
			);
		}
		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 1);
		assert.equal(all[0]?.id, fx.conversationId);
		assert.equal(all[0]?.status, "active");
		assert.equal((await inboundTasksOf(fx.conversationId)).length, 3);
		assert.deepEqual(await sessionTasksOf([fx.conversationId]), []);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("a mesma mensagem com externalId repetido dentro de 4h não é processada duas vezes (portado)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(60_000);

	try {
		const externalId = `wamid.dup_${fx.suffix}`;
		const payload = textWebhook(fx.phone, "duplicada", externalId);
		await post(app, payload);
		await post(app, payload);

		const events = await db
			.select({ id: whatsappWebhookEvents.id })
			.from(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.externalId, externalId));
		assert.equal(events.length, 1);
		assert.equal((await conversationsOf(fx.leadId)).length, 1);
		const inbound = await db
			.select({ id: messages.id })
			.from(messages)
			.where(eq(messages.externalId, externalId));
		assert.equal(inbound.length, 1);
		assert.equal((await inboundTasksOf(fx.conversationId)).length, 1);

		const sent: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});
		assert.equal(sent.length, 1);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Tester V1-c — casos adversariais de toque após 4h (S-20 v1.3, E1-a, K-7)
// ---------------------------------------------------------------------------

/** Pending tasks que roteariam o toque (o snapshot é `completed`). */
async function routedTasksOf(conversationIds: string[]) {
	return (await tasksOf(conversationIds)).filter(
		(task) => task.status === "pending"
	);
}

for (const kind of ["confirm", "cancel", "pref", "consultant", "sessao"]) {
	test(`tester: toque '${kind}:*' antigo após 4h não é roteado, não agenda e recebe só a resposta E1`, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		const generateContent = mockGeminiForbidden(t);
		const fx = await createFixture();

		try {
			const { sessionId, slotId } = await offerSlotInA(fx);
			// Sessão de A pronta para confirmar: o pior caso para um toque antigo.
			await db
				.update(schedulingSessions)
				.set({ selectedSlotId: slotId, workflowStage: "awaiting_confirmation" })
				.where(eq(schedulingSessions.id, sessionId));
			const buttonId = {
				cancel: `cancel:${slotId}`,
				confirm: `confirm:${slotId}`,
				consultant: `consultant:${fx.consultantId}`,
				pref: "pref:any",
				sessao: "sessao:continuar",
			}[kind] as string;
			const externalId = `wamid.tap_${kind}_${fx.suffix}`;
			await post(app, tapWebhook(fx.phone, buttonId, externalId));

			const b = await activeConversationOf(fx.leadId);
			assert.notEqual(b.id, fx.conversationId, "tap after 4h rotates");
			assert.deepEqual(
				(await routedTasksOf([fx.conversationId, b.id])).map(
					(task) => task.taskType
				),
				[],
				"old tap is not routed"
			);

			const sent: string[] = [];
			await drainConversationWork(b.id, { sender: fakeSender(sent) });
			await drainConversationWork(fx.conversationId, {
				sender: fakeSender(sent),
			});
			assert.deepEqual(sent, [`text:${E1_TAP_REPLY_TEXT}`]);
			assert.equal(generateContent.mock.callCount(), 0);
			const appts = await db
				.select({ id: appointments.id })
				.from(appointments)
				.where(eq(appointments.leadId, fx.leadId));
			assert.equal(appts.length, 0, "no appointment");
			const [session] = await db
				.select({ status: schedulingSessions.status })
				.from(schedulingSessions)
				.where(eq(schedulingSessions.id, sessionId));
			assert.equal(session?.status, "expired");
		} finally {
			await cleanup(fx.leadId, fx.phone);
		}
	});
}

test("tester: dois toques diferentes no horário antigo após 4h, concorrentes: uma B, uma resposta E1, nenhum agendamento", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const generateContent = mockGeminiForbidden(t);
	const fx = await createFixture();

	try {
		const { sessionId, slotId } = await offerSlotInA(fx);
		await Promise.all([
			post(app, tapWebhook(fx.phone, slotId, `wamid.tap2a_${fx.suffix}`)),
			post(app, tapWebhook(fx.phone, slotId, `wamid.tap2b_${fx.suffix}`)),
		]);

		assert.equal((await conversationsOf(fx.leadId)).length, 2, "A and one B");
		const b = await activeConversationOf(fx.leadId);
		const sent: string[] = [];
		await drainConversationWork(b.id, { sender: fakeSender(sent) });
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});
		// Passo 34 (F-V1c-3): o segundo toque vai para B, que não tem sessão:
		// recebe o aviso de botão antigo, nunca silêncio.
		assert.deepEqual(
			sent,
			[
				`text:${E1_TAP_REPLY_TEXT}`,
				`text:${STALE_TAP_NOTICE}\n${STALE_TAP_NO_SCHEDULING}`,
			],
			"E1 + stale-tap notice"
		);
		assert.equal(generateContent.mock.callCount(), 0);
		const appts = await db
			.select({ id: appointments.id })
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.equal(appts.length, 0, "no appointment");
		const [session] = await db
			.select()
			.from(schedulingSessions)
			.where(eq(schedulingSessions.id, sessionId));
		assert.equal(session?.status, "expired");
		assert.equal(session?.selectedSlotId, null);
		const events = await db
			.select({ status: whatsappWebhookEvents.status })
			.from(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.phone, fx.phone));
		assert.equal(events.length, 2);
		for (const event of events) {
			assert.equal(event.status, "processed", "no event left processing");
		}
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester: toque após 4h de lead com opt-out não envia nada e B mantém optOutAt (K-7)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture();

	try {
		const optOutAt = new Date(Date.now() - SESSION_INACTIVITY_MS);
		await db
			.update(conversations)
			.set({ optOutAt })
			.where(eq(conversations.id, fx.conversationId));
		const { slotId } = await offerSlotInA(fx);
		await post(
			app,
			tapWebhook(fx.phone, slotId, `wamid.optouttap_${fx.suffix}`)
		);

		const b = await activeConversationOf(fx.leadId);
		assert.notEqual(b.id, fx.conversationId);
		assert.equal(b.optOutAt?.getTime(), optOutAt.getTime());
		const sent: string[] = [];
		await drainConversationWork(b.id, { sender: fakeSender(sent) });
		assert.deepEqual(sent, [], "opted-out contact receives nothing");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester: F-V1b-3 — rotação e confirmação de agendamento concorrentes não entram em deadlock", async () => {
	const fx = await createFixture();
	try {
		const { sessionId } = await offerSlotInA(fx);
		await db
			.update(leads)
			.set({ status: "qualified" })
			.where(eq(leads.id, fx.leadId));
		const [other] = await db
			.insert(leads)
			.values({
				name: `Lead Blocker ${fx.suffix}`,
				phone: `551196${fx.suffix.slice(-9)}`,
			})
			.returning({ id: leads.id });
		assert.ok(other);
		const startAt = new Date(
			Date.now() +
				400 * 24 * 3_600_000 +
				Math.floor(Math.random() * 500_000) * 60_000
		);
		const endAt = new Date(startAt.getTime() + 1_800_000);
		const idempotencyKey = `f-v1b-3:${fx.suffix}`;
		const calendar = {
			createEvent: async () => ({ id: `f-v1b-3-${crypto.randomUUID()}` }),
			deleteEvent: async () => undefined,
			getBusyPeriods: async (ids: string[]) => [
				{ busy: [], calendarId: ids[0] },
			],
		} as unknown as ConstructorParameters<typeof AppointmentService>[0];

		try {
			// T0: reunião de outro lead com a mesma idempotencyKey, sem commit.
			// O INSERT real de createConfirmedAppointment espera por ela no meio
			// da transação, com os locks que já pegou; a rotação entra.
			let releaseBlocker: () => void = () => undefined;
			const blockerReleased = new Promise<void>((resolve) => {
				releaseBlocker = resolve;
			});
			let blockerPidReady: (pid: number) => void = () => undefined;
			const blockerPid = new Promise<number>((resolve) => {
				blockerPidReady = resolve;
			});
			const blocker = db
				.transaction(async (tx) => {
					blockerPidReady(await backendPid(tx));
					await tx.insert(appointments).values({
						consultantId: fx.consultantId,
						endAt: new Date(endAt.getTime() + 3_600_000),
						externalEventId: `f-v1b-3-blocker-${fx.suffix}`,
						idempotencyKey,
						leadId: other.id,
						startAt: new Date(startAt.getTime() + 3_600_000),
						status: "confirmed",
					});
					await blockerReleased;
					throw new Error("rollback blocker");
				})
				.then(
					() => undefined,
					() => undefined
				);
			const t0Pid = await blockerPid;

			const appointmentTx = new AppointmentService(calendar)
				.createConfirmedAppointment({
					consultantId: fx.consultantId,
					endAt,
					idempotencyKey,
					leadId: fx.leadId,
					schedulingSessionId: sessionId,
					startAt,
				})
				.then(
					() => undefined,
					(error: unknown) => error
				);
			await waitForLockWait({ blockedBy: t0Pid });

			const rotationTx = db
				.transaction((tx) =>
					resolveConversationForInbound(tx, {
						leadId: fx.leadId,
						receivedAt: new Date(),
					})
				)
				.then(
					() => undefined,
					(error: unknown) => error
				);
			// A rotação espera a transação do agendamento (lock real, sem sleep).
			await waitForLockWait({ blockedByAnyBlockedBy: t0Pid });
			releaseBlocker();
			await blocker;

			const errors = [await appointmentTx, await rotationTx];
			const failures = errors.flatMap((error) =>
				error === undefined ? [] : [sqlStateOf(error) ?? String(error)]
			);
			assert.deepEqual(failures, [], "no transaction aborted (40P01)");
		} finally {
			await db.delete(appointments).where(eq(appointments.leadId, other.id));
			await db.delete(leads).where(eq(leads.id, other.id));
		}
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// --- Tester, steps 28–29 (Batch V2-b) ---

const STALE_NO_SCHEDULING_TEXT =
	"Esse botão é de uma mensagem antiga.\nMe conta o que você precisa agora?";

test("tester: toque legado sessao:* com menos de 4h de lead com opt-out não envia nada (K-7)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		await db
			.update(conversations)
			.set({ optOutAt: new Date(Date.now() - 120_000) })
			.where(eq(conversations.id, fx.conversationId));
		await postLegacySessionTap(app, fx, `wamid.legacyoptout_${fx.suffix}`);
		const sent: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});
		assert.deepEqual(sent, [], "opted-out contact receives nothing");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester: toque legado sessao:* com sessão de agendamento vencida responde o aviso sem botões de horário", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const { sessionId } = await offerSlotInA(fx);
		await db
			.update(schedulingSessions)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(schedulingSessions.id, sessionId));
		const outbound = await postLegacySessionTap(
			app,
			fx,
			`wamid.legacyexpired_${fx.suffix}`
		);
		assert.equal(outbound.length, 1);
		assert.deepEqual(outbound[0]?.payload, {
			kind: "text",
			text: STALE_NO_SCHEDULING_TEXT,
		});
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester: toque legado sessao:* com consultor preferido mostra só os horários desse consultor", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const others = await db
			.select()
			.from(consultants)
			.where(eq(consultants.active, true));
		const other = others.find((c) => c.id !== fx.consultantId);
		if (!other) {
			t.skip("seed has a single active consultant");
			return;
		}
		const { sessionId, slotId } = await offerSlotInA(fx);
		const startAt = new Date(Date.now() + 26 * 3_600_000);
		const [otherSlot] = await db
			.insert(schedulingSlots)
			.values({
				calendarId: other.calendarId,
				consultantId: other.id,
				consultantName: other.name,
				endAt: new Date(startAt.getTime() + 1_800_000),
				position: 2,
				schedulingSessionId: sessionId,
				startAt,
			})
			.returning({ id: schedulingSlots.id });
		assert.ok(otherSlot);
		await db
			.update(schedulingSessions)
			.set({ preferredConsultantId: fx.consultantId })
			.where(eq(schedulingSessions.id, sessionId));
		const outbound = await postLegacySessionTap(
			app,
			fx,
			`wamid.legacypref_${fx.suffix}`
		);
		const payload = outbound[0]?.payload as { buttons: Array<{ id: string }> };
		assert.deepEqual(
			payload.buttons.map((button) => button.id),
			[slotId]
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Step 32 — clientes no meio do fluxo antigo no deploy (S-25, uma release)
// ---------------------------------------------------------------------------

const LEGACY_STAGES = [
	"awaiting_availability",
	"awaiting_consultant_preference",
	"awaiting_consultant_selection",
] as const;

const SLOT_CONFIRMATION_SENT = /^buttons:Você escolheu .+ Posso confirmar\?$/;

const STALE_SLOTS_BODY =
	"Esse botão é de uma mensagem antiga.\nEstes são os horários que tenho para você:";

async function setStage(
	sessionId: string,
	workflowStage: (typeof LEGACY_STAGES)[number]
) {
	await db
		.update(schedulingSessions)
		.set({ workflowStage })
		.where(eq(schedulingSessions.id, sessionId));
}

async function sessionRow(sessionId: string) {
	const [session] = await db
		.select()
		.from(schedulingSessions)
		.where(eq(schedulingSessions.id, sessionId));
	assert.ok(session);
	return session;
}

// F-T29-1 (substitui os 3 `todo`): numa sessão legada, o aviso mostra os
// botões de horário e a etapa aceita o toque (passo 32), então os botões
// mostrados nunca são recusados em silêncio.
for (const stage of LEGACY_STAGES) {
	test(`toque legado sessao:* em ${stage} mostra horários e o toque no horário segue para Confirmar (F-T29-1, S-25)`, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		mockGeminiForbidden(t);
		const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

		try {
			const { sessionId, slotId } = await offerSlotInA(fx);
			await setStage(sessionId, stage);
			const outbound = await postLegacySessionTap(
				app,
				fx,
				`wamid.legacystage_${fx.suffix}`
			);
			const payload = outbound[0]?.payload as {
				buttons?: Array<{ id: string }>;
			};
			assert.deepEqual(
				(payload.buttons ?? []).map((button) => button.id),
				[slotId]
			);

			await post(app, tapWebhook(fx.phone, slotId, `wamid.slot_${fx.suffix}`));
			const sent: string[] = [];
			await drainConversationWork(fx.conversationId, {
				sender: fakeSender(sent),
			});

			const session = await sessionRow(sessionId);
			assert.equal(session.selectedSlotId, slotId, "slot selected");
			assert.equal(session.workflowStage, "awaiting_confirmation");
			const confirmation = (await outboundOf([fx.conversationId])).filter(
				(row) =>
					(
						(row.payload as { buttons?: Array<{ id: string }> }).buttons ?? []
					).some((button) => button.id === `confirm:${slotId}`)
			);
			assert.equal(confirmation.length, 1, "one Confirmar/Não reply");
		} finally {
			await cleanup(fx.leadId, fx.phone);
		}
	});
}

test("sessão em awaiting_consultant_preference: toque no horário segue para Confirmar (S-25)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const { sessionId, slotId } = await offerSlotInA(fx);
		await setStage(sessionId, "awaiting_consultant_preference");

		await post(app, tapWebhook(fx.phone, slotId, `wamid.slot_${fx.suffix}`));
		const sent: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});

		const session = await sessionRow(sessionId);
		assert.equal(session.selectedSlotId, slotId);
		assert.equal(session.workflowStage, "awaiting_confirmation");
		assert.equal(sent.length, 1, "one reply");
		assert.match(sent[0] ?? "", SLOT_CONFIRMATION_SENT);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque num horário de outra sessão em etapa legada responde aviso e não muda a etapa (S-25, R-SCH-03)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const { sessionId } = await offerSlotInA(fx);
		await setStage(sessionId, "awaiting_consultant_preference");

		await post(
			app,
			tapWebhook(
				fx.phone,
				"00000000-0000-4000-8000-000000000000",
				`wamid.slot_${fx.suffix}`
			)
		);
		const sent: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});

		const session = await sessionRow(sessionId);
		assert.equal(session.workflowStage, "awaiting_consultant_preference");
		assert.equal(session.selectedSlotId, null);
		assert.equal(sent.length, 1, "exactly one reply");
		assert.ok(
			sent[0]?.startsWith(`buttons:${STALE_TAP_NOTICE}`),
			sent[0] ?? ""
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tarefa pendente de pergunta de preferência é drenada sem enviar nada (S-25)", async (t) => {
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const { sessionId } = await offerSlotInA(fx);
		await setStage(sessionId, "awaiting_availability");
		const [event] = await db
			.insert(whatsappWebhookEvents)
			.values({
				eventType: "text",
				externalId: `wamid.legacy_pref_task_${fx.suffix}`,
				payload: {},
				phone: fx.phone,
				status: "processing",
			})
			.returning({ id: whatsappWebhookEvents.id });
		assert.ok(event);
		await db.insert(autonomousTasks).values({
			availableAt: new Date(Date.now() - 1000),
			conversationId: fx.conversationId,
			idempotencyKey: `legacy-pref-question:${fx.suffix}`,
			payload: {
				eventId: event.id,
				kind: "send_consultant_preference_question",
				schedulingSessionId: sessionId,
			},
			taskType: "send_consultant_preference_question",
		});

		const sent: string[] = [];
		await drainConversationWork(fx.conversationId, {
			sender: fakeSender(sent),
		});

		assert.deepEqual(sent, [], "no preference question");
		assert.equal((await outboundOf([fx.conversationId])).length, 0);
		const [task] = (await tasksOf([fx.conversationId])).filter(
			(row) => row.taskType === "send_consultant_preference_question"
		);
		assert.equal(task?.status, "completed");
		const [eventRow] = await db
			.select({ status: whatsappWebhookEvents.status })
			.from(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.id, event.id));
		assert.equal(eventRow?.status, "processed");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

for (const [kind, stage] of [
	["pref", "awaiting_consultant_preference"],
	["consultant", "awaiting_consultant_selection"],
] as const) {
	test(`toque ${kind}:* antigo responde aviso + botões de horário e vai para awaiting_slot_selection (S-07, S-25)`, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		const generateContent = mockGeminiForbidden(t);
		const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

		try {
			const { sessionId, slotId } = await offerSlotInA(fx);
			await setStage(sessionId, stage);
			const buttonId =
				kind === "pref"
					? `pref:${sessionId}:has_preference`
					: `consultant:${sessionId}:${fx.consultantId}`;
			const externalId = `wamid.legacy_${kind}_${fx.suffix}`;
			await post(app, tapWebhook(fx.phone, buttonId, externalId));

			const outbound = (await outboundOf([fx.conversationId])).filter(
				(row) => row.idempotencyKey === `stale-tap:${externalId}`
			);
			assert.equal(outbound.length, 1, "one reply");
			const payload = outbound[0]?.payload as {
				body: string;
				buttons: Array<{ id: string }>;
				kind: string;
			};
			assert.equal(payload.kind, "buttons");
			assert.equal(payload.body, STALE_SLOTS_BODY);
			assert.deepEqual(
				payload.buttons.map((button) => button.id),
				[slotId]
			);
			const session = await sessionRow(sessionId);
			assert.equal(session.workflowStage, "awaiting_slot_selection");
			assert.equal(
				session.preferredConsultantId,
				null,
				"no preference written"
			);
			assert.deepEqual(
				(await routedTasksOf([fx.conversationId])).map((task) => task.taskType),
				[],
				"tap is not routed to a legacy handler"
			);
			const [event] = await db
				.select({ status: whatsappWebhookEvents.status })
				.from(whatsappWebhookEvents)
				.where(eq(whatsappWebhookEvents.externalId, externalId));
			assert.equal(event?.status, "processed");

			const sent: string[] = [];
			await drainConversationWork(fx.conversationId, {
				sender: fakeSender(sent),
			});
			assert.deepEqual(sent, [`buttons:${STALE_SLOTS_BODY}`]);
			assert.equal(generateContent.mock.callCount(), 0, "no AI call");
		} finally {
			await cleanup(fx.leadId, fx.phone);
		}
	});
}

test("toque pref:* antigo sem sessão de agendamento responde só o aviso (S-07, S-25)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGeminiForbidden(t);
	const fx = await createFixture(SESSION_INACTIVITY_MS - 60_000);

	try {
		const externalId = `wamid.legacy_pref_nosession_${fx.suffix}`;
		await post(app, tapWebhook(fx.phone, "pref:any:no_preference", externalId));
		const outbound = (await outboundOf([fx.conversationId])).filter(
			(row) => row.idempotencyKey === `stale-tap:${externalId}`
		);
		assert.equal(outbound.length, 1);
		assert.deepEqual(outbound[0]?.payload, {
			kind: "text",
			text: STALE_NO_SCHEDULING_TEXT,
		});
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});
