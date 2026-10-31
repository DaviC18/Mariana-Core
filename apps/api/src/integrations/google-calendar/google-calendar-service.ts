/** biome-ignore-all lint/style/useConsistentTypeDefinitions: <> */
/** biome-ignore-all lint/suspicious/noShadow: <> */
/** biome-ignore-all lint/correctness/noUnusedFunctionParameters: <> */
/** biome-ignore-all assist/source/useSortedKeys: <> */
/** biome-ignore-all assist/source/organizeImports: <> */
/** biome-ignore-all lint/correctness/noUnusedImports: <> */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { calendar, type calendar_v3 } from "googleapis/build/src/apis/calendar";
import { OAuth2Client } from "googleapis-common";

import { db } from "../../db/connections";
import { consultants } from "../../db/schema/consultants";
import { googleCalendarConnections } from "../../db/schema/google-calendar-connections";
import { env } from "../../env";
import { isBroken, markBroken } from "./calendar-connection-health";
import {
	CalendarAuthError,
	isInvalidGrantError,
} from "./google-calendar-errors";

export type BusyPeriod = {
	start: string;
	end: string;
};

export type CalendarAvailability = {
	calendarId: string;
	busy: BusyPeriod[];
};

export type CreateCalendarEventInput = {
	calendarId: string;
	/** Dono da conexão usada (2026-10-27-scheduling-loop passo 4). */
	consultantId: string;
	summary: string;
	description?: string;
	start: Date;
	end: Date;
	/** Chave da sala do Meet; a mesma em retentativas (C-MEET). */
	requestId?: string;
};

export type CreatedCalendarEvent = {
	id: string;
	htmlLink?: string;
	summary?: string;
	start: string;
	end: string;
	hangoutLink?: string;
};

/** Identifica um evento no calendário de um consultor (C-MEET). */
export type CalendarEventRef = {
	calendarId: string;
	consultantId: string;
	eventId: string;
};

/** A conexão do consultor; ausente = consultor sem linha (não conectado). */
export type ConsultantCalendarConnection = {
	consultantName?: string;
	connection?: { id: string; refreshToken: string; updatedAt: Date };
};

export type LoadCalendarConnection = (
	consultantId: string
) => Promise<ConsultantCalendarConnection>;

export type BuildCalendarClient = (
	refreshToken: string
) => calendar_v3.Calendar;

export type GoogleCalendarServiceDependencies = {
	buildCalendarClient?: BuildCalendarClient;
	loadConnection?: LoadCalendarConnection;
};

/** Só lê a conexão; o token nunca é escrito aqui. */
const loadConnectionFromDatabase: LoadCalendarConnection = async (
	consultantId
) => {
	const [row] = await db
		.select({
			connectionId: googleCalendarConnections.id,
			consultantName: consultants.name,
			refreshToken: googleCalendarConnections.refreshToken,
			updatedAt: googleCalendarConnections.updatedAt,
		})
		.from(consultants)
		.leftJoin(
			googleCalendarConnections,
			eq(googleCalendarConnections.consultantId, consultants.id)
		)
		.where(eq(consultants.id, consultantId))
		.limit(1);

	if (!row) {
		return {};
	}

	return {
		connection:
			row.connectionId && row.refreshToken && row.updatedAt
				? {
						id: row.connectionId,
						refreshToken: row.refreshToken,
						updatedAt: row.updatedAt,
					}
				: undefined,
		consultantName: row.consultantName,
	};
};

const buildGoogleCalendarClient: BuildCalendarClient = (refreshToken) => {
	const oauth2Client = new OAuth2Client(
		env.GOOGLE_CLIENT_ID,
		env.GOOGLE_CLIENT_SECRET,
		env.GOOGLE_REDIRECT_URI
	);

	oauth2Client.setCredentials({
		refresh_token: refreshToken,
	});

	return calendar({
		version: "v3",
		auth: oauth2Client,
	});
};

/** Uma linha JSON; nunca token nem e-mail da conta Google. */
function logNeedsReauth(fields: {
	connectionId?: string;
	consultantId: string;
	consultantName?: string;
	reason: "invalid_grant" | "not_connected";
}) {
	console.error(
		JSON.stringify({ event: "google_calendar_needs_reauth", ...fields })
	);
}

