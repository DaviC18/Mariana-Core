/** biome-ignore-all assist/source/useSortedKeys: <> */
/** biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: <> */
/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/** biome-ignore-all lint/style/useFilenamingConvention: <> */

import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { resolveModelName } from "../../ai/agent";
import { ModelUnavailableError } from "../../ai/model-errors";
import { db } from "../../db/connections";
import {
	autonomousTasks,
	conversations,
	leads,
	messages,
	outboundMessages,
	schedulingSessions,
	schedulingSlots,
	whatsappWebhookEvents,
} from "../../db/schema";
import { env } from "../../env";
import { formatSlotDate } from "../../utils/date-formatter";
import { SchedulingAvailabilityService } from "../calendar/scheduling-availability";
import { SchedulingCancellationService } from "../calendar/scheduling-cancellation-service";
import { SchedulingChoiceService } from "../calendar/scheduling-choice-service";
import { SchedulingConfirmationOrchestrator } from "../calendar/scheduling-confirmation-orchestrator";
import { SchedulingConfirmationService } from "../calendar/scheduling-confirmation-service";
import {
	buildWhatsAppSchedulingOffer,
	SchedulingOfferService,
} from "../calendar/scheduling-offer-service";
import { runFlowV2Tap, runFlowV2Turn } from "../flow-v2/run-turn";
import {
	buildBookingConfirmationText,
	CONSULTANT_BUTTON,
} from "../flow-v2/texts";
import {
	enqueueOutboundMessage,
	type OutboundMessagePayload,
} from "../messaging/outbound-messages";
import {
	type AutonomousTaskHandler,
	PermanentAutonomousTaskError,
} from "./autonomous-task-executor";
import { generateMarianaResponse } from "./generateMarianaResponse";
import {
	buildInboundReplyIdempotencyKey,
	getInboundBatchCutoffAt,
	selectInboundMessageBatch,
} from "./inbound-message-batch";
import { MODEL_FAILURE_NOTICE } from "./model-failure-notice";
import {
	LEGACY_SCHEDULING_STAGES,
	promoteLegacySchedulingStage,
	replyToStaleTap,
} from "./stale-tap-reply";
import { TurnSupersededError } from "./turn-superseded-error";

const schedulingChoiceService = new SchedulingChoiceService();
const schedulingConfirmationService = new SchedulingConfirmationService();
const schedulingConfirmationOrchestrator =
	new SchedulingConfirmationOrchestrator();
const schedulingCancellationService = new SchedulingCancellationService();
const schedulingAvailabilityService = new SchedulingAvailabilityService();
const schedulingOfferService = new SchedulingOfferService();

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function markEventProcessed(eventId: string | undefined) {
	if (!(eventId && UUID_PATTERN.test(eventId))) {
		return;
	}

	const [eventExists] = await db
		.select({ id: whatsappWebhookEvents.id })
		.from(whatsappWebhookEvents)
		.where(eq(whatsappWebhookEvents.id, eventId))
		.limit(1);

	if (!eventExists) {
		return;
	}

	await db
		.update(whatsappWebhookEvents)
		.set({
			lastError: null,
			leaseExpiresAt: null,
			status: "processed",
			updatedAt: new Date(),
		})
		.where(eq(whatsappWebhookEvents.id, eventId));
}

async function markMessagesProcessed(messageIds: string[]) {
	if (messageIds.length === 0) {
		return;
	}

	await db
		.update(messages)
		.set({ processedAt: new Date() })
		.where(inArray(messages.id, messageIds));
}

function buttonPayload(payload: {
	body: string;
	buttons: Array<{ id: string; title: string }>;
}): OutboundMessagePayload {
	return {
		body: payload.body,
		buttons: payload.buttons,
		kind: "buttons",
	};
}

/**
 * A task anchor owns a persisted debounce cohort. Only unprocessed user
 * messages referenced by inbound tasks in that cohort are included; stale
 * history without a matching task is never folded into the current reply.
 */
/**
 * Passo 11: o modelo falhou, então o cliente recebe o aviso aprovado em vez de
 * silêncio, e a task **conclui** — nada vai tentar de novo sozinho, o que é
 * exatamente o que o texto promete.
 *
 * Invariantes preservadas: usa o `runKey` que já existe, sem inventar uma
 * segunda chave de idempotência, então uma reexecução cai no dedup do outbox e
 * nenhuma mensagem possivelmente aceita pela Meta volta para `pending`; e
 * marca mensagens e evento como processados exatamente como o caminho de
 * sucesso, então nenhum evento de entrada é processado duas vezes.
 */
/**
 * Passo 3 (scheduling-loop, Q4): o mesmo aviso, com as mesmas garantias (lead
 * travado primeiro, conversa relida como ativa sob o lock, chave `runKey`),
 * também cobre um erro que não é do modelo na última tentativa da task de
 * entrada. Nesse caso nada é devolvido: o chamador relança o erro como
 * `PermanentAutonomousTaskError` e a task fica `failed`.
 */
