import assert from "node:assert/strict";
import test from "node:test";

import { envSchema, parseEnv } from "../env";

const MISSING_GEMINI_ERROR =
	/Invalid environment configuration[\s\S]*GEMINI_API_KEY/;
const NON_POSTGRES_DATABASE_URL_ERROR =
	/DATABASE_URL should start with postgresql:\/\//;
const SCHEDULE_CONFIRMATION_ERROR = /SCHEDULE_CONFIRMATION_MINUTES/;
const WHATSAPP_SEND_TIMEOUT_ERROR = /WHATSAPP_SEND_TIMEOUT_MS/;
const GEMINI_MODEL_ERROR = /GEMINI_MODEL/;
const GEMINI_TEMPERATURE_ERROR = /GEMINI_TEMPERATURE/;
const GEMINI_THINKING_LEVEL_ERROR = /GEMINI_THINKING_LEVEL/;
const GEMINI_MAX_OUTPUT_TOKENS_ERROR = /GEMINI_MAX_OUTPUT_TOKENS/;
const ADMIN_API_KEY_ERROR = /ADMIN_API_KEY/;
const ADMIN_TOTP_SECRET_ERROR = /ADMIN_TOTP_SECRET/;
const APP_SIGNING_SECRET_ERROR = /APP_SIGNING_SECRET/;
const TRUST_PROXY_HOPS_ERROR = /TRUST_PROXY_HOPS/;
const MARIANA_FLOW_ERROR = /MARIANA_FLOW/;
const MARIANA_UNDERSTAND_TIMEOUT_ERROR = /MARIANA_UNDERSTAND_TIMEOUT_MS/;
const MARIANA_HISTORY_MESSAGES_ERROR = /MARIANA_HISTORY_MESSAGES/;

const VALID_ADMIN_API_KEY = "admin-api-key-0123456789abcdef-xyz";
const VALID_SIGNING_SECRET = "app-signing-secret-0123456789abcdef";

const VALID_SOURCE = {
	ADMIN_API_KEY: VALID_ADMIN_API_KEY,
	ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXP",
	APP_SIGNING_SECRET: VALID_SIGNING_SECRET,
	DATABASE_URL: "postgresql://user:password@localhost:5432/mariana",
	GEMINI_API_KEY: "gemini-api-key",
	GOOGLE_ACCOUNT_EMAIL: "consultant@example.com",
	GOOGLE_ADS_WEBHOOK_KEY: "google-ads-webhook-key",
	GOOGLE_CLIENT_ID: "google-client-id",
	GOOGLE_CLIENT_SECRET: "google-client-secret",
	GOOGLE_REDIRECT_URI: "https://example.com/auth/google/callback",
	META_ADS_APP_SECRET: "meta-ads-app-secret",
	META_ADS_GRAPH_API_VERSION: "v23.0",
	META_ADS_VERIFY_TOKEN: "meta-ads-verify-token",
	WHATSAPP_ACCESS_TOKEN: "whatsapp-access-token",
	WHATSAPP_APP_SECRET: "whatsapp-app-secret",
	WHATSAPP_GRAPH_API_VERSION: "v23.0",
	WHATSAPP_PHONE_NUMBER_ID: "whatsapp-phone-number-id",
	WHATSAPP_VERIFY_TOKEN: "whatsapp-verify-token",
	WHATSAPP_WABA_ID: "whatsapp-waba-id",
} as NodeJS.ProcessEnv;

test("parseEnv aceita uma configuração válida e aplica os defaults", () => {
	const parsed = parseEnv(VALID_SOURCE);

	assert.equal(parsed.NODE_ENV, "development");
	assert.equal(parsed.PORT, 3252);
	assert.equal(parsed.MESSAGE_DEBOUNCE_MS, 15_000);
	assert.equal(parsed.SCHEDULE_CONFIRMATION_MINUTES, 60);
	assert.equal(parsed.WHATSAPP_SEND_TIMEOUT_MS, 15_000);
	assert.equal(
		parsed.DATABASE_URL,
		"postgresql://user:password@localhost:5432/mariana"
	);
});