/** Link da sala do Meet no evento; `null` quando não há sala. */
function extractMeetLink(event: calendar_v3.Schema$Event): string | null {
	if (event.hangoutLink) {
		return event.hangoutLink;
	}

	const videoEntryPoint = event.conferenceData?.entryPoints?.find(
		(entryPoint) => entryPoint.entryPointType === "video" && entryPoint.uri
	);

	return videoEntryPoint?.uri ?? null;
}

function errorStatus(error: {
	code?: unknown;
	response?: { status?: unknown };
}): number | undefined {
	const responseStatus = error.response?.status;

	if (typeof responseStatus === "number") {
		return responseStatus;
	}

	if (typeof error.code === "number") {
		return error.code;
	}

	return undefined;
}

/**
 * CM-3: erro de validação que recusa só a sala do Meet. O Google devolve
 * 400/403 antes de criar o evento, então repetir sem `conferenceData` não
 * duplica o compromisso. Qualquer outra falha pode ter criado o evento.
 */
function isConferenceCreationRejection(error: unknown): boolean {
	const candidate = error as {
		code?: unknown;
		message?: unknown;
		response?: { data?: unknown; status?: unknown };
	};
	const status = errorStatus(candidate);

	if (status !== 400 && status !== 403) {
		return false;
	}

	const payload = JSON.stringify(candidate.response?.data ?? "");
	const message =
		typeof candidate.message === "string" ? candidate.message : "";
	const text = `${payload} ${message}`.toLowerCase();

	return text.includes("conference") || text.includes("hangout");
}

/** Sem sala no evento: só ids técnicos, nunca dado do cliente. */
function logMeetLinkMissing(fields: {
	consultantId: string;
	reason: "conference_rejected" | "no_link";
}) {
	console.info(
		JSON.stringify({
			event: "calendar_meet_link_missing",
			source: "create_event",
			...fields,
		})
	);
}

export class GoogleCalendarService {
	private readonly buildCalendarClient: BuildCalendarClient;
	private readonly loadConnection: LoadCalendarConnection;

	constructor({
		buildCalendarClient = buildGoogleCalendarClient,
		loadConnection = loadConnectionFromDatabase,
	}: GoogleCalendarServiceDependencies = {}) {
		this.buildCalendarClient = buildCalendarClient;
		this.loadConnection = loadConnection;
	}

	/**
	 * 2026-10-27-scheduling-loop passo 4 (Q3): cada consultor usa a própria
	 * conexão. Sem linha → `CalendarAuthError('not_connected')`, logado.
	 * Passo 5: conexão marcada como quebrada (mesmo `updatedAt`) →
	 * `CalendarAuthError('invalid_grant')` sem nova chamada ao Google.
	 */
	private async withCalendarClient<T>(
		consultantId: string,
		run: (client: calendar_v3.Calendar) => Promise<T>
	): Promise<T> {
		const { connection, consultantName } =
			await this.loadConnection(consultantId);

		if (!connection) {
			logNeedsReauth({
				consultantId,
				consultantName,
				reason: "not_connected",
			});
			throw new CalendarAuthError(consultantId, "not_connected");
		}

		const updatedAtMs = connection.updatedAt.getTime();

		if (isBroken(connection.id, updatedAtMs)) {
			throw new CalendarAuthError(consultantId, "invalid_grant");
		}

		try {
			return await run(this.buildCalendarClient(connection.refreshToken));
		} catch (error) {
			if (!isInvalidGrantError(error)) {
				throw error;
			}

			if (markBroken(connection.id, updatedAtMs)) {
				logNeedsReauth({
					connectionId: connection.id,
					consultantId,
					consultantName,
					reason: "invalid_grant",
				});
			}

			// biome-ignore lint/style/useErrorCause: a causa vai no 3º argumento.
			throw new CalendarAuthError(consultantId, "invalid_grant", {
				cause: error,
			});
		}
	}