async function sendModelFailureNotice({
	conversationId,
	error,
	eventId,
	leadId,
	messageIds,
	runKey,
}: {
	conversationId: string;
	error: ModelUnavailableError | { finalAttempt: number };
	eventId: string | undefined;
	leadId: string;
	messageIds: string[];
	runKey: string;
}) {
	// Rev3.1 passo 40 (F-V3b-1): lead travado primeiro; a rotação fecha a
	// conversa sob o mesmo lock, então o status relido aqui é o final.
	const assistantMessage = await db.transaction(async (tx) => {
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
			return null;
		}

		const [inserted] = await tx
			.insert(messages)
			.values({
				content: MODEL_FAILURE_NOTICE,
				conversationId,
				role: "assistant",
			})
			.returning({ id: messages.id });

		await enqueueOutboundMessage({
			conversationId,
			eventId,
			executor: tx,
			idempotencyKey: runKey,
			leadId,
			messageId: inserted?.id,
			payload: { kind: "text", text: MODEL_FAILURE_NOTICE },
		});

		return inserted ?? { id: undefined };
	});

	if (!assistantMessage) {
		await markEventProcessed(eventId);
		return { reason: "conversation_not_active", skipped: true };
	}

	await markMessagesProcessed(messageIds);
	await markEventProcessed(eventId);

	if (error instanceof ModelUnavailableError) {
		console.error({
			conversationId,
			event: "mariana_model_failure",
			kind: error.kind,
			leadId,
			model: resolveModelName(),
		});
	} else {
		console.error({
			attempts: error.finalAttempt,
			conversationId,
			event: "mariana_final_attempt_notice",
			leadId,
		});
	}

	return {
		assistantMessageId: assistantMessage?.id,
		modelFailureNotice: true,
		outboundQueued: true,
	};
}

