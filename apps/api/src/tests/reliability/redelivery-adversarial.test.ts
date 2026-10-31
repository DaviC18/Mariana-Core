/** biome-ignore-all lint/suspicious/useAwait: mocks assíncronos */
/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/**
 * Tester Rev2 steps 26–27 (flow-review) — reentrega (F-V1b-1, D-R2-1 a) sob
 * casos adversariais: tarefa pendente vs concluída, payload diferente com o
 * mesmo externalId, toque reentregue, reentrega + mensagem nova concorrentes,
 * duas mensagens na mesma janela de debounce.
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

async function userMessages(leadId: string) {
	const convIds = (await conversationsOf(leadId)).map((c) => c.id);
	return await db
		.select({
			content: messages.content,
			conversationId: messages.conversationId,
			externalId: messages.externalId,
		})
		.from(messages)
		.where(inArray(messages.conversationId, convIds));
}

async function inboundTasks(leadId: string) {
	const convIds = (await conversationsOf(leadId)).map((c) => c.id);
	return await db
		.select({
			idempotencyKey: autonomousTasks.idempotencyKey,
			status: autonomousTasks.status,
		})
		.from(autonomousTasks)
		.where(inArray(autonomousTasks.conversationId, convIds));
}

test("tester R2: reentrega com tarefa ainda pendente e payload diferente: uma mensagem (a original), uma tarefa, uma resposta", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(new Date(Date.now() - 60_000));
	try {
		const id = `wamid.r2_pending_${fx.suffix}`;
		await post(app, textWebhook(fx.phone, "quero carro", id));
		await expireLease(id);
		await post(app, textWebhook(fx.phone, "TEXTO DIFERENTE", id));

		const msgs = (await userMessages(fx.leadId)).filter(
			(m) => m.externalId === id
		);
		assert.equal(msgs.length, 1, "one stored message");
		assert.equal(msgs[0]?.content, "quero carro", "first payload wins");
		assert.equal(msgs[0]?.conversationId, fx.conversationId);
		const tasks = (await inboundTasks(fx.leadId)).filter(
			(k) => k.idempotencyKey === `inbound:${id}`
		);
		assert.equal(tasks.length, 1, "one inbound task");

		const sent: string[] = [];
		await drainAll(fx.leadId, sent);
		assert.equal(sent.length, 1, "answered once");
		assert.equal(await eventStatus(id), "processed");
		assert.equal((await conversationsOf(fx.leadId)).length, 1);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester R2: reentrega depois da tarefa concluída não responde de novo", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(new Date(Date.now() - 60_000));
	try {
		const id = `wamid.r2_done_${fx.suffix}`;
		await post(app, textWebhook(fx.phone, "quero carro", id));
		const sent: string[] = [];
		await drainAll(fx.leadId, sent);
		assert.equal(sent.length, 1);
		assert.equal(await eventStatus(id), "processed");

		// Reentrega normal: o evento já está processed (duplicata).
		await post(app, textWebhook(fx.phone, "quero carro", id));
		// Reentrega forçada: evento falhou depois (pior caso) e o Meta reenviou.
		await db
			.update(whatsappWebhookEvents)
			.set({ status: "failed" })
			.where(eq(whatsappWebhookEvents.externalId, id));
		await post(app, textWebhook(fx.phone, "quero carro", id));
		await drainAll(fx.leadId, sent);

		assert.equal(sent.length, 1, "no second reply");
		assert.equal((await conversationsOf(fx.leadId)).length, 1);
		assert.equal(
			(await userMessages(fx.leadId)).filter((m) => m.externalId === id).length,
			1
		);
		t.diagnostic(
			`event status after forced redelivery: ${await eventStatus(id)}`
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester R2: duas mensagens na mesma janela de debounce e reentrega da primeira: uma resposta, eventos fechados", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const fx = await createFixture(new Date(Date.now() - 60_000));
	try {
		const id1 = `wamid.r2_deb1_${fx.suffix}`;
		const id2 = `wamid.r2_deb2_${fx.suffix}`;
		await post(app, textWebhook(fx.phone, "oi", id1));
		await post(app, textWebhook(fx.phone, "quero carro", id2));
		await expireLease(id1);
		await post(app, textWebhook(fx.phone, "oi", id1));

		const sent: string[] = [];
		await drainAll(fx.leadId, sent);
		assert.equal(sent.length, 1, "one batched reply");
		assert.equal((await conversationsOf(fx.leadId)).length, 1);
		assert.equal(
			(await userMessages(fx.leadId)).filter(
				(m) => m.externalId === id1 || m.externalId === id2
			).length,
			2
		);
		t.diagnostic(
			`events: ${await eventStatus(id1)} / ${await eventStatus(id2)}`
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

for (let run = 1; run <= 5; run += 1) {
	test(`tester R2: reentrega tardia e mensagem nova concorrentes: uma conversa ativa, a nova é respondida (run ${run})`, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		mockGemini(t);
		const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 30_000);
		const fx = await createFixture(lastAt);
		try {
			const lateId = `wamid.r2_late_${run}_${fx.suffix}`;
			const newId = `wamid.r2_new_${run}_${fx.suffix}`;
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
				payload: {
					batchCutoffAt: lastAt.toISOString(),
					eventExternalId: lateId,
					eventId: event.id,
					kind: "text",
				},
				taskType: "process_inbound_message",
				triggerMessageId: msg.id,
			});

			await Promise.all([
				post(app, textWebhook(fx.phone, "é para carro", lateId)),
				post(app, textWebhook(fx.phone, "ainda quero", newId)),
			]);

			const all = await conversationsOf(fx.leadId);
			const active = all.filter((c) => c.status === "active");
			assert.equal(active.length, 1, "one active conversation");
			const msgs = await userMessages(fx.leadId);
			const late = msgs.filter((m) => m.externalId === lateId);
			const fresh = msgs.filter((m) => m.externalId === newId);
			assert.equal(late.length, 1);
			assert.equal(late[0]?.conversationId, fx.conversationId, "X stays in A");
			assert.equal(fresh.length, 1);
			assert.equal(
				fresh[0]?.conversationId,
				active[0]?.id,
				"new message in the active conversation"
			);

			const sent: string[] = [];
			await drainAll(fx.leadId, sent);
			assert.ok(sent.length >= 1, "the new message is answered");
			assert.ok(sent.length <= 2, "never more than one reply per message");
			assert.notEqual(await eventStatus(newId), "failed");
			assert.notEqual(await eventStatus(lateId), "failed");
			t.diagnostic(
				`conversations=${all.length} replies=${sent.length} late=${await eventStatus(lateId)} new=${await eventStatus(newId)}`
			);
		} finally {
			await cleanup(fx.leadId, fx.phone);
		}
	});
}

// Passo 39 (F-T26-2, R-REL-02, R-SES-01): o toque reentregue acha a tarefa
// `button-reply:<id>` em A fechada; evento processado, B intocada.
test("tester R2: toque reentregue depois que B abriu não mexe em B (simetria com F-V1b-1)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 30_000);
	const fx = await createFixture(lastAt);
	try {
		const tapId = `wamid.r2_tap_${fx.suffix}`;
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

		await post(
			app,
			textWebhook(fx.phone, "oi", `wamid.r2_tapnew_${fx.suffix}`)
		);
		const b = (await conversationsOf(fx.leadId)).find(
			(c) => c.status === "active"
		);
		assert.ok(b);
		assert.notEqual(b.id, fx.conversationId);
		const sent: string[] = [];
		await drainConversationWork(b.id, { sender: fakeSender(sent) });
		const [bBefore] = await db
			.select()
			.from(conversations)
			.where(eq(conversations.id, b.id));

		await post(
			app,
			tapWebhook(fx.phone, `confirm:${crypto.randomUUID()}`, tapId)
		);
		await drainAll(fx.leadId, sent);

		const [bAfter] = await db
			.select()
			.from(conversations)
			.where(eq(conversations.id, b.id));
		t.diagnostic(
			`replies=${sent.length} event=${await eventStatus(tapId)} bBumped=${
				bAfter?.lastCustomerMessageAt?.getTime() !==
				bBefore?.lastCustomerMessageAt?.getTime()
			}`
		);
		assert.equal(sent.length, 1, "no reply to the old tap");
		assert.equal(
			bAfter?.lastCustomerMessageAt?.getTime(),
			bBefore?.lastCustomerMessageAt?.getTime(),
			"B lastCustomerMessageAt not bumped by the old tap"
		);
		assert.equal(await eventStatus(tapId), "processed", "event processed");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester R2: reentrega tardia antes da mensagem nova: X fica em A, a nova entra em A, nenhuma rotação perde X", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockGemini(t);
	const lastAt = new Date(Date.now() - SESSION_INACTIVITY_MS - 30_000);
	const fx = await createFixture(lastAt);
	try {
		const lateId = `wamid.r2_seq_late_${fx.suffix}`;
		const newId = `wamid.r2_seq_new_${fx.suffix}`;
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
			payload: {
				batchCutoffAt: lastAt.toISOString(),
				eventExternalId: lateId,
				eventId: event.id,
				kind: "text",
			},
			taskType: "process_inbound_message",
			triggerMessageId: msg.id,
		});

		await post(app, textWebhook(fx.phone, "é para carro", lateId));
		await post(app, textWebhook(fx.phone, "ainda quero", newId));

		const all = await conversationsOf(fx.leadId);
		assert.equal(all.length, 1, "no rotation: the redelivery reset the gap");
		const sent: string[] = [];
		await drainAll(fx.leadId, sent);
		t.diagnostic(`replies=${sent.length}`);
		assert.ok(sent.length >= 1 && sent.length <= 2);
		assert.equal(await eventStatus(lateId), "processed");
		assert.equal(await eventStatus(newId), "processed");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});
