/**
 * Erros do Google Calendar que o backend precisa distinguir
 * (2026-10-27-scheduling-loop).
 */

/**
 * Token de atualização revogado ou expirado. O gaxios devolve o corpo do
 * OAuth em `response.data.error`; algumas versões só deixam a mensagem.
 */
export function isInvalidGrantError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}

	const { response } = error as {
		response?: { data?: { error?: unknown } };
	};

	if (response?.data?.error === "invalid_grant") {
		return true;
	}

	if (error instanceof CalendarAuthError) {
		return error.reason === "invalid_grant";
	}

	return error instanceof Error && error.message === "invalid_grant";
}

export type CalendarAuthFailureReason = "invalid_grant" | "not_connected";

/**
 * A conexão do consultor não serve (2026-10-27-scheduling-loop, passos 4–5):
 * `not_connected` = sem linha em `google_calendar_connections`;
 * `invalid_grant` = refresh token revogado ou expirado (o erro do Google fica
 * em `cause`). A mensagem nunca traz token nem e-mail.
 */
export class CalendarAuthError extends Error {
	readonly consultantId: string;
	readonly reason: CalendarAuthFailureReason;

	constructor(
		consultantId: string,
		reason: CalendarAuthFailureReason,
		options?: { cause?: unknown }
	) {
		super(`Google Calendar connection unusable (${reason}).`, options);
		this.name = "CalendarAuthError";
		this.consultantId = consultantId;
		this.reason = reason;
	}
}

/** A falha de um consultor na consulta ao Calendar. */
export interface ConsultantCalendarFailure {
	consultantId: string;
	error: unknown;
}

/**
 * Nenhum consultor respondeu no Calendar durante a oferta. As falhas de cada
 * consultor ficam em `failures` (com o consultantId) e os erros em `cause`,
 * na ordem em que foram consultados.
 */
export class CalendarUnavailableError extends Error {
	readonly failures: ConsultantCalendarFailure[];

	constructor(failures: ConsultantCalendarFailure[]) {
		super(`No consultant calendar answered (${failures.length} failure(s)).`, {
			cause: failures.map((failure) => failure.error),
		});
		this.name = "CalendarUnavailableError";
		this.failures = failures;
	}
}