const handleProcessInboundMessage: AutonomousTaskHandler = async ({ task }) => {
	const { conversationId, payload: taskPayload, triggerMessageId } = task;
	const eventId = taskPayload?.eventId as string | undefined;
	if (!triggerMessageId) {
		throw new PermanentAutonomousTaskError("Inbound trigger message missing");
	}

	const [conversation] = await db
		.select({
			id: conversations.id,
			leadId: conversations.leadId,
			status: conversations.status,
		})
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);

	if (!conversation) {
		throw new PermanentAutonomousTaskError("Conversation not found");
	}

	// R-V1b-1: tarefa de uma conversa fechada nunca responde na conversa nova.
	if (conversation.status !== "active") {
		await markEventProcessed(eventId);
		return { reason: "conversation_not_active", skipped: true };
	}

	const batchCandidates = await db
		.select({
			content: messages.content,
			createdAt: messages.createdAt,
			id: messages.id,
			taskCreatedAt: autonomousTasks.createdAt,
			taskId: autonomousTasks.id,
			taskPayload: autonomousTasks.payload,
		})
		.from(autonomousTasks)
		.innerJoin(messages, eq(messages.id, autonomousTasks.triggerMessageId))
		.where(
			and(
				eq(autonomousTasks.conversationId, conversationId),
				eq(autonomousTasks.taskType, PROCESS_INBOUND_MESSAGE_TASK),
				inArray(autonomousTasks.status, ["pending", "processing"]),
				or(
					eq(autonomousTasks.id, task.id),
					and(
						gte(autonomousTasks.createdAt, task.createdAt),
						lte(autonomousTasks.createdAt, getInboundBatchCutoffAt(task))
					)
				),
				eq(messages.conversationId, conversationId),
				eq(messages.role, "user"),
				isNull(messages.processedAt)
			)
		)
		.orderBy(asc(autonomousTasks.createdAt), asc(autonomousTasks.id));
	const unprocessed = selectInboundMessageBatch({
		anchorTask: task,
		candidates: batchCandidates,
	});

	if (unprocessed.length === 0) {
		await markEventProcessed(eventId);
		return { skipped: true };
	}

	const lastMessage = unprocessed.at(-1);
	if (!lastMessage) {
		await markEventProcessed(eventId);
		return { skipped: true };
	}

	const messageIds = unprocessed.map((message) => message.id);
	const runKey = buildInboundReplyIdempotencyKey(
		conversationId,
		triggerMessageId
	);

	const [existingOutbound] = await db
		.select({ id: outboundMessages.id })
		.from(outboundMessages)
		.where(eq(outboundMessages.idempotencyKey, runKey))
		.limit(1);

	if (existingOutbound) {
		await markMessagesProcessed(messageIds);
		await markEventProcessed(eventId);
		return { deduplicated: true };
	}

	const messageCutoff = unprocessed.reduce(
		(latest, message) =>
			message.createdAt > latest ? message.createdAt : latest,
		lastMessage.createdAt
	);

	// Falha do turno, igual para v1 e v2 (2026-10-28-flow-v2, A3).
	const handleTurnFailure = async (error: unknown) => {
		// R-V1b-1: a conversa fechou durante o turno; nada foi gravado.
		if (error instanceof TurnSupersededError) {
			await markEventProcessed(eventId);
			return { reason: "conversation_not_active", skipped: true };
		}

		// Guardrail e erro de banco continuam falhando a task como hoje:
		// engolir tudo esconderia defeito de verdade. Passo 3 (Q2/Q4): na
		// última tentativa o cliente ainda recebe o aviso fixo (uma vez, pela
		// `runKey`) e a task termina `failed`, visível, com o erro em `cause`.
		if (!(error instanceof ModelUnavailableError)) {
			if (task.attempts >= task.maxAttempts) {
				await sendModelFailureNotice({
					conversationId,
					error: { finalAttempt: task.attempts },
					eventId,
					leadId: conversation.leadId,
					messageIds,
					runKey,
				});
				throw new PermanentAutonomousTaskError(
					error instanceof Error ? error.message : String(error),
					{ cause: error }
				);
			}
			throw error;
		}

		return await sendModelFailureNotice({
			conversationId,
			error,
			eventId,
			leadId: conversation.leadId,
			messageIds,
			runKey,
		});
	};

	// 2026-10-28-flow-v2 (A3): o único ponto onde v1 e v2 divergem. A v2 grava
	// a linha da assistente, o outbox (chave `runKey`) e as mensagens
	// processadas na própria transação; aqui só o evento é marcado.
	if (env.MARIANA_FLOW === "v2") {
		let flowV2Result: Awaited<ReturnType<typeof runFlowV2Turn>>;
		try {
			flowV2Result = await runFlowV2Turn({
				conversationId,
				currentMessages: unprocessed.map((message) => message.content),
				eventId,
				leadId: conversation.leadId,
				messageCutoff,
				messageIds,
				runKey,
				traceTurnId: task.id,
			});
		} catch (error) {
			return await handleTurnFailure(error);
		}

		await markEventProcessed(eventId);
		return flowV2Result.status === "queued"
			? {
					assistantMessageId: flowV2Result.assistantMessageId,
					flow: "v2",
					outboundQueued: true,
					route: flowV2Result.route,
				}
			: { flow: "v2", reason: flowV2Result.status, skipped: true };
	}

	let marianaResult: Awaited<ReturnType<typeof generateMarianaResponse>>;

	try {
		marianaResult = await generateMarianaResponse({
			currentMessages: unprocessed.map((message) => message.content),
			expectedConversationId: conversationId,
			leadId: conversation.leadId,
			messageCutoff,
			messageIds,
			persistUserMessage: false,
			// A task âncora identifica o turno no rastro.
			traceTurnId: task.id,
		});
	} catch (error) {
		return await handleTurnFailure(error);
	}

	const assistantMessageId = marianaResult.assistantMessage?.id;

	const payload: OutboundMessagePayload = marianaResult.schedulingOffer
		? buttonPayload(
				marianaResult.schedulingOffer.slots.length === 1
					? schedulingConfirmationService.buildSingleSlotConfirmationMessage(
							marianaResult.schedulingOffer.slots[0]
						)
					: buildWhatsAppSchedulingOffer(marianaResult.schedulingOffer.slots)
			)
		: { kind: "text", text: marianaResult.result.reply };

	// Rev3 passo 37 (janela do passo 28): a rotação pode ter commitado depois
	// do turno. Lead travado primeiro; a conversa precisa continuar ativa para
	// a resposta ir para o outbox (R-V1b-1, S-23).
	const queued = await db.transaction(async (tx) => {
		const [lead] = await tx
			.select({ phone: leads.phone })
			.from(leads)
			.where(eq(leads.id, conversation.leadId))
			.for("update");

		if (!lead) {
			throw new PermanentAutonomousTaskError("Lead not found");
		}

		const [current] = await tx
			.select({ status: conversations.status })
			.from(conversations)
			.where(eq(conversations.id, conversationId))
			.limit(1);

		if (current?.status !== "active") {
			return false;
		}

		await enqueueOutboundMessage({
			conversationId,
			eventId,
			executor: tx,
			idempotencyKey: runKey,
			leadId: conversation.leadId,
			messageId: assistantMessageId,
			payload,
		});

		return true;
	});

	if (!queued) {
		await markEventProcessed(eventId);
		return { reason: "conversation_not_active", skipped: true };
	}

	await markMessagesProcessed(messageIds);
	await markEventProcessed(eventId);

	return { assistantMessageId, outboundQueued: true };
};

/** D-R2-6 (a): texto fixo da reoferta (R-SCH-08, S-24). */
export const SLOT_UNAVAILABLE_REOFFER_TEXT =
	"Esse horário acabou de ficar indisponível. Tenho estes outros horários:";
