/** biome-ignore-all lint/suspicious/useAwait: <> */
// Steps 30 and 31 (D-R2-5, D-R2-7, R-SCH-01 v1.4): the consultant of each
// offered time is drawn by the backend at offer time and stored on the slot;
// the flow is slots → tap → Confirmar → confirmation, with no preference
// question. Gemini, WhatsApp and Google Calendar are mocked.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { GenerateContentResponse } from "@google/genai";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import fastify from "fastify";
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { ai } from "../../ai/client";
import { closeDatabase, db } from "../../db/connections";
import {
	appointments,
	autonomousTasks,
	consultants as consultantsTable,
	conversations,
	leads,
	messages,
	outboundMessages,
	schedulingSessions,
	schedulingSlots,
	whatsappWebhookEvents,
} from "../../db/schema";
import { env } from "../../env";
import { GoogleCalendarService } from "../../integrations/google-calendar/google-calendar-service";
import { WhatsAppService } from "../../integrations/whatsapp/whatsapp-service";
import { webhookWhatsApp } from "../../routes/whatsapp/webhook-whatsapp";
import {
	type Consultant,
	ConsultantAvailabilityService,
	type ConsultantDrawOptions,
} from "../../services/calendar/consultant-availability";
import { SchedulingAvailabilityService } from "../../services/calendar/scheduling-availability";
import { SchedulingConfirmationOrchestrator } from "../../services/calendar/scheduling-confirmation-orchestrator";
import { executeNextAutonomousTask } from "../../services/conversations/autonomous-task-executor";
import {
	createAutonomousTaskHandlers,
	PROCESS_BUTTON_REPLY_TASK,
	SEND_CONFIRMATION_REQUEST_TASK,
	SEND_CONSULTANT_PREFERENCE_QUESTION_TASK,
} from "../../services/conversations/autonomous-task-handlers";
import { generateMarianaResponse } from "../../services/conversations/generateMarianaResponse";
import { STALE_TAP_NOTICE } from "../../services/conversations/stale-tap-reply";
import { drainConversationWork } from "../../services/reliability/background-workers";
import { formatSlotDate } from "../../utils/date-formatter";

const CONFIRMATION_BODY = /^Você escolheu .+ com .+\. Posso confirmar\?$/;

test.after(async () => {
	await closeDatabase();
});

interface CalendarFake {
	busyCalendarIds: string[];
	createdEvents: { calendarId: string; start: string }[];
}

// Prototype fakes: availability, booking revalidation and event creation all
// go through GoogleCalendarService. Nothing leaves the machine.
function mockExternal(t: test.TestContext, busyCalendarIds: string[] = []) {
	const fake: CalendarFake = { busyCalendarIds, createdEvents: [] };

	t.mock.method(
		GoogleCalendarService.prototype,
		"getBusyPeriods",
		async (calendarIds: string[], timeMin: Date, timeMax: Date) =>
			calendarIds.map((calendarId) => ({
				busy: fake.busyCalendarIds.includes(calendarId)
					? [{ end: timeMax.toISOString(), start: timeMin.toISOString() }]
					: [],
				calendarId,
			}))
	);
	t.mock.method(
		GoogleCalendarService.prototype,
		"createEvent",
		async (input: { calendarId: string; end: Date; start: Date }) => {
			fake.createdEvents.push({
				calendarId: input.calendarId,
				start: input.start.toISOString(),
			});
			return {
				end: input.end.toISOString(),
				// Unique: appointments.externalEventId is UNIQUE across parallel files.
				id: `fake-event-${crypto.randomUUID()}-${fake.createdEvents.length}`,
				start: input.start.toISOString(),
			};
		}
	);
	t.mock.method(
		GoogleCalendarService.prototype,
		"deleteEvent",
		async () => undefined
	);
	const fakeSend = async () => ({
		contacts: [],
		messages: [{ id: `wamid.test_${Date.now()}_${Math.random()}` }],
		messaging_product: "whatsapp",
	});
	t.mock.method(WhatsAppService.prototype, "sendReplyButtonsMessage", fakeSend);
	t.mock.method(WhatsAppService.prototype, "sendTextMessage", fakeSend);
	t.mock.method(
		ai.models,
		"generateContent",
		async () =>
			({
				text: JSON.stringify({
					businessAction: "offer_appointment",
					evidenceUsed: [],
					leadUpdate: { status: "qualified" },
					nextAction: "offer_meeting",
					reply: "Vou consultar os horários.",
				}),
			}) as GenerateContentResponse
	);

	return fake;
}

// Real draw code. Records the ranked list it received and marks the
// first-ranked consultant busy, so the old "first free" rule and the draw
// give different consultants.
class RecordingConsultantAvailability extends ConsultantAvailabilityService {
	ranked: Consultant[] = [];
	private readonly fake: CalendarFake;

	constructor(fake: CalendarFake) {
		super();
		this.fake = fake;
	}

	override async getAvailableConsultants(
		consultants: Consultant[],
		timeMin: Date,
		timeMax: Date,
		options?: ConsultantDrawOptions
	) {
		this.ranked = consultants;
		const [firstRanked] = consultants;
		if (firstRanked) {
			this.fake.busyCalendarIds.push(firstRanked.calendarId);
		}
		return await super.getAvailableConsultants(
			consultants,
			timeMin,
			timeMax,
			options
		);
	}
}

