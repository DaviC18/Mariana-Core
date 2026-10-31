/**
 * Resposta da oferta de horários quando nenhum consultor respondeu no Google
 * Calendar (`CalendarUnavailableError`, 2026-10-27-scheduling-loop passo 2).
 *
 * Texto A aprovado por Davi (Q1) exatamente como está e fixado por um teste
 * de texto exato: qualquer edição exige nova aprovação dele.
 *
 * Verificado contra o código (`calendar-unavailable-notice.test.ts`):
 * - não contém marcador de oferta de consultor, então `detectPendingOffer`
 *   devolve `null` e não arma `accepted_pending_offer` no turno seguinte;
 * - não casa com `SCHEDULING_COMMITMENT_PATTERNS`: não promete horário;
 * - a task é concluída, então nada tenta de novo sozinho; o texto pede ao
 *   cliente que escreva de novo.
 */
export const CALENDAR_UNAVAILABLE_TEXT =
	"Desculpe, tive um problema para consultar a agenda dos consultores agora. Me mande uma mensagem daqui a pouco que eu tento de novo.";
