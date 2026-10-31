import { eq } from "drizzle-orm";
import type { FastifyPluginCallback, FastifyReply } from "fastify";
import { db } from "../../db/connections";
import { consultants, googleCalendarConnections } from "../../db/schema";
import { env } from "../../env";
import {
	GOOGLE_CALENDAR_SCOPES,
	googleOAuth2Client,
} from "../../integrations/google-calendar/oauth";
import type { AuthFailureLimiter } from "../../lib/security/auth-failure-limiter";
import { safeEqual } from "../../lib/security/constant-time";
import {
	ConsumedNonces,
	deriveSigningKey,
	signToken,
	verifyToken,
} from "../../lib/security/signed-token";

export const GCAL_CONNECT_PURPOSE = "gcal_connect";
export const GCAL_STATE_PURPOSE = "gcal_state";
export const GCAL_OAUTH_COOKIE = "gcal_oauth_nonce";
const CALLBACK_PATH = "/auth/google/callback";
const TEN_MINUTES_MS = 10 * 60 * 1000;

const connectKey = () =>
	deriveSigningKey(env.APP_SIGNING_SECRET, GCAL_CONNECT_PURPOSE);
const stateKey = () =>
	deriveSigningKey(env.APP_SIGNING_SECRET, GCAL_STATE_PURPOSE);

/**
 * Ticket de uso único e 10 min para iniciar o OAuth de um consultor. Só a
 * rota de admin `POST /admin/google-calendar/connect-link` o emite.
 */
export function createGoogleConnectTicket(
	consultantId: string,
	options: { now?: () => number } = {}
) {
	return signToken(
		connectKey(),
		GCAL_CONNECT_PURPOSE,
		{ consultantId },
		{ now: options.now, ttlMs: TEN_MINUTES_MS }
	);
}