/** Passo 35 (D-R3-3 a): reoferta com um único horário novo, no singular. */
export const SLOT_UNAVAILABLE_SINGLE_REOFFER_PREFIX =
	"Esse horário acabou de ficar indisponível. Tenho outro horário:";
/** Texto já usado quando a oferta não acha horário (`formatSchedulingOffer`). */
const NO_SLOTS_TEXT =
	"No momento, não encontrei horários disponíveis nos próximos 5 dias.";

type HandlerTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Rev3.1 passo 41 (S-23): trava o lead primeiro (a rotação fecha a conversa
 * sob o mesmo lock) e relê o status. `true` = a conversa continua ativa.
 */
async function lockLeadAndCheckActive(
	tx: HandlerTx,
	leadId: string,
	conversationId: string
): Promise<boolean> {
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

	return current?.status === "active";
}

/**
 * Rev3.1 passo 41: enfileira só se a conversa continua ativa sob o lock do
 * lead. Mesma chave e mesmo payload de antes; devolve se enfileirou.
 */
async function enqueueIfConversationActive(
	input: Omit<Parameters<typeof enqueueOutboundMessage>[0], "executor"> & {
		conversationId: string;
		leadId: string;
	}
): Promise<boolean> {
	return await db.transaction(async (tx) => {
		if (
			!(await lockLeadAndCheckActive(tx, input.leadId, input.conversationId))
		) {
			return false;
		}

		await enqueueOutboundMessage({ ...input, executor: tx });
		return true;
	});
}

/**
 * Passo 33 (B-3, S-24, R-SCH-08; D-R2-5 a): o horário escolhido ficou ocupado
 * antes do Confirmar. Nada foi agendado. Faz uma oferta nova (novo sorteio do
 * consultor por horário, nova sessão, nova seleção); o consultor nunca é
 * trocado em silêncio. Lead travado primeiro; sessão, slots, linha do
 * assistente e outbox na mesma transação (chave `reoffer:<externalId>`,
 * R-REL-02). Sem horários: o texto de sem horários, e a sessão antiga fecha
 * para o horário ocupado não ser confirmado de novo.
 */
async function sendSlotUnavailableReoffer({
	buttonId,
	conversationId,
	eventId,
	externalId,
	leadId,
}: {
	buttonId: string;
	conversationId: string;
	eventId: string | undefined;
	externalId: string | undefined;
	leadId: string;
}) {
	const idempotencyKey = `reoffer:${externalId ?? `${conversationId}:${buttonId}`}`;
	const [existing] = await db
		.select({ id: outboundMessages.id })
		.from(outboundMessages)
		.where(eq(outboundMessages.idempotencyKey, idempotencyKey))
		.limit(1);

	if (existing) {
		return { replied: false };
	}

	// Calendar fora da transação, como na oferta do turno.
	const timeMin = new Date();
	const timeMax = new Date(timeMin);
	timeMax.setDate(timeMax.getDate() + 5);
	const offeredSlots = (
		await schedulingAvailabilityService.getAvailableSlots({
			leadId,
			random: Math.random,
			timeMax,
			timeMin,
		})
	).slice(0, 3);

	return await db.transaction(async (tx) => {
		// Rev3.1 passo 41: a rotação pode ter fechado a conversa durante a
		// busca de horários; nenhuma sessão nem reoferta numa conversa fechada.
		if (!(await lockLeadAndCheckActive(tx, leadId, conversationId))) {
			return { reason: "conversation_not_active", replied: false };
		}

		const [raced] = await tx
			.select({ id: outboundMessages.id })
			.from(outboundMessages)
			.where(eq(outboundMessages.idempotencyKey, idempotencyKey))
			.limit(1);

		if (raced) {
			return { replied: false };
		}

		let payload: OutboundMessagePayload = { kind: "text", text: NO_SLOTS_TEXT };
		const [assistantMessage] = await tx
			.insert(messages)
			.values({
				content:
					offeredSlots.length > 0
						? SLOT_UNAVAILABLE_REOFFER_TEXT
						: NO_SLOTS_TEXT,
				conversationId,
				role: "assistant",
			})
			.returning({ id: messages.id });

		if (!assistantMessage) {
			throw new Error("Assistant message not created");
		}

		if (offeredSlots.length > 0) {
			// persistOffer fecha a sessão anterior e abre a nova na mesma tx.
			const offer = await schedulingOfferService.persistOffer({
				conversationId,
				executor: tx,
				finalReply: SLOT_UNAVAILABLE_REOFFER_TEXT,
				leadId,
				messageId: assistantMessage.id,
				offeredSlots,
			});
			const [onlySlot] = offer.slots;

			if (offer.slots.length === 1 && onlySlot) {
				// Um único horário já fica selecionado (B-2): vai com Confirmar/Não.
				const single =
					schedulingConfirmationService.buildSingleSlotConfirmationMessage(
						onlySlot
					);
				const body = `${SLOT_UNAVAILABLE_SINGLE_REOFFER_PREFIX} ${formatSlotDate(onlySlot.startAt)} com ${onlySlot.consultantName}. Posso confirmar?`;
				await tx
					.update(messages)
					.set({ content: body })
					.where(eq(messages.id, assistantMessage.id));
				payload = buttonPayload({ body, buttons: single.buttons });
			} else {
				payload = buttonPayload({
					body: SLOT_UNAVAILABLE_REOFFER_TEXT,
					buttons: buildWhatsAppSchedulingOffer(offer.slots).buttons,
				});
			}
		} else {
			await tx
				.update(schedulingSessions)
				.set({ status: "closed", updatedAt: new Date() })
				.where(
					and(
						eq(schedulingSessions.leadId, leadId),
						eq(schedulingSessions.conversationId, conversationId),
						eq(schedulingSessions.status, "active")
					)
				);
		}

		await enqueueOutboundMessage({
			conversationId,
			eventId,
			executor: tx,
			idempotencyKey,
			leadId,
			messageId: assistantMessage.id,
			payload,
		});

		return { replied: true };
	});
}

