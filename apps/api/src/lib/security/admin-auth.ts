import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminSession } from "./admin-totp";
import type { AuthFailureLimiter } from "./auth-failure-limiter";
import { safeEqual } from "./constant-time";

/**
 * Quem fez a requisição. Hoje só existe `admin` via chave de API; uma futura
 * UI de admin (sessão em cookie, papel `consultant`) preenche o mesmo campo.
 */
export interface RequestPrincipal {
	role: "admin";
	via: "api_key" | "totp_session";
}

declare module "fastify" {
	interface FastifyRequest {
		principal?: RequestPrincipal;
	}
}

type FailureReason = "missing" | "malformed" | "invalid";

const BEARER_PATTERN = /^Bearer ([^\s]+)$/i;

function readBearer(
	header: string | undefined
): { token: string } | { reason: FailureReason } {
	if (header === undefined || header === "") {
		return { reason: "missing" };
	}
	const match = BEARER_PATTERN.exec(header);
	if (!match?.[1]) {
		return { reason: "malformed" };
	}
	return { token: match[1] };
}

/** `undefined` = chave válida. */
function failureReason(
	header: string | undefined,
	adminApiKey: string
): FailureReason | undefined {
	const parsed = readBearer(header);
	if ("reason" in parsed) {
		return parsed.reason;
	}
	return safeEqual(parsed.token, adminApiKey) ? undefined : "invalid";
}

export interface RequireAdminOptions {
	adminApiKey: string;
	adminSessionSecret: string;
	limiter: AuthFailureLimiter;
}

/**
 * Hook `onRequest` do escopo de admin. Toda falha (sem header, esquema
 * errado, chave errada) recebe o mesmo 401; o log traz só a categoria, nunca
 * o valor do header. Depois de muitas falhas do mesmo IP → 429.
 */
export function createRequireAdmin({
	adminApiKey,
	adminSessionSecret,
	limiter,
}: RequireAdminOptions) {
	// biome-ignore lint/suspicious/useAwait: async Fastify hook; it returns the reply instead of calling done.
	return async function requireAdmin(
		request: FastifyRequest,
		reply: FastifyReply
	) {
		const { ip } = request;
		const limit = limiter.check(ip);
		if (limit.limited) {
			request.log.warn({
				event: "admin_auth_rate_limited",
				ip,
				method: request.method,
				route: request.routeOptions.url,
			});
			return reply
				.code(429)
				.header("Retry-After", String(limit.retryAfterSeconds))
				.send({ error: "too_many_requests" });
		}

		const sessionHeader = request.headers["x-admin-session"];
		const hasSession = verifyAdminSession(
			adminSessionSecret,
			typeof sessionHeader === "string" ? sessionHeader : undefined
		);
		const reason = hasSession
			? undefined
			: failureReason(request.headers.authorization, adminApiKey);

		if (reason === undefined) {
			limiter.reset(ip);
			request.principal = {
				role: "admin",
				via: hasSession ? "totp_session" : "api_key",
			};
			return;
		}

		limiter.recordFailure(ip);
		request.log.warn({
			event: "admin_auth_failed",
			ip,
			method: request.method,
			reason,
			route: request.routeOptions.url,
		});
		return reply
			.code(401)
			.header("WWW-Authenticate", "Bearer")
			.send({ error: "unauthorized" });
	};
}
