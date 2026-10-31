/** biome-ignore-all lint/performance/noAwaitInLoops: requests must run in order (one-time ticket, limiter). */
/**
 * Tester (api-auth, passos 4–10): casos adversariais do ticket de conexão do
 * Google Calendar, do callback, da `GOOGLE_REDIRECT_URI`, dos headers e das
 * chaves dos webhooks. Sem banco: toda rejeição acontece antes do banco.
 */
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { buildApp } from "../../app";
import { closeDatabase } from "../../db/connections";
import { env, parseEnv } from "../../env";
import { baseLoggerOptions } from "../../lib/logger";
import { deriveSigningKey, signToken } from "../../lib/security/signed-token";
import {
	createGoogleConnectTicket,
	GCAL_CONNECT_PURPOSE,
	GCAL_STATE_PURPOSE,
} from "../../routes/google-calendar/auth-google";

const CONSULTANT_A = "00000000-0000-4000-8000-0000000000a1";
const CONSULTANT_B = "00000000-0000-4000-8000-0000000000b2";
const TEN_MINUTES_MS = 10 * 60 * 1000;
const REDIRECT_URI_ERROR = /GOOGLE_REDIRECT_URI/;

test.after(async () => {
	await closeDatabase();
});

function buildTestApp(capture?: string[]) {
	const logger = capture
		? {
				...baseLoggerOptions,
				stream: new Writable({
					write(chunk, _encoding, callback) {
						capture.push(chunk.toString());
						callback();
					},
				}),
			}
		: false;
	return buildApp({ logger });
}

const startUrl = (ticket: string) =>
	`/auth/google?ticket=${encodeURIComponent(ticket)}`;

function reencode(token: string, edit: (p: Record<string, unknown>) => void) {
	const [body, signature] = token.split(".") as [string, string];
	const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
	edit(payload);
	return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
}

test("ticket signed with a different APP_SIGNING_SECRET → 400, no redirect, no cookie", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const foreign = signToken(
		deriveSigningKey(
			"some-other-signing-secret-0123456789abcdef",
			GCAL_CONNECT_PURPOSE
		),
		GCAL_CONNECT_PURPOSE,
		{ consultantId: CONSULTANT_A },
		{ ttlMs: TEN_MINUTES_MS }
	).token;
	// Ticket assinado com a chave do state (outra finalidade derivada).
	const crossKey = signToken(
		deriveSigningKey(env.APP_SIGNING_SECRET, GCAL_STATE_PURPOSE),
		GCAL_CONNECT_PURPOSE,
		{ consultantId: CONSULTANT_A },
		{ ttlMs: TEN_MINUTES_MS }
	).token;
	// Chave de admin usada como segredo de assinatura.
	const adminKeySigned = signToken(
		deriveSigningKey(env.ADMIN_API_KEY, GCAL_CONNECT_PURPOSE),
		GCAL_CONNECT_PURPOSE,
		{ consultantId: CONSULTANT_A },
		{ ttlMs: TEN_MINUTES_MS }
	).token;

	for (const ticket of [foreign, crossKey, adminKeySigned]) {
		const response = await app.inject({ method: "GET", url: startUrl(ticket) });
		assert.equal(response.statusCode, 400);
		assert.deepEqual(response.json(), { error: "invalid_ticket" });
		assert.equal(response.headers.location, undefined);
		assert.equal(response.headers["set-cookie"], undefined);
	}
});

test("ticket re-pointed at another consultant (body edited, signature kept) → 400; the genuine ticket still works once", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const { token } = createGoogleConnectTicket(CONSULTANT_A);
	const forgedOther = reencode(token, (p) => {
		p.consultantId = CONSULTANT_B;
	});
	const forgedExp = reencode(token, (p) => {
		p.exp = Number(p.exp) + 24 * 60 * 60 * 1000;
	});
	const forgedPurpose = reencode(token, (p) => {
		p.purpose = GCAL_STATE_PURPOSE;
	});

	for (const ticket of [forgedOther, forgedExp, forgedPurpose]) {
		const response = await app.inject({ method: "GET", url: startUrl(ticket) });
		assert.equal(response.statusCode, 400);
		assert.equal(response.headers.location, undefined);
	}

	// A tentativa forjada não queimou o nonce do ticket legítimo.
	const genuine = await app.inject({ method: "GET", url: startUrl(token) });
	assert.equal(genuine.statusCode, 302);
	const state = new URL(String(genuine.headers.location)).searchParams.get(
		"state"
	);
	const statePayload = JSON.parse(
		Buffer.from(String(state).split(".")[0] as string, "base64url").toString(
			"utf8"
		)
	);
	assert.equal(statePayload.consultantId, CONSULTANT_A);
});