	async getBusyPeriods(
		calendarIds: string[],
		timeMin: Date,
		timeMax: Date,
		consultantId: string
	): Promise<CalendarAvailability[]> {
		if (calendarIds.length === 0) {
			return [];
		}

		if (timeMin >= timeMax) {
			throw new Error("timeMin deve ser anterior a timeMax.");
		}

		const response = await this.withCalendarClient(consultantId, (calendars) =>
			calendars.freebusy.query({
				requestBody: {
					timeMin: timeMin.toISOString(),
					timeMax: timeMax.toISOString(),
					timeZone: "America/Sao_Paulo",
					items: calendarIds.map((calendarId) => ({
						id: calendarId,
					})),
				},
			})
		);

		return calendarIds.map((calendarId) => {
			const calendarData = response.data.calendars?.[calendarId];

			if (calendarData?.errors?.length) {
				throw new Error(
					`Erro ao consultar calendário ${calendarId}: ${JSON.stringify(
						calendarData.errors
					)}`
				);
			}

			const busy = (calendarData?.busy ?? []).flatMap((period) => {
				if (!(period.start && period.end)) {
					return [];
				}

				return [
					{
						start: period.start,
						end: period.end,
					},
				];
			});

			return {
				calendarId,
				busy,
			};
		});
	}

	async createEvent(
		input: CreateCalendarEventInput
	): Promise<CreatedCalendarEvent> {
		if (input.start >= input.end) {
			throw new Error("O início do evento deve ser anterior ao fim.");
		}

		const requestBody: calendar_v3.Schema$Event = {
			description: input.description,
			end: {
				dateTime: input.end.toISOString(),
				timeZone: "America/Sao_Paulo",
			},
			start: {
				dateTime: input.start.toISOString(),
				timeZone: "America/Sao_Paulo",
			},
			summary: input.summary,
		};

		let event: calendar_v3.Schema$Event;
		let missingReason: "conference_rejected" | "no_link" | null = null;

		try {
			const response = await this.withCalendarClient(
				input.consultantId,
				(calendar) =>
					calendar.events.insert({
						calendarId: input.calendarId,
						conferenceDataVersion: 1,
						requestBody: {
							...requestBody,
							conferenceData: {
								createRequest: {
									conferenceSolutionKey: { type: "hangoutsMeet" },
									requestId: input.requestId ?? randomUUID(),
								},
							},
						},
					})
			);

			event = response.data;
		} catch (error) {
			// CM-3: a sala é best-effort e não pode derrubar o agendamento.
			// Só repete sem `conferenceData` quando o Google recusou a
			// requisição antes de criar o evento; outra falha pode ter
			// criado o evento e um segundo insert duplicaria o compromisso.
			if (!isConferenceCreationRejection(error)) {
				throw error;
			}

			const response = await this.withCalendarClient(
				input.consultantId,
				(calendar) =>
					calendar.events.insert({
						calendarId: input.calendarId,
						requestBody,
					})
			);

			event = response.data;
			missingReason = "conference_rejected";
		}

		if (!(event.id && event.start?.dateTime && event.end?.dateTime)) {
			throw new Error("Google Calendar não retornou os dados do evento.");
		}

		const meetLink = extractMeetLink(event);

		if (!meetLink) {
			logMeetLinkMissing({
				consultantId: input.consultantId,
				reason: missingReason ?? "no_link",
			});
		}

		return {
			id: event.id,
			htmlLink: event.htmlLink ?? undefined,
			summary: event.summary ?? undefined,
			start: event.start.dateTime,
			end: event.end.dateTime,
			hangoutLink: meetLink ?? undefined,
		};
	}

	/** Link da sala do Meet; `null` quando o evento não tem sala. */
	async getMeetLink({
		calendarId,
		consultantId,
		eventId,
	}: CalendarEventRef): Promise<string | null> {
		const response = await this.withCalendarClient(consultantId, (calendar) =>
			calendar.events.get({ calendarId, eventId })
		);

		return extractMeetLink(response.data);
	}

	/** Acrescenta uma linha ao fim da descrição (get + patch). */
	async appendEventDescription({
		calendarId,
		consultantId,
		eventId,
		line,
	}: CalendarEventRef & { line: string }): Promise<void> {
		await this.withCalendarClient(consultantId, async (calendar) => {
			const current = await calendar.events.get({ calendarId, eventId });
			const previous = current.data.description?.trimEnd() ?? "";

			await calendar.events.patch({
				calendarId,
				eventId,
				requestBody: {
					description: previous ? `${previous}\n\n${line}` : line,
				},
			});
		});
	}

	async deleteEvent(
		calendarId: string,
		eventId: string,
		consultantId: string
	): Promise<void> {
		await this.withCalendarClient(consultantId, (calendars) =>
			calendars.events.delete({
				calendarId,
				eventId,
			})
		);
	}
}
