/**
 * R8 da v2 (2026-10-28-flow-v2, A2): busca de horários fora da transação e
 * gravação da oferta dentro dela. Mesmo molde de `sendSlotUnavailableReoffer`
 * (Calendar fora da tx; lead travado primeiro; linha da assistente, sessão,
 * slots e outbox na mesma tx), mas aqui `CalendarUnavailableError` vira o
 * texto A (V-18).
 */
import { eq } from "drizzle-orm";
import type { db } from "../../db/connections";
import { conversations, leads, messages } from "../../db/schema";
import { CalendarUnavailableError } from "../../integrations/google-calendar/google-calendar-errors";
import { describeError } from "../../lib/error-classification";
import type { TurnRoute } from "../../lib/turn-trace";
import type { ConsultantAvailableSlot } from "../calendar/consultant-availability";
import type { SchedulingAvailabilityService } from "../calendar/scheduling-availability";
import { SchedulingConfirmationService } from "../calendar/scheduling-confirmation-service";
import {
	buildWhatsAppSchedulingOffer,
	SchedulingOfferService,
} from "../calendar/scheduling-offer-service";
import { CALENDAR_UNAVAILABLE_TEXT } from "../conversations/calendar-unavailable-notice";
import { TurnSupersededError } from "../conversations/turn-superseded-error";
import { isAtLeast18 } from "../leads/lead-qualification";
import type { OutboundMessagePayload } from "../messaging/outbound-messages";
import { NO_SLOTS_TEXT } from "./texts";

export type FlowV2Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SchedulingOfferPreparation =
	| { kind: "slots"; slots: ConsultantAvailableSlot[] }
	| { kind: "none" }
	| { kind: "calendar_unavailable" };

const MAX_OFFERED_SLOTS = 3;
const OFFER_WINDOW_DAYS = 5;
const QUALIFIABLE_STATUSES = new Set(["new", "qualifying"]);

const schedulingConfirmationService = new SchedulingConfirmationService();
const schedulingOfferService = new SchedulingOfferService();

/**
 * O cliente pediu o consultor (R8): `interestedInConsultant = true` e o lead
 * vira `qualified`, que a busca de horários exige
 * (`SchedulingAvailabilityService`). Commit antes do Calendar, como a v1 faz
 * com o turno. Lead travado primeiro; conversa fechada → `TurnSupersededError`.
 * Um lead menor de idade nunca vira `qualified`.
 */
export async function markLeadReadyForScheduling(
	database: typeof db,
	{
		conversationId,
		leadId,
		now = new Date(),
		objective,
	}: {
		conversationId: string;
		leadId: string;
		now?: Date;
		objective?: string | null;
	}
): Promise<void> {
	await database.transaction(async (tx) => {
		const [lead] = await tx
			.select({
				birthDate: leads.birthDate,
				objective: leads.objective,
				qualifiedAt: leads.qualifiedAt,
				status: leads.status,
			})
			.from(leads)
			.where(eq(leads.id, leadId))
			.for("update");

		if (!lead) {
			throw new Error("Lead not found");
		}

		const [current] = await tx
			.select({ status: conversations.status })
			.from(conversations)
			.where(eq(conversations.id, conversationId))
			.limit(1);

		if (current?.status !== "active") {
			throw new TurnSupersededError(conversationId);
		}

		const adult = lead.birthDate === null || isAtLeast18(lead.birthDate, now);
		const qualify = adult && QUALIFIABLE_STATUSES.has(lead.status);
		const newObjective = objective?.trim();

		await tx
			.update(leads)
			.set({
				interestedInConsultant: true,
				...(lead.objective === null && newObjective
					? { objective: newObjective }
					: {}),
				...(qualify
					? { qualifiedAt: lead.qualifiedAt ?? now, status: "qualified" }
					: {}),
				updatedAt: now,
			})
			.where(eq(leads.id, leadId));
	});
}

/**
 * Busca até 3 horários. Só `CalendarUnavailableError` (nenhum consultor
 * respondeu) é tratado; um consultor fora já sai do sorteio lá dentro.
 */