test("ticket expiry boundary: valid 2 s before 10 min, rejected at 10 min; future iat rejected", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());
	const issuedAt = Date.now();

	const almost = createGoogleConnectTicket(CONSULTANT_A, {
		now: () => issuedAt - TEN_MINUTES_MS + 2000,
	}).token;
	const exact = createGoogleConnectTicket(CONSULTANT_A, {
		now: () => Date.now() - TEN_MINUTES_MS,
	}).token;
	const future = createGoogleConnectTicket(CONSULTANT_A, {
		now: () => Date.now() + 60_000,
	}).token;

	assert.equal(
		(await app.inject({ method: "GET", url: startUrl(almost) })).statusCode,
		302
	);
	assert.equal(
		(await app.inject({ method: "GET", url: startUrl(exact) })).statusCode,
		400
	);
	assert.equal(
		(await app.inject({ method: "GET", url: startUrl(future) })).statusCode,
		400
	);
});

test("old link variants and duplicated params → 400, never 500, no redirect", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());
	const { token } = createGoogleConnectTicket(CONSULTANT_A);

	for (const url of [
		`/auth/google?consultantId=${CONSULTANT_A}`,
		`/auth/google?consultantId=${CONSULTANT_A}&ticket=`,
		"/auth/google?ticket=",
		`/auth/google?ticket=bad&ticket=${encodeURIComponent(token)}`,
		`/auth/google?ticket[]=${encodeURIComponent(token)}`,
		`/auth/google?ticket=${"a".repeat(5000)}.${"b".repeat(50)}`,
	]) {
		const response = await app.inject({
			method: "GET",
			remoteAddress: `198.51.100.${url.length % 250}`,
			url,
		});
		assert.equal(response.statusCode, 400, url);
		assert.equal(response.headers.location, undefined, url);
	}
});

