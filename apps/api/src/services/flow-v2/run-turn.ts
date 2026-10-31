/**
 * Orquestração do turno da v2 (2026-10-28-flow-v2, A3). Um responsável por
 * turno: automação (texto fixo / botões) ou a IA (`understand`, lote B).
 *
 * Ordem: estado sem lock → roteador puro → `understand` (fora da tx) →
 * Calendar (fora da tx) → uma tx: lead travado, conversa ainda ativa (senão
 * `TurnSupersededError`), linha da assistente, oferta, outbox (chave
 * `runKey`) e mensagens do lote processadas → um `mariana_turn`.
 */
import { eq, inArray } from "drizzle-orm";
import { resolveModelName } from "../../ai/model-config";
import { ModelUnavailableError } from "../../ai/model-errors";
import { db } from "../../db/connections";
import {
	conversations,
	leads,
	messages,
	outboundMessages,
} from "../../db/schema";
import { env } from "../../env";
import {
	type CalendarEventRef,
	GoogleCalendarService,
} from "../../integrations/google-calendar/google-calendar-service";
import {
	hashText,
	logTurnTrace,
	type TurnGuardReason,
	type TurnIntent,
	type TurnOutcome,
	type TurnResponder,
	type TurnRoute,
} from "../../lib/turn-trace";
import { SchedulingAvailabilityService } from "../calendar/scheduling-availability";
import {
	buildCurrentStagePayload,
	type CurrentStagePayload,
} from "../conversations/stale-tap-reply";
import { TurnSupersededError } from "../conversations/turn-superseded-error";
import {
	enqueueOutboundMessage,
	type OutboundMessagePayload,
} from "../messaging/outbound-messages";
import { mergeLeadFields, statesMinor } from "./lead-fields";
import { checkReply } from "./reply-guard";
import { routeStartScheduling, routeTurn, routeUnderstood } from "./router";
import {
	type FlowV2Tx,
	insertAssistantRow,
	markLeadReadyForScheduling,
	prepareSchedulingOffer,
	type SchedulingOfferPreparation,
	writeSchedulingReply,
} from "./start-scheduling";
import { loadTurnState, type TurnState } from "./state";
import {
	buildAppointmentInfoText,
	buildDeclineText,
	buildWelcomeText,
	CONSULTANT_BUTTON,
	firstNameForGreeting,
	T_AI_FALLBACK,
	T_ASK_OBJECTIVE,
	T_GREETING_AGAIN,
	T_RESCHEDULE,
	T_SENSITIVE,
	T_STATUS_CONFIRM,
	T_STATUS_SLOT,
	T_UNDER_18,
} from "./texts";
import {
	runUnderstand,
	type UnderstandFields,
	type UnderstandMetadata,
	type UnderstandResult,
} from "./understand";

export type { UnderstandResult } from "./understand";

/** `metadata` só vem da chamada real (modelo, uso); fakes de teste omitem. */
export type UnderstandFn = (input: {
	conversationId: string;
	currentMessageIds: string[];
	currentMessages: string[];
	leadId: string;
	/** `messageCutoff` do lote: cliente mais novo fica fora do histórico. */
	messageCutoff?: Date;
	state: TurnState;
}) => Promise<UnderstandResult & { metadata?: UnderstandMetadata }>;

export interface FlowV2Deps {
	availability?: SchedulingAvailabilityService;
	/** C-MEET: link da sala do Meet do evento (null = sem sala). */
	meetLink?: (ref: CalendarEventRef) => Promise<string | null>;
	/** C-MEET: linha datada na descrição do evento (remarcação). */
	notifyReschedule?: (
		input: CalendarEventRef & { line: string }
	) => Promise<void>;
	now?: () => Date;
	random?: () => number;
	understand?: UnderstandFn;
}

export type FlowV2TurnResult =
	| { assistantMessageId: string; route: TurnRoute; status: "queued" }
	| { route: "R1"; status: "no_reply" }
	| { status: "deduplicated" };

