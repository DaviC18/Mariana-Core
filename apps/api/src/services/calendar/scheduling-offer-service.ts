import { and, eq, gt, lte } from "drizzle-orm";

import { db as defaultDb } from "../../db/connections";
import {
	conversations,
	leads,
	messages,
	schedulingSessions,
	schedulingSlots,
} from "../../db/schema";
import { TurnSupersededError } from "../conversations/turn-superseded-error";
import type { ConsultantAvailableSlot } from "./consultant-availability";

type SchedulingOfferExecutor = Parameters<
	Parameters<typeof defaultDb.transaction>[0]
>[0];

export interface PersistSchedulingOfferParams {
	conversationId: string;
	db?: typeof defaultDb;
	/**
	 * Transação do chamador (passo 33, reoferta): a oferta, a linha do
	 * assistente e o outbox ficam na mesma transação. Sem ela, abre uma própria.
	 */
	executor?: SchedulingOfferExecutor;
	finalReply: string;
	leadId: string;
	messageId: string;
	now?: Date;
	offeredSlots: ConsultantAvailableSlot[];
	/**
	 * Rev3 passo 37 (opt-in, só o turno da IA): sob o lock do lead, a conversa
	 * precisa continuar ativa; senão lança `TurnSupersededError` antes de gravar.
	 */
	requireActiveConversation?: boolean;
}

export interface PersistSchedulingOfferResult {
	session: typeof schedulingSessions.$inferSelect;
	slots: (typeof schedulingSlots.$inferSelect)[];
	updatedAssistantMessage: typeof messages.$inferSelect;
}

export function buildWhatsAppSchedulingOffer(
	slots: (typeof schedulingSlots.$inferSelect)[]
) {
	return {
		body: "Tenho estes horários disponíveis. Escolha uma opção:",
		buttons: slots.map((slot) => ({
			id: slot.id,
			title: new Intl.DateTimeFormat("pt-BR", {
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				month: "2-digit",
				timeZone: "America/Sao_Paulo",
			})
				.format(slot.startAt)
				.replace(",", " às"),
		})),
	};
}

export class SchedulingOfferService {
	private readonly db: typeof defaultDb;

	constructor(database = defaultDb) {
		this.db = database;
	}

	async persistOffer({
		conversationId,
		executor,
		finalReply,
		leadId,
		messageId,
		now = new Date(),
		offeredSlots,
		requireActiveConversation = false,
	}: PersistSchedulingOfferParams): Promise<PersistSchedulingOfferResult> {
		if (offeredSlots.length === 0) {
			throw new Error("Cannot persist scheduling offer with 0 slots");
		}

		const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

		const write = async (
			tx: SchedulingOfferExecutor
		): Promise<PersistSchedulingOfferResult> => {
			// 0. Passo 36 (F-T27-1, D-R2-4): o lead primeiro, antes das sessões.
			// Reentrante quando o chamador já tem o lock (reoferta do passo 33).
			await tx
				.select({ id: leads.id })
				.from(leads)
				.where(eq(leads.id, leadId))
				.for("update");

			if (requireActiveConversation) {
				const [current] = await tx
					.select({ status: conversations.status })
					.from(conversations)
					.where(eq(conversations.id, conversationId))
					.limit(1);

				if (current?.status !== "active") {
					throw new TurnSupersededError(conversationId);
				}
			}

			// 1. Expirar sessions vencidas antes de fechar uma oferta ainda válida.
			await tx
				.update(schedulingSessions)
				.set({
					status: "expired",
					updatedAt: now,
				})
				.where(
					and(
						eq(schedulingSessions.leadId, leadId),
						eq(schedulingSessions.status, "active"),
						lte(schedulingSessions.expiresAt, now)
					)
				);

			// 2. Fechar session active anterior ainda válida do mesmo lead.
			await tx
				.update(schedulingSessions)
				.set({
					status: "closed",
					updatedAt: now,
				})
				.where(
					and(
						eq(schedulingSessions.leadId, leadId),
						eq(schedulingSessions.status, "active"),
						gt(schedulingSessions.expiresAt, now)
					)
				);

			// 3. Criar a nova session active. R-SCH-01 v1.4: sem pergunta de
			// preferência; a sessão já começa esperando o toque no horário.
			const [createdSession] = await tx
				.insert(schedulingSessions)
				.values({
					conversationId,
					createdAt: now,
					expiresAt,
					leadId,
					status: "active",
					updatedAt: now,
					workflowStage: "awaiting_slot_selection",
				})
				.returning();

			if (!createdSession) {
				throw new Error("Failed to create scheduling session");
			}

			// 4. Criar os slots ofertados
			const slotsToInsert = offeredSlots.map((slot, index) => ({
				calendarId: slot.consultant.calendarId,
				consultantId: slot.consultant.id,
				consultantName: slot.consultant.name,
				createdAt: now,
				endAt: slot.end,
				position: index + 1,
				schedulingSessionId: createdSession.id,
				startAt: slot.start,
			}));

			const createdSlots = await tx
				.insert(schedulingSlots)
				.values(slotsToInsert)
				.returning();
			let session = createdSession;

			// 4b. Um único horário vai direto para Confirmar/Não: o slot já fica
			// selecionado, na mesma transação, para o Confirmar valer (B-2).
			const [onlySlot] = createdSlots;

			if (createdSlots.length === 1 && onlySlot) {
				const [selectedSession] = await tx
					.update(schedulingSessions)
					.set({
						selectedSlotId: onlySlot.id,
						updatedAt: now,
						workflowStage: "awaiting_confirmation",
					})
					.where(eq(schedulingSessions.id, createdSession.id))
					.returning();

				if (!selectedSession) {
					throw new Error("Failed to select the single offered slot");
				}

				session = selectedSession;
			}

			// 5. Atualizar a mensagem assistente existente com finalReply
			const [updatedAssistantMessage] = await tx
				.update(messages)
				.set({
					content: finalReply,
				})
				.where(eq(messages.id, messageId))
				.returning();

			if (!updatedAssistantMessage) {
				throw new Error("Assistant message not found for update");
			}

			// 6. Atualizar conversation updatedAt para consistência
			await tx
				.update(conversations)
				.set({
					updatedAt: now,
				})
				.where(eq(conversations.id, conversationId));

			return {
				session,
				slots: createdSlots,
				updatedAssistantMessage,
			};
		};

		return executor ? await write(executor) : await this.db.transaction(write);
	}
}