async function createQualifiedLead() {
	const phone = `5511${Math.floor(Math.random() * 1e9)
		.toString()
		.padStart(9, "0")}`;
	const [lead] = await db
		.insert(leads)
		.values({
			consortiumType: "imóvel",
			interestedInConsultant: true,
			name: "Cliente Sorteio",
			objective: "Comprar imóvel",
			phone,
			status: "qualified",
		})
		.returning({ id: leads.id });
	assert.ok(lead);
	const [conversation] = await db
		.insert(conversations)
		.values({ leadId: lead.id })
		.returning({ id: conversations.id });
	assert.ok(conversation);
	return { conversationId: conversation.id, leadId: lead.id, phone };
}

async function cleanup(leadId: string, phone?: string) {
	if (phone) {
		await db
			.delete(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.phone, phone));
	}
	const conversationIds = (
		await db
			.select({ id: conversations.id })
			.from(conversations)
			.where(eq(conversations.leadId, leadId))
	).map((conversation) => conversation.id);
	if (conversationIds.length > 0) {
		await db
			.delete(outboundMessages)
			.where(inArray(outboundMessages.conversationId, conversationIds));
		await db
			.delete(autonomousTasks)
			.where(inArray(autonomousTasks.conversationId, conversationIds));
		await db
			.delete(messages)
			.where(inArray(messages.conversationId, conversationIds));
	}
	await db.delete(appointments).where(eq(appointments.leadId, leadId));
	await db
		.delete(schedulingSessions)
		.where(eq(schedulingSessions.leadId, leadId));
	await db.delete(conversations).where(eq(conversations.leadId, leadId));
	await db.delete(leads).where(eq(leads.id, leadId));
}

function buildApp() {
	const app = fastify().withTypeProvider<ZodTypeProvider>();
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	app.register(webhookWhatsApp);
	return app;
}

type InboundContent =
	| { text: { body: string }; type: "text" }
	| {
			interactive: {
				button_reply: { id: string; title: string };
				type: "button_reply";
			};
			type: "interactive";
	  };

function inboundWebhook(
	phone: string,
	externalId: string,
	content: InboundContent
) {
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
									timestamp: String(Math.floor(Date.now() / 1000)),
									...content,
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
				id: "entry_no_choice",
			},
		],
		object: "whatsapp_business_account",
	});
}

async function postInbound(
	app: ReturnType<typeof buildApp>,
	conversationId: string,
	payload: string
) {
	const signature = crypto
		.createHmac("sha256", env.WHATSAPP_APP_SECRET)
		.update(payload)
		.digest("hex");
	const response = await app.inject({
		headers: {
			"content-type": "application/json",
			"x-hub-signature-256": `sha256=${signature}`,
		},
		method: "POST",
		payload,
		url: "/webhooks/whatsapp",
	});
	assert.equal(response.statusCode, 200);
	await drainConversationWork(conversationId);
}

interface InboundFixture {
	conversationId: string;
	phone: string;
}

function postText(
	app: ReturnType<typeof buildApp>,
	fx: InboundFixture,
	body: string
) {
	return postInbound(
		app,
		fx.conversationId,
		inboundWebhook(fx.phone, `wamid.text_${crypto.randomUUID()}`, {
			text: { body },
			type: "text",
		})
	);
}

function postTap(
	app: ReturnType<typeof buildApp>,
	fx: InboundFixture,
	buttonId: string
) {
	return postInbound(
		app,
		fx.conversationId,
		inboundWebhook(fx.phone, `wamid.tap_${crypto.randomUUID()}`, {
			interactive: {
				button_reply: { id: buttonId, title: "Botão" },
				type: "button_reply",
			},
			type: "interactive",
		})
	);
}

async function activeSessionOf(leadId: string) {
	const [session] = await db
		.select()
		.from(schedulingSessions)
		.where(
			and(
				eq(schedulingSessions.leadId, leadId),
				eq(schedulingSessions.status, "active")
			)
		);
	assert.ok(session, "active scheduling session");
	return session;
}

function buttonIdsOf(row: { payload: unknown } | undefined) {
	const payload = row?.payload as
		| { buttons?: Array<{ id: string }> }
		| undefined;
	return (payload?.buttons ?? []).map((button) => button.id);
}

function bodyOf(row: { payload: unknown } | undefined) {
	const payload = row?.payload as { body?: string; text?: string } | undefined;
	return payload?.body ?? payload?.text ?? "";
}

function mockSingleSlot(t: test.TestContext, consultant: Consultant) {
	const start = new Date(Date.now() + 2 * 86_400_000);
	start.setUTCHours(14, 0, 0, 0);
	t.mock.method(
		SchedulingAvailabilityService.prototype,
		"getAvailableSlots",
		async () => [
			{ consultant, end: new Date(start.getTime() + 1_800_000), start },
		]
	);
}

async function anyActiveConsultant(): Promise<Consultant> {
	const [consultant] = await db
		.select({
			calendarId: consultantsTable.calendarId,
			id: consultantsTable.id,
			name: consultantsTable.name,
		})
		.from(consultantsTable)
		.where(eq(consultantsTable.active, true))
		.limit(1);
	assert.ok(consultant);
	return consultant;
}

async function runTask(
	conversationId: string,
	taskType: string,
	payload: Record<string, unknown>
) {
	await db.insert(autonomousTasks).values({
		availableAt: new Date(),
		conversationId,
		idempotencyKey: `no-choice:${taskType}:${Date.now()}:${Math.random()}`,
		maxAttempts: 5,
		maxSteps: 8,
		payload,
		status: "pending",
		taskType,
	});
	const result = await executeNextAutonomousTask({
		conversationId,
		handlers: createAutonomousTaskHandlers(),
	});
	assert.equal(result.status, "completed", JSON.stringify(result));
}

async function sessionOf(sessionId: string) {
	const [session] = await db
		.select()
		.from(schedulingSessions)
		.where(eq(schedulingSessions.id, sessionId));
	assert.ok(session);
	return session;
}

