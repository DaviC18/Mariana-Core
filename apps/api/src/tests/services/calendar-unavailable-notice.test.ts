import assert from "node:assert/strict";
import test from "node:test";

import { CALENDAR_UNAVAILABLE_TEXT } from "../../services/conversations/calendar-unavailable-notice";
import { persistAuthorizedAssistantReply } from "../../services/conversations/generateMarianaResponse";
import { detectPendingOffer } from "../../services/conversations/pending-offer";

test("texto exato; detectPendingOffer devolve null; não casa SCHEDULING_COMMITMENT_PATTERNS", async () => {
	// Texto A aprovado por Davi (Q1): qualquer edição exige nova aprovação.
	assert.equal(
		CALENDAR_UNAVAILABLE_TEXT,
		"Desculpe, tive um problema para consultar a agenda dos consultores agora. Me mande uma mensagem daqui a pouco que eu tento de novo."
	);

	// Invariante do CLAUDE.md: o aviso não pode armar a oferta pendente.
	assert.equal(detectPendingOffer(CALENDAR_UNAVAILABLE_TEXT), null);

	// Se o texto casasse um padrão de compromisso de agendamento, a
	// autorização o trocaria (L10) e haveria registro de reescrita.
	const prepared = await persistAuthorizedAssistantReply({
		actionResult: { action: "continue_qualification", status: "executed" },
		fallbackReply: "Qual é o seu objetivo?",
		persistAssistantMessage: (content: string) => Promise.resolve(content),
		reply: CALENDAR_UNAVAILABLE_TEXT,
		requestedAction: "continue_qualification",
	});

	assert.equal(prepared.reply, CALENDAR_UNAVAILABLE_TEXT);
	assert.deepEqual(prepared.rewrites, []);
});
