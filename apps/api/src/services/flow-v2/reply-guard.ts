/**
 * Filtro da resposta da IA na v2 (2026-10-28-flow-v2, B1; Q5). Aceita ou
 * rejeita a resposta **inteira**; nunca corta nem reescreve. Rejeitada, o
 * turno manda T-AI-FALLBACK e o rastro guarda o motivo (enum).
 *
 * Fatos aprovados passam: "18 anos", "35 anos", "30 minutos", Google Meet e
 * toda frase `clientAllowed` da base (teste de falso positivo).
 */
import type { TurnGuardReason } from "../../lib/turn-trace";
import { T_AI_FALLBACK, T_ASK_OBJECTIVE, T_SENSITIVE } from "./texts";

export type ReplyGuardResult =
	| { ok: true }
	| { ok: false; reason: TurnGuardReason };

const MAX_SENTENCES = 3;
const MAX_QUESTIONS = 1;
/**
 * Teto duro do corpo (B-4). O corpo dos botões no WhatsApp aceita 1024
 * caracteres; 3 frases não garantem isso. 600 deixa folga e cabe toda frase
 * da base aprovada (a maior tem ~330).
 */
export const MAX_REPLY_CHARS = 600;

const DIACRITICS = /[̀-ͯ]/g;
const WHITESPACE = /\s+/g;
const SENTENCE_END = /(?<=[.!?])\s+/;
// Quebra de linha também separa frase (B-4): sem isso, 5 linhas sem ponto
// passam como uma frase só.
const SENTENCE_SPLIT = /[.!?]+(?:\s+|$)|\n+/;
const SENTENCE_CHUNKS = /[^.!?\n]+/g;
const ANY_DIGIT = /\d/;
/** Únicos números aprovados (R-INF-06 e a base): o resto é rejeitado (B-1). */
const APPROVED_NUMBER_FACTS = /\b(?:18 anos|35 anos|30 minutos)\b/g;
const MONEY_EMOJI = /[\u{1F4B0}\u{1F4B5}\u{1F4B8}\u{1F911}\u{1F4B2}]/u;
const QUESTION_MARKS = /\?+/g;

const NUMBER_WORD =
	"(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos)";
const FEW_WORD = "(?:poucos|poucas|alguns|algumas)";

/** Padrões sobre o texto normalizado (minúsculas, sem acento). */
const RULES: [TurnGuardReason, RegExp[]][] = [
	[
		"internal_content",
		[
			/\bprompt\b/,
			/\binstruc(?:ao|oes)\b/,
			/\bbase de conhecimento\b/,
			/\bregras? internas?\b/,
			/\bmodelo de linguagem\b/,
			/\b(?:gemini|llm|json|clientallowed|system)\b/,
			/\btokens?\b/,
		],
	],
	[
		"scheduling_claim",
		[
			/\bagendad[oa]s?\b/,
			/\bconfirmad[oa]s?\b/,
			/\b(?:agendei|marquei|reservei)\b/,
			/\besta marcad[oa]\b/,
			/\b(?:ficou|fica|esta|ta|foi|sera)\s+marcad[oa]s?\b/,
			/\breservad[oa]s?\b/,
			/\bas \d{1,2}(?:h|:\d{2})/,
			/\b\d{1,2}\s*(?:h|hs|horas?)\b(?!\s*de\s+dura)/,
			/\b\d{1,2}h\d{0,2}\b/,
			/\b\d{1,2}:\d{2}\b/,
			new RegExp(
				`\\bas\\s+(?:${NUMBER_WORD})\\s+(?:horas?|da manha|da tarde|da noite)\\b`
			),
		],
	],
	[
		"money",
		[
			/r\s*\$/,
			/\$/,
			/\breais\b/,
			/\bmeio milhao\b/,
			/\bmilh(?:ao|oes)\b/,
			/\bbilh(?:ao|oes)\b/,
			new RegExp(`\\b${NUMBER_WORD}\\s+mil\\b`),
			/\b\d[\d.,]*\s*(?:mil|milhao|milhoes|k)\b/,
			/\b\d{1,3}(?:\.\d{3})+(?:,\d{2})?\b/,
			/\b\d+,\d{2}\b/,
		],
	],
	["percentage", [/%/, /\bpor ?cento\b/, /\bpct\b/]],
	[
		"installments",
		[
			/\b\d+\s*(?:x|vezes|parcelas?|prestac(?:ao|oes))\b/,
			new RegExp(
				`\\b${NUMBER_WORD}(?: e ${NUMBER_WORD})?\\s+(?:parcelas|prestacoes|vezes)\\b`
			),
		],
	],
	[
		"contemplation_promise",
		[
			/\b(?:vai|vao|vais|sera|serao|ira|irao)\s+(?:ser\s+)?contemplad/,
			/(?<!nao )(?<!nunca )\bgarant\w*\s+(?:a\s+|sua\s+)?contemplac/,
			/\bcontemplac\w*\s+(?:\w+\s+)?garantid/,
			/\bgarantid[oa]s?\s+(?:a\s+|sua\s+)?contemplac/,
			new RegExp(
				`\\bcontemplad[oa]s?\\s+(?:em|ate|dentro de)\\s+(?:\\d|${NUMBER_WORD}|${FEW_WORD})`
			),
		],
	],
	[
		"deadline",
		[
			/\b\d+\s*(?:dias?|semanas?|mes|meses)\b/,
			new RegExp(
				`\\b(?:${NUMBER_WORD}|${FEW_WORD})\\s+(?:dias?|semanas?|mes|meses)\\b`
			),
		],
	],
];

