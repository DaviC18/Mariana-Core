/**
 * Estado do turno da v2 (2026-10-28-flow-v2, A2). Leitura sem lock: o turno
 * relê o que importa sob o lock do lead na transação de escrita. Mensagens,
 * oferta pendente e sessão vêm só da conversa atual (R-SES-03); a reunião
 * futura é do lead.
 */
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "../../db/connections";
import {
	appointments,
	consultants,
	conversations,
	leads,
	messages,
	schedulingSessions,
} from "../../db/schema";
import { CONFIRMED_APPOINTMENT_STATUSES } from "../appointments/appointment-status";
import { isAtLeast18 } from "../leads/lead-qualification";
import type { V2PendingOffer } from "./router";
import { T_AI_FALLBACK, T_ASK_OBJECTIVE, T_SENSITIVE } from "./texts";

export interface TurnState {
	activeSession: { id: string; workflowStage: string } | null;
	askedObjective: boolean;
	assistantReplyCount: number;
	conversation: { optOutAt: Date | null; status: string };
	futureAppointment: {
		calendarId: string;
		consultantId: string;
		consultantName: string;
		externalEventId: string;
		id: string;
		startAt: Date;
	} | null;
	lastAssistantContent: string | null;
	lead: {
		birthDate: Date | null;
		id: string;
		interestedInConsultant: boolean;
		name: string;
		objective: string | null;
		phone: string;
		status: string;
	};
	pendingOffer: V2PendingOffer;
	underAge: boolean;
}

/**
 * Q7: a oferta só está pendente quando a última linha da assistente é
 * exatamente um texto fixo do backend. Texto livre do modelo nunca conta, e a
 * próxima linha da assistente limpa o marcador.
 */
export function detectV2PendingOffer(
	lastAssistantContent: string | null
): V2PendingOffer {
	if (
		lastAssistantContent === T_SENSITIVE ||
		lastAssistantContent === T_AI_FALLBACK
	) {
		return "consultant_offer";
	}
	if (lastAssistantContent === T_ASK_OBJECTIVE) {
		return "objective_question";
	}
	return null;
}

export async function loadTurnState({
	conversationId,
	leadId,
	now = new Date(),
}: {
	conversationId: string;
	leadId: string;
	now?: Date;
}): Promise<TurnState> {
	const [lead] = await db
		.select({
			birthDate: leads.birthDate,
			id: leads.id,
			interestedInConsultant: leads.interestedInConsultant,
			name: leads.name,
			objective: leads.objective,
			phone: leads.phone,
			status: leads.status,
		})
		.from(leads)
		.where(eq(leads.id, leadId))
		.limit(1);

	if (!lead) {
		throw new Error("Lead not found");
	}

	const [conversation] = await db
		.select({
			optOutAt: conversations.optOutAt,
			status: conversations.status,
		})
		.from(conversations)
		.where(
			and(
				eq(conversations.id, conversationId),
				eq(conversations.leadId, leadId)
			)
		)
		.limit(1);

	if (!conversation) {
		throw new Error("Conversation not found");
	}

	const isAssistantRow = and(
		eq(messages.conversationId, conversationId),
		eq(messages.role, "assistant")
	);

	const [lastAssistant] = await db
		.select({ content: messages.content })
		.from(messages)
		.where(isAssistantRow)
		.orderBy(desc(messages.createdAt), desc(messages.id))
		.limit(1);

	const [replies] = await db
		.select({ total: count() })
		.from(messages)
		.where(isAssistantRow);

	const [askedObjective] = await db
		.select({ id: messages.id })
		.from(messages)
		.where(and(isAssistantRow, eq(messages.content, T_ASK_OBJECTIVE)))
		.limit(1);

	const [activeSession] = await db
		.select({
			id: schedulingSessions.id,
			workflowStage: schedulingSessions.workflowStage,
		})
		.from(schedulingSessions)
		.where(
			and(
				eq(schedulingSessions.conversationId, conversationId),
				eq(schedulingSessions.status, "active"),
				gt(schedulingSessions.expiresAt, now)
			)
		)
		.limit(1);

	const [futureAppointment] = await db
		.select({
			calendarId: consultants.calendarId,
			consultantId: appointments.consultantId,
			consultantName: consultants.name,
			externalEventId: appointments.externalEventId,
			id: appointments.id,
			startAt: appointments.startAt,
		})
		.from(appointments)
		.innerJoin(consultants, eq(consultants.id, appointments.consultantId))
		.where(
			and(
				eq(appointments.leadId, leadId),
				inArray(appointments.status, [...CONFIRMED_APPOINTMENT_STATUSES]),
				gt(appointments.startAt, now)
			)
		)
		.orderBy(appointments.startAt)
		.limit(1);

	const lastAssistantContent = lastAssistant?.content ?? null;

	return {
		activeSession: activeSession ?? null,
		askedObjective: askedObjective !== undefined,
		assistantReplyCount: replies?.total ?? 0,
		conversation,
		futureAppointment: futureAppointment ?? null,
		lastAssistantContent,
		lead,
		pendingOffer: detectV2PendingOffer(lastAssistantContent),
		underAge: lead.birthDate !== null && !isAtLeast18(lead.birthDate, now),
	};
}
