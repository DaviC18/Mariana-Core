import "dotenv/config";
import z from "zod";

const parseIntegerEnv = (value: string | undefined, fallback: number) => {
	if (value === undefined || value === "") {
		return fallback;
	}

	const normalized = value.replace(/_/g, "");
	const parsed = Number(normalized);

	if (!Number.isFinite(parsed)) {
		return fallback;
	}

	return parsed;
};

const NO_WHITESPACE = /^\S+$/;

export const envSchema = z.object({
	// Chave das rotas de admin (`Authorization: Bearer <chave>`). Sem espaço
	// em branco: o Bearer só aceita `[^\s]+`, então a chave nunca casaria.
	ADMIN_API_KEY: z
		.string()
		.min(32)
		.regex(NO_WHITESPACE, { message: "must not contain whitespace" }),
	// Segredo base32 do autenticador do administrador; nunca é exposto ao painel.
	ADMIN_TOTP_SECRET: z
		.string()
		.min(16)
		.regex(NO_WHITESPACE, { message: "must not contain whitespace" }),
	// Chave de assinatura de tickets/state do OAuth. Precisa ser diferente da
	// ADMIN_API_KEY (ver `refinedEnvSchema`).
	APP_SIGNING_SECRET: z
		.string()
		.min(32)
		.regex(NO_WHITESPACE, { message: "must not contain whitespace" }),
	AUTONOMOUS_TASK_POLL_MS: z.coerce.number().int().positive().default(2000),
	DATABASE_URL: z
		.string()
		.min(1)
		.url()
		.refine((v) => v.startsWith("postgresql://"), {
			message: "DATABASE_URL should start with postgresql://",
		}),
	GEMINI_API_KEY: z.string().min(1),
	// A resposta é JSON (reply + leadUpdate + evidenceUsed) e os tokens de
	// raciocínio são cobrados como saída: um limite apertado trunca o JSON.
	GEMINI_MAX_OUTPUT_TOKENS: z.coerce
		.number()
		.int()
		.min(128)
		.max(8192)
		.default(1024),
	GEMINI_MODEL: z
		.string()
		.min(1)
		.regex(
			/^gemini-[0-9]+(?:\.[0-9]+)?-(?:flash|flash-lite|pro)(?:-[a-z0-9.-]+)?$/,
			{
				message:
					"GEMINI_MODEL deve seguir o formato gemini-<versão>-<flash|flash-lite|pro>",
			}
		)
		.default("gemini-3.5-flash-lite"),
	GEMINI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
	// A partir do Gemini 3.5 o thinkingBudget é rejeitado pela API: a
	// profundidade de raciocínio se controla por thinkingLevel.
	GEMINI_THINKING_LEVEL: z
		.enum(["MINIMAL", "LOW", "MEDIUM", "HIGH"])
		.default("LOW"),
	GOOGLE_ACCOUNT_EMAIL: z.string().email().min(1),
	GOOGLE_ADS_WEBHOOK_KEY: z.string().min(1),
	GOOGLE_CLIENT_ID: z.string().min(1),
	GOOGLE_CLIENT_SECRET: z.string().min(1),
	GOOGLE_REDIRECT_URI: z.string().min(1),
	// Flow v2 (2026-10-28-flow-v2, Q10): `v1` até o Davi aprovar a v2 no
	// WhatsApp (V5). Só o turno de texto e o botão `consultor:falar` mudam.
	MARIANA_FLOW: z.enum(["v1", "v2"]).default("v1"),
	// Mensagens da conversa atual que a v2 manda ao modelo (`understand`).
	MARIANA_HISTORY_MESSAGES: z.coerce.number().int().min(1).max(30).default(10),
	// Teto de uma chamada `understand` da v2; travou → aviso de falha do modelo.
	// Abaixo do lease de 60s da task de entrada.
	MARIANA_UNDERSTAND_TIMEOUT_MS: z.coerce
		.number()
		.int()
		.min(1000)
		.max(45_000)
		.default(45_000),
	MESSAGE_DEBOUNCE_MS: z.coerce.number().int().positive().default(15_000),
	META_ADS_APP_SECRET: z.string().min(1),
	META_ADS_GRAPH_API_VERSION: z.string().min(1),
	META_ADS_VERIFY_TOKEN: z.string().min(1),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	OUTBOUND_MESSAGE_POLL_MS: z.coerce.number().int().positive().default(2000),
	PORT: z.coerce.number().default(3252),
	RELIABILITY_WORKERS_ENABLED: z.enum(["true", "false"]).default("true"),
	SCHEDULE_CONFIRMATION_MINUTES: z.coerce
		.number()
		.int()
		.min(30)
		.max(60)
		.default(60),
	// Proxies confiáveis à frente do servidor (ngrok = 1). 0 = nenhum: o IP do
	// cliente é o da conexão TCP.
	TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
	WHATSAPP_ACCESS_TOKEN: z.string().min(1),
	WHATSAPP_APP_SECRET: z.string().min(1),
	WHATSAPP_GRAPH_API_VERSION: z.string().min(1),
	WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
	// Bem abaixo do lease de 60s do outbox: o worker precisa ser liberado e
	// marcar o envio como incerto antes que o lease expire.
	WHATSAPP_SEND_TIMEOUT_MS: z.coerce
		.number()
		.int()
		.min(1000)
		.max(45_000)
		.default(15_000),
	WHATSAPP_VERIFY_TOKEN: z.string().min(1),
	WHATSAPP_WABA_ID: z.string().min(1),
});

