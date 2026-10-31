/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/** biome-ignore-all lint/style/useDestructuring: <> */
/** biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: <> */
/** biome-ignore-all lint/suspicious/useAwait: <> */
/** biome-ignore-all assist/source/useSortedKeys: <> */

import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { db } from "../../db/connections";
import {
	autonomousTasks,
	conversations,
	messages,
	outboundMessages,
	whatsappWebhookEvents,
} from "../../db/schema";
import { env } from "../../env";
import { whatsAppService } from "../../integrations/whatsapp/whatsapp-service";
import type { WhatsAppWebhookPayload } from "../../integrations/whatsapp/whatsapp-types";
import {
	INBOUND_TASK_MAX_ATTEMPTS,
	PROCESS_BUTTON_REPLY_TASK,
	PROCESS_INBOUND_MESSAGE_TASK,
	SEND_CONFIRMATION_REQUEST_TASK,
} from "../../services/conversations/autonomous-task-handlers";
import {
	resolveConversationForInbound,
	SESSION_ROTATION_TAP_REPLY_TEXT,
	sessionRotationTapReplyKey,
} from "../../services/conversations/session-rotation";
import {
	promoteLegacySchedulingStage,
	replyToStaleTap,
} from "../../services/conversations/stale-tap-reply";
import { isOptOutRequest } from "../../services/conversations/whatsapp-compliance";
import { leadIngestionService } from "../../services/leads/lead-ingestion";
import { enqueueOutboundMessage } from "../../services/messaging/outbound-messages";

const WHATSAPP_WEBHOOK_EVENT_LEASE_MS = 60_000;
const SCHEDULING_SLOT_BUTTON_ID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

async function recoverStaleProcessingWebhookEvents() {
	const now = new Date();

	await db
		.update(whatsappWebhookEvents)
		.set({
			lastError: "processing lease expired",
			leaseExpiresAt: null,
			status: "failed",
			updatedAt: now,
		})
		.where(
			and(
				eq(whatsappWebhookEvents.status, "processing"),
				sql`${whatsappWebhookEvents.leaseExpiresAt} IS NOT NULL AND ${whatsappWebhookEvents.leaseExpiresAt} <= ${now.toISOString()}`
			)
		);
}

async function claimWhatsAppWebhookEvent({
	externalId,
	phone,
	eventType,
	payload,
}: {
	externalId: string;
	phone?: string;
	eventType: "button_reply" | "text";
	payload: Record<string, unknown>;
}) {
	const now = new Date();
	const leaseExpiresAt = new Date(
		now.getTime() + WHATSAPP_WEBHOOK_EVENT_LEASE_MS
	);

	const reclaimValues = {
		lastError: null,
		leaseExpiresAt,
		payload,
		phone,
		status: "processing" as const,
		updatedAt: now,
	};

	const [insertedEvent] = await db
		.insert(whatsappWebhookEvents)
		.values({
			eventType,
			externalId,
			leaseExpiresAt,
			payload,
			phone,
			status: "processing",
		})
		.onConflictDoNothing()
		.returning();

	if (insertedEvent) {
		return { duplicate: false, event: insertedEvent };
	}

	const [existingEvent] = await db
		.select()
		.from(whatsappWebhookEvents)
		.where(eq(whatsappWebhookEvents.externalId, externalId))
		.limit(1);

	if (!existingEvent) {
		return { duplicate: false as const };
	}

	const canReclaim =
		existingEvent.status === "failed" ||
		(existingEvent.status === "processing" &&
			(!existingEvent.leaseExpiresAt || existingEvent.leaseExpiresAt <= now));

	if (canReclaim) {
		const [reclaimedEvent] = await db
			.update(whatsappWebhookEvents)
			.set(reclaimValues)
			.where(
				and(
					eq(whatsappWebhookEvents.externalId, externalId),
					eq(whatsappWebhookEvents.status, existingEvent.status)
				)
			)
			.returning();

		if (reclaimedEvent) {
			return { duplicate: false, event: reclaimedEvent };
		}
	}

	return { duplicate: true as const, event: existingEvent };
}