/** B3: a chamada real (Gemini), com a dica de estado montada pelo backend. */
const defaultUnderstand: UnderstandFn = async ({
	conversationId,
	currentMessageIds,
	currentMessages,
	messageCutoff,
	state,
}) => {
	const { metadata, result } = await runUnderstand({
		conversationId,
		currentMessageIds,
		currentMessages,
		cutoff: messageCutoff,
		hint: {
			firstName: firstNameForGreeting(state.lead.name, state.lead.phone),
			futureAppointment: state.futureAppointment,
			objectiveKnown: Boolean(state.lead.objective?.trim()),
			schedulingStage: state.activeSession?.workflowStage ?? null,
		},
	});
	return { ...result, metadata };
};

const defaultAvailability = new SchedulingAvailabilityService();
const defaultGoogleCalendar = new GoogleCalendarService();

const defaultMeetLink = (ref: CalendarEventRef) =>
	defaultGoogleCalendar.getMeetLink(ref);

const defaultNotifyReschedule = (input: CalendarEventRef & { line: string }) =>
	defaultGoogleCalendar.appendEventDescription(input);

const REQUEST_DATE = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "2-digit",
	timeZone: "America/Sao_Paulo",
	year: "numeric",
});

/** Data do pedido sem hora; o fuso é o da operação (São Paulo). */
function rescheduleLine(now: Date): string {
	return `Cliente pediu remarcação pelo WhatsApp em ${REQUEST_DATE.format(now)}.`;
}

type Plan =
	| { kind: "silent" }
	| {
			kind: "reply";
			payload: OutboundMessagePayload;
			/** C2: `R7d` grava o pedido de remarcação depois do write. */
			rescheduleAppointmentId?: string | null;
			/** C-MEET: evento a marcar com a linha datada, também após o write. */
			rescheduleEvent?: CalendarEventRef | null;
			responder: TurnResponder;
			route: TurnRoute;
	  }
	| { kind: "offer"; offer: SchedulingOfferPreparation };

interface TraceContext {
	conversationId: string;
	/** Campos do `understand` a gravar na transação do turno. */
	fields?: UnderstandFields;
	guardReason?: TurnGuardReason;
	guardRejected?: boolean;
	intent?: TurnIntent;
	latencyMs: number | null;
	leadId: string;
	metadata?: UnderstandMetadata;
	rawReply: string | null;
	requestedNextAction: string;
	stage: string;
	turnId: string;
}

function payloadText(payload: OutboundMessagePayload): string {
	return payload.kind === "text" ? payload.text : payload.body;
}

function text(
	route: TurnRoute,
	value: string,
	responder: TurnResponder = "automation"
): Plan {
	return {
		kind: "reply",
		payload: { kind: "text", text: value },
		responder,
		route,
	};
}

function withConsultantButton(
	route: TurnRoute,
	body: string,
	responder: TurnResponder
): Plan {
	return {
		kind: "reply",
		payload: { body, buttons: [{ ...CONSULTANT_BUTTON }], kind: "buttons" },
		responder,
		route,
	};
}

/** C1/R7e: os botões da etapa atual, nunca o botão de consultor. */
function withStageButtons(
	route: TurnRoute,
	body: string,
	responder: TurnResponder,
	stage: CurrentStagePayload
): Plan {
	return {
		kind: "reply",
		payload: { body, buttons: stage.buttons, kind: "buttons" },
		responder,
		route,
	};
}

/** Texto fixo de estado da etapa (C1): escolher horário ou confirmar. */
function currentStateText(stage: CurrentStagePayload): string {
	return stage.stage === "awaiting_confirmation"
		? `${T_STATUS_CONFIRM}\n${stage.body}`
		: T_STATUS_SLOT;
}