const refinedEnvSchema = envSchema.superRefine((value, ctx) => {
	if (value.APP_SIGNING_SECRET === value.ADMIN_API_KEY) {
		ctx.addIssue({
			code: "custom",
			message: "APP_SIGNING_SECRET must differ from ADMIN_API_KEY",
			path: ["APP_SIGNING_SECRET"],
		});
	}
	const redirectError = googleRedirectUriError(
		value.GOOGLE_REDIRECT_URI,
		value.NODE_ENV
	);
	if (redirectError) {
		ctx.addIssue({
			code: "custom",
			message: redirectError,
			path: ["GOOGLE_REDIRECT_URI"],
		});
	}
});

const GOOGLE_CALLBACK_PATH = "/auth/google/callback";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * O callback do OAuth precisa ser uma URL deste servidor em
 * `/auth/google/callback`. Em produção só `https:`; fora dela, `http:` só
 * para localhost.
 */
function googleRedirectUriError(
	value: string,
	nodeEnv: string
): string | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return "must be a valid URL";
	}
	if (url.pathname !== GOOGLE_CALLBACK_PATH) {
		return `path must be ${GOOGLE_CALLBACK_PATH}`;
	}
	if (url.protocol === "https:") {
		return;
	}
	if (
		url.protocol === "http:" &&
		nodeEnv !== "production" &&
		LOCAL_HOSTNAMES.has(url.hostname)
	) {
		return;
	}
	return nodeEnv === "production"
		? "must use https in production"
		: "must use https (http only for localhost)";
}

export type Env = z.infer<typeof envSchema>;

