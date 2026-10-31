/**
 * Roteador da v2 (2026-10-28-flow-v2, spec §3). Funções puras: o backend
 * decide quem responde; a IA nunca é a autoridade sobre autorização. Na
 * dúvida, a IA responde, nunca um texto fixo.
 */
import type { TurnIntent } from "../../lib/turn-trace";
import { isClearAffirmative } from "../conversations/pending-offer";
import {
	APPOINTMENT_ONLY_PHRASES,
	CONSULTANT_PHRASES,
	coreOf,
	EXTRA_YES,
	greetingLengthAt,
	NO_REPLIES,
	normalizeWords,
	RESCHEDULE_PHRASES,
	SENSITIVE_PHRASES,
	STATUS_PHRASES,
} from "./intent-lists";

const NAME_INTRODUCTION =
	/^\s*(?:meu nome é|me chamo|sou o|sou a)\s+[\p{L}'-]+\s*[!.]?\s*$/iu;

/**
 * Oferta pendente sem migração (Q7): vem da última linha da assistente da
 * conversa atual, quando ela é exatamente um texto fixo do backend.
 */
export type V2PendingOffer = "consultant_offer" | "objective_question" | null;

export interface RouterState {
	hasActiveSession: boolean;
	hasAssistantReply: boolean;
	hasFutureAppointment: boolean;
	optedOut: boolean;
	pendingOffer: V2PendingOffer;
}

/** `list-*`: listas fechadas da A4, respondidas sem chamar a IA. */
export type TextRoute =
	| "R1"
	| "R4"
	| "R5"
	| "R6-accept"
	| "R6-decline"
	| "list-consultant"
	| "list-sensitive"
	| "list-appointment-info"
	| "list-status"
	| "list-reschedule"
	| "R7";

export const UNDERSTAND_INTENTS = [
	"question",
	"provides_info",
	"wants_consultant",
	"accept_offer",
	"decline_offer",
	"sensitive_question",
	"schedule_status",
	"reschedule_or_cancel",
	"smalltalk",
	"off_topic",
	"unclear",
] as const satisfies readonly TurnIntent[];

export type UnderstandIntent = (typeof UNDERSTAND_INTENTS)[number];

export type UnderstoodRoute =
	| "R7a"
	| "R7b"
	| "R7c"
	| "R7c-fallback"
	| "R7d"
	| "R7e-status"
	| "R7-appointment-info";

export type StartSchedulingRoute =
	| "R8-under-18"
	| "R8-appointment-info"
	| "R8-stage-buttons"
	| "R8-ask-objective"
	| "R8-offer";

export interface SchedulingGate {
	askedObjective: boolean;
	hasActiveSession: boolean;
	hasFutureAppointment: boolean;
	objectiveKnown: boolean;
	underAge: boolean;
}

/**
 * Só saudação (lista fechada), com pontuação ou emoji. "oi, tudo bem?" conta;
 * qualquer palavra fora da lista não.
 */
export function isGreetingOnly(text: string): boolean {
	const words = normalizeWords(text);
	if (words.length === 0) {
		return false;
	}

	let index = 0;
	while (index < words.length) {
		const length = greetingLengthAt(words, index);
		if (length === 0) {
			return false;
		}
		index += length;
	}
	return true;
}

/** Apresentação curta enviada logo após uma saudação no mesmo lote do WhatsApp. */
function isNameIntroduction(text: string): boolean {
	return NAME_INTRODUCTION.test(text);
}

function isFirstContactGreeting(messages: string[]): boolean {
	return (
		messages.length > 0 &&
		isGreetingOnly(messages[0] ?? "") &&
		messages.slice(1).every(isNameIntroduction)
	);
}

/** "Sim" curto: `isClearAffirmative` ou a lista extra da v2 (N1). */
export function isClearYes(text: string): boolean {
	return (
		isClearAffirmative(text) ||
		(!text.includes("?") && EXTRA_YES.has(normalizeWords(text).join(" ")))
	);
}

/** "Não" curto e inequívoco (lista fechada, N2). */
export function isClearNegative(text: string): boolean {
	if (text.includes("?")) {
		return false;
	}
	return NO_REPLIES.has(normalizeWords(text).join(" "));
}

/** A4: todas as mensagens do lote casam com a mesma lista fechada. */
function allIn(messages: string[], list: ReadonlySet<string>): boolean {
	return messages.every((message) => list.has(coreOf(message)));
}

function routeClosedLists(
	state: RouterState,
	messages: string[]
): TextRoute | null {
	if (allIn(messages, RESCHEDULE_PHRASES)) {
		return "list-reschedule";
	}
	if (allIn(messages, CONSULTANT_PHRASES)) {
		return "list-consultant";
	}
	if (allIn(messages, SENSITIVE_PHRASES)) {
		return "list-sensitive";
	}
	if (
		state.hasFutureAppointment &&
		messages.every(
			(message) =>
				STATUS_PHRASES.has(coreOf(message)) ||
				APPOINTMENT_ONLY_PHRASES.has(coreOf(message))
		)
	) {
		return "list-appointment-info";
	}
	if (state.hasActiveSession && allIn(messages, STATUS_PHRASES)) {
		return "list-status";
	}
	return null;
}

/**
 * R1; R6 (com oferta pendente, antes da saudação: N1); R4/R5; listas
 * fechadas (A4); tudo o mais vai para a IA (R7).
 */
export function routeTurn(
	state: RouterState,
	{ messages }: { messages: string[] }
): { route: TextRoute } {
	if (state.optedOut) {
		return { route: "R1" };
	}
	if (messages.length === 0) {
		return { route: "R7" };
	}

	if (state.pendingOffer === "consultant_offer") {
		if (messages.every(isClearYes)) {
			return { route: "R6-accept" };
		}
		if (messages.every(isClearNegative)) {
			return { route: "R6-decline" };
		}
	}

	if (
		messages.every(isGreetingOnly) ||
		(!state.hasAssistantReply && isFirstContactGreeting(messages))
	) {
		return { route: state.hasAssistantReply ? "R5" : "R4" };
	}

	return { route: routeClosedLists(state, messages) ?? "R7" };
}

/**
 * R7a–R7e a partir da intenção devolvida pela IA. `accept_offer` só leva aos
 * horários com o marcador do backend; sem ele é uma resposta comum.
 * `schedule_status` só vira texto fixo de estado durante uma sessão ativa
 * (C1); sem sessão não há estado a informar e a IA responde.
 */
export function routeUnderstood(
	state: {
		hasActiveSession?: boolean;
		hasFutureAppointment?: boolean;
		pendingOffer: V2PendingOffer;
	},
	understood: {
		hasObjective: boolean;
		intent: UnderstandIntent;
		reply: string | null;
	}
): { route: UnderstoodRoute } {
	const { hasObjective, intent, reply } = understood;

	if (intent === "wants_consultant") {
		return { route: "R7a" };
	}
	if (intent === "accept_offer" && state.pendingOffer === "consultant_offer") {
		return { route: "R7a" };
	}
	if (intent === "sensitive_question") {
		return { route: "R7b" };
	}
	if (intent === "reschedule_or_cancel") {
		return { route: "R7d" };
	}
	if (intent === "schedule_status" && state.hasFutureAppointment) {
		return { route: "R7-appointment-info" };
	}
	if (intent === "schedule_status" && state.hasActiveSession) {
		return { route: "R7e-status" };
	}
	if (state.pendingOffer === "objective_question" && hasObjective) {
		return { route: "R7a" };
	}
	if (!reply?.trim()) {
		return { route: "R7c-fallback" };
	}
	return { route: "R7c" };
}

/** R8: ordem fixa de precedência antes de buscar horários. */
export function routeStartScheduling(
	gate: SchedulingGate
): StartSchedulingRoute {
	if (gate.underAge) {
		return "R8-under-18";
	}
	if (gate.hasFutureAppointment) {
		return "R8-appointment-info";
	}
	if (gate.hasActiveSession) {
		return "R8-stage-buttons";
	}
	if (!(gate.objectiveKnown || gate.askedObjective)) {
		return "R8-ask-objective";
	}
	return "R8-offer";
}