function emitTrace(
	context: TraceContext,
	{
		outcome,
		payload,
		postTurnStage,
		responder,
		route,
	}: {
		outcome: TurnOutcome;
		payload?: OutboundMessagePayload;
		postTurnStage?: string;
		responder: TurnResponder;
		route?: TurnRoute;
	}
) {
	const sent = payload ? payloadText(payload) : null;
	logTurnTrace({
		actionBlockedReason: null,
		commercialAccessLevel: null,
		conversationId: context.conversationId,
		executedAction: route ?? "none",
		finishReason: context.metadata?.finishReason ?? null,
		flow: "v2",
		...(context.guardReason ? { guardReason: context.guardReason } : {}),
		...(context.guardRejected === undefined
			? {}
			: { guardRejected: context.guardRejected }),
		guardrailLayer: null,
		...(context.intent ? { intent: context.intent } : {}),
		latencyMs: context.latencyMs,
		leadId: context.leadId,
		maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS,
		model: resolveModelName(),
		modelVersionReturned: context.metadata?.modelVersionReturned ?? null,
		outcome,
		postTurnStage: postTurnStage ?? context.stage,
		pureBackendText: responder === "automation",
		questionKey: null,
		rawReplyHash: context.rawReply === null ? null : hashText(context.rawReply),
		rawReplyLength: context.rawReply?.length ?? null,
		requestedNextAction: context.requestedNextAction,
		responder,
		rewrites: [],
		rewritesReported: true,
		...(route ? { route } : {}),
		sentReplyHash: sent === null ? null : hashText(sent),
		sentReplyLength: sent?.length ?? null,
		stage: context.stage,
		temperature: env.GEMINI_TEMPERATURE,
		thinkingLevel: env.GEMINI_THINKING_LEVEL,
		turnId: context.turnId,
		usage: context.metadata?.usage ?? {
			candidatesTokens: null,
			promptTokens: null,
			thoughtsTokens: null,
			totalTokens: null,
		},
	});
}

/**
 * R8: idade, reunião futura, etapa ativa, objetivo, e só então o Calendar.
 * A IA nunca decide isso; o objetivo vindo dela só preenche um campo vazio.
 */
async function planStartScheduling({
	conversationId,
	deps,
	leadId,
	now,
	objectiveFromAi,
	state,
	statedMinor,
}: {
	conversationId: string;
	deps: FlowV2Deps;
	leadId: string;
	now: Date;
	objectiveFromAi: string | null;
	state: TurnState;
	/** A idade dita neste turno (calculada pelo backend) é de menor. */
	statedMinor: boolean;
}): Promise<Plan> {
	const route = routeStartScheduling({
		askedObjective: state.askedObjective,
		hasActiveSession: state.activeSession !== null,
		hasFutureAppointment: state.futureAppointment !== null,
		objectiveKnown: Boolean(state.lead.objective?.trim() || objectiveFromAi),
		underAge: state.underAge || statedMinor,
	});

	if (route === "R8-under-18") {
		return text(route, T_UNDER_18);
	}
	if (route === "R8-appointment-info" && state.futureAppointment) {
		return text(route, buildAppointmentInfoText(state.futureAppointment));
	}
	if (route === "R8-ask-objective") {
		return text(route, T_ASK_OBJECTIVE);
	}
	if (route === "R8-stage-buttons") {
		// Sem Calendar e sem trocar a sessão: os botões da etapa atual.
		const stage = await buildCurrentStagePayload(db, conversationId);
		if (stage) {
			return {
				kind: "reply",
				payload: { body: stage.body, buttons: stage.buttons, kind: "buttons" },
				responder: "automation",
				route,
			};
		}
	}

	await markLeadReadyForScheduling(db, {
		conversationId,
		leadId,
		now,
		objective: objectiveFromAi,
	});
	const offer = await prepareSchedulingOffer({
		availability: deps.availability ?? defaultAvailability,
		conversationId,
		leadId,
		now,
		random: deps.random ?? Math.random,
	});
	return { kind: "offer", offer };
}

async function lockLeadAndCheckActive(
	tx: FlowV2Tx,
	leadId: string,
	conversationId: string
) {
	await tx
		.select({ id: leads.id })
		.from(leads)
		.where(eq(leads.id, leadId))
		.for("update");

	const [current] = await tx
		.select({ status: conversations.status })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);

	if (current?.status !== "active") {
		throw new TurnSupersededError(conversationId);
	}
}

/**
 * Uma transação: estado + outbox (R-REL-06). `null` quando a `runKey` já tem
 * resposta no outbox (reentrega): nada é gravado de novo.
 */
