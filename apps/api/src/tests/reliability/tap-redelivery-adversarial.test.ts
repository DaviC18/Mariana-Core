/** biome-ignore-all lint/suspicious/useAwait: mocks assíncronos */
/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/**
 * Tester V3-c (flow-review, passo 39 / F-T26-2) — reentrega de toque sob
 * casos adversariais: toque novo nunca ignorado, reentrega em conversa ativa,
 * reentrega após 4h sem resposta anterior, reentrega concorrente com toque novo.
 *
 * Só Gemini e o transporte WhatsApp são mockados; Postgres é o local de teste.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { eq, inArray } from "drizzle-orm";
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
import { conversations } from "../../db/schema/conversations";
import { leads } from "../../db/schema/leads";
import { messages } from "../../db/schema/messages";
import { outboundMessages } from "../../db/schema/outbound-messages";
import { schedulingSessions } from "../../db/schema/scheduling-sessions";
import { whatsappWebhookEvents } from "../../db/schema/whatsapp-webhook-events";
import { env } from "../../env";
import { webhookWhatsApp } from "../../routes/whatsapp/webhook-whatsapp";
import { SESSION_INACTIVITY_MS } from "../../services/conversations/session-choice-policy";
import {
	resolveConversationForInbound,
	SESSION_ROTATION_TAP_REPLY_TEXT,
	sessionRotationTapReplyKey,
} from "../../services/conversations/session-rotation";
import type { OutboundSender } from "../../services/messaging/outbound-messages";
import { drainConversationWork } from "../../services/reliability/background-workers";

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

/** Meta reentrega quando o lease de 60 s expirou (evento `processing` velho). */
async function expireLease(externalId: string) {
	await db
		.update(whatsappWebhookEvents)
		.set({ leaseExpiresAt: new Date(Date.now() - 1000) })
		.where(eq(whatsappWebhookEvents.externalId, externalId));
}

async function eventStatus(externalId: string) {
	const [row] = await db
		.select({ status: whatsappWebhookEvents.status })
		.from(whatsappWebhookEvents)
		.where(eq(whatsappWebhookEvents.externalId, externalId));
	return row?.status;
}

async function drainAll(leadId: string, sent: string[]) {
	for (const c of await conversationsOf(leadId)) {
		await drainConversationWork(c.id, { sender: fakeSender(sent) });
	}
}

async function forceRedeliverable(externalId: string) {
	await db
		.update(whatsappWebhookEvents)
		.set({
			leaseExpiresAt: new Date(Date.now() - 1000),
			status: "processing",
		})
		.where(eq(whatsappWebhookEvents.externalId, externalId));
}

async function outboxOf(leadId: string) {
	return await db
		.select({
			conversationId: outboundMessages.conversationId,
			idempotencyKey: outboundMessages.idempotencyKey,
		})
		.from(outboundMessages)
		.where(eq(outboundMessages.leadId, leadId));
}

async function tasksOf(leadId: string) {
	const convIds = (await conversationsOf(leadId)).map((c) => c.id);
	return await db
		.select({
			conversationId: autonomousTasks.conversationId,
			idempotencyKey: autonomousTasks.idempotencyKey,
			status: autonomousTasks.status,
		})
		.from(autonomousTasks)
		.where(inArray(autonomousTasks.conversationId, convIds));
}

async function getConversation(id: string) {
	const [row] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, id));
	return row;
}

/** A fechada com a tarefa do toque antigo; B aberta por um texto após 4h e respondida. */
async function oldTapInClosedA(app: ReturnType<typeof buildApp>) {
	const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 30_000);
	const fx = await createFixture(lastAt);
	const tapId = `wamid.v3c_old_${fx.suffix}`;
	const [event] = await db
		.insert(whatsappWebhookEvents)
		.values({
			conversationId: fx.conversationId,
			eventType: "button_reply",
			externalId: tapId,
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
		idempotencyKey: `button-reply:${tapId}`,
		payload: {
			buttonId: `confirm:${crypto.randomUUID()}`,
			eventExternalId: tapId,
			eventId: event.id,
			kind: "button_reply",
		},
		taskType: "process_button_reply",
	});
	await post(app, textWebhook(fx.phone, "oi", `wamid.v3c_text_${fx.suffix}`));
	const b = (await conversationsOf(fx.leadId)).find(
		(c) => c.status === "active"
	);
	assert.ok(b);
	assert.notEqual(b.id, fx.conversationId);
	const sent: string[] = [];
	await drainConversationWork(b.id, { sender: fakeSender(sent) });
	return { b, fx, sent, tapId };
}

