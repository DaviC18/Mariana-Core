/** biome-ignore-all lint/suspicious/useAwait: mocks assíncronos */
/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/**
 * Rev2 step 27 (F-V1b-3, F-V1c-2) — ordem de locks: o lead primeiro.
 *
 * Toda transação que grava um lead e as linhas dele (conversas, sessões de
 * agendamento, reuniões) trava o lead antes. Os testes forçam a intercalação
 * real no Postgres e esperam o bloqueio em `pg_stat_activity`
 * (`pg_blocking_pids`), sem sleeps. Antes da correção, um lado abortava com
 * 40P01 (`deadlock detected`).
 *
 * Google Calendar é um fake; WhatsApp e Gemini não são chamados.
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
import { SchedulingOfferService } from "../../services/calendar/scheduling-offer-service";
import { executeNextAutonomousTask } from "../../services/conversations/autonomous-task-executor";
import {
	createAutonomousTaskHandlers,
	SEND_CONFIRMATION_REQUEST_TASK,
} from "../../services/conversations/autonomous-task-handlers";
import { SESSION_INACTIVITY_MS } from "../../services/conversations/session-choice-policy";
import {
	STALE_TAP_NOTICE,
	staleTapReplyKey,
} from "../../services/conversations/stale-tap-reply";
import { backendPid, sqlStateOf, waitForLockWait } from "../support/lock-wait";

const SESSION_GONE_MESSAGE = "A sessão de agendamento não está mais ativa.";
const DAY_MS = 24 * 3_600_000;

test.after(async () => {
	await closeDatabase();
});

type Settled<T> =
	| { ok: true; value: T }
	| { error: unknown; ok: false; sqlState?: string };

/** Anexa o handler na hora (sem unhandledRejection enquanto o teste espera). */
function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
	return promise.then(
		(value) => ({ ok: true as const, value }),
		(error: unknown) => ({
			error,
			ok: false as const,
			sqlState: sqlStateOf(error),
		})
	);
}

class RollbackSignal extends Error {}

/**
 * Transação T0 que segura um lock até `release()`. Ao liberar, faz rollback
 * (ou commit, com `after`).
 */
function holdTransaction(
	lock: (
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0]
	) => Promise<unknown>,
	after?: (
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0]
	) => Promise<unknown>
) {
	let release: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let pidReady: (pid: number) => void = () => undefined;
	const pid = new Promise<number>((resolve) => {
		pidReady = resolve;
	});
	let lockedReady: () => void = () => undefined;
	const locked = new Promise<void>((resolve) => {
		lockedReady = resolve;
	});
	const done = settle(
		db
			.transaction(async (tx) => {
				pidReady(await backendPid(tx));
				await lock(tx);
				lockedReady();
				await released;
				if (after) {
					await after(tx);
					return;
				}
				throw new RollbackSignal("rollback");
			})
			.catch((error: unknown) => {
				if (!(error instanceof RollbackSignal)) {
					throw error;
				}
			})
	);
	// `locked`: T0 já tem o lock (o outro lado só começa depois, sem corrida).
	return { done, locked, pid, release };
}

function fakeCalendar() {
	const calls = { createEvent: 0, deleteEvent: 0 };
	const service = {
		createEvent: async () => {
			calls.createEvent += 1;
			return { id: `lock-order-event-${crypto.randomUUID()}` };
		},
		deleteEvent: async () => {
			calls.deleteEvent += 1;
		},
		getBusyPeriods: async (calendarIds: string[]) => [
			{ busy: [], calendarId: calendarIds[0] ?? "test-calendar" },
		],
	};
	return {
		calls,
		service: service as unknown as ConstructorParameters<
			typeof AppointmentService
		>[0],
	};
}