export async function enqueueTask({
	availableAt,
	conversationId,
	createdAt,
	executor = db,
	idempotencyKey,
	payload,
	preserveExisting = false,
	taskType,
	triggerMessageId,
}: {
	availableAt?: Date;
	conversationId: string;
	createdAt?: Date;
	executor?: Pick<typeof db, "insert">;
	idempotencyKey: string;
	payload: Record<string, unknown>;
	preserveExisting?: boolean;
	taskType: string;
	triggerMessageId?: string;
}): Promise<boolean> {
	const taskInsert = executor.insert(autonomousTasks).values({
		availableAt: availableAt ?? new Date(),
		conversationId,
		createdAt: createdAt ?? undefined,
		idempotencyKey,
		// Passo 3 (Q2): a task de entrada para em 3; as outras mantêm o padrão.
		maxAttempts:
			taskType === PROCESS_INBOUND_MESSAGE_TASK
				? INBOUND_TASK_MAX_ATTEMPTS
				: undefined,
		payload,
		taskType,
		triggerMessageId: triggerMessageId ?? null,
	});

	if (preserveExisting) {
		const [insertedTask] = await taskInsert
			.onConflictDoNothing({ target: autonomousTasks.idempotencyKey })
			.returning({ id: autonomousTasks.id });
		return Boolean(insertedTask);
	}

	await taskInsert.onConflictDoUpdate({
		set: {
			availableAt: availableAt ?? new Date(),
			attempts: 0,
			lastError: null,
			leaseExpiresAt: null,
			leaseToken: null,
			payload,
			status: "pending",
			updatedAt: new Date(),
		},
		setWhere: ne(autonomousTasks.status, "processing"),
		target: autonomousTasks.idempotencyKey,
	});
	return true;
}

async function extendOpenInboundBatch({
	batchCutoffAt,
	conversationId,
	now,
	executor = db,
}: {
	batchCutoffAt: Date;
	conversationId: string;
	now: Date;
	executor?: typeof db;
}) {
	const pendingTasks = await executor
		.select({ id: autonomousTasks.id, payload: autonomousTasks.payload })
		.from(autonomousTasks)
		.where(
			and(
				eq(autonomousTasks.conversationId, conversationId),
				eq(autonomousTasks.taskType, PROCESS_INBOUND_MESSAGE_TASK),
				eq(autonomousTasks.status, "pending"),
				isNull(autonomousTasks.startedAt),
				gt(autonomousTasks.availableAt, now)
			)
		);

	for (const pendingTask of pendingTasks) {
		await executor
			.update(autonomousTasks)
			.set({
				availableAt: batchCutoffAt,
				payload: {
					...(pendingTask.payload as Record<string, unknown>),
					batchCutoffAt: batchCutoffAt.toISOString(),
				},
				updatedAt: now,
			})
			.where(
				and(
					eq(autonomousTasks.id, pendingTask.id),
					eq(autonomousTasks.status, "pending"),
					isNull(autonomousTasks.startedAt),
					gt(autonomousTasks.availableAt, now)
				)
			);
	}
}

