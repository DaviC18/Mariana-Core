/**
 * Campos do lead vindos do `understand` (2026-10-28-flow-v2, B3). A IA nunca
 * é a autoridade: o backend valida, só preenche campo vazio, nunca troca o
 * nome (Q2) e calcula a idade ele mesmo (Q9). Sem `updateLeadFromAgent`, que
 * lança com menor de idade.
 */
import { eq } from "drizzle-orm";
import { leads } from "../../db/schema";
import { isAtLeast18 } from "../leads/lead-qualification";
import type { FlowV2Tx } from "./start-scheduling";
import type { UnderstandFields } from "./understand";

const DIACRITICS = /[̀-ͯ]/g;
const WHITESPACE = /\s+/g;
const AGE_ONLY =
	/^(?:eu\s+)?(?:tenho\s+)?(\d{1,3})(?:\s+anos?)?(?:\s+de\s+idade)?$/;
const BIRTH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const MAX_AGE = 120;

function normalize(value: string): string {
	return value
		.normalize("NFD")
		.replace(DIACRITICS, "")
		.toLowerCase()
		.replace(WHITESPACE, " ")
		.trim();
}

/**
 * "16", "16 anos", "tenho 16 anos", "dd/mm/aaaa" → data de nascimento (UTC).
 * Idade vira a data mais recente possível (a pessoa fez N anos hoje): nunca
 * deixa um menor parecer adulto. Qualquer outra coisa → `null`.
 */
export function parseAgeOrBirthDate(value: string, now: Date): Date | null {
	const normalized = normalize(value);

	const age = AGE_ONLY.exec(normalized);
	if (age) {
		const years = Number(age[1]);
		if (years < 1 || years > MAX_AGE) {
			return null;
		}
		return new Date(
			Date.UTC(
				now.getUTCFullYear() - years,
				now.getUTCMonth(),
				now.getUTCDate()
			)
		);
	}

	const date = BIRTH_DATE.exec(normalized);
	if (date) {
		const [day, month, year] = [
			Number(date[1]),
			Number(date[2]),
			Number(date[3]),
		];
		const parsed = new Date(Date.UTC(year, month - 1, day));
		const valid =
			parsed.getUTCFullYear() === year &&
			parsed.getUTCMonth() === month - 1 &&
			parsed.getUTCDate() === day &&
			parsed <= now &&
			now.getUTCFullYear() - year <= MAX_AGE;
		return valid ? parsed : null;
	}

	return null;
}

/** `true` quando o texto de idade diz menor de 18 (decisão do backend). */
export function statesMinor(fields: UnderstandFields, now: Date): boolean {
	if (!fields.ageOrBirthDate) {
		return false;
	}
	const birthDate = parseAgeOrBirthDate(fields.ageOrBirthDate, now);
	return birthDate !== null && !isAtLeast18(birthDate, now);
}

/**
 * Grava os campos na transação do chamador, que já travou o lead. Só
 * preenche vazio; a data de nascimento entra se não havia uma, ou se a nova
 * diz menor (a mais restritiva vence). `new → qualifying` quando algo veio.
 */
export async function mergeLeadFields(
	tx: FlowV2Tx,
	{
		fields,
		leadId,
		now,
	}: { fields: UnderstandFields; leadId: string; now: Date }
): Promise<void> {
	const [lead] = await tx
		.select({
			birthDate: leads.birthDate,
			consortiumType: leads.consortiumType,
			currentSituation: leads.currentSituation,
			objective: leads.objective,
			painPoint: leads.painPoint,
			status: leads.status,
		})
		.from(leads)
		.where(eq(leads.id, leadId))
		.limit(1);

	if (!lead) {
		throw new Error("Lead not found");
	}

	const update: Partial<typeof leads.$inferInsert> = {};
	if (fields.objective && !lead.objective) {
		update.objective = fields.objective;
	}
	if (fields.consortiumType && !lead.consortiumType) {
		update.consortiumType = fields.consortiumType;
	}
	if (fields.currentSituation && !lead.currentSituation) {
		update.currentSituation = fields.currentSituation;
	}
	if (fields.motivation && !lead.painPoint) {
		update.painPoint = fields.motivation;
	}

	const birthDate = fields.ageOrBirthDate
		? parseAgeOrBirthDate(fields.ageOrBirthDate, now)
		: null;
	if (
		birthDate &&
		(lead.birthDate === null ||
			(!isAtLeast18(birthDate, now) && isAtLeast18(lead.birthDate, now)))
	) {
		update.birthDate = birthDate;
	}

	const anyField = Object.values(fields).some(Boolean);
	if (anyField && lead.status === "new") {
		update.status = "qualifying";
	}

	if (Object.keys(update).length === 0) {
		return;
	}

	await tx
		.update(leads)
		.set({ ...update, updatedAt: now })
		.where(eq(leads.id, leadId));
}