export async function prepareSchedulingOffer({
	availability,
	conversationId,
	leadId,
	now = new Date(),
	random,
}: {
	availability: SchedulingAvailabilityService;
	conversationId: string;
	leadId: string;
	now?: Date;
	random: () => number;
}): Promise<SchedulingOfferPreparation> {
	const timeMax = new Date(now);
	timeMax.setDate(timeMax.getDate() + OFFER_WINDOW_DAYS);

	try {
		const slots = await availability.getAvailableSlots({
			leadId,
			random,
			timeMax,
			timeMin: now,
		});
		const offered = slots.slice(0, MAX_OFFERED_SLOTS);
		return offered.length > 0
			? { kind: "slots", slots: offered }
			: { kind: "none" };
	} catch (error) {
		if (!(error instanceof CalendarUnavailableError)) {
			throw error;
		}

		console.error(
			JSON.stringify({
				conversationId,
				event: "scheduling_calendar_unavailable",
				failureCount: error.failures.length,
				failures: error.failures.map((failure) => ({
					consultantId: failure.consultantId,
					...describeError(failure.error),
				})),
				flow: "v2",
				leadId,
			})
		);
		return { kind: "calendar_unavailable" };
	}
}

/**
 * Linha da assistente + oferta (sessão e slots, `persistOffer` na tx do
 * chamador). O chamador já travou o lead e conferiu a conversa ativa.
 */
export async function writeSchedulingReply(
	tx: FlowV2Tx,
	{
		conversationId,
		leadId,
		now = new Date(),
		offer,
	}: {
		conversationId: string;
		leadId: string;
		now?: Date;
		offer: SchedulingOfferPreparation;
	}
): Promise<{
	assistantMessageId: string;
	payload: OutboundMessagePayload;
	route: TurnRoute;
}> {
	if (offer.kind !== "slots") {
		const text =
			offer.kind === "none" ? NO_SLOTS_TEXT : CALENDAR_UNAVAILABLE_TEXT;
		const assistantMessageId = await insertAssistantRow(
			tx,
			conversationId,
			text
		);
		return {
			assistantMessageId,
			payload: { kind: "text", text },
			route: offer.kind === "none" ? "R8-no-slots" : "R8-calendar-unavailable",
		};
	}

	// O corpo da oferta não depende dos ids dos slots.
	const multiBody = buildWhatsAppSchedulingOffer([]).body;
	const assistantMessageId = await insertAssistantRow(
		tx,
		conversationId,
		multiBody
	);
	const persisted = await schedulingOfferService.persistOffer({
		conversationId,
		executor: tx,
		finalReply: multiBody,
		leadId,
		messageId: assistantMessageId,
		now,
		offeredSlots: offer.slots,
	});
	const [onlySlot] = persisted.slots;

	if (persisted.slots.length === 1 && onlySlot) {
		// Um único horário já fica selecionado (B-2): vai com Confirmar/Não.
		const single =
			schedulingConfirmationService.buildSingleSlotConfirmationMessage(
				onlySlot
			);
		await tx
			.update(messages)
			.set({ content: single.body })
			.where(eq(messages.id, assistantMessageId));
		return {
			assistantMessageId,
			payload: { body: single.body, buttons: single.buttons, kind: "buttons" },
			route: "R8-slots",
		};
	}

	const multi = buildWhatsAppSchedulingOffer(persisted.slots);
	return {
		assistantMessageId,
		payload: { body: multi.body, buttons: multi.buttons, kind: "buttons" },
		route: "R8-slots",
	};
}

export async function insertAssistantRow(
	tx: FlowV2Tx,
	conversationId: string,
	content: string
): Promise<string> {
	const [inserted] = await tx
		.insert(messages)
		.values({ content, conversationId, role: "assistant" })
		.returning({ id: messages.id });

	if (!inserted) {
		throw new Error("Assistant message not created");
	}
	return inserted.id;
}
