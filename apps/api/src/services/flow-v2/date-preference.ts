const TIME_ZONE = "America/Sao_Paulo";
const DAY_NAMES: Record<string, number> = {
	domingo: 0,
	quarta: 3,
	quinta: 4,
	sabado: 6,
	segunda: 1,
	sexta: 5,
	terca: 2,
};
const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
	day: "2-digit",
	month: "2-digit",
	timeZone: TIME_ZONE,
	year: "numeric",
});
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
	timeZone: TIME_ZONE,
	weekday: "short",
});
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
	timeZone: TIME_ZONE,
	timeZoneName: "longOffset",
});
const DIACRITICS = /[̀-ͯ]/g;
const TODAY = /\bhoje\b/;
const TOMORROW = /\bamanha\b/;
const TODAY_PREFERENCE = /(?:prefiro|quero|pode\s+ser|tem)\s+hoje/;
const TOMORROW_PREFERENCE = /(?:prefiro|quero|pode\s+ser|tem)\s+amanha/;
const WEEKDAY_TRIGGER =
	/\b(?:prefiro|quero|pode\s+ser|tem(?:\s+para)?|para|proxim[ao])(?:\s+(?:n[ao]|em|a|o))?\s+(?:proxim[ao]\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira|\s+feira)?\b/;
const WEEKDAY_WITH_FEIRA =
	/\b(segunda|terca|quarta|quinta|sexta)(?:-feira|\s+feira)\b/;
const AMBIGUOUS_DATE =
	/\b(?:outr[oa]s?\s+(?:dias?|datas?|horarios?)|mais\s+(?:dias?|datas?|horarios?)|tem\s+(?:outr[oa]|mais|horarios?|vagas?|dias?|datas?)|quais\s+(?:dias|datas|horarios)|pode\s+ser\s+outr[oa]|algum\s+outro|outr[oa]\s+opcao|outras\s+opcoes|nao\s+posso)\b/;
const UTC_OFFSET = /^GMT([+-])(\d{2}):(\d{2})$/;

export type DatePreference =
	| { kind: "date"; timeMax: Date; timeMin: Date }
	| { kind: "ambiguous" }
	| null;

interface CalendarDate {
	day: number;
	month: number;
	year: number;
}

function saoPauloDate(date: Date) {
	const parts = Object.fromEntries(
		DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value])
	);
	return {
		day: Number(parts.day),
		month: Number(parts.month),
		year: Number(parts.year),
	};
}

function offsetAt(date: Date): number {
	const offset = DAY_FORMATTER.formatToParts(date).find(
		(part) => part.type === "timeZoneName"
	)?.value;
	const match = offset?.match(UTC_OFFSET);
	if (!match) {
		throw new Error("Missing Sao Paulo UTC offset");
	}
	const minutes = Number(match[2]) * 60 + Number(match[3]);
	return match[1] === "+" ? minutes : -minutes;
}

function startOfSaoPauloDay(year: number, month: number, day: number): Date {
	const noonUtc = new Date(Date.UTC(year, month - 1, day, 12));
	return new Date(Date.UTC(year, month - 1, day) - offsetAt(noonUtc) * 60_000);
}

function nextCalendarDay({ year, month, day }: CalendarDate) {
	const next = new Date(Date.UTC(year, month - 1, day + 1));
	return {
		day: next.getUTCDate(),
		month: next.getUTCMonth() + 1,
		year: next.getUTCFullYear(),
	};
}

function rangeForDate(date: CalendarDate) {
	const next = nextCalendarDay(date);
	return {
		timeMax: startOfSaoPauloDay(next.year, next.month, next.day),
		timeMin: startOfSaoPauloDay(date.year, date.month, date.day),
	};
}