function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(DIACRITICS, "")
		.toLowerCase()
		.replace(WHITESPACE, " ")
		.trim();
}

const FIXED_OFFER_TEXTS = [T_SENSITIVE, T_AI_FALLBACK, T_ASK_OBJECTIVE];
const FIXED_OFFER_FULL = FIXED_OFFER_TEXTS.map(normalize);
/** As perguntas de oferta dos textos fixos ("Quer que eu veja os horários?"). */
const FIXED_OFFER_QUESTIONS = new Set(
	FIXED_OFFER_TEXTS.flatMap((fixed) => fixed.split(SENTENCE_END))
		.filter((sentence) => sentence.trim().endsWith("?"))
		.map(normalize)
);

/**
 * N5: a IA nunca repete um texto fixo de oferta; senão a próxima mensagem do
 * cliente acharia uma oferta pendente que o backend não fez.
 */
function containsFixedOffer(normalized: string, raw: string): boolean {
	if (FIXED_OFFER_FULL.some((fixed) => normalized.includes(fixed))) {
		return true;
	}
	return raw
		.split(SENTENCE_END)
		.some((sentence) => FIXED_OFFER_QUESTIONS.has(normalize(sentence)));
}

/**
 * B-2: "contemplado/a" com palavra de tempo ou rapidez na mesma frase é
 * promessa ("em até três anos você é contemplado", "contemplada logo").
 * "cotas já contempladas" (base) não tem palavra de tempo e passa.
 */
const CONTEMPLATED = /\bcontemplad[oa]s?\b/;
const TIME_OR_SPEED =
	/\b(?:rapid\w*|logo|breve|cedo|imediat\w*|prazo|em ate|dentro de|anos?|mes|meses|semanas?|dias?|primeir[oa]s?)\b/;

function promisesTimedContemplation(normalized: string): boolean {
	return (normalized.match(SENTENCE_CHUNKS) ?? []).some(
		(sentence) => CONTEMPLATED.test(sentence) && TIME_OR_SPEED.test(sentence)
	);
}

/** B-1: emoji de dinheiro com valor (número ou número por extenso). */
function moneyEmojiWithAmount(normalized: string): boolean {
	return (
		MONEY_EMOJI.test(normalized) &&
		(ANY_DIGIT.test(normalized) ||
			new RegExp(`\\b${NUMBER_WORD}\\b|\\bquinhent\\w*|\\bmil\\b`).test(
				normalized
			))
	);
}

export function checkReply(reply: string): ReplyGuardResult {
	const normalized = normalize(reply);

	if (containsFixedOffer(normalized, reply)) {
		return { ok: false, reason: "fixed_offer_text" };
	}

	if (reply.length > MAX_REPLY_CHARS) {
		return { ok: false, reason: "too_long" };
	}

	for (const [reason, patterns] of RULES) {
		if (patterns.some((pattern) => pattern.test(normalized))) {
			return { ok: false, reason };
		}
		if (reason === "money" && moneyEmojiWithAmount(normalized)) {
			return { ok: false, reason };
		}
		if (
			reason === "contemplation_promise" &&
			promisesTimedContemplation(normalized)
		) {
			return { ok: false, reason };
		}
	}

	// B-1: qualquer outro número fica de fora (só os fatos aprovados passam).
	if (ANY_DIGIT.test(normalized.replace(APPROVED_NUMBER_FACTS, ""))) {
		return { ok: false, reason: "number" };
	}

	const sentences = reply
		.split(SENTENCE_SPLIT)
		.filter((sentence) => sentence.trim().length > 0);
	if (sentences.length > MAX_SENTENCES) {
		return { ok: false, reason: "too_many_sentences" };
	}

	if ((reply.match(QUESTION_MARKS) ?? []).length > MAX_QUESTIONS) {
		return { ok: false, reason: "too_many_questions" };
	}

	return { ok: true };
}