async function writePlan({
	conversationId,
	eventId,
	fields,
	leadId,
	messageIds,
	now,
	plan,
	runKey,
}: {
	conversationId: string;
	eventId?: string;
	fields?: UnderstandFields;
	leadId: string;
	messageIds: string[];
	now: Date;
	plan: Exclude<Plan, { kind: "silent" }>;
	runKey: string;
}): Promise<{
	assistantMessageId: string;
	payload: OutboundMessagePayload;
	rescheduleAppointmentId?: string | null;
	rescheduleEvent?: CalendarEventRef | null;
	responder: TurnResponder;
	route: TurnRoute;
} | null> {
	return await db.transaction(async (tx) => {
		await lockLeadAndCheckActive(tx, leadId, conversationId);

		if (messageIds.length > 0) {
			await tx
				.update(messages)
				.set({ processedAt: now })
				.where(inArray(messages.id, messageIds));
		}

		const [existing] = await tx
			.select({ id: outboundMessages.id })
			.from(outboundMessages)
			.where(eq(outboundMessages.idempotencyKey, runKey))
			.limit(1);

		if (existing) {
			return null;
		}

		// B3: campos do `understand`, validados pelo backend, sob o lock do lead.
		if (fields) {
			await mergeLeadFields(tx, { fields, leadId, now });
		}

		const written =
			plan.kind === "offer"
				? {
						...(await writeSchedulingReply(tx, {
							conversationId,
							leadId,
							now,
							offer: plan.offer,
						})),
						responder: "automation" as const,
					}
				: {
						assistantMessageId: await insertAssistantRow(
							tx,
							conversationId,
							payloadText(plan.payload)
						),
						payload: plan.payload,
						rescheduleAppointmentId: plan.rescheduleAppointmentId,
						rescheduleEvent: plan.rescheduleEvent,
						responder: plan.responder,
						route: plan.route,
					};

		await enqueueOutboundMessage({
			conversationId,
			eventId,
			executor: tx,
			idempotencyKey: runKey,
			leadId,
			messageId: written.assistantMessageId,
			payload: written.payload,
		});

		return written;
	});
}

async function runPlanned({
	context,
	conversationId,
	deps,
	eventId,
	leadId,
	makePlan,
	messageIds,
	now,
	runKey,
}: {
	context: TraceContext;
	conversationId: string;
	deps: FlowV2Deps;
	eventId?: string;
	leadId: string;
	makePlan: () => Promise<Plan>;
	messageIds: string[];
	now: Date;
	runKey: string;
}): Promise<FlowV2TurnResult> {
	try {
		const plan = await makePlan();

		if (plan.kind === "silent") {
			// R1: opt-out. Nenhuma resposta; o lote não roda de novo.
			if (messageIds.length > 0) {
				await db
					.update(messages)
					.set({ processedAt: now })
					.where(inArray(messages.id, messageIds));
			}
			emitTrace(context, {
				outcome: "no_reply",
				responder: "none",
				route: "R1",
			});
			return { route: "R1", status: "no_reply" };
		}

		const written = await writePlan({
			conversationId,
			eventId,
			fields: context.fields,
			leadId,
			messageIds,
			now,
			plan,
			runKey,
		});

		if (!written) {
			// Dedup (N4): a reentrega não é um turno; sem `mariana_turn`.
			return { status: "deduplicated" };
		}

		// C2: o pedido só é registrado depois de uma gravação de verdade.
		// Nunca o texto da mensagem nem o telefone (regra de privacidade).
		if (written.rescheduleAppointmentId !== undefined) {
			console.info(
				JSON.stringify({
					appointmentId: written.rescheduleAppointmentId,
					event: "mariana_reschedule_request",
					flow: "v2",
					leadId,
				})
			);
		}

		// C-MEET: mesma regra; falha no Calendar não derruba o turno já gravado.
		if (written.rescheduleEvent) {
			try {
				await (deps.notifyReschedule ?? defaultNotifyReschedule)({
					...written.rescheduleEvent,
					line: rescheduleLine(now),
				});
			} catch {
				console.error(
					JSON.stringify({
						appointmentId: written.rescheduleAppointmentId ?? null,
						event: "calendar_reschedule_note_failed",
						flow: "v2",
					})
				);
			}
		}

		const firstButton =
			written.payload.kind === "buttons" ? written.payload.buttons[0] : null;
		let postTurnStage: string | undefined;
		if (written.route === "R8-slots") {
			postTurnStage = firstButton?.id.startsWith("confirm:")
				? "awaiting_confirmation"
				: "awaiting_slot_selection";
		}

		emitTrace(context, {
			outcome: "replied",
			payload: written.payload,
			postTurnStage,
			responder: written.responder,
			route: written.route,
		});

		return {
			assistantMessageId: written.assistantMessageId,
			route: written.route,
			status: "queued",
		};
	} catch (error) {
		emitTrace(context, {
			outcome: outcomeOf(error),
			responder: "none",
		});
		throw error;
	}
}