export const webhookWhatsApp: FastifyPluginCallbackZod = (app, _opts, done) => {
	app.addContentTypeParser(
		"application/json",
		{ parseAs: "string" },
		(req, body, doneParsing) => {
			try {
				(req as unknown as { rawBody: string }).rawBody = body as string;

				const json = JSON.parse(body as string);

				doneParsing(null, json);
			} catch (err) {
				doneParsing(err as Error, undefined);
			}
		}
	);

	app.get("/webhooks/whatsapp", async (request, reply) => {
		const query = request.query as Record<string, string | undefined>;
		const mode = query["hub.mode"];
		const token = query["hub.verify_token"];
		const challenge = query["hub.challenge"];

		if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
			request.log.info({
				event: "whatsapp_webhook_verified",
			});

			return reply
				.code(200)
				.type("text/plain")
				.send(challenge ?? "");
		}

		request.log.warn({
			event: "whatsapp_webhook_verification_failed",
			mode,
			tokenMatched: false,
		});

		return reply.code(403).send({
			error: "Forbidden",
		});
	});

	app.post("/webhooks/whatsapp", async (request, reply) => {
		await recoverStaleProcessingWebhookEvents();

		const signatureHeader = request.headers["x-hub-signature-256"] as
			| string
			| undefined;

		const rawBody =
			(request as unknown as { rawBody?: string }).rawBody ??
			JSON.stringify(request.body);

		if (!whatsAppService.verifySignature(rawBody, signatureHeader)) {
			request.log.warn({
				event: "whatsapp_webhook_invalid_signature",
			});

			return reply.code(401).send({
				error: "Invalid signature",
			});
		}

		const payload = request.body as WhatsAppWebhookPayload;

		if (payload.object !== "whatsapp_business_account" || !payload.entry) {
			return reply.code(200).send({
				status: "ignored",
			});
		}

		for (const entry of payload.entry) {
			if (!entry.changes) {
				continue;
			}

			for (const change of entry.changes) {
				const { value } = change;

				if (!value?.messages || value.messages.length === 0) {
					continue;
				}

				for (const message of value.messages) {
					const isTextMessage =
						message.type === "text" && Boolean(message.text?.body);

					const isButtonReply =
						message.type === "interactive" &&
						message.interactive?.type === "button_reply" &&
						Boolean(message.interactive.button_reply?.id);

					if (!(isTextMessage || isButtonReply)) {
						continue;
					}

					const phone = message.from;
					const externalId = message.id;
					const content = message.text?.body;
					const buttonId = message.interactive?.button_reply?.id;
					const eventType = isButtonReply ? "button_reply" : "text";

					const eventReceipt = await claimWhatsAppWebhookEvent({
						eventType,
						externalId,
						payload: { buttonId, content, message, phone },
						phone,
					});

					if (eventReceipt.duplicate || !eventReceipt.event) {
						continue;
					}

					const event = eventReceipt.event;

					try {
						const contact = value.contacts?.find((c) => c.wa_id === phone);

						const ingestionResult = await leadIngestionService.ingest({
							name: contact?.profile?.name,
							phone,
							source: "whatsapp",
						});

						const lead = ingestionResult.lead;

						const receivedAt = new Date();

						if (isButtonReply && buttonId) {
							await db.transaction(async (tx) => {
								// R-SES-02 v1.3: toque também rotaciona após 4h, sob o lock
								// do lead, na mesma transação que grava o toque (K-1, F2-20).
								// Passo 39 (F-T26-2): `tapExternalId` acha a conversa que esse
								// toque já usou. Reentrega numa conversa fechada: evento
								// processado, sem tocar em B (R-REL-02, R-SES-01).
								const { conversation, redelivery, rotated } =
									await resolveConversationForInbound(tx, {
										leadId: lead.id,
										receivedAt,
										tapExternalId: externalId,
									});

								if (redelivery && conversation.status !== "active") {
									await tx
										.update(whatsappWebhookEvents)
										.set({
											conversationId: conversation.id,
											lastError: null,
											leaseExpiresAt: null,
											status: "processed",
											updatedAt: receivedAt,
										})
										.where(eq(whatsappWebhookEvents.id, event.id));
									return;
								}

								await tx
									.update(whatsappWebhookEvents)
									.set({
										conversationId: conversation.id,
										updatedAt: receivedAt,
									})
									.where(eq(whatsappWebhookEvents.id, event.id));

								await tx
									.update(conversations)
									.set({
										lastCustomerMessageAt: receivedAt,
										updatedAt: receivedAt,
									})
									.where(eq(conversations.id, conversation.id));

								// E1-a (S-20 v1.3): toque após 4h não é honrado. Uma resposta
								// fixa em B; linha do assistente e outbox na mesma transação
								// (F2-16). Uma reentrega (B já sem intervalo) acha a chave e
								// também não roteia o toque (R-REL-02).
								const tapReplyKey = sessionRotationTapReplyKey(externalId);
								const [existingTapReply] = await tx
									.select({ id: outboundMessages.id })
									.from(outboundMessages)
									.where(eq(outboundMessages.idempotencyKey, tapReplyKey))
									.limit(1);

								if (rotated || existingTapReply) {
									if (!existingTapReply) {
										const [assistantMessage] = await tx
											.insert(messages)
											.values({
												content: SESSION_ROTATION_TAP_REPLY_TEXT,
												conversationId: conversation.id,
												role: "assistant",
											})
											.returning({ id: messages.id });
										await enqueueOutboundMessage({
											conversationId: conversation.id,
											eventId: event.id,
											executor: tx,
											idempotencyKey: tapReplyKey,
											leadId: lead.id,
											messageId: assistantMessage?.id,
											payload: {
												kind: "text",
												text: SESSION_ROTATION_TAP_REPLY_TEXT,
											},
										});
									}
									await tx
										.update(whatsappWebhookEvents)
										.set({
											lastError: null,
											leaseExpiresAt: null,
											status: "processed",
											updatedAt: receivedAt,
										})
										.where(eq(whatsappWebhookEvents.id, event.id));
									return;
								}

								// F-V1c-1 (S-07 v1.4): toque `sessao:*` de uma pergunta enviada
								// antes do deploy recebe o aviso fixo e os botões da etapa
								// atual, nunca silêncio. Linha do assistente, outbox e evento
								// na mesma transação; a chave segura a reentrega (R-REL-02).
								// Passo 32 (S-25, uma release): toques `pref:*` e
								// `consultant:*` da pergunta antiga de preferência recebem o
								// mesmo aviso, com os botões de horário da sessão, que passa
								// para awaiting_slot_selection. Nenhuma pergunta de consultor.
								const legacyConsultantTap =
									buttonId.startsWith("pref:") ||
									buttonId.startsWith("consultant:");
								if (buttonId.startsWith("sessao:") || legacyConsultantTap) {
									if (legacyConsultantTap) {
										await promoteLegacySchedulingStage(tx, {
											conversationId: conversation.id,
										});
									}
									await replyToStaleTap(tx, {
										conversationId: conversation.id,
										eventId: event.id,
										externalId,
										leadId: lead.id,
									});
									await tx
										.update(whatsappWebhookEvents)
										.set({
											lastError: null,
											leaseExpiresAt: null,
											status: "processed",
											updatedAt: receivedAt,
										})
										.where(eq(whatsappWebhookEvents.id, event.id));
									return;
								}

								// Determinar o tipo de tarefa baseado no prefixo do buttonId
								let taskType = PROCESS_BUTTON_REPLY_TASK;
								if (
									buttonId.startsWith("confirm:") ||
									buttonId.startsWith("cancel:")
								) {
									taskType = PROCESS_BUTTON_REPLY_TASK;
								} else if (SCHEDULING_SLOT_BUTTON_ID.test(buttonId)) {
									taskType = SEND_CONFIRMATION_REQUEST_TASK;
								}

								await enqueueTask({
									conversationId: conversation.id,
									executor: tx,
									idempotencyKey: `button-reply:${externalId}`,
									payload: {
										buttonId,
										eventExternalId: externalId,
										eventId: event.id,
										kind: "button_reply",
									},
									taskType,
								});
							});
						} else if (content) {
							await db.transaction(async (tx) => {
								// R-SES-02 v1.3: com ≥ 4h sem mensagem do cliente, a
								// rotação fecha A e abre B sob o lock do lead, nesta
								// mesma transação que grava a mensagem (K-1, K-6).
								const { conversation, redelivery } =
									await resolveConversationForInbound(tx, {
										externalId,
										leadId: lead.id,
										receivedAt,
									});

								// F-V1b-1 (D-R2-1 a): reentrega de uma mensagem gravada numa
								// conversa já fechada. Uma mensagem mais nova já rotacionou e
								// foi respondida em B (R-SES-02 "começa do zero"): nada mais
								// é gravado e o evento fecha nesta transação (R-REL-02).
								if (redelivery && conversation.status !== "active") {
									await tx
										.update(whatsappWebhookEvents)
										.set({
											lastError: null,
											leaseExpiresAt: null,
											status: "processed",
											updatedAt: receivedAt,
										})
										.where(eq(whatsappWebhookEvents.id, event.id));
									return;
								}

								await tx
									.update(whatsappWebhookEvents)
									.set({
										conversationId: conversation.id,
										updatedAt: receivedAt,
									})
									.where(eq(whatsappWebhookEvents.id, event.id));

								const [insertedMessage] = await tx
									.insert(messages)
									.values({
										content,
										conversationId: conversation.id,
										externalId,
										role: "user",
									})
									.onConflictDoNothing()
									.returning();

								const inboundMessage =
									insertedMessage ??
									(
										await tx
											.select()
											.from(messages)
											.where(eq(messages.externalId, externalId))
											.limit(1)
									)[0];

								await tx
									.update(conversations)
									.set({
										lastCustomerMessageAt: receivedAt,
										updatedAt: receivedAt,
										...(isOptOutRequest(content)
											? { optOutAt: receivedAt }
											: {}),
									})
									.where(eq(conversations.id, conversation.id));

								if (!inboundMessage) {
									throw new Error("Inbound message not found");
								}

								const now = receivedAt;
								const batchCutoffAt = new Date(
									now.getTime() + env.MESSAGE_DEBOUNCE_MS
								);
								const insertedTask = await enqueueTask({
									availableAt: batchCutoffAt,
									conversationId: conversation.id,
									executor: tx,
									idempotencyKey: `inbound:${externalId}`,
									payload: {
										batchCutoffAt: batchCutoffAt.toISOString(),
										eventExternalId: externalId,
										eventId: event.id,
										kind: "text",
									},
									preserveExisting: true,
									taskType: PROCESS_INBOUND_MESSAGE_TASK,
									triggerMessageId: inboundMessage.id,
								});

								if (insertedTask) {
									await extendOpenInboundBatch({
										batchCutoffAt,
										conversationId: conversation.id,
										now,
									});
								}
							});
						}
					} catch (err) {
						request.log.error(
							{
								err,
								event: "whatsapp_webhook_enqueue_failed",
								externalId,
								conversationId: undefined,
							},
							"Failed to durably enqueue WhatsApp event"
						);

						await db
							.update(whatsappWebhookEvents)
							.set({
								lastError: err instanceof Error ? err.message : String(err),
								leaseExpiresAt: null,
								status: "failed",
								updatedAt: new Date(),
							})
							.where(eq(whatsappWebhookEvents.id, event.id));
					}
				}
			}
		}

		return reply.code(200).send({
			status: "ok",
		});
	});

	done();
};