test("parseEnv lança erro acionável quando uma variável obrigatória está ausente", () => {
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, GEMINI_API_KEY: undefined }),
		MISSING_GEMINI_ERROR
	);
});

test("parseEnv recusa ADMIN_TOTP_SECRET ausente", () => {
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, ADMIN_TOTP_SECRET: undefined }),
		ADMIN_TOTP_SECRET_ERROR
	);
});

test("parseEnv rejeita DATABASE_URL que não seja postgresql://", () => {
	assert.throws(
		() =>
			parseEnv({
				...VALID_SOURCE,
				DATABASE_URL: "mysql://user:password@localhost:3306/mariana",
			}),
		NON_POSTGRES_DATABASE_URL_ERROR
	);
});

test("parseEnv rejeita SCHEDULE_CONFIRMATION_MINUTES fora do intervalo permitido", () => {
	assert.throws(
		() =>
			parseEnv({
				...VALID_SOURCE,
				SCHEDULE_CONFIRMATION_MINUTES: "10",
			}),
		SCHEDULE_CONFIRMATION_ERROR
	);
});

test("envSchema não marca META_ADS_ACCESS_TOKEN como obrigatório", () => {
	assert.equal(Object.hasOwn(envSchema.shape, "META_ADS_ACCESS_TOKEN"), false);
});

test("parseEnv aceita WHATSAPP_SEND_TIMEOUT_MS configurado", () => {
	assert.equal(
		parseEnv({ ...VALID_SOURCE, WHATSAPP_SEND_TIMEOUT_MS: "20000" })
			.WHATSAPP_SEND_TIMEOUT_MS,
		20_000
	);
});

test("parseEnv rejeita WHATSAPP_SEND_TIMEOUT_MS fora do intervalo seguro", () => {
	// Precisa ficar bem abaixo do lease de 60s do outbox.
	for (const value of ["0", "500", "45001", "60000"]) {
		assert.throws(
			() => parseEnv({ ...VALID_SOURCE, WHATSAPP_SEND_TIMEOUT_MS: value }),
			WHATSAPP_SEND_TIMEOUT_ERROR,
			value
		);
	}
});

test("parseEnv rejeita WHATSAPP_SEND_TIMEOUT_MS não numérico em vez de usar o default", () => {
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, WHATSAPP_SEND_TIMEOUT_MS: "20s" }),
		WHATSAPP_SEND_TIMEOUT_ERROR
	);
});

test("parseEnv aplica os defaults do Gemini", () => {
	const parsed = parseEnv(VALID_SOURCE);

	assert.equal(parsed.GEMINI_MODEL, "gemini-3.5-flash-lite");
	assert.equal(parsed.GEMINI_TEMPERATURE, 0.3);
	assert.equal(parsed.GEMINI_THINKING_LEVEL, "LOW");
	assert.equal(parsed.GEMINI_MAX_OUTPUT_TOKENS, 1024);
});

test("parseEnv recusa um nome de modelo fora do formato", () => {
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, GEMINI_MODEL: "gpt-4o" }),
		GEMINI_MODEL_ERROR
	);
});

test("parseEnv recusa temperatura e nível de raciocínio inválidos", () => {
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, GEMINI_TEMPERATURE: "3" }),
		GEMINI_TEMPERATURE_ERROR
	);
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, GEMINI_THINKING_LEVEL: "ULTRA" }),
		GEMINI_THINKING_LEVEL_ERROR
	);
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, GEMINI_MAX_OUTPUT_TOKENS: "10" }),
		GEMINI_MAX_OUTPUT_TOKENS_ERROR
	);
});