async function slotsOf(sessionId: string) {
	return await db
		.select()
		.from(schedulingSlots)
		.where(eq(schedulingSlots.schedulingSessionId, sessionId))
		.orderBy(asc(schedulingSlots.position));
}

async function outboundOf(conversationId: string) {
	return await db
		.select()
		.from(outboundMessages)
		.where(eq(outboundMessages.conversationId, conversationId))
		.orderBy(asc(outboundMessages.createdAt));
}

test("a oferta grava o consultor sorteado no slot e a confirmação usa esse consultor (R-SCH-01, R-SCH-04)", async (t) => {
	const { conversationId, leadId } = await createQualifiedLead();

	try {
		const fake = mockExternal(t);
		const recording = new RecordingConsultantAvailability(fake);
		const result = await generateMarianaResponse({
			currentMessages: ["Quero agendar"],
			leadId,
			random: () => 0.99,
			schedulingAvailabilityService: new SchedulingAvailabilityService(
				recording
			),
		});
		const offer = result.schedulingOffer;
		assert.ok(offer, result.result.reply);
		assert.ok(recording.ranked.length >= 3, "seed has 3 active consultants");
		const [firstRanked] = recording.ranked;
		// random 0.99 picks the last free consultant in the ranked list.
		const drawn = recording.ranked.at(-1);
		assert.ok(firstRanked);
		assert.ok(drawn);
		assert.notEqual(drawn.id, firstRanked.id, "busy one never drawn");

		const slots = await slotsOf(offer.session.id);
		assert.ok(slots.length >= 2);
		for (const slot of slots) {
			assert.equal(slot.consultantId, drawn.id, "slot keeps the drawn one");
			assert.equal(slot.calendarId, drawn.calendarId);
			assert.equal(slot.consultantName, drawn.name);
		}

		const [chosen] = slots;
		assert.ok(chosen);
		await runTask(conversationId, SEND_CONFIRMATION_REQUEST_TASK, {
			buttonId: chosen.id,
			eventExternalId: `draw-slot-${chosen.id}`,
			kind: "button_reply",
		});
		await runTask(conversationId, PROCESS_BUTTON_REPLY_TASK, {
			buttonId: `confirm:${chosen.id}`,
			eventExternalId: `draw-confirm-${chosen.id}`,
			kind: "button_reply",
		});

		const saved = await db
			.select()
			.from(appointments)
			.where(eq(appointments.leadId, leadId));
		assert.equal(saved.length, 1);
		assert.equal(saved[0]?.consultantId, drawn.id);
		assert.deepEqual(
			fake.createdEvents.map((event) => event.calendarId),
			[drawn.calendarId]
		);
	} finally {
		await cleanup(leadId);
	}
});