function oauthCookie(value: string, maxAgeSeconds: number) {
	const secure = env.NODE_ENV === "production" ? "; Secure" : "";
	return `${GCAL_OAUTH_COOKIE}=${value}; Path=${CALLBACK_PATH}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

/** Valor de um cookie no header `Cookie`, ou `undefined`. */
function readCookie(header: string | undefined, name: string) {
	const prefix = `${name}=`;
	const part = header
		?.split(";")
		.map((item) => item.trim())
		.find((item) => item.startsWith(prefix));
	return part?.slice(prefix.length);
}

/** Só campos seguros de um erro do Google (nunca mensagem nem `config`). */
function safeErrorFields(error: unknown) {
	const { code, name } = (error ?? {}) as { code?: unknown; name?: unknown };
	return {
		code:
			typeof code === "string" || typeof code === "number" ? code : undefined,
		name: typeof name === "string" ? name : undefined,
	};
}

export interface AuthGoogleOptions {
	limiter: AuthFailureLimiter;
}

export const authGoogle: FastifyPluginCallback<AuthGoogleOptions> = (
	app,
	{ limiter },
	done
) => {
	const usedTickets = new ConsumedNonces();
	const usedStates = new ConsumedNonces();

	/** `consultantId` do state válido, do mesmo navegador e ainda não usado. */
	const consumeState = (state: string, cookieNonce: string | undefined) => {
		const payload = verifyToken(state, stateKey(), GCAL_STATE_PURPOSE);
		if (
			!(payload && cookieNonce) ||
			typeof payload.consultantId !== "string" ||
			!safeEqual(cookieNonce, payload.nonce) ||
			!usedStates.consume(payload.nonce, payload.exp)
		) {
			return;
		}
		return payload.consultantId;
	};

	const rejectTicket = (
		ip: string,
		reply: FastifyReply,
		reason: string,
		log: { warn: (value: object) => void }
	) => {
		limiter.recordFailure(ip);
		log.warn({ event: "google_oauth_ticket_rejected", ip, reason });
		return reply.status(400).send({ error: "invalid_ticket" });
	};

	// biome-ignore lint/suspicious/useAwait: async Fastify handler returns the reply.
	app.get("/auth/google", async (request, reply) => {
		const { ip } = request;
		const limit = limiter.check(ip);
		if (limit.limited) {
			return reply
				.code(429)
				.header("Retry-After", String(limit.retryAfterSeconds))
				.send({ error: "too_many_requests" });
		}

		const { ticket } = request.query as { ticket?: string };
		if (!ticket) {
			return rejectTicket(ip, reply, "missing", request.log);
		}
		const payload = verifyToken(ticket, connectKey(), GCAL_CONNECT_PURPOSE);
		if (!payload || typeof payload.consultantId !== "string") {
			return rejectTicket(ip, reply, "invalid", request.log);
		}
		if (!usedTickets.consume(payload.nonce, payload.exp)) {
			return rejectTicket(ip, reply, "reused", request.log);
		}

		// O nonce do state também vai num cookie HttpOnly: o callback só aceita
		// o state no mesmo navegador que iniciou o fluxo (contra login-CSRF).
		const { payload: statePayload, token: state } = signToken(
			stateKey(),
			GCAL_STATE_PURPOSE,
			{ consultantId: payload.consultantId },
			{ ttlMs: TEN_MINUTES_MS }
		);

		const authorizationUrl = googleOAuth2Client.generateAuthUrl({
			access_type: "offline",
			include_granted_scopes: true,
			prompt: "consent",
			scope: GOOGLE_CALENDAR_SCOPES,
			state,
		});

		return reply
			.header(
				"Set-Cookie",
				oauthCookie(statePayload.nonce, TEN_MINUTES_MS / 1000)
			)
			.redirect(authorizationUrl);
	});

	app.get("/auth/google/callback", async (request, reply) => {
		const {
			code,
			error: oauthError,
			state,
		} = request.query as {
			code?: string;
			error?: string;
			state?: string;
		};

		// O cookie de vínculo vale para uma única tentativa: sempre apagado.
		reply.header("Set-Cookie", oauthCookie("", 0));

		if (oauthError) {
			// Mensagem fixa: o parâmetro `error` vem do navegador e nunca é ecoado.
			return reply.status(400).send({
				message: "Autorização Google recusada.",
				success: false,
			});
		}

		if (!(code && state)) {
			return reply.status(400).send({
				message: "Código ou state de autorização não encontrado.",
				success: false,
			});
		}

		// State: assinatura, finalidade e validade (10 min), o mesmo navegador
		// (nonce do cookie) e uso único, tudo antes de tocar o banco ou o Google.
		const consultantId = consumeState(
			state,
			readCookie(request.headers.cookie, GCAL_OAUTH_COOKIE)
		);

		if (!consultantId) {
			return reply.status(400).send({
				message: "State OAuth inválido.",
				success: false,
			});
		}

		try {
			const [consultant] = await db
				.select({
					id: consultants.id,
					name: consultants.name,
				})
				.from(consultants)
				.where(eq(consultants.id, consultantId))
				.limit(1);

			if (!consultant) {
				return reply.status(404).send({
					message: "Consultor não encontrado.",
					success: false,
				});
			}

			const { tokens } = await googleOAuth2Client.getToken(code);

			if (!tokens.refresh_token) {
				return reply.status(400).send({
					message:
						"Google não retornou refresh token. Revogue a autorização anterior e autorize novamente.",
					success: false,
				});
			}

			await db
				.insert(googleCalendarConnections)
				.values({
					consultantId: consultant.id,
					googleAccountEmail: env.GOOGLE_ACCOUNT_EMAIL,
					refreshToken: tokens.refresh_token,
				})
				.onConflictDoUpdate({
					set: {
						googleAccountEmail: env.GOOGLE_ACCOUNT_EMAIL,
						refreshToken: tokens.refresh_token,
						updatedAt: new Date(),
					},
					target: googleCalendarConnections.consultantId,
				});

			return reply.send({
				consultant: consultant.name,
				hasAccessToken: Boolean(tokens.access_token),
				hasRefreshToken: Boolean(tokens.refresh_token),
				message: "Google Calendar autorizado e conexão salva.",
				success: true,
			});
		} catch (catchError) {
			// Só campos seguros: o erro do Google pode carregar o pedido inteiro
			// (client secret, code) na mensagem ou em `config`.
			request.log.error({
				...safeErrorFields(catchError),
				event: "google_oauth_callback_failed",
			});

			return reply.status(500).send({
				message: "Erro ao concluir autorização do Google Calendar.",
				success: false,
			});
		}
	});

	done();
};
