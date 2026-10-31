/**
 * O turno começou numa conversa que foi fechada (rotação de sessão) antes de
 * gravar. Nada do turno é gravado nem enviado.
 *
 * Módulo próprio (Rev3 passo 37) para `scheduling-offer-service.ts` poder
 * lançar o erro sem importar o módulo do turno (sem ciclo).
 */
export class TurnSupersededError extends Error {
	readonly conversationId: string;

	constructor(conversationId: string) {
		super(`Conversation is no longer active: ${conversationId}`);
		this.name = "TurnSupersededError";
		this.conversationId = conversationId;
	}
}