const MONTH_NAMES: Record<string, number> = {
	abril: 4,
	agosto: 8,
	dezembro: 12,
	fevereiro: 2,
	janeiro: 1,
	julho: 7,
	junho: 6,
	maio: 5,
	marco: 3,
	novembro: 11,
	outubro: 10,
	setembro: 9,
};
const SLASH_DATE = /\b([0-3]?[0-9])\/(0?[1-9]|1[0-2])(?:\/(\d{2,4}))?\b/;
const MONTH_NAME_DATE =
	/\b([0-3]?[0-9])\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/;
const DAY_OF_MONTH =
	/\b(?:no\s+dia|dia|pode\s+ser\s+dia|prefiro\s+dia)\s+([0-3]?[0-9])\b/;
const NEXT_MONTH = /\b(?:mes\s+que\s+vem|proximo\s+mes)\b/;
const NAMED_MONTH =
	/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/;
const BOA_TARDE = /\bboa\s+tarde\b/g;
const MAIS_TARDE = /\bmais\s+tarde\b/g;
const MORNING_PATTERN = /\b(?:(?:de|pela|na)\s+)?manha\b|\bmatutin[oa]\b/;
const AFTERNOON_PATTERN = /\b(?:(?:a|de|pela|na)\s+)?tarde\b|\bvespertin[oa]\b/;

function isValidDate(year: number, month: number, day: number): boolean {
	const testDate = new Date(Date.UTC(year, month - 1, day));
	return (
		testDate.getUTCFullYear() === year &&
		testDate.getUTCMonth() === month - 1 &&
		testDate.getUTCDate() === day
	);
}

function yearFromExplicit(
	rawYear: string | undefined,
	month: number,
	today: CalendarDate
): number {
	if (rawYear) {
		return Number(rawYear);
	}
	return month < today.month ? today.year + 1 : today.year;
}

function expandTwoDigitYear(rawYear: string | undefined, year: number): number {
	return rawYear && year < 100 ? year + 2000 : year;
}

function parseSlashDate(match: RegExpMatchArray | null, today: CalendarDate) {
	if (!match) {
		return null;
	}
	const [, rawDay, rawMonth, rawYear] = match;
	const day = Number(rawDay);
	const month = Number(rawMonth);
	const year = expandTwoDigitYear(
		rawYear,
		yearFromExplicit(rawYear, month, today)
	);
	return isValidDate(year, month, day) ? { day, month, year } : null;
}

function parseMonthNameDate(
	match: RegExpMatchArray | null,
	today: CalendarDate
) {
	if (!match) {
		return null;
	}
	const [, rawDay, monthName, rawYear] = match;
	const day = Number(rawDay);
	const month = MONTH_NAMES[monthName];
	if (!month) {
		return null;
	}
	const year = yearFromExplicit(rawYear, month, today);
	return isValidDate(year, month, day) ? { day, month, year } : null;
}

function parseDayOfMonth(match: RegExpMatchArray | null, today: CalendarDate) {
	if (!match) {
		return null;
	}
	const day = Number(match[1]);
	if (day < 1 || day > 31) {
		return null;
	}
	let { month, year } = today;
	if (day < today.day) {
		month += 1;
		if (month > 12) {
			month = 1;
			year += 1;
		}
	}
	return isValidDate(year, month, day) ? { day, month, year } : null;
}

function parseNumericDate(
	text: string,
	today: CalendarDate
): CalendarDate | null {
	return (
		parseSlashDate(text.match(SLASH_DATE), today) ??
		parseMonthNameDate(text.match(MONTH_NAME_DATE), today) ??
		parseDayOfMonth(text.match(DAY_OF_MONTH), today)
	);
}

function prefersDay(
	text: string,
	day: RegExp,
	strictDay: RegExp,
	otherDay: RegExp
): boolean {
	return day.test(text) && (!otherDay.test(text) || strictDay.test(text));
}