/** R1, R4, R5 e R6-não: só automação, sem IA e sem Calendar. */
async function planAutomationRoute(
	route: "R1" | "R4" | "R5" | "R6-decline",
	state: TurnState,
	conversationId: string
): Promise<Plan> {
	if (route === "R1") {
		return { kind: "silent" };
	}
	if (route === "R4") {
		return text(
			"R4",
			buildWelcomeText({
				conversationId,
				name: state.lead.name,
				phone: state.lead.phone,
			})
		);
	}
	if (route === "R6-decline") {
		return text("R6-decline", buildDeclineText(conversationId));
	}

	const stage = state.activeSession
		? await buildCurrentStagePayload(db, conversationId)
		: null;
	if (!stage) {
		return text("R5", T_GREETING_AGAIN);
	}
	return {
		kind: "reply",
		payload: {
			body: `${T_GREETING_AGAIN}\n${stage.body}`,
			buttons: stage.buttons,
			kind: "buttons",
		},
		responder: "automation",
		route: "R5",
	};
}

/** Resposta com os botões da etapa ativa, ou com o botão de consultor. */
async function withStageOrConsultant({
	body,
	conversationId,
	stageRoute,
	state,
	responder,
	buttonRoute,
}: {
	body: string;
	buttonRoute: TurnRoute;
	conversationId: string;
	responder: TurnResponder;
	stageRoute: TurnRoute;
	state: TurnState;
}): Promise<Plan> {
	const stage = state.activeSession
		? await buildCurrentStagePayload(db, conversationId)
		: null;
	if (stage) {
		return withStageButtons(stageRoute, body, responder, stage);
	}
	// Q4/C2: reunião futura → resposta de IA sem botão nenhum.
	if (state.futureAppointment) {
		return text(buttonRoute, body, responder);
	}
	return withConsultantButton(buttonRoute, body, responder);
}

/** Texto fixo de estado, ou `null` quando a sessão sumiu (aí a IA responde). */
async function planStatusReply(conversationId: string): Promise<Plan | null> {
	const stage = await buildCurrentStagePayload(db, conversationId);
	return stage
		? withStageButtons(
				"R7e-status",
				currentStateText(stage),
				"automation",
				stage
			)
		: null;
}

/** Q5: a resposta vai inteira ou é trocada inteira por T-AI-FALLBACK. */
function passGuard(reply: string | null, context: TraceContext): string | null {
	const candidate = reply?.trim() ? reply : null;
	if (candidate === null) {
		return null;
	}
	const guard = checkReply(candidate);
	context.guardRejected = !guard.ok;
	if (guard.ok) {
		return candidate;
	}
	context.guardReason = guard.reason;
	return null;
}

/** R7a–R7e a partir do que a IA entendeu; a resposta da IA passa pelo filtro. */
async function planUnderstood(
	conversationId: string,
	state: TurnState,
	understood: UnderstandResult,
	context: TraceContext,
	deps: FlowV2Deps,
	startScheduling: (
		objectiveFromAi: string | null,
		statedMinor: boolean
	) => Promise<Plan>,
	now: Date
): Promise<Plan> {
	const objectiveFromAi = understood.fields.objective?.trim() || null;
	const { route } = routeUnderstood(
		{
			hasActiveSession: state.activeSession !== null,
			hasFutureAppointment: state.futureAppointment !== null,
			pendingOffer: state.pendingOffer,
		},
		{
			hasObjective: objectiveFromAi !== null,
			intent: understood.intent,
			reply: understood.reply,
		}
	);

	if (route === "R7a") {
		return await startScheduling(
			objectiveFromAi,
			statesMinor(understood.fields, now)
		);
	}
	if (route === "R7b") {
		// A4-N3/C1: durante o agendamento os botões são os da etapa.
		return await withStageOrConsultant({
			body: T_SENSITIVE,
			buttonRoute: "R7b",
			conversationId,
			responder: "automation",
			stageRoute: "R7b",
			state,
		});
	}
	if (route === "R7e-status") {
		const plan = await planStatusReply(conversationId);
		if (plan) {
			return plan;
		}
	}
	if (route === "R7-appointment-info" && state.futureAppointment) {
		return await appointmentInfoPlan(state.futureAppointment, deps);
	}

	const reply = passGuard(understood.reply, context);

	// C2: remarcar/cancelar usa o texto fixo aprovado, sem IA e sem botão.
	if (route === "R7d") {
		return reschedulePlan(state);
	}
	if (route === "R7c" && reply) {
		// R7e: a resposta da IA vai com os botões da etapa atual.
		return await withStageOrConsultant({
			body: reply,
			buttonRoute: "R7c",
			conversationId,
			responder: "ai",
			stageRoute: "R7e",
			state,
		});
	}
	return await withStageOrConsultant({
		body: T_AI_FALLBACK,
		buttonRoute: "R7c-fallback",
		conversationId,
		responder: "automation",
		stageRoute: "R7c-fallback",
		state,
	});
}

