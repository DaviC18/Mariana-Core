/**
 * Textos fixos da v2 (2026-10-28-flow-v2, spec §4 + Q1 aprovado por Davi).
 * Qualquer edição de texto exige nova aprovação dele.
 */
import { createHash } from "node:crypto";

import { formatSlotDate } from "../../utils/date-formatter";

export const CONSULTANT_BUTTON = {
	id: "consultor:falar",
	title: "Falar com consultor",
} as const;

export const T_GREETING_AGAIN = "Oi de novo! Em que posso te ajudar?";
export const T_ASK_OBJECTIVE =
	"Antes de eu buscar os horários: o que você pretende conquistar com o consórcio? Um imóvel, um carro ou outro bem?";
export const T_SENSITIVE =
	"Valores de parcela, taxa, lance e simulação quem passa é o consultor, numa conversa de 30 minutos pelo Google Meet. Quer que eu veja os horários?";
export const T_UNDER_18 =
	"Para conversar com um consultor é preciso ter 18 anos ou mais. Mas posso continuar tirando suas dúvidas por aqui!";
export const T_AI_FALLBACK =
	"Boa pergunta! Esse ponto o consultor explica melhor na reunião. Quer que eu veja os horários?";
export const T_STATUS_SLOT = "Falta escolher um dos horários abaixo.";
export const T_STATUS_CONFIRM = "Falta confirmar o horário abaixo.";
/** T-RESCHEDULE (aprovado por Davi em 2026-10-28, opção A; serve para remarcar e cancelar). */
export const T_RESCHEDULE =
	"Tudo bem! Anotei seu pedido e o consultor entra em contato com você. Precisa de mais alguma coisa?";

/** Reusados como estão (mesmo texto da v1, que fica em arquivos v1). */
export const NO_SLOTS_TEXT =
	"No momento, não encontrei horários disponíveis nos próximos 5 dias.";

/** Spec §4: até 3 variações; hoje só uma foi aprovada para cada. */
const WELCOME_VARIANTS = [
	(greeting: string) =>
		`${greeting}! Eu sou a Mariana, atendente virtual da Ademicon. Como posso ajudar você hoje?`,
] as const;
const DECLINE_VARIANTS = [
	"Tudo bem! Se surgir qualquer dúvida, é só me chamar por aqui.",
] as const;

const MAX_FIRST_NAME_LENGTH = 20;
const LETTER = /\p{L}/u;
const NON_DIGIT = /\D/g;
const WHITESPACE = /\s+/;

/** Escolha estável por conversa: o mesmo id sempre dá a mesma variação. */
export function pickVariant<T>(variants: readonly T[], seed: string): T {
	if (variants.length === 0) {
		throw new Error("pickVariant needs at least one variant");
	}
	const index =
		createHash("sha256").update(seed, "utf8").digest().readUInt32BE(0) %
		variants.length;
	return variants[index] as T;
}

/**
 * Primeiro nome do perfil do WhatsApp (Q2), ou `null`. O nome cai para o
 * telefone quando o perfil não tem nome (`lead-ingestion.ts`): nunca usar.
 */
export function firstNameForGreeting(
	name: string | null | undefined,
	phone: string
): string | null {
	const trimmed = name?.trim() ?? "";
	if (trimmed.length === 0) {
		return null;
	}

	const phoneDigits = phone.replace(NON_DIGIT, "");
	const nameDigits = trimmed.replace(NON_DIGIT, "");
	if (
		trimmed === phone ||
		(nameDigits.length > 0 && nameDigits === phoneDigits)
	) {
		return null;
	}

	const [first = ""] = trimmed.split(WHITESPACE);
	if (!LETTER.test(first) || first.length > MAX_FIRST_NAME_LENGTH) {
		return null;
	}

	const lower = first.toLocaleLowerCase("pt-BR");
	return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
}

/** T-WELCOME: "Oi{, nome}! …". */
export function buildWelcomeText({
	conversationId,
	name,
	phone,
}: {
	conversationId: string;
	name: string | null | undefined;
	phone: string;
}): string {
	const firstName = firstNameForGreeting(name, phone);
	const variant = pickVariant(WELCOME_VARIANTS, conversationId);
	return variant(firstName ? `Oi, ${firstName}` : "Oi");
}

/** T-DECLINE. */
export function buildDeclineText(conversationId: string): string {
	return pickVariant(DECLINE_VARIANTS, conversationId);
}

const APPOINTMENT_DATE = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "2-digit",
	timeZone: "America/Sao_Paulo",
});
const APPOINTMENT_WEEKDAY = new Intl.DateTimeFormat("pt-BR", {
	timeZone: "America/Sao_Paulo",
	weekday: "long",
});
const APPOINTMENT_TIME = new Intl.DateTimeFormat("pt-BR", {
	hour: "2-digit",
	hour12: false,
	minute: "2-digit",
	timeZone: "America/Sao_Paulo",
});

/** T-APPOINTMENT-INFO (texto aprovado por Davi em A4, 2026-10-28). */
export function buildAppointmentInfoText({
	consultantName,
	meetLink,
	startAt,
}: {
	consultantName: string;
	meetLink?: string | null;
	startAt: Date;
}): string {
	const body = `Sua reunião com ${consultantName} está marcada para ${APPOINTMENT_WEEKDAY.format(startAt)}, ${APPOINTMENT_DATE.format(startAt)}, às ${APPOINTMENT_TIME.format(startAt)}, pelo Google Meet (30 minutos). Obrigada pela confiança! Precisa de mais alguma coisa?`;
	return withMeetLink(body, meetLink);
}

/**
 * Confirmação do agendamento (fluxo de botões). C-MEET: o link do Meet vai
 * junto quando o Google devolve a sala.
 */
export function buildBookingConfirmationText({
	consultantName,
	meetLink,
	startAt,
}: {
	consultantName: string;
	meetLink?: string | null;
	startAt: Date;
}): string {
	const body = `Agendamento confirmado para ${formatSlotDate(startAt)} com ${consultantName}.`;
	return withMeetLink(body, meetLink);
}

function withMeetLink(body: string, meetLink?: string | null): string {
	const link = meetLink?.trim();
	return link ? `${body}\n\nLink do Google Meet: ${link}` : body;
}
