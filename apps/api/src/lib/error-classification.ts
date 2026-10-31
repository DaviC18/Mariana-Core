import { isInvalidGrantError } from "../integrations/google-calendar/google-calendar-errors";

/**
 * Descrição de um erro para log (R-REL-05, R-REL-07): nome, código estável e
 * mensagem truncada com dados sensíveis mascarados — mensagens do Postgres
 * podem trazer o telefone do cliente, e o Drizzle embute a query e os params.
 * Nunca o payload da task.
 *
 * `errorMessage` fica ausente quando a mensagem não pode ser tornada segura
 * (sobra um par chave/valor de segredo depois das máscaras): o log leva só
 * `errorName` e `errorCode`.
 */
export interface ErrorDescription {
	errorCode: string;
	errorMessage?: string;
	errorName: string;
}

const MAX_ERROR_MESSAGE_LENGTH = 200;
const MASK = "***";

/** Drizzle 1.0 (`DrizzleQueryError`): "Failed query: <sql>\nparams: <...>". */
const DRIZZLE_FAILED_QUERY_PREFIX = "Failed query:";
const PARAMS_SECTION = /\nparams:[\s\S]*$/;

/**
 * Máscaras em ordem: as específicas (tokens do Google, chaves) antes das
 * genéricas (e-mail, segredo longo, dígitos), para que um token não seja
 * mascarado só pela metade.
 */
const SECRET_MASKS: [RegExp, string][] = [
	[/\bBearer\s+\S+/gi, `Bearer ${MASK}`],
	[/\bya29\.[\w.-]+/g, `ya29.${MASK}`],
	[/\b1\/\/[\w.-]+/g, `1//${MASK}`],
	[/\bAIza[\w-]{20,}/g, `AIza${MASK}`],
	[/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, `${MASK}@${MASK}`],
	[
		/\b([\w-]*(?:token|secret|password|passwd|api[_-]?key|key|code|signature)[\w-]*)=[^\s&,;]+/gi,
		`$1=${MASK}`,
	],
	// Valores citados pelo Postgres: `Key (x)=(valor)` e `...: "valor"`.
	[/[=]\([^)]*\)/g, `=(${MASK})`],
	[/:\s*"[^"]*"/g, `: "${MASK}"`],
];

/** Hex ou base64/base64url com 32+ caracteres e letra e dígito misturados. */
const LONG_OPAQUE_RUN = /[A-Za-z0-9+/_-]{32,}={0,2}/g;
const HAS_DIGIT = /\d/;
const HAS_LETTER = /[A-Za-z]/;
const LONG_DIGIT_RUN = /\d{8,}/g;

/** O que sobra disto depois das máscaras não vai para o log. */
const UNSAFE_REMAINDER =
	/(?:token|secret|password|passwd|api[_-]?key|authorization)["']?\s*[:=]\s*["']?(?!\*{3}|Bearer \*{3})[^\s"',}]/i;

const POSTGRES_SQLSTATE = /^[0-9A-Z]{5}$/;
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);
const TIMEOUT_CODES = new Set([
	"ETIMEDOUT",
	"ESOCKETTIMEDOUT",
	"ECONNABORTED",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
]);
const TIMEOUT_NAMES = new Set(["TimeoutError", "AbortError"]);

function maskOpaqueRun(run: string): string {
	return HAS_DIGIT.test(run) && HAS_LETTER.test(run) ? MASK : run;
}

/**
 * Máscara de segredos e dados do cliente, depois o corte em 200 caracteres.
 * `null` quando sobra algo que parece segredo.
 */
export function maskErrorMessage(message: string): string | null {
	let masked = message.replace(PARAMS_SECTION, "");

	for (const [pattern, replacement] of SECRET_MASKS) {
		masked = masked.replace(pattern, replacement);
	}

	masked = masked
		.replace(LONG_OPAQUE_RUN, maskOpaqueRun)
		.replace(LONG_DIGIT_RUN, (run) => "#".repeat(run.length));

	if (UNSAFE_REMAINDER.test(masked)) {
		return null;
	}

	return masked.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function errorCodeOf(error: unknown): unknown {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}

	const { code } = error as { code?: unknown };

	return code;
}

function httpStatusOf(error: unknown): unknown {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}

	const { response, status } = error as {
		response?: { status?: unknown };
		status?: unknown;
	};

	return response?.status ?? status ?? errorCodeOf(error);
}

/** O erro e suas causas (o Drizzle e o gaxios embrulham o erro real). */
function errorChain(error: unknown): unknown[] {
	const chain: unknown[] = [];
	let current = error;

	while (
		typeof current === "object" &&
		current !== null &&
		chain.length < 4 &&
		!chain.includes(current)
	) {
		chain.push(current);
		const { cause } = current as { cause?: unknown };
		current = cause;
	}

	return chain;
}

function classifyOne(error: unknown): string | null {
	const code = errorCodeOf(error);
	const status = httpStatusOf(error);

	if (status === 403 || status === "403") {
		return "google_forbidden";
	}

	if (typeof code === "string" && DNS_CODES.has(code)) {
		return "network_dns";
	}

	if (
		(typeof code === "string" && TIMEOUT_CODES.has(code)) ||
		(error instanceof Error && TIMEOUT_NAMES.has(error.name))
	) {
		return "google_timeout";
	}

	if (typeof code === "string" && POSTGRES_SQLSTATE.test(code)) {
		return `pg_${code}`;
	}

	return null;
}

/**
 * Código estável para filtrar no log. A ordem importa: `invalid_grant`
 * primeiro; depois, no erro e nas causas, 403, DNS, timeout e o SQLSTATE do
 * Postgres; por fim `unknown`.
 */
export function classifyError(error: unknown): string {
	if (isInvalidGrantError(error)) {
		return "google_invalid_grant";
	}

	for (const link of errorChain(error)) {
		const code = classifyOne(link);

		if (code !== null) {
			return code;
		}
	}

	return "unknown";
}

/**
 * Para um `DrizzleQueryError`, a query e os params nunca entram: só
 * "Failed query" e a mensagem da causa (o erro do Postgres).
 */
function rawMessageOf(error: Error): string {
	if (!error.message.startsWith(DRIZZLE_FAILED_QUERY_PREFIX)) {
		return error.message;
	}

	return error.cause instanceof Error
		? `Failed query: ${error.cause.message}`
		: "Failed query";
}

export function describeError(error: unknown): ErrorDescription {
	const errorName = error instanceof Error ? error.name : "NonError";
	const errorMessage = maskErrorMessage(
		error instanceof Error ? rawMessageOf(error) : String(error)
	);

	return {
		errorCode: classifyError(error),
		...(errorMessage === null ? {} : { errorMessage }),
		errorName,
	};
}