/** C2/R7d: T-RESCHEDULE, sem botão; o pedido é registrado depois do write. */
function reschedulePlan(state: TurnState): Plan {
	const appointment = state.futureAppointment;
	return {
		kind: "reply",
		payload: { kind: "text", text: T_RESCHEDULE },
		rescheduleAppointmentId: appointment?.id ?? null,
		rescheduleEvent: appointment
			? {
					calendarId: appointment.calendarId,
					consultantId: appointment.consultantId,
					eventId: appointment.externalEventId,
				}
			: null,
		responder: "automation",
		route: "R7d",
	};
}

/**
 * C-MEET: T-APPOINTMENT-INFO com o link lido do evento. Sem link (ou falha na
 * leitura), o texto vai sem ele e o log não leva dado do cliente.
 */
async function appointmentInfoPlan(
	appointment: NonNullable<TurnState["futureAppointment"]>,
	deps: FlowV2Deps
): Promise<Plan> {
	let meetLink: string | null = null;
	try {
		meetLink = await (deps.meetLink ?? defaultMeetLink)({
			calendarId: appointment.calendarId,
			consultantId: appointment.consultantId,
			eventId: appointment.externalEventId,
		});
	} catch {
		meetLink = null;
	}

	if (!meetLink) {
		console.info(
			JSON.stringify({
				appointmentId: appointment.id,
				event: "calendar_meet_link_missing",
				flow: "v2",
			})
		);
	}

	return text(
		"R7-appointment-info",
		buildAppointmentInfoText({
			consultantName: appointment.consultantName,
			meetLink,
			startAt: appointment.startAt,
		})
	);
}

/**
 * A4: listas fechadas, sem IA. Consultor → R8 (o chamador); sensível →
 * T-SENSITIVE; status/agradecimento com reunião futura → T-APPOINTMENT-INFO;
 * status no agendamento → T-STATUS-* + botões da etapa; remarcar → R7d.
 */
async function planClosedList(
	route:
		| "list-sensitive"
		| "list-appointment-info"
		| "list-status"
		| "list-reschedule",
	state: TurnState,
	conversationId: string,
	deps: FlowV2Deps
): Promise<Plan> {
	if (route === "list-sensitive") {
		// A4-N3/C1: durante o agendamento os botões são os da etapa; C2:
		// reunião futura → sem botão.
		return await withStageOrConsultant({
			body: T_SENSITIVE,
			buttonRoute: "R7b",
			conversationId,
			responder: "automation",
			stageRoute: "R7b",
			state,
		});
	}
	if (route === "list-reschedule") {
		return reschedulePlan(state);
	}
	if (route === "list-appointment-info" && state.futureAppointment) {
		return await appointmentInfoPlan(state.futureAppointment, deps);
	}

	const stage = state.activeSession
		? await buildCurrentStagePayload(db, conversationId)
		: null;
	if (!stage) {
		// A sessão sumiu entre a leitura e agora: o texto fixo de dúvida.
		return withConsultantButton("R7c-fallback", T_AI_FALLBACK, "automation");
	}
	return withStageButtons(
		"R7e-status",
		currentStateText(stage),
		"automation",
		stage
	);
}