test("tester V3-c: toque NOVO com id parecido com um antigo nunca é ignorado (vai para B)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const { b, fx, sent, tapId } = await oldTapInClosedA(app);
	try {
		const newIds = [`${tapId}2`, tapId.toUpperCase(), `${tapId} `];
		const bBefore = await getConversation(b.id);
		for (const id of newIds) {
			await post(
				app,
				tapWebhook(fx.phone, `confirm:${crypto.randomUUID()}`, id)
			);
		}
		const tasks = await tasksOf(fx.leadId);
		for (const id of newIds) {
			const task = tasks.find((x) => x.idempotencyKey === `button-reply:${id}`);
			assert.ok(task, `task for new tap ${JSON.stringify(id)}`);
			assert.equal(task.conversationId, b.id, "new tap lands in B");
		}
		const bAfter = await getConversation(b.id);
		assert.notEqual(
			bAfter?.lastCustomerMessageAt?.getTime(),
			bBefore?.lastCustomerMessageAt?.getTime(),
			"new tap bumps B"
		);
		await drainAll(fx.leadId, sent);
		const outbox = await outboxOf(fx.leadId);
		for (const id of newIds) {
			assert.equal(
				outbox.filter((o) => o.idempotencyKey === `stale-tap:${id}`).length,
				1,
				`new refused tap ${JSON.stringify(id)} answered once`
			);
		}
		assert.equal(
			(await conversationsOf(fx.leadId)).length,
			2,
			"no third conversation"
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester V3-c: chave `button-reply:<id>` de OUTRO lead não sequestra o toque (filtro por lead)", async () => {
	const recent = new Date(Date.now() - 60_000);
	const other = await createFixture(recent);
	const mine = await createFixture(recent);
	try {
		const tapId = `wamid.v3c_cross_${other.suffix}`;
		await db.insert(autonomousTasks).values({
			conversationId: other.conversationId,
			idempotencyKey: `button-reply:${tapId}`,
			payload: { buttonId: "confirm:x", kind: "button_reply" },
			taskType: "process_button_reply",
		});
		const result = await db.transaction(
			async (tx) =>
				await resolveConversationForInbound(tx, {
					leadId: mine.leadId,
					receivedAt: new Date(),
					tapExternalId: tapId,
				})
		);
		assert.equal(result.conversation.id, mine.conversationId);
		assert.ok(!result.redelivery, "not a redelivery");
		assert.equal(result.rotated, false);
	} finally {
		await cleanup(other.leadId, other.phone);
		await cleanup(mine.leadId, mine.phone);
	}
});

test("tester V3-c: toque reentregue em A ATIVA continua idempotente: uma tarefa, uma resposta", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(new Date(Date.now() - 60_000));
	try {
		const tapId = `wamid.v3c_active_${fx.suffix}`;
		const buttonId = `confirm:${crypto.randomUUID()}`;
		await post(app, tapWebhook(fx.phone, buttonId, tapId));
		await expireLease(tapId);
		await post(app, tapWebhook(fx.phone, buttonId, tapId));
		let tasks = await tasksOf(fx.leadId);
		assert.equal(tasks.length, 1, "one task after redelivery before drain");
		assert.equal(tasks[0]?.conversationId, fx.conversationId);
		const sent: string[] = [];
		await drainAll(fx.leadId, sent);
		assert.equal(sent.length, 1, "answered once");
		const statusAfterDrain = await eventStatus(tapId);
		await forceRedeliverable(tapId);
		await post(app, tapWebhook(fx.phone, buttonId, tapId));
		await drainAll(fx.leadId, sent);
		tasks = await tasksOf(fx.leadId);
		t.diagnostic(
			`event after drain=${statusAfterDrain} sent=${JSON.stringify(sent)}`
		);
		assert.equal(tasks.length, 1, "still one task");
		assert.equal(
			sent.length,
			1,
			"forced redelivery after completion: no second reply"
		);
		assert.equal((await conversationsOf(fx.leadId)).length, 1, "no rotation");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester V3-c: toque após 4h sem resposta anterior recebe E1 uma vez; reentrega forçada não repete", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 30_000);
	const fx = await createFixture(lastAt);
	try {
		const tapId = `wamid.v3c_e1_${fx.suffix}`;
		// Primeira tentativa caiu antes do commit: só o evento `processing` velho.
		await db.insert(whatsappWebhookEvents).values({
			eventType: "button_reply",
			externalId: tapId,
			leaseExpiresAt: new Date(Date.now() - 1000),
			payload: {},
			phone: fx.phone,
			status: "processing",
		});
		await post(
			app,
			tapWebhook(fx.phone, `confirm:${crypto.randomUUID()}`, tapId)
		);
		const convs = await conversationsOf(fx.leadId);
		assert.equal(convs.length, 2, "rotated");
		const b = convs.find((c) => c.status === "active");
		assert.ok(b);
		const sent: string[] = [];
		await drainAll(fx.leadId, sent);
		assert.deepEqual(
			sent,
			[`text:${SESSION_ROTATION_TAP_REPLY_TEXT}`],
			"E1 once"
		);
		await forceRedeliverable(tapId);
		await post(
			app,
			tapWebhook(fx.phone, `confirm:${crypto.randomUUID()}`, tapId)
		);
		await drainAll(fx.leadId, sent);
		assert.equal(sent.length, 1, "no second E1");
		const outbox = await outboxOf(fx.leadId);
		assert.equal(
			outbox.filter(
				(o) => o.idempotencyKey === sessionRotationTapReplyKey(tapId)
			).length,
			1
		);
		assert.equal(
			(await conversationsOf(fx.leadId)).length,
			2,
			"no third conversation"
		);
		assert.equal(await eventStatus(tapId), "processed");
		assert.equal(
			(await tasksOf(fx.leadId)).filter((x) =>
				x.idempotencyKey.startsWith("button-reply:")
			).length,
			0,
			"tap not routed"
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester V3-c: toque `sessao:` respondido em A (stale-tap) e reentregue depois que B abriu não mexe em B", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(new Date(Date.now() - 60_000));
	try {
		const tapId = `wamid.v3c_sessao_${fx.suffix}`;
		await post(app, tapWebhook(fx.phone, "sessao:continuar", tapId));
		const sent: string[] = [];
		await drainAll(fx.leadId, sent);
		const outboxA = await outboxOf(fx.leadId);
		assert.equal(
			outboxA.filter((o) => o.idempotencyKey === `stale-tap:${tapId}`).length,
			1,
			"precondition: stale-tap reply in A"
		);
		await db
			.update(conversations)
			.set({
				lastCustomerMessageAt: new Date(
					Date.now() - SESSION_INACTIVITY_MS - 30_000
				),
			})
			.where(eq(conversations.id, fx.conversationId));
		await post(
			app,
			textWebhook(fx.phone, "oi", `wamid.v3c_sessao_text_${fx.suffix}`)
		);
		const b = (await conversationsOf(fx.leadId)).find(
			(c) => c.status === "active"
		);
		assert.ok(b);
		assert.notEqual(b.id, fx.conversationId);
		await drainAll(fx.leadId, sent);
		const bBefore = await getConversation(b.id);
		const sentBefore = sent.length;
		await forceRedeliverable(tapId);
		await post(app, tapWebhook(fx.phone, "sessao:continuar", tapId));
		await drainAll(fx.leadId, sent);
		const bAfter = await getConversation(b.id);
		assert.equal(sent.length, sentBefore, "no reply to the redelivered tap");
		assert.equal(
			bAfter?.lastCustomerMessageAt?.getTime(),
			bBefore?.lastCustomerMessageAt?.getTime(),
			"B not bumped"
		);
		assert.equal(await eventStatus(tapId), "processed");
		const outbox = await outboxOf(fx.leadId);
		assert.equal(
			outbox.filter(
				(o) => o.idempotencyKey === sessionRotationTapReplyKey(tapId)
			).length,
			0,
			"no E1 in B"
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

for (let run = 1; run <= 3; run += 1) {
	test(`tester V3-c: reentrega do toque antigo concorrente com toque novo em B (run ${run})`, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		mockGemini(t);
		const { b, fx, sent, tapId } = await oldTapInClosedA(app);
		try {
			const newTap = `wamid.v3c_new_${fx.suffix}`;
			await Promise.all([
				post(
					app,
					tapWebhook(fx.phone, `confirm:${crypto.randomUUID()}`, tapId)
				),
				post(
					app,
					tapWebhook(fx.phone, `confirm:${crypto.randomUUID()}`, newTap)
				),
			]);
			const tasks = await tasksOf(fx.leadId);
			const old = tasks.filter(
				(x) => x.idempotencyKey === `button-reply:${tapId}`
			);
			assert.equal(old.length, 1);
			assert.equal(
				old[0]?.conversationId,
				fx.conversationId,
				"old task stays in A"
			);
			const fresh = tasks.find(
				(x) => x.idempotencyKey === `button-reply:${newTap}`
			);
			assert.equal(fresh?.conversationId, b.id, "new tap routed to B");
			assert.equal(
				await eventStatus(tapId),
				"processed",
				"old event processed"
			);
			const convs = await conversationsOf(fx.leadId);
			assert.equal(convs.length, 2);
			assert.equal(convs.filter((c) => c.status === "active").length, 1);
			const sentBefore = sent.length;
			await drainConversationWork(b.id, { sender: fakeSender(sent) });
			assert.equal(
				sent.length,
				sentBefore + 1,
				"only the new tap answered in B"
			);
			const outbox = await outboxOf(fx.leadId);
			assert.equal(
				outbox.filter((o) => o.idempotencyKey === `stale-tap:${tapId}`).length,
				0,
				"old tap never answered"
			);
		} finally {
			await cleanup(fx.leadId, fx.phone);
		}
	});
}

test("tester V3-c (sonda): toque com tarefa falhada em A ainda ativa, reentregue após 4h", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 30_000);
	const fx = await createFixture(lastAt);
	try {
		const tapId = `wamid.v3c_dead_${fx.suffix}`;
		const [event] = await db
			.insert(whatsappWebhookEvents)
			.values({
				conversationId: fx.conversationId,
				eventType: "button_reply",
				externalId: tapId,
				leaseExpiresAt: new Date(lastAt.getTime() + 60_000),
				payload: {},
				phone: fx.phone,
				status: "processing",
			})
			.returning({ id: whatsappWebhookEvents.id });
		assert.ok(event);
		const buttonId = `confirm:${crypto.randomUUID()}`;
		await db.insert(autonomousTasks).values({
			availableAt: lastAt,
			conversationId: fx.conversationId,
			idempotencyKey: `button-reply:${tapId}`,
			payload: {
				buttonId,
				eventExternalId: tapId,
				eventId: event.id,
				kind: "button_reply",
			},
			status: "failed",
			taskType: "process_button_reply",
		});
		await post(app, tapWebhook(fx.phone, buttonId, tapId));
		const sent: string[] = [];
		await drainAll(fx.leadId, sent);
		const convs = await conversationsOf(fx.leadId);
		const tasks = await tasksOf(fx.leadId);
		t.diagnostic(
			`convs=${convs.length} task=${tasks[0]?.status} event=${await eventStatus(tapId)} sent=${JSON.stringify(sent)}`
		);
		assert.equal(
			convs.length,
			1,
			"redelivery decided once: stays in A, no rotation"
		);
		assert.ok(
			!sent.includes(`text:${SESSION_ROTATION_TAP_REPLY_TEXT}`),
			"no E1 for a redelivered tap"
		);
		assert.ok(sent.length <= 1, "at most one reply");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});