test("parseEnv não transforma uma GEMINI_TEMPERATURE em branco em zero", () => {
	// `Number("   ") === 0`, que passa por `min(0)`: sem trim, um valor em
	// branco viraria temperatura 0 — nem o valor pedido nem o default
	// aprovado, e sem nenhum log.
	for (const blank of ["   ", "\t", " \n "]) {
		assert.equal(
			parseEnv({ ...VALID_SOURCE, GEMINI_TEMPERATURE: blank })
				.GEMINI_TEMPERATURE,
			0.3,
			blank
		);
	}
});

test("parseEnv recusa as outras três variáveis do Gemini em branco", () => {
	// Confirma, em vez de presumir, que o buraco do `Number("   ")` não
	// alcança as outras três: duas são texto, e `0` falha `min(128)`.
	const cases = [
		["GEMINI_MODEL", GEMINI_MODEL_ERROR],
		["GEMINI_THINKING_LEVEL", GEMINI_THINKING_LEVEL_ERROR],
		["GEMINI_MAX_OUTPUT_TOKENS", GEMINI_MAX_OUTPUT_TOKENS_ERROR],
	] as const;

	for (const [name, expected] of cases) {
		assert.throws(
			() => parseEnv({ ...VALID_SOURCE, [name]: "   " }),
			expected,
			name
		);
	}
});

test("parseEnv recusa ADMIN_API_KEY ausente", () => {
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, ADMIN_API_KEY: undefined }),
		ADMIN_API_KEY_ERROR
	);
});

test("parseEnv recusa ADMIN_API_KEY com 31 caracteres", () => {
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, ADMIN_API_KEY: "a".repeat(31) }),
		ADMIN_API_KEY_ERROR
	);
});

test("parseEnv recusa APP_SIGNING_SECRET ausente ou curto", () => {
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, APP_SIGNING_SECRET: undefined }),
		APP_SIGNING_SECRET_ERROR
	);
	assert.throws(
		() => parseEnv({ ...VALID_SOURCE, APP_SIGNING_SECRET: "s".repeat(31) }),
		APP_SIGNING_SECRET_ERROR
	);
});

test("parseEnv recusa APP_SIGNING_SECRET igual a ADMIN_API_KEY", () => {
	assert.throws(
		() =>
			parseEnv({ ...VALID_SOURCE, APP_SIGNING_SECRET: VALID_ADMIN_API_KEY }),
		APP_SIGNING_SECRET_ERROR
	);
});

test("parseEnv aceita as chaves de segurança e TRUST_PROXY_HOPS = 0 por padrão", () => {
	const parsed = parseEnv(VALID_SOURCE);

	assert.equal(parsed.ADMIN_API_KEY, VALID_ADMIN_API_KEY);
	assert.equal(parsed.APP_SIGNING_SECRET, VALID_SIGNING_SECRET);
	assert.equal(parsed.TRUST_PROXY_HOPS, 0);
});

test("parseEnv aceita TRUST_PROXY_HOPS inteiro >= 0 e recusa o resto", () => {
	assert.equal(
		parseEnv({ ...VALID_SOURCE, TRUST_PROXY_HOPS: "1" }).TRUST_PROXY_HOPS,
		1
	);
	for (const value of ["-1", "1.5", "abc"]) {
		assert.throws(
			() => parseEnv({ ...VALID_SOURCE, TRUST_PROXY_HOPS: value }),
			TRUST_PROXY_HOPS_ERROR,
			value
		);
	}
});

test("parseEnv recusa ADMIN_API_KEY e APP_SIGNING_SECRET com espaço em branco", () => {
	// A chave nunca casaria com o Bearer (`[^\s]+`): o admin ficaria trancado.
	const padded = "k".repeat(40);
	for (const value of [
		" ".repeat(40),
		`${padded} `,
		` ${padded}`,
		`${"k".repeat(20)} ${"k".repeat(20)}`,
		`${padded}\t`,
		`${padded}\n`,
	]) {
		assert.throws(
			() => parseEnv({ ...VALID_SOURCE, ADMIN_API_KEY: value }),
			ADMIN_API_KEY_ERROR,
			JSON.stringify(value)
		);
		assert.throws(
			() => parseEnv({ ...VALID_SOURCE, APP_SIGNING_SECRET: value }),
			APP_SIGNING_SECRET_ERROR,
			JSON.stringify(value)
		);
	}
});

