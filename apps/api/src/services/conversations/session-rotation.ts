/** biome-ignore-all lint/style/useFilenamingConvention: <> */
import { and, eq, gt, inArray } from "drizzle-orm";

import type { db } from "../../db/connections";
import {
	appointments,
	autonomousTasks,
	conversations,
	leads,
	messages,
	outboundMessages,
	schedulingSessions,
} from "../../db/schema";
import { getOrCreateActiveConversation } from "./active-conversation";
import { isSessionInactivityGap } from "./session-choice-policy";
import { staleTapReplyKey } from "./stale-tap-reply";

/**
 * Linha de auditoria (write-only) com o estado comercial de A antes do reset.
 * Status `completed`: o executor nunca a reclama (E5, sem migration).
 */
export const SESSION_ROTATION_SNAPSHOT_TASK = "session_rotation_snapshot";

export function sessionRotationSnapshotKey(conversationId: string): string {
	return `session-rotation:${conversationId}`;
}

/**
 * E1-a (S-20 v1.3): resposta fixa a um toque que chega depois de 4h. O toque
 * antigo não é honrado; a conversa nova pede o que o cliente procura agora.
 */
export const SESSION_ROTATION_TAP_REPLY_TEXT =
	"Oi! Já faz um tempo desde a nossa última conversa, então aqueles horários não valem mais. Me conta o que você procura agora?";

export function sessionRotationTapReplyKey(externalId: string): string {
	return `session-rotation-tap:${externalId}`;
}

type SessionRotationExecutor = Pick<
	Parameters<Parameters<typeof db.transaction>[0]>[0],
	"insert" | "select" | "update"
>;

export interface ResolveConversationForInboundResult {
	conversation: typeof conversations.$inferSelect;
	previousConversationId?: string;
	/**
	 * F-V1b-1: a mensagem (`externalId`) já estava gravada. `conversation` é a
	 * conversa onde ela foi gravada pela primeira vez (ativa ou fechada).
	 */
	redelivery?: boolean;
	rotated: boolean;
}

/**
 * Resolve a conversa de uma mensagem do cliente (R-SES-02 v1.3).
 *
 * Deve rodar na mesma transação que grava a mensagem. O lock `FOR UPDATE` no
 * lead serializa mensagens concorrentes: a segunda espera o commit da
 * primeira e enxerga B com `lastCustomerMessageAt` já gravado, então não vê
 * intervalo de novo (K-1, K-6). Com ≥ 4h sem mensagem do cliente, fecha A e
 * abre B do zero. Timestamp `null` nunca rotaciona.
 *
 * O chamador grava `lastCustomerMessageAt = receivedAt` na conversa
 * devolvida, na mesma transação.
 *
 * Com `externalId` (F-V1b-1, D-R2-1 a): se essa mensagem do cliente já foi
 * gravada, a conversa dela é decidida uma vez só. Devolve a conversa onde foi
 * gravada (`redelivery: true`), sem rotacionar. A busca roda sob o lock do
 * lead, então nenhuma mensagem concorrente rotaciona entre a busca e o insert.
 *
 * Com `tapExternalId` (passo 39, F-T26-2): toques não são gravados como
 * mensagem. Se esse toque já produziu uma linha para o lead (tarefa
 * `button-reply:<id>`, outbox `stale-tap:<id>` ou
 * `session-rotation-tap:<id>`), devolve a conversa dessa linha
 * (`redelivery: true`), sem rotacionar. Mesma busca sob o lock do lead.
 */