function outcomeOf(error: unknown): TurnOutcome {
	if (error instanceof TurnSupersededError) {
		return "superseded";
	}
	if (error instanceof ModelUnavailableError) {
		return "model_error";
	}
	return "turn_error";
}

/** Turno de texto (lote do debounce) sob `MARIANA_FLOW=v2`. */
export async function runFlowV2Turn({
	conversationId,
	currentMessages,
	deps = {},
	eventId,
	leadId,
	messageCutoff,
	messageIds,
	runKey,
	traceTurnId,
}: {
	conversationId: string;
	currentMessages: string[];
	deps?: FlowV2Deps;
	eventId?: string;
	leadId: string;
	messageCutoff?: Date;
	messageIds: string[];
	runKey: string;
	traceTurnId: string;
}): Promise<FlowV2TurnResult> {
	const now = deps.now?.() ?? new Date();
	const state = await loadTurnState({ conversationId, leadId, now });
	const context: TraceContext = {
		conversationId,
		latencyMs: null,
		leadId,
		rawReply: null,
		requestedNextAction: "text_turn",
		stage: state.activeSession?.workflowStage ?? "none",
		turnId: traceTurnId,
	};

	const startScheduling = (
		objectiveFromAi: string | null,
		statedMinor = false
	) =>
		planStartScheduling({
			conversationId,
			deps,
			leadId,
			now,
			objectiveFromAi,
			state,
			statedMinor,
		});

	const makePlan = async (): Promise<Plan> => {
		const { route } = routeTurn(
			{
				hasActiveSession: state.activeSession !== null,
				hasAssistantReply: state.assistantReplyCount > 0,
				hasFutureAppointment: state.futureAppointment !== null,
				optedOut: state.conversation.optOutAt !== null,
				pendingOffer: state.pendingOffer,
			},
			{ messages: currentMessages }
		);

		if (route === "R6-accept" || route === "list-consultant") {
			return await startScheduling(null);
		}
		if (
			route === "list-sensitive" ||
			route === "list-appointment-info" ||
			route === "list-status" ||
			route === "list-reschedule"
		) {
			return await planClosedList(route, state, conversationId, deps);
		}
		if (route !== "R7") {
			return await planAutomationRoute(route, state, conversationId);
		}

		// R7: uma chamada à IA, fora da transação.
		const startedAt = Date.now();
		const { metadata, ...understood } = await (
			deps.understand ?? defaultUnderstand
		)({
			conversationId,
			currentMessageIds: messageIds,
			currentMessages,
			leadId,
			messageCutoff,
			state,
		});
		context.latencyMs = Date.now() - startedAt;
		context.intent = understood.intent;
		context.rawReply = understood.reply;
		context.metadata = metadata;
		context.fields = understood.fields;

		return await planUnderstood(
			conversationId,
			state,
			understood,
			context,
			deps,
			startScheduling,
			now
		);
	};

	return await runPlanned({
		context,
		conversationId,
		deps,
		eventId,
		leadId,
		makePlan,
		messageIds,
		now,
		runKey,
	});
}

/**
 * Toque em "Falar com consultor" (R3 → R8), com qualquer valor da flag: só a
 * v2 envia esse botão. Chave = `button-reply:<conversa>:<id externo>`.
 */
export async function runFlowV2Tap({
	conversationId,
	deps = {},
	eventId,
	leadId,
	runKey,
	traceTurnId,
}: {
	conversationId: string;
	deps?: FlowV2Deps;
	eventId?: string;
	leadId: string;
	runKey: string;
	traceTurnId: string;
}): Promise<FlowV2TurnResult> {
	const now = deps.now?.() ?? new Date();
	const state = await loadTurnState({ conversationId, leadId, now });

	return await runPlanned({
		context: {
			conversationId,
			latencyMs: null,
			leadId,
			rawReply: null,
			requestedNextAction: "consultant_tap",
			stage: state.activeSession?.workflowStage ?? "none",
			turnId: traceTurnId,
		},
		conversationId,
		deps,
		eventId,
		leadId,
		makePlan: async () =>
			state.conversation.optOutAt === null
				? await planStartScheduling({
						conversationId,
						deps,
						leadId,
						now,
						objectiveFromAi: null,
						state,
						statedMinor: false,
					})
				: { kind: "silent" },
		messageIds: [],
		now,
		runKey,
	});
}