function weekdayRange(
	weekday: string,
	today: CalendarDate,
	now: Date
): { timeMax: Date; timeMin: Date } | null {
	const targetWeekday = DAY_NAMES[weekday];
	if (targetWeekday === undefined) {
		return null;
	}
	const current = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(
		WEEKDAY_FORMATTER.format(now).toLowerCase()
	);
	const delta = ((targetWeekday - current + 6) % 7) + 1;
	const target = new Date(
		Date.UTC(today.year, today.month - 1, today.day + delta)
	);
	return rangeForDate({
		day: target.getUTCDate(),
		month: target.getUTCMonth() + 1,
		year: target.getUTCFullYear(),
	});
}

export function parseDatePreference(
	messages: readonly string[],
	now: Date
): DatePreference {
	const text = messages
		.join(" ")
		.normalize("NFD")
		.replace(DIACRITICS, "")
		.toLowerCase();

	const today = saoPauloDate(now);

	const numericDate = parseNumericDate(text, today);
	if (numericDate) {
		const range = rangeForDate(numericDate);
		const startOfToday = startOfSaoPauloDay(today.year, today.month, today.day);
		return range.timeMax <= startOfToday
			? { kind: "ambiguous" }
			: { kind: "date", ...range };
	}

	const preferredWeekday =
		text.match(WEEKDAY_TRIGGER)?.[1] ?? text.match(WEEKDAY_WITH_FEIRA)?.[1];

	const prefersTomorrow = prefersDay(
		text,
		TOMORROW,
		TOMORROW_PREFERENCE,
		TODAY
	);
	const prefersToday = prefersDay(text, TODAY, TODAY_PREFERENCE, TOMORROW);

	if (prefersTomorrow && !preferredWeekday) {
		return { kind: "date", ...rangeForDate(nextCalendarDay(today)) };
	}
	if (prefersToday && !preferredWeekday) {
		return { kind: "date", ...rangeForDate(today) };
	}

	if (preferredWeekday) {
		const range = weekdayRange(preferredWeekday, today, now);
		if (range) {
			return { kind: "date", ...range };
		}
	}

	if (prefersTomorrow) {
		return { kind: "date", ...rangeForDate(nextCalendarDay(today)) };
	}
	if (prefersToday) {
		return { kind: "date", ...rangeForDate(today) };
	}

	if (AMBIGUOUS_DATE.test(text)) {
		return { kind: "ambiguous" };
	}

	return null;
}

export function parseMonthPreference(
	messages: readonly string[],
	now: Date
): string | null {
	const text = messages
		.join(" ")
		.normalize("NFD")
		.replace(DIACRITICS, "")
		.toLowerCase();

	if (
		MONTH_NAME_DATE.test(text) ||
		SLASH_DATE.test(text) ||
		DAY_OF_MONTH.test(text)
	) {
		return null;
	}

	const { month: todayMonth, year: todayYear } = saoPauloDate(now);

	if (NEXT_MONTH.test(text)) {
		const nextMonth = todayMonth === 12 ? 1 : todayMonth + 1;
		const nextYear = todayMonth === 12 ? todayYear + 1 : todayYear;
		return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
	}

	const match = text.match(NAMED_MONTH);
	if (match) {
		const [, monthName, rawYear] = match;
		const monthNum = MONTH_NAMES[monthName];
		if (monthNum) {
			let year: number;
			if (rawYear) {
				year = Number(rawYear);
			} else if (monthNum < todayMonth) {
				year = todayYear + 1;
			} else {
				year = todayYear;
			}
			return `${year}-${String(monthNum).padStart(2, "0")}`;
		}
	}

	return null;
}

export function parsePeriodPreference(
	messages: readonly string[]
): "manha" | "tarde" | null {
	const text = messages
		.join(" ")
		.normalize("NFD")
		.replace(DIACRITICS, "")
		.toLowerCase();

	const stripped = text.replace(BOA_TARDE, "").replace(MAIS_TARDE, "");

	const hasMorning = MORNING_PATTERN.test(stripped);
	const hasAfternoon = AFTERNOON_PATTERN.test(stripped);

	if (hasMorning && !hasAfternoon) {
		return "manha";
	}
	if (hasAfternoon && !hasMorning) {
		return "tarde";
	}
	return null;
}