/**
 * Passo 34 (F-T32-1, F-V1c-3; R-SCH-03, S-07): um toque que a etapa recusa
 * (horário de outra oferta, Confirmar/Não antigo, sessão vencida ou ausente)
 * recebe o aviso de botão antigo com os botões da etapa atual, nunca silêncio.
 * Lead travado primeiro; a conversa precisa continuar ativa (R-SES-01). Só
 * escreve texto e botões: nunca seleciona nem agenda. Chave
 * `stale-tap:<externalId>` (R-REL-02). Marca o evento como processado.
 */
async function replyToRefusedTap({
	conversationId,
	eventId,
	externalId,
	leadId,
	taskId,
}: {
	conversationId: string;
	eventId?: string;
	externalId?: string;
	leadId: string;
	taskId: string;
}): Promise<boolean> {
	const { replied } = await db.transaction(async (tx) => {
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
			return { replied: false };
		}

		return await replyToStaleTap(tx, {
			conversationId,
			eventId: undefined,
			externalId: externalId ?? `task:${taskId}`,
			leadId,
		});
	});

	await markEventProcessed(eventId);
	return replied;
}

/**
 * Handler de resposta de botão. Reaproveita os fluxos determinísticos de
 * seleção, confirmação e cancelamento e enfileira a próxima mensagem no
 * outbox. Idempotente pela chave derivada do id externo do botão.
 */
