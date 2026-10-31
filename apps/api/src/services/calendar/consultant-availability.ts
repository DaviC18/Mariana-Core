/** biome-ignore-all lint/style/useConsistentTypeDefinitions: <> */
/** biome-ignore-all assist/source/useSortedKeys: <> */
/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/** biome-ignore-all lint/style/noParameterProperties: <> */
import {
	CalendarAuthError,
	CalendarUnavailableError,
	type ConsultantCalendarFailure,
} from "../../integrations/google-calendar/google-calendar-errors";
import {
	type CalendarAvailability,
	GoogleCalendarService,
} from "../../integrations/google-calendar/google-calendar-service";
import { describeError } from "../../lib/error-classification";
import { AvailabilityService } from "./availability";

export type Consultant = {
	id: string;
	name: string;
	calendarId: string;
};

export type ConsultantAvailableSlot = {
	consultant: Consultant;
	start: Date;
	end: Date;
};

export type ConsultantDrawOptions = {
	/**
	 * Fonte aleatória do sorteio (D-R2-5, D-R2-7): para cada horário, um
	 * consultor livre é sorteado com `random()`, sem peso de carga. Sem fonte,
	 * vale o primeiro livre na ordem recebida (rota admin de disponibilidade).
	 */
	random?: () => number;
};

export class ConsultantAvailabilityService {
	constructor(
		private readonly googleCalendarService = new GoogleCalendarService(),
		private readonly availabilityService = new AvailabilityService()
	) {}

	async getAvailableConsultants(
		consultants: Consultant[],
		timeMin: Date,
		timeMax: Date,
		{ random }: ConsultantDrawOptions = {}
	): Promise<ConsultantAvailableSlot[]> {
		if (timeMin >= timeMax) {
			throw new Error("timeMin deve ser anterior a timeMax.");
		}

		if (consultants.length === 0) {
			return [];
		}

		const consultantSlots = new Map<
			string,
			{
				consultant: Consultant;
				slots: { start: Date; end: Date }[];
			}
		>();

		const failures: ConsultantCalendarFailure[] = [];

		for (const consultant of consultants) {
			let calendarAvailability: CalendarAvailability | undefined;

			try {
				[calendarAvailability] =
					await this.googleCalendarService.getBusyPeriods(
						[consultant.calendarId],
						timeMin,
						timeMax,
						consultant.id
					);
			} catch (error) {
				failures.push({ consultantId: consultant.id, error });
				continue;
			}

			const slots = this.availabilityService.getAvailableSlots(
				timeMin,
				timeMax,
				calendarAvailability?.busy ?? []
			);

			consultantSlots.set(consultant.id, {
				consultant,
				slots,
			});
		}

		// 2026-10-27-scheduling-loop passo 2: nenhum consultor respondeu →
		// erro próprio, que a oferta responde com texto fixo.
		if (failures.length === consultants.length) {
			throw new CalendarUnavailableError(failures);
		}

		// Passos 4–5: quem falhou sai do sorteio desta oferta e os outros
		// seguem. Falha de conexão (`CalendarAuthError`) já foi logada pelo
		// serviço (`google_calendar_needs_reauth`); outro erro é logado aqui,
		// para nenhum consultor sair em silêncio.
		for (const failure of failures) {
			if (!(failure.error instanceof CalendarAuthError)) {
				console.error(
					JSON.stringify({
						consultantId: failure.consultantId,
						event: "scheduling_consultant_calendar_skipped",
						...describeError(failure.error),
					})
				);
			}
		}

		const result: ConsultantAvailableSlot[] = [];

		const uniqueSlotTimes = new Map<string, { start: Date; end: Date }>();

		for (const consultantData of consultantSlots.values()) {
			for (const slot of consultantData.slots) {
				const key = `${slot.start.toISOString()}_${slot.end.toISOString()}`;

				if (!uniqueSlotTimes.has(key)) {
					uniqueSlotTimes.set(key, slot);
				}
			}
		}

		for (const slot of uniqueSlotTimes.values()) {
			const freeConsultants = consultants.filter((candidate) =>
				consultantSlots
					.get(candidate.id)
					?.slots.some(
						(availableSlot) =>
							availableSlot.start.getTime() === slot.start.getTime() &&
							availableSlot.end.getTime() === slot.end.getTime()
					)
			);

			const consultant = drawConsultant(freeConsultants, random);

			if (consultant) {
				result.push({
					consultant,
					start: slot.start,
					end: slot.end,
				});
			}
		}

		return result.sort((a, b) => a.start.getTime() - b.start.getTime());
	}
}

function drawConsultant(
	freeConsultants: Consultant[],
	random: (() => number) | undefined
): Consultant | undefined {
	if (freeConsultants.length === 0) {
		return undefined;
	}

	if (!random) {
		return freeConsultants[0];
	}

	const index = Math.min(
		Math.floor(random() * freeConsultants.length),
		freeConsultants.length - 1
	);

	return freeConsultants[Math.max(index, 0)];
}