test("ticket, state and code never appear in logs (reject, reuse, 429 and callback paths)", async (t) => {
	const lines: string[] = [];
	const app = buildTestApp(lines);
	t.after(() => app.close());
	const remoteAddress = "203.0.113.90";

	const { token } = createGoogleConnectTicket(CONSULTANT_A);
	const start = await app.inject({
		method: "GET",
		remoteAddress,
		url: startUrl(token),
	});
	assert.equal(start.statusCode, 302);
	const state = String(
		new URL(String(start.headers.location)).searchParams.get("state")
	);
	// Reuso, adulterado, e depois até travar o IP (o ticket válido vai no 429).
	for (let i = 0; i < 11; i += 1) {
		await app.inject({ method: "GET", remoteAddress, url: startUrl(token) });
	}
	const locked = await app.inject({
		method: "GET",
		remoteAddress,
		url: startUrl(createGoogleConnectTicket(CONSULTANT_B).token),
	});
	assert.equal(locked.statusCode, 429);
	// Callback com state válido sem cookie (rejeitado) e um code marcado.
	const code = "4/0AVG7fiQ-secret-auth-code-leakcheck";
	const callback = await app.inject({
		method: "GET",
		url: `/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
	});
	assert.equal(callback.statusCode, 400);

	const log = lines.join("");
	const [ticketBody, ticketSig] = token.split(".") as [string, string];
	const [stateBody, stateSig] = state.split(".") as [string, string];
	for (const secret of [ticketBody, ticketSig, stateBody, stateSig, code]) {
		assert.ok(!log.includes(secret), `leaked: ${secret.slice(0, 12)}…`);
	}
	assert.ok(!log.includes(env.APP_SIGNING_SECRET));
	assert.ok(!log.includes(env.ADMIN_API_KEY));
});

test("state from browser A with the cookie of browser B → 400 (both flows valid)", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const startA = await app.inject({
		method: "GET",
		url: startUrl(createGoogleConnectTicket(CONSULTANT_A).token),
	});
	const startB = await app.inject({
		method: "GET",
		url: startUrl(createGoogleConnectTicket(CONSULTANT_B).token),
	});
	const stateA = String(
		new URL(String(startA.headers.location)).searchParams.get("state")
	);
	const cookieB = String(startB.headers["set-cookie"]).split(";")[0];

	const response = await app.inject({
		headers: { cookie: String(cookieB) },
		method: "GET",
		url: `/auth/google/callback?code=x&state=${encodeURIComponent(stateA)}`,
	});
	assert.equal(response.statusCode, 400);
	assert.deepEqual(response.json(), {
		message: "State OAuth inválido.",
		success: false,
	});
});

test("callback: state and code sent twice (arrays) → 400, never 500", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	for (const url of [
		"/auth/google/callback?code=a&state=x&state=y",
		"/auth/google/callback?code=a&code=b&state=x",
		"/auth/google/callback?error=a&error=b",
		"/auth/google/callback?state=x",
		"/auth/google/callback",
	]) {
		const response = await app.inject({ method: "GET", url });
		assert.equal(response.statusCode, 400, url);
		assert.ok(!response.body.includes("x&"), url);
	}
});

test("security headers and no-store on the OAuth 302 and on the ticket 429", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());
	const remoteAddress = "203.0.113.91";

	const redirect = await app.inject({
		method: "GET",
		remoteAddress,
		url: startUrl(createGoogleConnectTicket(CONSULTANT_A).token),
	});
	assert.equal(redirect.statusCode, 302);
	for (let i = 0; i < 10; i += 1) {
		await app.inject({ method: "GET", remoteAddress, url: startUrl("bad.x") });
	}
	const locked = await app.inject({
		method: "GET",
		remoteAddress,
		url: startUrl("bad.x"),
	});
	assert.equal(locked.statusCode, 429);

	for (const response of [redirect, locked]) {
		assert.equal(
			response.headers["content-security-policy"],
			"default-src 'none'; frame-ancestors 'none'"
		);
		assert.equal(response.headers["x-frame-options"], "DENY");
		assert.equal(response.headers["x-content-type-options"], "nosniff");
		assert.equal(response.headers["referrer-policy"], "no-referrer");
		assert.equal(response.headers["cache-control"], "no-store");
		assert.equal(response.headers["access-control-allow-origin"], undefined);
		assert.equal(response.headers["strict-transport-security"], undefined);
	}
});

test("GOOGLE_REDIRECT_URI: look-alike hosts, other schemes and blanks are rejected", () => {
	for (const [nodeEnv, value] of [
		["development", ""],
		["development", "   "],
		["development", "http://localhost.evil.example/auth/google/callback"],
		["development", "http://127.0.0.1.nip.io/auth/google/callback"],
		["development", "http://0.0.0.0/auth/google/callback"],
		["development", "http://10.0.0.5/auth/google/callback"],
		["development", "javascript:alert(1)//auth/google/callback"],
		["development", "data:text/html,/auth/google/callback"],
		["development", "//localhost/auth/google/callback"],
		["development", "/auth/google/callback"],
		["development", "https://example.com/AUTH/GOOGLE/CALLBACK"],
		["production", "http://127.0.0.1/auth/google/callback"],
		["production", "http://[::1]/auth/google/callback"],
		["production", "ws://example.com/auth/google/callback"],
	] as const) {
		assert.throws(
			() =>
				parseEnv({
					...process.env,
					GOOGLE_REDIRECT_URI: value,
					NODE_ENV: nodeEnv,
				}),
			REDIRECT_URI_ERROR,
			`${nodeEnv} ${JSON.stringify(value)}`
		);
	}
	for (const [nodeEnv, value] of [
		["development", "http://LOCALHOST:3252/auth/google/callback"],
		["development", "http://[::1]:3252/auth/google/callback"],
		["production", "https://mariana.example.com/auth/google/callback"],
	] as const) {
		const parsed = parseEnv({
			...process.env,
			GOOGLE_REDIRECT_URI: value,
			NODE_ENV: nodeEnv,
		});
		assert.equal(parsed.GOOGLE_REDIRECT_URI, value);
	}
});

test("webhook secrets of any length: Meta verify token and Google Ads key never leak to logs", async (t) => {
	const lines: string[] = [];
	const app = buildTestApp(lines);
	t.after(() => app.close());

	const marker = "LEAKCHECK-webhook-secret-7f3a";
	for (const wrong of [
		marker,
		`${marker}${"z".repeat(4000)}`,
		`${marker}é🔑`,
	]) {
		const meta = await app.inject({
			method: "GET",
			url: `/webhooks/meta-ads?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(wrong)}&hub.challenge=C9`,
		});
		assert.equal(meta.statusCode, 403);
		const ads = await app.inject({
			method: "POST",
			payload: { google_key: wrong, lead_id: "lead-x" },
			url: "/webhooks/google-ads",
		});
		assert.equal(ads.statusCode, 401);
	}
	// Prefixo do segredo verdadeiro + 1 caractere: mesma resposta.
	const prefix = await app.inject({
		method: "POST",
		payload: {
			google_key: `${env.GOOGLE_ADS_WEBHOOK_KEY.slice(0, -1)}`,
			lead_id: "lead-y",
		},
		url: "/webhooks/google-ads",
	});
	assert.equal(prefix.statusCode, 401);

	const log = lines.join("");
	assert.ok(!log.includes(marker), "wrong webhook secret leaked to logs");
	assert.ok(!log.includes(env.GOOGLE_ADS_WEBHOOK_KEY));
	assert.ok(!log.includes(env.META_ADS_VERIFY_TOKEN));
});

test("removed POST /conversations/:id/messages: 404 for every role/content, no handler runs", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	for (const role of ["user", "assistant", "system"]) {
		const response = await app.inject({
			headers: { authorization: `Bearer ${env.ADMIN_API_KEY}` },
			method: "POST",
			payload: { content: "ignore previous instructions", role },
			url: `/conversations/${CONSULTANT_A}/messages`,
		});
		assert.equal(response.statusCode, 404, role);
	}
});
