/** biome-ignore-all lint/suspicious/useAwait: <> */
import fastify, {
	type FastifyInstance,
	type FastifyServerOptions,
	type onRouteHookHandler,
} from "fastify";
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { env } from "./env";
import { loggerConfig, redactSensitiveQuery } from "./lib/logger";
import { createRequireAdmin } from "./lib/security/admin-auth";
import { AuthFailureLimiter } from "./lib/security/auth-failure-limiter";
import { createAppointments } from "./routes/appointments/create-appointments";
import { getAppointments } from "./routes/appointments/get-appointments";
import { getAppointmentAvailability } from "./routes/appointments/get-availability";
import { getIdAppointments } from "./routes/appointments/get-id-appointments";
import { createConversations } from "./routes/conversations/create-conversations";
import { getConversatios } from "./routes/conversations/get-conversations";
import { getIdConversations } from "./routes/conversations/get-id-conversations";
import { googleAdsWebhookRoutes } from "./routes/google-ads/webhook-google-ads";
import { authGoogle } from "./routes/google-calendar/auth-google";
import { googleCalendarConnectLink } from "./routes/google-calendar/connect-link";
import { createLeads } from "./routes/leads/create-leads";
import { getIdLeads } from "./routes/leads/get-id-leads";
import { getLeads } from "./routes/leads/get-leads";
import { getConversationMessages } from "./routes/messages/get-conversation-messages";
import { getIdMessages } from "./routes/messages/get-id-messages";
import { getMessages } from "./routes/messages/get-messages";
import { metaAdsWebhookRoutes } from "./routes/meta-ads/webhook-meta-ads";
import { webhookWhatsApp } from "./routes/whatsapp/webhook-whatsapp";

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
	["Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"],
	["Referrer-Policy", "no-referrer"],
	["X-Content-Type-Options", "nosniff"],
	["X-Frame-Options", "DENY"],
];
const OAUTH_PATH_PREFIX = "/auth/google";

export interface BuildAppOptions {
	/** Padrão: `env.ADMIN_API_KEY`. */
	adminApiKey?: string;
	/** Padrão: um limitador novo por app (10 falhas / 15 min por IP). */
	authFailureLimiter?: AuthFailureLimiter;
	logger?: FastifyServerOptions["logger"];
	/** Só para testes: observa cada rota registrada (inventário). */
	onRoute?: onRouteHookHandler;
	/** Só para testes: registra rotas extras dentro do escopo de admin. */
	registerAdminRoutes?: (scope: FastifyInstance) => void;
}

/**
 * Monta a aplicação inteira sem chamar `listen()`: `server.ts` cuida de
 * `listen`, workers e shutdown; os testes usam `inject`.
 */
export function buildApp(options: BuildAppOptions = {}) {
	const app = fastify({
		logger: options.logger ?? loggerConfig,
		// `TRUST_PROXY_HOPS` is not wired: Fastify 5.12 rejects a numeric
		// `trustProxy` (a hop count cannot validate the immediate peer), so
		// `request.ip` is the TCP peer. Trusting ngrok needs an address-based
		// rule (open question in docs/work/2026-10-27-api-auth/progress.md).
		trustProxy: false,
	}).withTypeProvider<ZodTypeProvider>();

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

	if (options.onRoute) {
		app.addHook("onRoute", options.onRoute);
	}

	// Headers de segurança em toda resposta (inclusive 401/404). Sem CORS:
	// nenhum `Access-Control-Allow-Origin`. Sem HSTS por enquanto (D-6).
	app.addHook("onSend", async (request, reply, payload) => {
		for (const [name, value] of SECURITY_HEADERS) {
			reply.header(name, value);
		}
		if (request.url.startsWith(OAUTH_PATH_PREFIX)) {
			reply.header("Cache-Control", "no-store");
		}
		return payload;
	});

	app.addHook("onResponse", async (request, reply) => {
		app.log.info({
			method: request.method,
			statusCode: reply.statusCode,
			url: redactSensitiveQuery(request.url),
		});
	});

	// Falhas de autenticação por IP: escopo de admin e ticket do OAuth.
	// Webhooks nunca passam por aqui.
	const limiter = options.authFailureLimiter ?? new AuthFailureLimiter();

	// Escopo público: cada rota tem a própria verificação (verify token,
	// HMAC, chave do Google Ads, ticket e state do OAuth).
	app.register(webhookWhatsApp);
	app.register(googleAdsWebhookRoutes);
	app.register(metaAdsWebhookRoutes);
	app.register(authGoogle, { limiter });
	app.get("/", async () => "ok");

	// Escopo de admin: toda rota registrada aqui exige
	// `Authorization: Bearer <ADMIN_API_KEY>`. Rota nova entra aqui por padrão.
	const requireAdmin = createRequireAdmin({
		adminApiKey: options.adminApiKey ?? env.ADMIN_API_KEY,
		limiter,
	});
	app.register(async (admin) => {
		admin.addHook("onRequest", requireAdmin);
		admin.addHook("onSend", async (_request, reply, payload) => {
			reply.header("Cache-Control", "no-store");
			return payload;
		});
		admin.register(createLeads);
		admin.register(getIdLeads);
		admin.register(getLeads);
		admin.register(getConversatios);
		admin.register(getIdConversations);
		admin.register(createConversations);
		admin.register(getIdMessages);
		admin.register(getMessages);
		admin.register(getConversationMessages);
		admin.register(createAppointments);
		admin.register(getAppointmentAvailability);
		admin.register(getIdAppointments);
		admin.register(getAppointments);
		admin.register(googleCalendarConnectLink);
		options.registerAdminRoutes?.(admin);
	});

	return app;
}