const handleProcessButtonReply: AutonomousTaskHandler = async ({ task }) => {
	const { conversationId, payload: taskPayload } = task;
	const eventId = taskPayload?.eventId as string | undefined;
	const buttonId = taskPayload?.buttonId as string | undefined;
	const externalId = taskPayload?.eventExternalId as string | undefined;

	if (!buttonId) {
		throw new PermanentAutonomousTaskError("Button id missing in payload");
	}

	const [conversation] = await db
		.select({ id: conversations.id, leadId: conversations.leadId })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);

	if (!conversation) {
		throw new PermanentAutonomousTaskError("Conversation not found");
	}

	const [lead] = await db
		.select({ id: leads.id, phone: leads.phone })
		.from(leads)
		.where(eq(leads.id, conversation.leadId))
		.limit(1);

	if (!lead) {
		throw new PermanentAutonomousTaskError("Lead not found");
	}

	await db
		.update(conversations)
		.set({ lastCustomerMessageAt: new Date(), updatedAt: new Date() })
		.where(eq(conversations.id, conversationId));

	const runKey = `button-reply:${conversationId}:${externalId ?? buttonId}`;

	const [existingOutbound] = await db
		.select({ id: outboundMessages.id })
		.from(outboundMessages)
		.where(eq(outboundMessages.idempotencyKey, runKey))
		.limit(1);

	if (existingOutbound) {
		await markEventProcessed(eventId);
		return { deduplicated: true };
	}

	// 2026-10-28-flow-v2 (A3, R3 → R8): "Falar com consultor". Tratado pela
	// v2 com qualquer valor da flag (só a v2 envia esse botão). Mesma chave
	// `runKey` do toque; a v2 grava linha, oferta e outbox numa transação.
	if (buttonId === CONSULTANT_BUTTON.id) {
		let tap: Awaited<ReturnType<typeof runFlowV2Tap>>;
		try {
			tap = await runFlowV2Tap({
				conversationId,
				eventId,
				leadId: lead.id,
				runKey,
				traceTurnId: task.id,
			});
		} catch (error) {
			if (error instanceof TurnSupersededError) {
				await markEventProcessed(eventId);
				return { reason: "conversation_not_active", skipped: true };
			}
			throw error;
		}

		await markEventProcessed(eventId);
		return tap.status === "queued"
			? { action: "consultant_tap", route: tap.route }
			: { action: "consultant_tap", reason: tap.status, skipped: true };
	}

	if (buttonId.startsWith("confirm:")) {
		const confirmationResult = await schedulingConfirmationOrchestrator.execute(
			{
				buttonId,
				conversationId,
				leadId: lead.id,
			}
		);

		if (confirmationResult.ok && confirmationResult.action === "confirm") {
			const { appointment, slot } = confirmationResult;

			await enqueueOutboundMessage({
				conversationId,
				eventId,
				idempotencyKey: runKey,
				leadId: lead.id,
				payload: {
					kind: "text",
					text: buildBookingConfirmationText({
						consultantName: slot.consultantName,
						meetLink: appointment.calendarEvent.hangoutLink,
						startAt: slot.startAt,
					}),
				},
			});
		}

		if (
			!confirmationResult.ok &&
			confirmationResult.reason === "slot_unavailable"
		) {
			await sendSlotUnavailableReoffer({
				buttonId,
				conversationId,
				eventId,
				externalId,
				leadId: lead.id,
			});
			await markEventProcessed(eventId);
			return { action: "reoffer" };
		}

		if (
			!confirmationResult.ok &&
			confirmationResult.reason !== "appointment_failed"
		) {
			const replied = await replyToRefusedTap({
				conversationId,
				eventId,
				externalId,
				leadId: lead.id,
				taskId: task.id,
			});
			return { action: "rejected", replied };
		}

		await markEventProcessed(eventId);
		return {
			action: confirmationResult.ok ? confirmationResult.action : "rejected",
		};
	}

	if (buttonId.startsWith("cancel:")) {
		const cancellationResult =
			await schedulingCancellationService.resolveCancellation({
				buttonId,
				conversationId,
				leadId: lead.id,
			});

		if (cancellationResult.ok && cancellationResult.action === "reoffer") {
			await enqueueIfConversationActive({
				conversationId,
				eventId,
				idempotencyKey: runKey,
				leadId: lead.id,
				payload: buttonPayload({
					body: "Tudo bem. Tenho estes horários disponíveis:",
					buttons: cancellationResult.slots.map((slot) => ({
						id: slot.id,
						title: formatSlotTitle(slot.startAt),
					})),
				}),
			});
		} else if (cancellationResult.ok && cancellationResult.action === "close") {
			await enqueueIfConversationActive({
				conversationId,
				eventId,
				idempotencyKey: runKey,
				leadId: lead.id,
				payload: {
					kind: "text",
					text: "Tudo bem. Esse horário não foi confirmado. Quando quiser, podemos consultar novos horários.",
				},
			});
		}

		if (!cancellationResult.ok) {
			const replied = await replyToRefusedTap({
				conversationId,
				eventId,
				externalId,
				leadId: lead.id,
				taskId: task.id,
			});
			return { action: "rejected", replied };
		}

		await markEventProcessed(eventId);
		return { action: cancellationResult.action };
	}

	const choiceResult = await schedulingChoiceService.resolveChoice({
		buttonId,
		conversationId,
		leadId: lead.id,
	});

	if (choiceResult.ok) {
		const confirmation = schedulingConfirmationService.buildConfirmationMessage(
			choiceResult.slot
		);

		await enqueueIfConversationActive({
			conversationId,
			eventId,
			idempotencyKey: runKey,
			leadId: lead.id,
			payload: buttonPayload(confirmation),
		});
	}

	await markEventProcessed(eventId);
	return { selected: choiceResult.ok };
};

function formatSlotTitle(startAt: Date): string {
	return new Intl.DateTimeFormat("pt-BR", {
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		month: "2-digit",
		timeZone: "America/Sao_Paulo",
	})
		.format(startAt)
		.replace(",", " às");
}

/**
 * Passo 32 (S-25, uma release): a pergunta de preferência de consultor saiu
 * do fluxo (R-SCH-01 v1.4). Uma tarefa `send_consultant_preference_question`
 * enfileirada antes do deploy não envia nada: marca o evento como processado.
 * A sessão continua com os seus slots, e o toque no horário é aceito na etapa
 * legada (`handleSendConfirmationRequest`).
 */
const handleLegacyConsultantPreferenceQuestion: AutonomousTaskHandler = async ({
	task,
}) => {
	await markEventProcessed(task.payload?.eventId as string | undefined);
	return { legacyConsultantPreferenceQuestion: true, skipped: true };
};

/**
 * Passo 32 (S-07, S-25, uma release): uma tarefa `process_consultant_*`
 * enfileirada antes do deploy (toque em "Tenho/Sem preferência" ou num
 * consultor) recebe o aviso de botão antigo com os botões de horário da
 * sessão, que passa para awaiting_slot_selection. Lead travado primeiro;
 * etapa, linha do assistente e outbox na mesma transação (chave
 * `stale-tap:<externalId>`, R-REL-02).
 */
