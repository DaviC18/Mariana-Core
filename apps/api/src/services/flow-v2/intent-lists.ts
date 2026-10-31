/**
 * Listas fechadas da v2 (2026-10-28-flow-v2, A4, Davi: "a IA fica em segundo
 * plano"). Casamento exato da frase normalizada (minúsculas, sem acento, sem
 * pontuação/emoji), depois de tirar só saudação no início e enchimento
 * educado ("por favor", "Mariana"). Nada de casamento aproximado: o que não
 * casa vai para a IA.
 */

const DIACRITICS = /[̀-ͯ]/g;
const NON_WORD = /[^a-z0-9]+/g;

export function normalizeWords(text: string): string[] {
	return text
		.normalize("NFD")
		.replace(DIACRITICS, "")
		.toLowerCase()
		.replace(NON_WORD, " ")
		.trim()
		.split(" ")
		.filter(Boolean);
}

export const GREETING_PHRASES = [
	["bom", "dia"],
	["boa", "tarde"],
	["boa", "noite"],
	["e", "ai"],
	["tudo", "bem"],
	["oi"],
	["ola"],
	["opa"],
] as const;

/** Enchimento sem conteúdo, aceito em qualquer posição. */
const FILLER_WORDS = new Set(["mariana", "pf", "pfv", "porfavor"]);
const FILLER_PAIRS = [["por", "favor"]] as const;

/** Tamanho da saudação que começa em `index`, ou 0. */
export function greetingLengthAt(words: string[], index: number): number {
	const phrase = GREETING_PHRASES.find((candidate) =>
		candidate.every((word, offset) => words[index + offset] === word)
	);
	return phrase?.length ?? 0;
}

/** Texto sem saudação inicial e sem enchimento, para comparar com as listas. */
export function coreOf(text: string): string {
	const words = normalizeWords(text);
	let start = 0;
	let greeting = greetingLengthAt(words, start);
	while (greeting > 0) {
		start += greeting;
		greeting = greetingLengthAt(words, start);
	}

	const kept: string[] = [];
	for (let index = start; index < words.length; index += 1) {
		const word = words[index] as string;
		const pair = FILLER_PAIRS.find(
			([first, second]) => word === first && words[index + 1] === second
		);
		if (pair) {
			index += 1;
		} else if (!FILLER_WORDS.has(word)) {
			kept.push(word);
		}
	}
	return kept.join(" ");
}

function closedList(phrases: string[]): ReadonlySet<string> {
	return new Set(phrases.map((phrase) => normalizeWords(phrase).join(" ")));
}

/** "Sim" extra da v2 (N1), além de `isClearAffirmative`. */
export const EXTRA_YES = closedList([
	"claro que sim",
	"com certeza",
	"fechado",
	"opa",
	"pode ser sim",
	"quero sim",
	"ta",
	"ta bom",
	"tudo bem",
	"tudo certo",
]);

/** "Não" curto (N2). */
export const NO_REPLIES = closedList([
	"agora nao",
	"agora nao obrigada",
	"agora nao obrigado",
	"deixa pra depois",
	"depois",
	"fica pra depois",
	"mais tarde",
	"n",
	"nao",
	"nao agora",
	"nao agora nao",
	"nao nao",
	"nao obrigada",
	"nao obrigado",
	"nao por enquanto",
	"nao precisa",
	"nao precisa obrigada",
	"nao precisa obrigado",
	"nao quero",
	"nao valeu",
	"no momento nao",
	"outra hora",
	"por enquanto nao",
]);

export const CONSULTANT_PHRASES = closedList([
	"agendar",
	"agendar reuniao",
	"agendar uma reuniao",
	"falar com consultor",
	"falar com o consultor",
	"falar com um consultor",
	"marcar",
	"marcar com o consultor",
	"marcar reuniao",
	"marcar uma reuniao",
	"quero agendar",
	"quero agendar uma reuniao",
	"quero falar com consultor",
	"quero falar com o consultor",
	"quero falar com um consultor",
	"quero marcar",
	"quero marcar com o consultor",
	"quero marcar uma reuniao",
	"quero ver os horarios",
]);

export const SENSITIVE_PHRASES = closedList([
	"lance",
	"qual a parcela",
	"qual a taxa",
	"qual e a taxa",
	"qual o lance",
	"qual o valor da parcela",
	"quanto custa",
	"quanto e a parcela",
	"quanto fica a parcela",
	"quero simular",
	"quero uma simulacao",
	"simulacao",
	"taxa",
	"valor da parcela",
]);

export const STATUS_PHRASES = closedList([
	"esta confirmada",
	"esta confirmado",
	"esta marcada",
	"esta marcado",
	"foi confirmada",
	"foi confirmado",
	"ta confirmada",
	"ta confirmado",
	"ta marcada",
	"ta marcado",
]);

/** Só com reunião futura (perguntas de quando, agradecimento). */
export const APPOINTMENT_ONLY_PHRASES = closedList([
	"brigada",
	"brigado",
	"muito obrigada",
	"muito obrigado",
	"obg",
	"obrigada",
	"obrigado",
	"quando e a reuniao",
	"que horas e a reuniao",
	"valeu",
]);

export const RESCHEDULE_PHRASES = closedList([
	"cancelar a reuniao",
	"desmarcar",
	"mudar o horario",
	"quero cancelar a reuniao",
	"quero desmarcar",
	"quero mudar o horario",
	"quero remarcar",
	"quero trocar o horario",
	"remarcar",
	"trocar o horario",
]);