const GOOGLE_REDIRECT_URI_ERROR = /GOOGLE_REDIRECT_URI/;

test("parseEnv recusa GOOGLE_REDIRECT_URI inválida", () => {
	for (const [nodeEnv, value] of [
		["development", "not-a-url"],
		["development", "https://example.com/auth/google"],
		["development", "https://example.com/auth/google/callback/x"],
		["development", "ftp://localhost/auth/google/callback"],
		["development", "http://example.com/auth/google/callback"],
		["production", "http://example.com/auth/google/callback"],
		["production", "http://localhost/auth/google/callback"],
	] as const) {
		assert.throws(
			() =>
				parseEnv({
					...VALID_SOURCE,
					GOOGLE_REDIRECT_URI: value,
					NODE_ENV: nodeEnv,
				}),
			GOOGLE_REDIRECT_URI_ERROR,
			`${nodeEnv} ${value}`
		);
	}
});

test("parseEnv aceita GOOGLE_REDIRECT_URI https (ngrok) e http://localhost fora de produção", () => {
	for (const [nodeEnv, value] of [
		["production", "https://abc-123.ngrok-free.app/auth/google/callback"],
		["development", "https://abc-123.ngrok-free.app/auth/google/callback"],
		["development", "http://localhost:3252/auth/google/callback"],
		["test", "http://127.0.0.1:3252/auth/google/callback"],
	] as const) {
		const parsed = parseEnv({
			...VALID_SOURCE,
			GOOGLE_REDIRECT_URI: value,
			NODE_ENV: nodeEnv,
		});
		assert.equal(parsed.GOOGLE_REDIRECT_URI, value);
	}
});

test("MARIANA_FLOW defaults to v1 and rejects other values", () => {
	assert.equal(parseEnv(VALID_SOURCE).MARIANA_FLOW, "v1");
	assert.equal(
		parseEnv({ ...VALID_SOURCE, MARIANA_FLOW: "v2" }).MARIANA_FLOW,
		"v2"
	);
	for (const invalid of ["v3", "V2", " v2", "true"]) {
		assert.throws(
			() => parseEnv({ ...VALID_SOURCE, MARIANA_FLOW: invalid }),
			MARIANA_FLOW_ERROR
		);
	}
});

test("MARIANA_HISTORY_MESSAGES defaults to 10 and accepts only integers 1-30", () => {
	assert.equal(parseEnv(VALID_SOURCE).MARIANA_HISTORY_MESSAGES, 10);
	assert.equal(
		parseEnv({ ...VALID_SOURCE, MARIANA_HISTORY_MESSAGES: "30" })
			.MARIANA_HISTORY_MESSAGES,
		30
	);
	for (const invalid of ["0", "31", "2.5", "dez"]) {
		assert.throws(
			() => parseEnv({ ...VALID_SOURCE, MARIANA_HISTORY_MESSAGES: invalid }),
			MARIANA_HISTORY_MESSAGES_ERROR
		);
	}
});

test("MARIANA_UNDERSTAND_TIMEOUT_MS defaults to 20000 and accepts only 1000-45000", () => {
	assert.equal(parseEnv(VALID_SOURCE).MARIANA_UNDERSTAND_TIMEOUT_MS, 20_000);
	assert.equal(
		parseEnv({ ...VALID_SOURCE, MARIANA_UNDERSTAND_TIMEOUT_MS: "5000" })
			.MARIANA_UNDERSTAND_TIMEOUT_MS,
		5000
	);
	for (const invalid of ["999", "45001", "1.5", "rápido"]) {
		assert.throws(
			() =>
				parseEnv({ ...VALID_SOURCE, MARIANA_UNDERSTAND_TIMEOUT_MS: invalid }),
			MARIANA_UNDERSTAND_TIMEOUT_ERROR
		);
	}
});