export function buildEnvInput(source: NodeJS.ProcessEnv) {
	return {
		ADMIN_API_KEY: source.ADMIN_API_KEY,
		ADMIN_TOTP_SECRET: source.ADMIN_TOTP_SECRET,
		APP_SIGNING_SECRET: source.APP_SIGNING_SECRET,
		AUTONOMOUS_TASK_POLL_MS: parseIntegerEnv(
			source.AUTONOMOUS_TASK_POLL_MS,
			2000
		),
		DATABASE_URL: source.DATABASE_URL,
		GEMINI_API_KEY: source.GEMINI_API_KEY,
		// Valor inválido falha na validação em vez de cair no default.
		GEMINI_MAX_OUTPUT_TOKENS: source.GEMINI_MAX_OUTPUT_TOKENS || undefined,
		// Só o modelo e o nível são comparados como texto, então espaços neles
		// devem falhar. Aqui o `trim` é obrigatório: `Number("   ")` é 0, que
		// passa por `min(0)` e viraria uma temperatura 0 silenciosa.
		GEMINI_MODEL: source.GEMINI_MODEL || undefined,
		GEMINI_TEMPERATURE: source.GEMINI_TEMPERATURE?.trim() || undefined,
		GEMINI_THINKING_LEVEL: source.GEMINI_THINKING_LEVEL || undefined,
		GOOGLE_ACCOUNT_EMAIL: source.GOOGLE_ACCOUNT_EMAIL,
		GOOGLE_ADS_WEBHOOK_KEY: source.GOOGLE_ADS_WEBHOOK_KEY,
		GOOGLE_CLIENT_ID: source.GOOGLE_CLIENT_ID,
		GOOGLE_CLIENT_SECRET: source.GOOGLE_CLIENT_SECRET,
		GOOGLE_REDIRECT_URI: source.GOOGLE_REDIRECT_URI,
		// Valor inválido falha na validação em vez de cair no default.
		MARIANA_FLOW: source.MARIANA_FLOW || undefined,
		MARIANA_HISTORY_MESSAGES:
			source.MARIANA_HISTORY_MESSAGES?.trim() || undefined,
		MARIANA_UNDERSTAND_TIMEOUT_MS:
			source.MARIANA_UNDERSTAND_TIMEOUT_MS?.trim() || undefined,
		MESSAGE_DEBOUNCE_MS: parseIntegerEnv(source.MESSAGE_DEBOUNCE_MS, 15_000),
		META_ADS_APP_SECRET: source.META_ADS_APP_SECRET,
		META_ADS_GRAPH_API_VERSION: source.META_ADS_GRAPH_API_VERSION,
		META_ADS_VERIFY_TOKEN: source.META_ADS_VERIFY_TOKEN,
		NODE_ENV: source.NODE_ENV,
		OUTBOUND_MESSAGE_POLL_MS: parseIntegerEnv(
			source.OUTBOUND_MESSAGE_POLL_MS,
			2000
		),
		PORT: parseIntegerEnv(source.PORT, 3252),
		RELIABILITY_WORKERS_ENABLED: source.RELIABILITY_WORKERS_ENABLED,
		SCHEDULE_CONFIRMATION_MINUTES: parseIntegerEnv(
			source.SCHEDULE_CONFIRMATION_MINUTES,
			60
		),
		// Valor inválido falha na validação em vez de cair no default.
		TRUST_PROXY_HOPS: source.TRUST_PROXY_HOPS?.trim() || undefined,
		WHATSAPP_ACCESS_TOKEN: source.WHATSAPP_ACCESS_TOKEN,
		WHATSAPP_APP_SECRET: source.WHATSAPP_APP_SECRET,
		WHATSAPP_GRAPH_API_VERSION: source.WHATSAPP_GRAPH_API_VERSION,
		WHATSAPP_PHONE_NUMBER_ID: source.WHATSAPP_PHONE_NUMBER_ID,
		// Valor inválido falha na validação em vez de cair no default.
		WHATSAPP_SEND_TIMEOUT_MS: source.WHATSAPP_SEND_TIMEOUT_MS || undefined,
		WHATSAPP_VERIFY_TOKEN: source.WHATSAPP_VERIFY_TOKEN,
		WHATSAPP_WABA_ID: source.WHATSAPP_WABA_ID,
	};
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
	const result = refinedEnvSchema.safeParse(buildEnvInput(source));

	if (!result.success) {
		const issues = result.error.issues
			.map(
				(issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`
			)
			.join("\n");

		throw new Error(`Invalid environment configuration:\n${issues}`);
	}

	return result.data;
}

export const env = parseEnv(process.env);