test("aceite oferece só horários; nenhuma pergunta de preferência (S-01, R-SCH-01)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		await postText(app, fx, "Quero agendar");

		const session = await activeSessionOf(fx.leadId);
		const slotIds = (await slotsOf(session.id)).map((slot) => slot.id);
		assert.equal(slotIds.length, 3);
		const withButtons = (await outboundOf(fx.conversationId)).filter(
			(row) => buttonIdsOf(row).length > 0
		);
		assert.equal(withButtons.length, 1, "one button message: the slots");
		assert.deepEqual(buttonIdsOf(withButtons[0]), slotIds);
		assert.ok(
			!withButtons.some((row) =>
				buttonIdsOf(row).some((id) => id.startsWith("pref:"))
			),
			"no pref: buttons"
		);
		const preferenceTasks = (
			await db
				.select()
				.from(autonomousTasks)
				.where(eq(autonomousTasks.conversationId, fx.conversationId))
		).filter(
			(task) => task.taskType === SEND_CONSULTANT_PREFERENCE_QUESTION_TASK
		);
		assert.equal(preferenceTasks.length, 0, "no preference task");
		assert.equal(session.workflowStage, "awaiting_slot_selection");
		assert.equal(session.selectedSlotId, null);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque no horário da primeira oferta pede Confirmar com o consultor do horário (B-1)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		await postText(app, fx, "Quero agendar");
		const session = await activeSessionOf(fx.leadId);
		const [, second] = await slotsOf(session.id);
		assert.ok(second);

		await postTap(app, fx, second.id);

		const after = await sessionOf(session.id);
		assert.equal(after.selectedSlotId, second.id);
		assert.equal(after.workflowStage, "awaiting_confirmation");
		const confirmation = (await outboundOf(fx.conversationId)).filter((row) =>
			buttonIdsOf(row).includes(`confirm:${second.id}`)
		);
		assert.equal(confirmation.length, 1, "one Confirmar/Não reply");
		const body = bodyOf(confirmation[0]);
		assert.match(body, CONFIRMATION_BODY);
		assert.ok(body.includes(` com ${second.consultantName}.`), body);
		assert.deepEqual(buttonIdsOf(confirmation[0]), [
			`confirm:${second.id}`,
			`cancel:${second.id}`,
		]);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("um único horário: Confirmar agenda (B-2)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const consultant = await anyActiveConsultant();
	mockSingleSlot(t, consultant);
	const fx = await createQualifiedLead();

	try {
		await postText(app, fx, "Quero agendar");
		const session = await activeSessionOf(fx.leadId);
		const [slot] = await slotsOf(session.id);
		assert.ok(slot);
		assert.equal(session.selectedSlotId, slot.id);
		assert.equal(session.workflowStage, "awaiting_confirmation");
		const offer = (await outboundOf(fx.conversationId)).filter(
			(row) => buttonIdsOf(row).length > 0
		);
		assert.equal(offer.length, 1);
		assert.deepEqual(buttonIdsOf(offer[0]), [
			`confirm:${slot.id}`,
			`cancel:${slot.id}`,
		]);

		await postTap(app, fx, `confirm:${slot.id}`);

		const saved = await db
			.select()
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.equal(saved.length, 1, "appointment created");
		assert.equal(saved[0]?.consultantId, consultant.id);
		assert.deepEqual(
			fake.createdEvents.map((event) => event.calendarId),
			[consultant.calendarId]
		);
		assert.ok(
			(await outboundOf(fx.conversationId)).some((row) =>
				bodyOf(row).startsWith("Agendamento confirmado para ")
			),
			"confirmation text queued"
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("Confirmar exige o selectedSlotId gravado (R-SCH-04)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		await postText(app, fx, "Quero agendar");
		const session = await activeSessionOf(fx.leadId);
		const [first, second] = await slotsOf(session.id);
		assert.ok(first);
		assert.ok(second);
		await postTap(app, fx, first.id);
		assert.equal((await sessionOf(session.id)).selectedSlotId, first.id);

		await postTap(app, fx, `confirm:${second.id}`);

		const saved = await db
			.select()
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.equal(saved.length, 0, "other slot never booked");
		assert.equal(fake.createdEvents.length, 0);
		const after = await sessionOf(session.id);
		assert.equal(after.selectedSlotId, first.id);
		assert.equal(after.status, "active");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque legado sessao:* numa oferta nova mostra horários que a etapa aceita: toque segue para Confirmar (F-T29-1, S-07)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		await postText(app, fx, "Quero agendar");
		const session = await activeSessionOf(fx.leadId);
		assert.equal(session.workflowStage, "awaiting_slot_selection");

		await postTap(app, fx, "sessao:continuar");
		const notice = (await outboundOf(fx.conversationId)).filter((row) =>
			bodyOf(row).startsWith("Esse botão é de uma mensagem antiga.")
		);
		assert.equal(notice.length, 1, "one stale-tap reply");
		const [offeredId] = buttonIdsOf(notice[0]);
		assert.ok(offeredId, "the reply carries slot buttons");

		await postTap(app, fx, offeredId);

		const after = await sessionOf(session.id);
		assert.equal(after.selectedSlotId, offeredId, "the stage accepts the tap");
		assert.equal(after.workflowStage, "awaiting_confirmation");
		assert.ok(
			(await outboundOf(fx.conversationId)).some((row) =>
				buttonIdsOf(row).includes(`confirm:${offeredId}`)
			),
			"Confirmar/Não sent"
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// --- tester (steps 30–31): no re-draw on redelivery or re-render; the AI
// never picks the consultant or the slot.

test("tester: reentrega do aceite e re-render (toque antigo) não sorteiam de novo; Confirmar mostra o mesmo consultor", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const payload = inboundWebhook(
			fx.phone,
			`wamid.accept_${crypto.randomUUID()}`,
			{
				text: { body: "Quero agendar" },
				type: "text",
			}
		);
		await postInbound(app, fx.conversationId, payload);
		const session = await activeSessionOf(fx.leadId);
		const before = await slotsOf(session.id);
		assert.equal(before.length, 3);

		// Meta redelivers the very same event.
		await postInbound(app, fx.conversationId, payload);
		const sessions = await db
			.select()
			.from(schedulingSessions)
			.where(eq(schedulingSessions.leadId, fx.leadId));
		assert.equal(sessions.length, 1, "redelivery creates no new offer");
		assert.deepEqual(await slotsOf(session.id), before, "slots untouched");

		// Re-render through the stale-tap reply: same slot ids, same consultants.
		await postTap(app, fx, "sessao:continuar");
		const notice = (await outboundOf(fx.conversationId)).filter((row) =>
			bodyOf(row).startsWith("Esse botão é de uma mensagem antiga.")
		);
		assert.equal(notice.length, 1);
		assert.deepEqual(
			buttonIdsOf(notice[0]),
			before.map((slot) => slot.id)
		);
		assert.deepEqual(await slotsOf(session.id), before, "no re-draw");

		const [, , third] = before;
		assert.ok(third);
		await postTap(app, fx, third.id);
		const confirmation = (await outboundOf(fx.conversationId)).find((row) =>
			buttonIdsOf(row).includes(`confirm:${third.id}`)
		);
		assert.ok(confirmation);
		assert.ok(
			bodyOf(confirmation).includes(
				` com ${third.consultantName}. Posso confirmar?`
			),
			bodyOf(confirmation)
		);
		const outbound = await outboundOf(fx.conversationId);
		assert.ok(
			!outbound.some((row) =>
				buttonIdsOf(row).some(
					(id) => id.startsWith("pref:") || id.startsWith("consultant:")
				)
			),
			"no preference or consultant buttons anywhere"
		);
		assert.ok(
			!outbound.some((row) => bodyOf(row).includes("preferência")),
			"preference question never sent"
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester: a IA não escolhe consultor nem horário, mesmo que a resposta dela nomeie outro", async (t) => {
	const { leadId } = await createQualifiedLead();

	try {
		const fake = mockExternal(t);
		const recording = new RecordingConsultantAvailability(fake);
		const consultantRows = await db
			.select()
			.from(consultantsTable)
			.where(eq(consultantsTable.active, true));
		const generate = ai.models.generateContent as unknown as {
			mock: { mockImplementation: (fn: () => Promise<unknown>) => void };
		};
		// The model tries to pick: names a consultant, invents ids and a time.
		generate.mock.mockImplementation(async () => ({
			text: JSON.stringify({
				businessAction: "offer_appointment",
				consultantId: consultantRows[0]?.id,
				evidenceUsed: [],
				leadUpdate: { status: "qualified" },
				nextAction: "offer_meeting",
				reply: `Agendei com ${consultantRows[0]?.name} amanhã às 03:00.`,
				selectedSlotId: crypto.randomUUID(),
				slotId: crypto.randomUUID(),
			}),
		}));

		const result = await generateMarianaResponse({
			currentMessages: ["Quero agendar com o primeiro consultor às 3h"],
			leadId,
			random: () => 0,
			schedulingAvailabilityService: new SchedulingAvailabilityService(
				recording
			),
		});
		const offer = result.schedulingOffer;
		assert.ok(offer, result.result.reply);
		// random 0 picks the first FREE one; the first ranked was made busy.
		const [, drawn] = recording.ranked;
		assert.ok(drawn);
		const slots = await slotsOf(offer.session.id);
		for (const slot of slots) {
			assert.equal(slot.consultantId, drawn.id, "backend draw wins");
		}
		assert.equal(offer.session.selectedSlotId, null, "AI never selects");
		assert.ok(
			!(result.assistantMessage?.content ?? "").includes("03:00"),
			"AI time text replaced by the backend offer"
		);
		const saved = await db
			.select()
			.from(appointments)
			.where(eq(appointments.leadId, leadId));
		assert.equal(saved.length, 0, "AI cannot book");
	} finally {
		await cleanup(leadId);
	}
});

// ---------------------------------------------------------------------------
// Step 33 (D-R2-5 a, D-R2-6 a; B-3, S-24, R-SCH-08): the slot is taken before
// Confirmar. Nothing is booked, the consultant is never swapped in silence,
// and the customer gets the re-offer text with a fresh draw.
// ---------------------------------------------------------------------------

const REOFFER_TEXT =
	"Esse horário acabou de ficar indisponível. Tenho estes outros horários:";
const NO_SLOTS_TEXT =
	"No momento, não encontrei horários disponíveis nos próximos 5 dias.";

function confirmTapPayload(phone: string, slotId: string, externalId: string) {
	return inboundWebhook(phone, externalId, {
		interactive: {
			button_reply: { id: `confirm:${slotId}`, title: "Confirmar" },
			type: "button_reply",
		},
		type: "interactive",
	});
}

/** Offer, then tap the 2nd slot: the session waits for Confirmar. */
async function offerAndPickSecond(
	app: ReturnType<typeof buildApp>,
	fx: InboundFixture & { leadId: string }
) {
	await postText(app, fx, "Quero agendar");
	const session = await activeSessionOf(fx.leadId);
	const [, second] = await slotsOf(session.id);
	assert.ok(second);
	await postTap(app, fx, second.id);
	const picked = await sessionOf(session.id);
	assert.equal(picked.selectedSlotId, second.id);
	assert.equal(picked.workflowStage, "awaiting_confirmation");
	return { second, session };
}

async function sessionsOfLead(leadId: string) {
	return await db
		.select()
		.from(schedulingSessions)
		.where(eq(schedulingSessions.leadId, leadId))
		.orderBy(asc(schedulingSessions.createdAt));
}

async function reofferRows(externalId: string) {
	return await db
		.select()
		.from(outboundMessages)
		.where(eq(outboundMessages.idempotencyKey, `reoffer:${externalId}`));
}

test("consultor do horário ocupado antes do Confirmar: nada agendado, nova oferta, consultor não trocado (S-24)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second, session } = await offerAndPickSecond(app, fx);
		const oldSlotIds = (await slotsOf(session.id)).map((slot) => slot.id);
		fake.busyCalendarIds.push(second.calendarId);

		const externalId = `wamid.confirm_${crypto.randomUUID()}`;
		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(fx.phone, second.id, externalId)
		);

		const saved = await db
			.select()
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.equal(saved.length, 0, "nothing booked");
		assert.equal(fake.createdEvents.length, 0, "no Calendar event");

		const reoffer = await reofferRows(externalId);
		assert.equal(reoffer.length, 1, "one re-offer reply");
		assert.equal(bodyOf(reoffer[0]), REOFFER_TEXT);

		const [oldSession, newSession, ...rest] = await sessionsOfLead(fx.leadId);
		assert.equal(rest.length, 0, "exactly one new session");
		assert.equal(oldSession?.id, session.id);
		assert.equal(oldSession?.status, "closed", "old offer closed");
		assert.ok(newSession);
		assert.equal(newSession.status, "active");
		assert.equal(newSession.workflowStage, "awaiting_slot_selection");
		assert.equal(newSession.selectedSlotId, null, "new selection required");

		const newSlots = await slotsOf(newSession.id);
		assert.ok(newSlots.length >= 2, "fresh slots offered");
		assert.deepEqual(
			buttonIdsOf(reoffer[0]),
			newSlots.map((slot) => slot.id)
		);
		for (const slot of newSlots) {
			assert.ok(!oldSlotIds.includes(slot.id), "new slot rows");
			assert.notEqual(
				slot.calendarId,
				second.calendarId,
				"busy consultant never drawn again"
			);
		}

		const [assistant] = await db
			.select()
			.from(messages)
			.where(eq(messages.id, reoffer[0]?.messageId ?? crypto.randomUUID()));
		assert.equal(assistant?.role, "assistant");
		assert.equal(assistant?.content, REOFFER_TEXT);
		assert.equal(assistant?.conversationId, fx.conversationId);

		const [event] = await db
			.select({ status: whatsappWebhookEvents.status })
			.from(whatsappWebhookEvents)
			.where(eq(whatsappWebhookEvents.externalId, externalId));
		assert.equal(event?.status, "processed");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("reoferta repetida pelo Meta responde uma vez (R-REL-02, S-24)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second } = await offerAndPickSecond(app, fx);
		fake.busyCalendarIds.push(second.calendarId);

		const externalId = `wamid.confirm_${crypto.randomUUID()}`;
		const payload = confirmTapPayload(fx.phone, second.id, externalId);
		await postInbound(app, fx.conversationId, payload);
		await postInbound(app, fx.conversationId, payload);
		// The task itself runs again (lease lost after the commit).
		await runTask(fx.conversationId, PROCESS_BUTTON_REPLY_TASK, {
			buttonId: `confirm:${second.id}`,
			eventExternalId: externalId,
			kind: "button_reply",
		});

		assert.equal((await reofferRows(externalId)).length, 1, "one re-offer");
		assert.equal(
			(await sessionsOfLead(fx.leadId)).length,
			2,
			"one fresh offer only"
		);
		const saved = await db
			.select()
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.equal(saved.length, 0);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("sem horários na reoferta: texto de sem horários (S-24, regressão do texto)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second, session } = await offerAndPickSecond(app, fx);
		const active = await db
			.select({ calendarId: consultantsTable.calendarId })
			.from(consultantsTable)
			.where(eq(consultantsTable.active, true));
		fake.busyCalendarIds.push(...active.map((row) => row.calendarId));

		const externalId = `wamid.confirm_${crypto.randomUUID()}`;
		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(fx.phone, second.id, externalId)
		);

		const reoffer = await reofferRows(externalId);
		assert.equal(reoffer.length, 1, "never silent");
		assert.deepEqual(reoffer[0]?.payload, {
			kind: "text",
			text: NO_SLOTS_TEXT,
		});
		const saved = await db
			.select()
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.equal(saved.length, 0);
		assert.equal(fake.createdEvents.length, 0);
		const sessions = await sessionsOfLead(fx.leadId);
		assert.equal(sessions.length, 1, "no new session without slots");
		assert.equal(
			(await sessionOf(session.id)).status,
			"closed",
			"the taken slot cannot be confirmed again"
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// ---------------------------------------------------------------------------
// Tester (steps 32–33 verification).
// ---------------------------------------------------------------------------

// Step 35 (D-R3-3 a; R-SCH-08, S-24): one line, singular.
const SINGLE_REOFFER_PREFIX =
	"Esse horário acabou de ficar indisponível. Tenho outro horário:";
const SINGLE_REOFFER_BODY = new RegExp(
	`^${SINGLE_REOFFER_PREFIX} .+ com (.+)\\. Posso confirmar\\?$`
);

test("tester: reoferta com um único horário novo vai com Confirmar/Não, mostra o consultor e o Confirmar agenda esse consultor (passo 33, desvio 1)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second, session } = await offerAndPickSecond(app, fx);
		const others = await db
			.select({
				calendarId: consultantsTable.calendarId,
				id: consultantsTable.id,
				name: consultantsTable.name,
			})
			.from(consultantsTable)
			.where(eq(consultantsTable.active, true));
		const other = others.find((c) => c.id !== second.consultantId);
		if (!other) {
			t.skip("seed has a single active consultant");
			return;
		}
		fake.busyCalendarIds.push(second.calendarId);
		// The fresh draw finds a single time: the same start, another consultant.
		t.mock.method(
			SchedulingAvailabilityService.prototype,
			"getAvailableSlots",
			async () => [
				{ consultant: other, end: second.endAt, start: second.startAt },
			]
		);

		const externalId = `wamid.confirm_${crypto.randomUUID()}`;
		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(fx.phone, second.id, externalId)
		);

		assert.equal(fake.createdEvents.length, 0, "nothing booked yet");
		const reoffer = await reofferRows(externalId);
		assert.equal(reoffer.length, 1, "one re-offer reply");
		const body = bodyOf(reoffer[0]);
		const match = SINGLE_REOFFER_BODY.exec(body);
		assert.ok(match, body);
		assert.equal(match[1], other.name, "new consultant shown before Confirmar");

		const [, fresh, ...rest] = await sessionsOfLead(fx.leadId);
		assert.equal(rest.length, 0);
		assert.ok(fresh);
		assert.equal(fresh.status, "active");
		assert.equal(fresh.workflowStage, "awaiting_confirmation");
		const [onlySlot, ...more] = await slotsOf(fresh.id);
		assert.ok(onlySlot);
		assert.equal(more.length, 0);
		assert.equal(fresh.selectedSlotId, onlySlot.id);
		assert.equal(onlySlot.consultantId, other.id);
		assert.equal(
			body,
			`Esse horário acabou de ficar indisponível. Tenho outro horário: ${formatSlotDate(onlySlot.startAt)} com ${other.name}. Posso confirmar?`
		);
		assert.deepEqual(buttonIdsOf(reoffer[0]), [
			`confirm:${onlySlot.id}`,
			`cancel:${onlySlot.id}`,
		]);
		const [assistant] = await db
			.select()
			.from(messages)
			.where(eq(messages.id, reoffer[0]?.messageId ?? crypto.randomUUID()));
		assert.equal(assistant?.content, body, "assistant row = sent text");
		assert.equal((await sessionOf(session.id)).status, "closed");

		// The old Confirmar is refused; the new one books the shown consultant.
		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(
				fx.phone,
				second.id,
				`wamid.oldconfirm_${crypto.randomUUID()}`
			)
		);
		assert.equal(fake.createdEvents.length, 0, "old slot never booked");
		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(
				fx.phone,
				onlySlot.id,
				`wamid.newconfirm_${crypto.randomUUID()}`
			)
		);
		const saved = await db
			.select()
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.equal(saved.length, 1);
		assert.equal(saved[0]?.consultantId, other.id);
		assert.deepEqual(
			fake.createdEvents.map((event) => event.calendarId),
			[other.calendarId]
		);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester: reoferta é atômica — falha no outbox não deixa sessão nova nem linha do assistente; a nova tentativa responde uma vez (passo 33)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();
	const externalId = `wamid.confirm_${crypto.randomUUID()}`;
	const fn = `tester_fail_reoffer_${crypto.randomUUID().replaceAll("-", "")}`;

	try {
		const { second, session } = await offerAndPickSecond(app, fx);
		fake.busyCalendarIds.push(second.calendarId);
		await db.execute(
			sql.raw(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$
			BEGIN
				IF NEW."idempotencyKey" = 'reoffer:${externalId}' THEN
					RAISE EXCEPTION 'tester injected re-offer outbox failure';
				END IF;
				RETURN NEW;
			END; $$ LANGUAGE plpgsql`)
		);
		await db.execute(
			sql.raw(
				`CREATE TRIGGER ${fn} BEFORE INSERT ON "outbound_messages" FOR EACH ROW EXECUTE FUNCTION ${fn}()`
			)
		);

		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(fx.phone, second.id, externalId)
		);

		assert.equal((await reofferRows(externalId)).length, 0);
		const sessions = await sessionsOfLead(fx.leadId);
		assert.equal(sessions.length, 1, "no new session after rollback");
		const old = await sessionOf(session.id);
		assert.equal(old.status, "active", "old session untouched by rollback");
		const reofferRowsInConversation = await db
			.select()
			.from(messages)
			.where(
				and(
					eq(messages.conversationId, fx.conversationId),
					eq(messages.content, REOFFER_TEXT)
				)
			);
		assert.equal(reofferRowsInConversation.length, 0, "no orphan assistant");

		await db.execute(
			sql.raw(
				`DROP TRIGGER ${fn} ON "outbound_messages"; DROP FUNCTION ${fn}()`
			)
		);
		await db
			.update(autonomousTasks)
			.set({ availableAt: new Date(0) })
			.where(eq(autonomousTasks.conversationId, fx.conversationId));
		await drainConversationWork(fx.conversationId);

		assert.equal((await reofferRows(externalId)).length, 1, "one re-offer");
		assert.equal((await sessionsOfLead(fx.leadId)).length, 2);
		assert.equal(fake.createdEvents.length, 0);
	} finally {
		await db.execute(
			sql.raw(
				`DROP TRIGGER IF EXISTS ${fn} ON "outbound_messages"; DROP FUNCTION IF EXISTS ${fn}()`
			)
		);
		await cleanup(fx.leadId, fx.phone);
	}
});

// Step 34 (F-T32-1): a tap the stage refuses gets the stale-tap reply
// (notice + buttons of the current stage), never silence.
test("tester: depois da reoferta, toque num horário da oferta antiga responde, nunca silêncio", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second, session } = await offerAndPickSecond(app, fx);
		const [first] = await slotsOf(session.id);
		assert.ok(first);
		fake.busyCalendarIds.push(second.calendarId);
		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(fx.phone, second.id, `wamid.c_${crypto.randomUUID()}`)
		);
		const before = (await outboundOf(fx.conversationId)).length;

		await postTap(app, fx, first.id);

		assert.equal(
			(await outboundOf(fx.conversationId)).length,
			before + 1,
			"old-offer slot tap gets one reply"
		);
		assert.equal(fake.createdEvents.length, 0);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester: depois da reoferta, Confirmar antigo responde, nunca silêncio", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second } = await offerAndPickSecond(app, fx);
		fake.busyCalendarIds.push(second.calendarId);
		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(fx.phone, second.id, `wamid.c_${crypto.randomUUID()}`)
		);
		const before = (await outboundOf(fx.conversationId)).length;

		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(fx.phone, second.id, `wamid.c2_${crypto.randomUUID()}`)
		);

		assert.equal(
			(await outboundOf(fx.conversationId)).length,
			before + 1,
			"old Confirmar gets one reply"
		);
		assert.equal(fake.createdEvents.length, 0);
		const saved = await db
			.select({ id: appointments.id })
			.from(appointments)
			.where(eq(appointments.leadId, fx.leadId));
		assert.equal(saved.length, 0, "no new appointment");
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

async function staleTapRows(externalId: string) {
	return await db
		.select()
		.from(outboundMessages)
		.where(eq(outboundMessages.idempotencyKey, `stale-tap:${externalId}`));
}

function cancelTapPayload(phone: string, slotId: string, externalId: string) {
	return inboundWebhook(phone, externalId, {
		interactive: {
			button_reply: { id: `cancel:${slotId}`, title: "Não" },
			type: "button_reply",
		},
		type: "interactive",
	});
}

test("Não (cancel:) de uma oferta antiga responde aviso + botões atuais (passo 34, R-SCH-03)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second } = await offerAndPickSecond(app, fx);
		fake.busyCalendarIds.push(second.calendarId);
		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(fx.phone, second.id, `wamid.c_${crypto.randomUUID()}`)
		);
		const fresh = await activeSessionOf(fx.leadId);
		const freshSlots = await slotsOf(fresh.id);
		const stageBefore = fresh.workflowStage;

		const externalId = `wamid.cancel_${crypto.randomUUID()}`;
		await postInbound(
			app,
			fx.conversationId,
			cancelTapPayload(fx.phone, second.id, externalId)
		);

		const rows = await staleTapRows(externalId);
		assert.equal(rows.length, 1, "one stale-tap reply");
		assert.ok(bodyOf(rows[0]).startsWith(STALE_TAP_NOTICE), bodyOf(rows[0]));
		if (stageBefore === "awaiting_confirmation") {
			assert.deepEqual(buttonIdsOf(rows[0]), [
				`confirm:${fresh.selectedSlotId}`,
				`cancel:${fresh.selectedSlotId}`,
			]);
		} else {
			assert.deepEqual(
				buttonIdsOf(rows[0]),
				freshSlots.map((slot) => slot.id)
			);
		}
		const after = await sessionOf(fresh.id);
		assert.equal(after.status, "active", "current offer untouched");
		assert.equal(after.workflowStage, stageBefore);
		assert.equal(fake.createdEvents.length, 0);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque recusado repetido pelo Meta responde uma vez (passo 34, R-REL-02)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second } = await offerAndPickSecond(app, fx);
		fake.busyCalendarIds.push(second.calendarId);
		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(fx.phone, second.id, `wamid.c_${crypto.randomUUID()}`)
		);

		const externalId = `wamid.oldconfirm_${crypto.randomUUID()}`;
		const payload = confirmTapPayload(fx.phone, second.id, externalId);
		await postInbound(app, fx.conversationId, payload);
		await postInbound(app, fx.conversationId, payload);
		await runTask(fx.conversationId, PROCESS_BUTTON_REPLY_TASK, {
			buttonId: `confirm:${second.id}`,
			eventExternalId: externalId,
		});

		assert.equal((await staleTapRows(externalId)).length, 1, "one reply");
		assert.equal(fake.createdEvents.length, 0);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("toque recusado numa conversa já fechada não responde (passo 34, R-SES-01, S-23)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second } = await offerAndPickSecond(app, fx);
		await db
			.update(conversations)
			.set({ status: "closed" })
			.where(eq(conversations.id, fx.conversationId));

		const before = (await outboundOf(fx.conversationId)).length;
		const externalId = `wamid.closed_${crypto.randomUUID()}`;
		await runTask(fx.conversationId, PROCESS_BUTTON_REPLY_TASK, {
			buttonId: `cancel:${crypto.randomUUID()}`,
			eventExternalId: externalId,
		});
		await runTask(fx.conversationId, SEND_CONFIRMATION_REQUEST_TASK, {
			buttonId: crypto.randomUUID(),
			eventExternalId: `${externalId}_slot`,
		});

		assert.equal((await staleTapRows(externalId)).length, 0);
		assert.equal((await staleTapRows(`${externalId}_slot`)).length, 0);
		assert.equal((await outboundOf(fx.conversationId)).length, before);
		assert.equal(fake.createdEvents.length, 0);
		assert.ok(second);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

// Tester V3-a (passo 34): bordas que o plano não cobria.
test("tester: toque recusado de lead que pediu para parar não chega ao WhatsApp (passo 34, opt-out)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		await offerAndPickSecond(app, fx);
		await db
			.update(conversations)
			.set({ optOutAt: new Date() })
			.where(eq(conversations.id, fx.conversationId));
		const sendText = WhatsAppService.prototype.sendTextMessage as unknown as {
			mock: { callCount: () => number };
		};
		const sendButtons = WhatsAppService.prototype
			.sendReplyButtonsMessage as unknown as {
			mock: { callCount: () => number };
		};
		const sendsBefore =
			sendText.mock.callCount() + sendButtons.mock.callCount();

		const externalId = `wamid.optout_${crypto.randomUUID()}`;
		await runTask(fx.conversationId, PROCESS_BUTTON_REPLY_TASK, {
			buttonId: `cancel:${crypto.randomUUID()}`,
			eventExternalId: externalId,
		});
		await drainConversationWork(fx.conversationId);

		assert.equal(
			sendText.mock.callCount() + sendButtons.mock.callCount(),
			sendsBefore,
			"no WhatsApp call for an opted-out lead"
		);
		for (const row of await staleTapRows(externalId)) {
			assert.notEqual(row.status, "sent");
			assert.equal(row.providerMessageId, null);
		}
		assert.equal(fake.createdEvents.length, 0);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester: Confirmar com appointment_failed não recebe o aviso de botão antigo (passo 34, exclusão)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second } = await offerAndPickSecond(app, fx);
		t.mock.method(
			SchedulingConfirmationOrchestrator.prototype,
			"execute",
			async () => ({
				ok: false as const,
				reason: "appointment_failed" as const,
			})
		);
		const externalId = `wamid.apfail_${crypto.randomUUID()}`;
		await runTask(fx.conversationId, PROCESS_BUTTON_REPLY_TASK, {
			buttonId: `confirm:${second.id}`,
			eventExternalId: externalId,
		});
		assert.equal((await staleTapRows(externalId)).length, 0);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});

test("tester: Confirmar com slot_unavailable recebe só a reoferta, nunca o aviso (passo 34, exclusão)", async (t) => {
	const app = buildApp();
	t.after(() => app.close());
	const fake = mockExternal(t);
	const fx = await createQualifiedLead();

	try {
		const { second } = await offerAndPickSecond(app, fx);
		fake.busyCalendarIds.push(second.calendarId);
		const externalId = `wamid.unav_${crypto.randomUUID()}`;
		await postInbound(
			app,
			fx.conversationId,
			confirmTapPayload(fx.phone, second.id, externalId)
		);
		assert.equal((await reofferRows(externalId)).length, 1);
		assert.equal((await staleTapRows(externalId)).length, 0);
	} finally {
		await cleanup(fx.leadId, fx.phone);
	}
});