const handleLegacyConsultantTap: AutonomousTaskHandler = async ({ task }) => {
	const { conversationId, payload: taskPayload } = task;
	const eventId = taskPayload?.eventId as string | undefined;
	const externalId = taskPayload?.eventExternalId as string | undefined;

	const [conversation] = await db
		.select({ id: conversations.id, leadId: conversations.leadId })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);

	if (!conversation) {
		throw new PermanentAutonomousTaskError("Conversation not found");
	}

	// Rev3.1 passo 41: o status é lido sob o lock do lead, não antes.
	const outcome = await db.transaction(async (tx) => {
		if (
			!(await lockLeadAndCheckActive(tx, conversation.leadId, conversationId))
		) {
			return null;
		}

		await promoteLegacySchedulingStage(tx, { conversationId });

		return await replyToStaleTap(tx, {
			conversationId,
			eventId: undefined,
			externalId: externalId ?? `task:${task.id}`,
			leadId: conversation.leadId,
		});
	});

	await markEventProcessed(eventId);
	if (!outcome) {
		return { reason: "conversation_not_active", skipped: true };
	}
	return { legacyConsultantTap: true, replied: outcome.replied };
};

/**
 * Handler para enviar a solicitação de confirmação após seleção de slot.
 * Transição: awaiting_slot_selection → awaiting_confirmation
 */
const handleSendConfirmationRequest: AutonomousTaskHandler = async ({
	task,
}) => {
	const { conversationId, payload: taskPayload } = task;
	const eventId = taskPayload?.eventId as string | undefined;
	const buttonId = taskPayload?.buttonId as string | undefined;
	const externalId = taskPayload?.eventExternalId as string | undefined;

	if (!buttonId) {
		throw new PermanentAutonomousTaskError("Button id missing in payload");
	}

	const [conversation] = await db
		.select({ id: conversations.id, leadId: conversations.leadId })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);

	if (!conversation) {
		throw new PermanentAutonomousTaskError("Conversation not found");
	}

	const [lead] = await db
		.select({ id: leads.id, phone: leads.phone })
		.from(leads)
		.where(eq(leads.id, conversation.leadId))
		.limit(1);

	if (!lead) {
		throw new PermanentAutonomousTaskError("Lead not found");
	}

	await db
		.update(conversations)
		.set({ lastCustomerMessageAt: new Date(), updatedAt: new Date() })
		.where(eq(conversations.id, conversationId));

	const [session] = await db
		.select()
		.from(schedulingSessions)
		.where(
			and(
				eq(schedulingSessions.leadId, lead.id),
				eq(schedulingSessions.conversationId, conversationId),
				eq(schedulingSessions.status, "active")
			)
		)
		.limit(1);

	// Passo 32 (S-25, uma release): sessão criada antes do deploy numa etapa
	// do fluxo antigo. O toque num slot desta mesma sessão vale como em
	// awaiting_slot_selection; um slot de outra sessão não muda nada.
	if (
		session &&
		(LEGACY_SCHEDULING_STAGES as readonly string[]).includes(
			session.workflowStage
		) &&
		UUID_PATTERN.test(buttonId)
	) {
		const [ownSlot] = await db
			.select({ id: schedulingSlots.id })
			.from(schedulingSlots)
			.where(
				and(
					eq(schedulingSlots.id, buttonId),
					eq(schedulingSlots.schedulingSessionId, session.id)
				)
			)
			.limit(1);

		if (
			ownSlot &&
			(await promoteLegacySchedulingStage(db, {
				conversationId,
				sessionId: session.id,
			}))
		) {
			session.workflowStage = "awaiting_slot_selection";
		}
	}

	if (session?.workflowStage !== "awaiting_slot_selection") {
		const replied = await replyToRefusedTap({
			conversationId,
			eventId,
			externalId,
			leadId: lead.id,
			taskId: task.id,
		});
		return {
			replied,
			skipped: true,
			reason: "no_active_session_or_invalid_stage",
		};
	}

	// Validar e persistir a seleção do slot
	const choiceResult = await schedulingChoiceService.resolveChoice({
		buttonId,
		conversationId,
		leadId: lead.id,
	});

	if (!choiceResult.ok) {
		const replied = await replyToRefusedTap({
			conversationId,
			eventId,
			externalId,
			leadId: lead.id,
			taskId: task.id,
		});
		return { replied, skipped: true, reason: choiceResult.reason };
	}

	const runKey = `confirmation-request:${conversationId}:${externalId ?? buttonId}`;

	const [existingOutbound] = await db
		.select({ id: outboundMessages.id })
		.from(outboundMessages)
		.where(eq(outboundMessages.idempotencyKey, runKey))
		.limit(1);

	if (existingOutbound) {
		await markEventProcessed(eventId);
		return { deduplicated: true };
	}

	// Enviar mensagem de confirmação com botões Confirmar/Não
	const confirmation = schedulingConfirmationService.buildConfirmationMessage(
		choiceResult.slot
	);

	// Atualizar workflow stage para awaiting_confirmation e enfileirar o
	// pedido na mesma transação: se o outbox falhar, a sessão continua em
	// awaiting_slot_selection e a nova tentativa refaz o pedido.
	// Passo 36 (F-T27-1, D-R2-4): o lead primeiro, antes da sessão, como a
	// rotação; senão sessão → FK do outbox para o lead fecha um ciclo (40P01).
	const transitioned = await db.transaction(async (tx) => {
		// Rev3.1 passo 41: status explícito sob o lock do lead (a condição
		// `status = active` da sessão já cobria a rotação; fica uniforme).
		if (!(await lockLeadAndCheckActive(tx, lead.id, conversationId))) {
			return false;
		}

		const [confirmationSession] = await tx
			.update(schedulingSessions)
			.set({
				workflowStage: "awaiting_confirmation",
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(schedulingSessions.id, session.id),
					eq(schedulingSessions.leadId, lead.id),
					eq(schedulingSessions.conversationId, conversationId),
					eq(schedulingSessions.status, "active"),
					eq(schedulingSessions.workflowStage, "awaiting_slot_selection"),
					eq(schedulingSessions.selectedSlotId, choiceResult.slot.id),
					gt(schedulingSessions.expiresAt, new Date())
				)
			)
			.returning({ id: schedulingSessions.id });

		if (!confirmationSession) {
			return false;
		}

		await enqueueOutboundMessage({
			conversationId,
			eventId: undefined,
			executor: tx,
			idempotencyKey: runKey,
			leadId: lead.id,
			payload: buttonPayload(confirmation),
		});

		return true;
	});

	if (!transitioned) {
		const replied = await replyToRefusedTap({
			conversationId,
			eventId,
			externalId,
			leadId: lead.id,
			taskId: task.id,
		});
		return {
			replied,
			skipped: true,
			reason: "session_changed_before_confirmation",
		};
	}

	await markEventProcessed(eventId);
	return { confirmationRequestSent: true };
};