export async function resolveConversationForInbound(
	tx: SessionRotationExecutor,
	{
		externalId,
		leadId,
		receivedAt,
		tapExternalId,
	}: {
		externalId?: string;
		leadId: string;
		receivedAt: Date;
		tapExternalId?: string;
	}
): Promise<ResolveConversationForInboundResult> {
	const [lead] = await tx
		.select()
		.from(leads)
		.where(eq(leads.id, leadId))
		.for("update")
		.limit(1);

	if (!lead) {
		throw new Error(`Lead not found: ${leadId}`);
	}

	if (externalId) {
		const [stored] = await tx
			.select({ conversation: conversations })
			.from(messages)
			.innerJoin(conversations, eq(conversations.id, messages.conversationId))
			.where(
				and(
					eq(messages.externalId, externalId),
					eq(messages.role, "user"),
					eq(conversations.leadId, leadId)
				)
			)
			.limit(1);

		if (stored) {
			return {
				conversation: stored.conversation,
				redelivery: true,
				rotated: false,
			};
		}
	}

	if (tapExternalId) {
		const [task] = await tx
			.select({ conversation: conversations })
			.from(autonomousTasks)
			.innerJoin(
				conversations,
				eq(conversations.id, autonomousTasks.conversationId)
			)
			.where(
				and(
					eq(autonomousTasks.idempotencyKey, `button-reply:${tapExternalId}`),
					eq(conversations.leadId, leadId)
				)
			)
			.limit(1);
		const [outbox] = task
			? []
			: await tx
					.select({ conversation: conversations })
					.from(outboundMessages)
					.innerJoin(
						conversations,
						eq(conversations.id, outboundMessages.conversationId)
					)
					.where(
						and(
							inArray(outboundMessages.idempotencyKey, [
								staleTapReplyKey(tapExternalId),
								sessionRotationTapReplyKey(tapExternalId),
							]),
							eq(conversations.leadId, leadId)
						)
					)
					.limit(1);
		const found = task ?? outbox;
		if (found) {
			return {
				conversation: found.conversation,
				redelivery: true,
				rotated: false,
			};
		}
	}

	const [active] = await tx
		.select()
		.from(conversations)
		.where(
			and(eq(conversations.leadId, leadId), eq(conversations.status, "active"))
		)
		.limit(1);

	if (
		!(
			active &&
			isSessionInactivityGap({
				lastCustomerMessageAt: active.lastCustomerMessageAt,
				now: receivedAt,
			})
		)
	) {
		const { conversation } = await getOrCreateActiveConversation(tx, leadId);
		return { conversation, rotated: false };
	}

	const now = new Date();

	// E5: snapshot de A antes do reset.
	await tx
		.insert(autonomousTasks)
		.values({
			completedAt: now,
			conversationId: active.id,
			idempotencyKey: sessionRotationSnapshotKey(active.id),
			payload: {
				kind: "session_rotation",
				leadId,
				previousConversationId: active.id,
				previousLastCustomerMessageAt:
					active.lastCustomerMessageAt?.toISOString() ?? null,
				rotatedAt: receivedAt.toISOString(),
				snapshot: {
					commercialApproach: lead.commercialApproach,
					consortiumType: lead.consortiumType,
					currentSituation: lead.currentSituation,
					interestedInConsultant: lead.interestedInConsultant,
					objective: lead.objective,
					painPoint: lead.painPoint,
					qualifiedAt: lead.qualifiedAt ? lead.qualifiedAt.toISOString() : null,
					status: lead.status,
					urgency: lead.urgency,
				},
			},
			status: "completed",
			taskType: SESSION_ROTATION_SNAPSHOT_TASK,
		})
		.onConflictDoNothing({ target: autonomousTasks.idempotencyKey });

	// K-3: nenhum estado comercial herdado.
	await tx
		.update(leads)
		.set({
			commercialApproach: null,
			consortiumType: null,
			currentSituation: null,
			interestedInConsultant: false,
			objective: null,
			painPoint: null,
			qualifiedAt: null,
			updatedAt: now,
			urgency: null,
		})
		.where(eq(leads.id, leadId));

	await tx
		.update(autonomousTasks)
		.set({
			completedAt: now,
			result: { supersededBy: "session_rotation" },
			status: "completed",
			updatedAt: now,
		})
		.where(
			and(
				eq(autonomousTasks.conversationId, active.id),
				eq(autonomousTasks.status, "pending")
			)
		);

	// K-8: A fechada, nunca apagada.
	await tx
		.update(conversations)
		.set({ status: "closed", updatedAt: now })
		.where(eq(conversations.id, active.id));

	await tx
		.update(schedulingSessions)
		.set({ status: "expired", updatedAt: now })
		.where(
			and(
				eq(schedulingSessions.leadId, leadId),
				eq(schedulingSessions.status, "active")
			)
		);

	const { conversation: created } = await getOrCreateActiveConversation(
		tx,
		leadId
	);

	// K-7: opt-out nunca se perde. `lastCustomerMessageAt` NÃO é copiado: o
	// chamador grava `receivedAt`, senão a próxima mensagem veria intervalo.
	let conversation = created;
	if (active.optOutAt) {
		const [updated] = await tx
			.update(conversations)
			.set({ optOutAt: active.optOutAt, updatedAt: now })
			.where(eq(conversations.id, created.id))
			.returning();
		conversation = updated ?? created;
	}

	// K-2 (R-SES-04): status pela data da reunião. Sem reunião futura, B
	// começa do zero para qualquer status (E7, N-1): `qualifying`/`qualified`
	// também voltam a `new`.
	const [futureAppointment] = await tx
		.select({ id: appointments.id })
		.from(appointments)
		.where(
			and(
				eq(appointments.leadId, leadId),
				inArray(appointments.status, ["confirmed", "scheduled"]),
				gt(appointments.startAt, now)
			)
		)
		.limit(1);

	if (futureAppointment) {
		if (lead.status !== "scheduled") {
			await tx
				.update(leads)
				.set({ status: "scheduled", updatedAt: now })
				.where(eq(leads.id, leadId));
		}
	} else if (lead.status !== "new") {
		await tx
			.update(leads)
			.set({ qualifiedAt: null, status: "new", updatedAt: now })
			.where(eq(leads.id, leadId));
	}

	return { conversation, previousConversationId: active.id, rotated: true };
}
