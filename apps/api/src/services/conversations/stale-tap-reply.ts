/**
 * Resposta fixa a um toque de botão de uma mensagem antiga, na mesma conversa
 * (menos de 4h). S-07 v1.4: aviso curto mais os botões da etapa atual; nunca
 * silêncio. Textos aprovados pelo Davi em D-R2-6 (a).
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { db } from "../../db/connections";
import {
	messages,
	outboundMessages,
	schedulingSessions,
	schedulingSlots,
} from "../../db/schema";
import { SchedulingConfirmationService } from "../calendar/scheduling-confirmation-service";
import { buildWhatsAppSchedulingOffer } from "../calendar/scheduling-offer-service";
import {
	enqueueOutboundMessage,
	type OutboundMessagePayload,
} from "../messaging/outbound-messages";

export const STALE_TAP_NOTICE = "Esse botão é de uma mensagem antiga.";
export const STALE_TAP_SLOTS_LEAD =
	"Estes são os horários que tenho para você:";
export const STALE_TAP_NO_SCHEDULING = "Me conta o que você precisa agora?";

type StaleTapExecutor = Pick<
	Parameters<Parameters<typeof db.transaction>[0]>[0],
	"insert" | "select"
>;

/**
 * Passo 32 (S-25, uma release): etapas do fluxo antigo de preferência de
 * consultor. Não são mais gravadas (R-SCH-01 v1.4); só sessões criadas antes
 * do deploy ainda estão nelas.
 */
export const LEGACY_SCHEDULING_STAGES = [
	"awaiting_availability",
	"awaiting_consultant_preference",
	"awaiting_consultant_selection",
] as const;

type LegacyStageExecutor = Pick<
	Parameters<Parameters<typeof db.transaction>[0]>[0],
	"update"
>;

/**
 * Move a sessão ativa da conversa de uma etapa legada para
 * `awaiting_slot_selection`, na transação do chamador. Os slots e o consultor
 * de cada slot não mudam; `preferredConsultantId` não é escrito.
 */
export async function promoteLegacySchedulingStage(
	tx: LegacyStageExecutor,
	{ conversationId, sessionId }: { conversationId: string; sessionId?: string }
): Promise<boolean> {
	const promoted = await tx
		.update(schedulingSessions)
		.set({ updatedAt: new Date(), workflowStage: "awaiting_slot_selection" })
		.where(
			and(
				eq(schedulingSessions.conversationId, conversationId),
				sessionId ? eq(schedulingSessions.id, sessionId) : undefined,
				eq(schedulingSessions.status, "active"),
				gt(schedulingSessions.expiresAt, new Date()),
				inArray(schedulingSessions.workflowStage, [...LEGACY_SCHEDULING_STAGES])
			)
		)
		.returning({ id: schedulingSessions.id });

	return promoted.length > 0;
}

export function staleTapReplyKey(externalId: string): string {
	return `stale-tap:${externalId}`;
}

const schedulingConfirmationService = new SchedulingConfirmationService();

export interface CurrentStagePayload {
	body: string;
	buttons: Array<{ id: string; title: string }>;
	stage: "awaiting_confirmation" | "awaiting_slot_selection";
}

/**
 * Texto e botões da etapa atual da sessão ativa da conversa, ou `null` sem
 * sessão utilizável. Usado pelo toque antigo (com o aviso na frente) e pela
 * v2 (R5 e R8 durante o agendamento, 2026-10-28-flow-v2 A2).
 */
export async function buildCurrentStagePayload(
	tx: StaleTapExecutor,
	conversationId: string
): Promise<CurrentStagePayload | null> {
	const [session] = await tx
		.select({
			id: schedulingSessions.id,
			preferredConsultantId: schedulingSessions.preferredConsultantId,
			selectedSlotId: schedulingSessions.selectedSlotId,
			workflowStage: schedulingSessions.workflowStage,
		})
		.from(schedulingSessions)
		.where(
			and(
				eq(schedulingSessions.conversationId, conversationId),
				eq(schedulingSessions.status, "active"),
				gt(schedulingSessions.expiresAt, new Date())
			)
		)
		.limit(1);

	if (session?.workflowStage === "awaiting_confirmation") {
		const [slot] = session.selectedSlotId
			? await tx
					.select()
					.from(schedulingSlots)
					.where(
						and(
							eq(schedulingSlots.id, session.selectedSlotId),
							eq(schedulingSlots.schedulingSessionId, session.id)
						)
					)
					.limit(1)
			: [];

		if (slot) {
			const confirmation =
				schedulingConfirmationService.buildConfirmationMessage(slot);
			return {
				body: confirmation.body,
				buttons: confirmation.buttons,
				stage: "awaiting_confirmation",
			};
		}
	} else if (session) {
		const slots = await tx
			.select()
			.from(schedulingSlots)
			.where(
				session.preferredConsultantId
					? and(
							eq(schedulingSlots.schedulingSessionId, session.id),
							eq(schedulingSlots.consultantId, session.preferredConsultantId)
						)
					: eq(schedulingSlots.schedulingSessionId, session.id)
			)
			.orderBy(asc(schedulingSlots.position))
			.limit(3);

		if (slots.length > 0) {
			return {
				body: STALE_TAP_SLOTS_LEAD,
				buttons: buildWhatsAppSchedulingOffer(slots).buttons,
				stage: "awaiting_slot_selection",
			};
		}
	}

	return null;
}

async function buildStaleTapPayload(
	tx: StaleTapExecutor,
	conversationId: string
): Promise<OutboundMessagePayload> {
	const stage = await buildCurrentStagePayload(tx, conversationId);

	if (stage) {
		return {
			body: `${STALE_TAP_NOTICE}\n${stage.body}`,
			buttons: stage.buttons,
			kind: "buttons",
		};
	}

	return {
		kind: "text",
		text: `${STALE_TAP_NOTICE}\n${STALE_TAP_NO_SCHEDULING}`,
	};
}

/**
 * Grava a linha do assistente e o outbox na transação do chamador (chave
 * `stale-tap:<externalId>`). Uma reentrega acha a chave e não responde de novo
 * (R-REL-02). O chamador marca o evento como processado.
 */
export async function replyToStaleTap(
	tx: StaleTapExecutor,
	{
		conversationId,
		eventId,
		externalId,
		leadId,
	}: {
		conversationId: string;
		eventId?: string;
		externalId: string;
		leadId: string;
	}
): Promise<{ replied: boolean }> {
	const idempotencyKey = staleTapReplyKey(externalId);
	const [existing] = await tx
		.select({ id: outboundMessages.id })
		.from(outboundMessages)
		.where(eq(outboundMessages.idempotencyKey, idempotencyKey))
		.limit(1);

	if (existing) {
		return { replied: false };
	}

	const payload = await buildStaleTapPayload(tx, conversationId);
	const [assistantMessage] = await tx
		.insert(messages)
		.values({
			content: payload.kind === "text" ? payload.text : payload.body,
			conversationId,
			role: "assistant",
		})
		.returning({ id: messages.id });

	await enqueueOutboundMessage({
		conversationId,
		eventId,
		executor: tx,
		idempotencyKey,
		leadId,
		messageId: assistantMessage?.id,
		payload,
	});

	return { replied: true };
}