function buildApp() {
	const app = fastify().withTypeProvider<ZodTypeProvider>();
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.register(webhookWhatsApp);
	return app;
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

function post(app: ReturnType<typeof buildApp>, payload: string) {
	return app.inject({
		headers: {
			"content-type": "application/json",
			"x-hub-signature-256": `sha256=${crypto
				.createHmac("sha256", env.WHATSAPP_APP_SECRET)
				.update(payload)
				.digest("hex")}`,
		},
		method: "POST",
		payload,
		url: "/webhooks/whatsapp",
	});
}

async function createLead(suffix: string, phone: string) {
	const [lead] = await db
		.insert(leads)
		.values({ name: `Lead Lock ${suffix}`, phone, status: "qualified" })
		.returning({ id: leads.id });
	assert.ok(lead);
	const [conversation] = await db
		.insert(conversations)
		.values({
			lastCustomerMessageAt: new Date(
				Date.now() - SESSION_INACTIVITY_MS - 60_000
			),
			leadId: lead.id,
		})
		.returning({ id: conversations.id });
	assert.ok(conversation);
	return { conversationId: conversation.id, leadId: lead.id };
}

/**
 * Lead `qualified` com conversa A ≥ 4h parada e sessão de agendamento ativa;
 * mais um lead "outro" só para as linhas que bloqueiam (T0).
 */
async function createFixture() {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const phone = `551194${suffix.slice(-9)}`;
	const otherPhone = `551195${suffix.slice(-9)}`;
	const main = await createLead(suffix, phone);
	const other = await createLead(`${suffix}-other`, otherPhone);
	const [session] = await db
		.insert(schedulingSessions)
		.values({
			conversationId: main.conversationId,
			expiresAt: new Date(Date.now() + 3_600_000),
			leadId: main.leadId,
			status: "active",
			workflowStage: "awaiting_confirmation",
		})
		.returning({ id: schedulingSessions.id });
	assert.ok(session);
	const [consultant] = await db
		.select({ id: consultants.id })
		.from(consultants)
		.where(eq(consultants.active, true))
		.limit(1);
	assert.ok(consultant);
	// Horário longe e aleatório: não colide com reuniões de outros testes.
	const startAt = new Date(
		Date.now() + 400 * DAY_MS + Math.floor(Math.random() * 500_000) * 60_000
	);
	return {
		consultantId: consultant.id,
		endAt: new Date(startAt.getTime() + 1_800_000),
		leadId: main.leadId,
		other,
		otherPhone,
		phone,
		sessionId: session.id,
		startAt,
		suffix,
	};
}

async function cleanup(fx: Awaited<ReturnType<typeof createFixture>>) {
	const leadIds = [fx.leadId, fx.other.leadId];
	await db
		.delete(whatsappWebhookEvents)
		.where(inArray(whatsappWebhookEvents.phone, [fx.phone, fx.otherPhone]));
	const convIds = (
		await db
			.select({ id: conversations.id })
			.from(conversations)
			.where(inArray(conversations.leadId, leadIds))
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
	await db.delete(appointments).where(inArray(appointments.leadId, leadIds));
	await db
		.delete(schedulingSessions)
		.where(inArray(schedulingSessions.leadId, leadIds));
	await db.delete(conversations).where(inArray(conversations.leadId, leadIds));
	await db.delete(leads).where(inArray(leads.id, leadIds));
}

test("agendamento e rotação concorrentes não dão deadlock; a mensagem é gravada", async () => {
	const fx = await createFixture();
	try {
		const calendar = fakeCalendar();
		const service = new AppointmentService(calendar.service);

		// T0 faz o papel da rotação: lead FOR UPDATE, depois a sessão.
		const t0 = holdTransaction(
			(tx) =>
				tx
					.select({ id: leads.id })
					.from(leads)
					.where(eq(leads.id, fx.leadId))
					.for("update"),
			(tx) =>
				tx
					.update(schedulingSessions)
					.set({ status: "expired", updatedAt: new Date() })
					.where(eq(schedulingSessions.id, fx.sessionId))
		);
		const t0Pid = await t0.pid;

		const appointment = settle(
			service.createConfirmedAppointment({
				consultantId: fx.consultantId,
				endAt: fx.endAt,
				leadId: fx.leadId,
				schedulingSessionId: fx.sessionId,
				startAt: fx.startAt,
			})
		);
		await waitForLockWait({ blockedBy: t0Pid });
		t0.release();

		const t0Result = await t0.done;
		const appointmentResult = await appointment;
		assert.deepEqual(
			[t0Result, appointmentResult]
				.flatMap((r) => (r.ok ? [] : [r.sqlState ?? String(r.error)]))
				.filter((code) => code === "40P01"),
			[],
			"no transaction aborted (40P01)"
		);
		assert.equal(t0Result.ok, true, "T0 commits");
		assert.equal(appointmentResult.ok, false, "appointment rejects");
		assert.equal(
			appointmentResult.ok
				? undefined
				: (appointmentResult.error as Error).message,
			SESSION_GONE_MESSAGE
		);
		assert.equal(calendar.calls.deleteEvent, 1, "calendar compensation");
		const rows = await db
			.select({ id: appointments.id })
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.deepEqual(rows, [], "no appointment row");
	} finally {
		await cleanup(fx);
	}
});

for (const order of ["appointment-first", "webhook-first"] as const) {
	test(`toque e confirmação concorrentes não dão deadlock (lead primeiro): ${order}`, async (t) => {
		const app = buildApp();
		t.after(() => app.close());
		const fx = await createFixture();
		try {
			const calendar = fakeCalendar();
			const service = new AppointmentService(calendar.service);
			const externalId = `wamid.lock_${order}_${fx.suffix}`;
			const idempotencyKey = `lock-order:${fx.suffix}`;
			const startAppointment = () =>
				settle(
					service.createConfirmedAppointment({
						consultantId: fx.consultantId,
						endAt: fx.endAt,
						idempotencyKey,
						leadId: fx.leadId,
						schedulingSessionId: fx.sessionId,
						startAt: fx.startAt,
					})
				);
			const startWebhook = () =>
				settle(post(app, textWebhook(fx.phone, "quero remarcar", externalId)));

			// T0 segura, sem commit, uma linha que colide (índice único) com o
			// INSERT do lado que começa primeiro. Esse lado para no meio da
			// transação com os locks que já pegou; o outro lado entra.
			const t0 = holdTransaction((tx) =>
				order === "appointment-first"
					? tx.insert(appointments).values({
							consultantId: fx.consultantId,
							endAt: new Date(fx.endAt.getTime() + 3_600_000),
							externalEventId: `lock-order-blocker-${fx.suffix}`,
							idempotencyKey,
							leadId: fx.other.leadId,
							startAt: new Date(fx.startAt.getTime() + 3_600_000),
							status: "confirmed",
						})
					: tx.insert(messages).values({
							content: "bloqueio",
							conversationId: fx.other.conversationId,
							externalId,
							role: "user",
						})
			);
			const t0Pid = await t0.pid;

			let appointmentPromise: ReturnType<typeof startAppointment>;
			let webhookPromise: ReturnType<typeof startWebhook>;
			if (order === "appointment-first") {
				appointmentPromise = startAppointment();
				await waitForLockWait({ blockedBy: t0Pid });
				webhookPromise = startWebhook();
			} else {
				webhookPromise = startWebhook();
				await waitForLockWait({ blockedBy: t0Pid });
				appointmentPromise = startAppointment();
			}
			await waitForLockWait({ blockedByAnyBlockedBy: t0Pid });
			t0.release();

			assert.equal((await t0.done).ok, true, "T0 rolls back cleanly");
			const appointmentResult = await appointmentPromise;
			const webhookResult = await webhookPromise;

			assert.equal(
				appointmentResult.ok ? undefined : appointmentResult.sqlState,
				undefined,
				`appointment side: ${appointmentResult.ok ? "ok" : String(appointmentResult.error)}`
			);
			assert.equal(webhookResult.ok, true);
			assert.equal(webhookResult.ok && webhookResult.value.statusCode, 200);
			const [event] = await db
				.select({
					lastError: whatsappWebhookEvents.lastError,
					status: whatsappWebhookEvents.status,
				})
				.from(whatsappWebhookEvents)
				.where(eq(whatsappWebhookEvents.externalId, externalId));
			assert.ok(event);
			assert.notEqual(
				event.status,
				"failed",
				`event failed: ${event.lastError}`
			);
			const [stored] = await db
				.select({ conversationId: messages.conversationId })
				.from(messages)
				.where(eq(messages.externalId, externalId));
			assert.ok(stored, "the message is stored");
			const [storedIn] = await db
				.select({ leadId: conversations.leadId, status: conversations.status })
				.from(conversations)
				.where(eq(conversations.id, stored.conversationId));
			assert.equal(storedIn?.leadId, fx.leadId);
			assert.equal(
				storedIn?.status,
				"active",
				"stored in the active conversation"
			);

			if (order === "appointment-first") {
				assert.equal(appointmentResult.ok, true, "appointment commits first");
			} else {
				assert.equal(appointmentResult.ok, false);
				assert.equal(
					appointmentResult.ok
						? undefined
						: (appointmentResult.error as Error).message,
					SESSION_GONE_MESSAGE
				);
				assert.equal(calendar.calls.deleteEvent, 1);
			}
		} finally {
			await cleanup(fx);
		}
	});
}

/**
 * Rev3 passo 36 (F-T27-1): as duas últimas transações que mexiam na sessão
 * antes de gravar uma linha com FK para o lead. T0 faz o papel da rotação
 * (lead FOR UPDATE, depois a sessão) e o outro lado precisa esperar o lead.
 */
function deadlocks(...codes: (string | undefined)[]) {
	return codes.filter((code) => code === "40P01");
}

async function addOfferSlot(fx: Awaited<ReturnType<typeof createFixture>>) {
	const [consultant] = await db
		.select()
		.from(consultants)
		.where(eq(consultants.id, fx.consultantId));
	assert.ok(consultant);
	await db
		.update(schedulingSessions)
		.set({ workflowStage: "awaiting_slot_selection" })
		.where(eq(schedulingSessions.id, fx.sessionId));
	const [slot] = await db
		.insert(schedulingSlots)
		.values({
			calendarId: consultant.calendarId,
			consultantId: consultant.id,
			consultantName: consultant.name,
			endAt: fx.endAt,
			position: 1,
			schedulingSessionId: fx.sessionId,
			startAt: fx.startAt,
		})
		.returning({ id: schedulingSlots.id });
	assert.ok(slot);
	return { consultant, slotId: slot.id };
}

function rotationLikeT0(fx: Awaited<ReturnType<typeof createFixture>>) {
	return holdTransaction(
		(tx) =>
			tx
				.select({ id: leads.id })
				.from(leads)
				.where(eq(leads.id, fx.leadId))
				.for("update"),
		(tx) =>
			tx
				.update(schedulingSessions)
				.set({ status: "expired", updatedAt: new Date() })
				.where(eq(schedulingSessions.id, fx.sessionId))
	);
}

test("pedido de confirmação (toque no horário) e rotação concorrentes não dão deadlock", async () => {
	const fx = await createFixture();
	let t0: ReturnType<typeof rotationLikeT0> | undefined;
	try {
		const { slotId } = await addOfferSlot(fx);
		const [conversation] = await db
			.select({ id: conversations.id })
			.from(conversations)
			.where(eq(conversations.leadId, fx.leadId));
		assert.ok(conversation);
		const externalId = `wamid.lock_confirm_${fx.suffix}`;
		const [event] = await db
			.insert(whatsappWebhookEvents)
			.values({
				conversationId: conversation.id,
				eventType: "button_reply",
				externalId,
				phone: fx.phone,
				status: "processing",
			})
			.returning({ id: whatsappWebhookEvents.id });
		assert.ok(event);
		const [task] = await db
			.insert(autonomousTasks)
			.values({
				availableAt: new Date(),
				conversationId: conversation.id,
				idempotencyKey: `lock-order:confirm:${fx.suffix}`,
				maxAttempts: 1,
				maxSteps: 8,
				payload: {
					buttonId: slotId,
					eventExternalId: externalId,
					eventId: event.id,
				},
				status: "pending",
				taskType: SEND_CONFIRMATION_REQUEST_TASK,
			})
			.returning({ id: autonomousTasks.id });
		assert.ok(task);

		// Guarda o SQLSTATE do erro do handler (o executor só grava a mensagem).
		const handlers = createAutonomousTaskHandlers();
		const confirmationHandler = handlers[SEND_CONFIRMATION_REQUEST_TASK];
		assert.ok(confirmationHandler);
		let handlerSqlState: string | undefined;
		handlers[SEND_CONFIRMATION_REQUEST_TASK] = async (context) => {
			try {
				return await confirmationHandler(context);
			} catch (error) {
				handlerSqlState = sqlStateOf(error);
				throw error;
			}
		};

		t0 = rotationLikeT0(fx);
		const t0Pid = await t0.pid;
		await Promise.race([t0.locked, t0.done]);
		const handler = settle(
			executeNextAutonomousTask({
				conversationId: conversation.id,
				handlers,
				retryable: () => false,
			})
		);
		await waitForLockWait({ blockedBy: t0Pid });
		t0.release();

		const t0Result = await t0.done;
		const handlerResult = await handler;
		assert.deepEqual(
			deadlocks(t0Result.ok ? undefined : t0Result.sqlState, handlerSqlState),
			[],
			"no transaction aborted (40P01)"
		);
		assert.equal(t0Result.ok, true, "T0 commits");
		assert.equal(handlerResult.ok && handlerResult.value.status, "completed");

		const [stored] = await db
			.select({ result: autonomousTasks.result })
			.from(autonomousTasks)
			.where(eq(autonomousTasks.id, task.id));
		assert.equal(
			stored?.result?.reason,
			"session_changed_before_confirmation",
			JSON.stringify(stored?.result)
		);
		const sent = await db
			.select({
				idempotencyKey: outboundMessages.idempotencyKey,
				payload: outboundMessages.payload,
			})
			.from(outboundMessages)
			.where(eq(outboundMessages.conversationId, conversation.id));
		assert.equal(sent.length, 1, "exactly one reply");
		assert.equal(sent[0]?.idempotencyKey, staleTapReplyKey(externalId));
		assert.match(
			JSON.stringify(sent[0]?.payload),
			new RegExp(`^.*${STALE_TAP_NOTICE}`)
		);
		const [session] = await db
			.select({
				status: schedulingSessions.status,
				workflowStage: schedulingSessions.workflowStage,
			})
			.from(schedulingSessions)
			.where(eq(schedulingSessions.id, fx.sessionId));
		assert.deepEqual(session, {
			status: "expired",
			workflowStage: "awaiting_slot_selection",
		});
		const [eventRow] = await db
			.select({ status: whatsappWebhookEvents.status })
			.from(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.id, event.id));
		assert.equal(eventRow?.status, "processed");
	} finally {
		// Nunca deixa T0 aberto (um assert falho não pode travar o cleanup).
		t0?.release();
		await t0?.done;
		await db
			.delete(schedulingSlots)
			.where(eq(schedulingSlots.schedulingSessionId, fx.sessionId));
		await cleanup(fx);
	}
});

test("oferta (persistOffer) e rotação concorrentes não dão deadlock", async () => {
	const fx = await createFixture();
	let t0: ReturnType<typeof rotationLikeT0> | undefined;
	try {
		const { consultant } = await addOfferSlot(fx);
		const [conversation] = await db
			.select({ id: conversations.id })
			.from(conversations)
			.where(eq(conversations.leadId, fx.leadId));
		assert.ok(conversation);
		const [assistant] = await db
			.insert(messages)
			.values({
				content: "oferta",
				conversationId: conversation.id,
				role: "assistant",
			})
			.returning({ id: messages.id });
		assert.ok(assistant);

		t0 = rotationLikeT0(fx);
		const t0Pid = await t0.pid;
		await Promise.race([t0.locked, t0.done]);
		const offer = settle(
			new SchedulingOfferService().persistOffer({
				conversationId: conversation.id,
				finalReply: "Tenho estes horários disponíveis.",
				leadId: fx.leadId,
				messageId: assistant.id,
				offeredSlots: [
					{
						consultant,
						end: new Date(fx.endAt.getTime() + DAY_MS),
						start: new Date(fx.startAt.getTime() + DAY_MS),
					},
					{
						consultant,
						end: new Date(fx.endAt.getTime() + 2 * DAY_MS),
						start: new Date(fx.startAt.getTime() + 2 * DAY_MS),
					},
				],
			})
		);
		await waitForLockWait({ blockedBy: t0Pid });
		t0.release();

		const t0Result = await t0.done;
		const offerResult = await offer;
		assert.deepEqual(
			deadlocks(
				t0Result.ok ? undefined : t0Result.sqlState,
				offerResult.ok ? undefined : offerResult.sqlState
			),
			[],
			"no transaction aborted (40P01)"
		);
		assert.equal(t0Result.ok, true, "T0 commits");
		assert.equal(
			offerResult.ok,
			true,
			offerResult.ok ? "" : String(offerResult.error)
		);
		const sessions = await db
			.select({
				id: schedulingSessions.id,
				status: schedulingSessions.status,
			})
			.from(schedulingSessions)
			.where(eq(schedulingSessions.leadId, fx.leadId));
		assert.deepEqual(
			sessions.filter((s) => s.status === "active").length,
			1,
			"one active session (the new offer)"
		);
		assert.equal(
			sessions.find((s) => s.id === fx.sessionId)?.status,
			"expired",
			"T0's update kept"
		);
	} finally {
		t0?.release();
		await t0?.done;
		const sessionIds = (
			await db
				.select({ id: schedulingSessions.id })
				.from(schedulingSessions)
				.where(eq(schedulingSessions.leadId, fx.leadId))
		).map((s) => s.id);
		if (sessionIds.length > 0) {
			await db
				.delete(schedulingSlots)
				.where(inArray(schedulingSlots.schedulingSessionId, sessionIds));
		}
		await cleanup(fx);
	}
});