/**
 * E3-a (Rev1 step 23): a escolha de sessão foi removida (R-SES-02 v1.3). Tasks
 * `ask/remind/process_session_choice` enfileiradas antes do deploy, e toques
 * `sessao:*` de perguntas antigas, caem neste no-op por uma release: marca o
 * evento como processado, sem falha e sem resposta. Não trava nada.
 */
const handleLegacySessionChoice: AutonomousTaskHandler = async ({ task }) => {
	await markEventProcessed(task.payload?.eventId as string | undefined);
	return { legacySessionChoice: true };
};

export const PROCESS_INBOUND_MESSAGE_TASK = "process_inbound_message";
/**
 * Passo 3 (Q2, aprovado por Davi): cada tentativa refaz o turno inteiro,
 * inclusive a chamada ao Gemini, então a task de entrada para em 3.
 */
export const INBOUND_TASK_MAX_ATTEMPTS = 3;
export const PROCESS_BUTTON_REPLY_TASK = "process_button_reply";
export const SEND_CONSULTANT_PREFERENCE_QUESTION_TASK =
	"send_consultant_preference_question";
export const PROCESS_CONSULTANT_PREFERENCE_REPLY_TASK =
	"process_consultant_preference_reply";
export const PROCESS_CONSULTANT_SELECTION_TASK = "process_consultant_selection";
export const SEND_CONFIRMATION_REQUEST_TASK = "send_confirmation_request";
/** E3-a: tipos legados da escolha de sessão, drenados pelo no-op por uma release. */
export const LEGACY_SESSION_CHOICE_TASK_TYPES = [
	"ask_session_choice",
	"remind_session_choice",
	"process_session_choice",
] as const;
export const LEGACY_SESSION_CHOICE_TAP_TASK = "process_session_choice";

export function createAutonomousTaskHandlers(): Record<
	string,
	AutonomousTaskHandler
> {
	return {
		[PROCESS_BUTTON_REPLY_TASK]: handleProcessButtonReply,
		[PROCESS_INBOUND_MESSAGE_TASK]: handleProcessInboundMessage,
		// Passo 32: tipos legados do fluxo de consultor, por uma release.
		[SEND_CONSULTANT_PREFERENCE_QUESTION_TASK]:
			handleLegacyConsultantPreferenceQuestion,
		[PROCESS_CONSULTANT_PREFERENCE_REPLY_TASK]: handleLegacyConsultantTap,
		[PROCESS_CONSULTANT_SELECTION_TASK]: handleLegacyConsultantTap,
		[SEND_CONFIRMATION_REQUEST_TASK]: handleSendConfirmationRequest,
		...Object.fromEntries(
			LEGACY_SESSION_CHOICE_TASK_TYPES.map((taskType) => [
				taskType,
				handleLegacySessionChoice,
			])
		),
	};
}
