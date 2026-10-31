/** biome-ignore-all lint/performance/noAwaitInLoops: requests must run in order (one-time ticket, failure limiter). */
/**
 * Início do OAuth do Google Calendar (sem banco): `GET /auth/google` só
 * aceita um ticket assinado, de curta duração e de uso único, emitido pela
 * rota de admin `POST /admin/google-calendar/connect-link`.
 */
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { buildApp } from "../../app";
import { closeDatabase } from "../../db/connections";
import { env } from "../../env";
import { baseLoggerOptions } from "../../lib/logger";
import {
	deriveSigningKey,
	signToken,
	verifyToken,
} from "../../lib/security/signed-token";
import {
	createGoogleConnectTicket,
	GCAL_CONNECT_PURPOSE,
	GCAL_STATE_PURPOSE,
} from "../../routes/google-calendar/auth-google";

const CONSULTANT_ID = "00000000-0000-4000-8000-0000000000aa";
const COOKIE_NAME_VALUE = /^gcal_oauth_nonce=[A-Za-z0-9_-]+;/;
const HTTP_ONLY = /HttpOnly/;
const SAME_SITE_LAX = /SameSite=Lax/;
const CALLBACK_PATH = /Path=\/auth\/google\/callback/;
const MAX_AGE_600 = /Max-Age=600/;
const CLEARED_COOKIE =
	/^gcal_oauth_nonce=; Path=\/auth\/google\/callback; Max-Age=0;/;
const ELEVEN_MINUTES_MS = 11 * 60 * 1000;

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

function startUrl(ticket: string) {
	return `/auth/google?ticket=${encodeURIComponent(ticket)}`;
}

test("signed token: valid round trip; tampered, expired and wrong purpose are rejected", () => {
	const key = deriveSigningKey(env.APP_SIGNING_SECRET, GCAL_CONNECT_PURPOSE);
	const now = 1_000_000;
	const { token } = signToken(
		key,
		GCAL_CONNECT_PURPOSE,
		{ consultantId: "c" },
		{
			now: () => now,
			ttlMs: 60_000,
		}
	);

	const ok = verifyToken(token, key, GCAL_CONNECT_PURPOSE, () => now + 1000);
	assert.equal(ok?.consultantId, "c");

	const [body, signature] = token.split(".") as [string, string];
	const flipped = `${body}.${signature.slice(0, -2)}${signature.endsWith("AA") ? "BB" : "AA"}`;
	assert.equal(
		verifyToken(flipped, key, GCAL_CONNECT_PURPOSE, () => now),
		null
	);
	assert.equal(
		verifyToken(`${body}x.${signature}`, key, GCAL_CONNECT_PURPOSE, () => now),
		null
	);
	assert.equal(
		verifyToken(token, key, GCAL_CONNECT_PURPOSE, () => now + 61_000),
		null
	);
	assert.equal(
		verifyToken(token, key, GCAL_STATE_PURPOSE, () => now),
		null
	);
	const otherKey = deriveSigningKey(env.APP_SIGNING_SECRET, GCAL_STATE_PURPOSE);
	assert.equal(
		verifyToken(token, otherKey, GCAL_CONNECT_PURPOSE, () => now),
		null
	);
	for (const garbage of ["", ".", "a.b.c", "%%%.###", "x".repeat(10_000)]) {
		assert.equal(
			verifyToken(garbage, key, GCAL_CONNECT_PURPOSE, () => now),
			null
		);
	}
});

test("POST /admin/google-calendar/connect-link without key → 401", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const response = await app.inject({
		method: "POST",
		payload: { consultantId: CONSULTANT_ID },
		url: "/admin/google-calendar/connect-link",
	});

	assert.equal(response.statusCode, 401);
});

test("GET /auth/google?consultantId=x (old open link) → 400, no redirect", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const response = await app.inject({
		method: "GET",
		url: `/auth/google?consultantId=${CONSULTANT_ID}`,
	});

	assert.equal(response.statusCode, 400);
	assert.equal(response.headers.location, undefined);
	assert.equal(response.headers["set-cookie"], undefined);
});

test("tampered / expired / wrong-purpose / reused ticket → 400, no redirect", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const valid = createGoogleConnectTicket(CONSULTANT_ID).token;
	const [body, signature] = valid.split(".") as [string, string];
	const tampered = `${body}.${signature.slice(0, -2)}${signature.endsWith("AA") ? "BB" : "AA"}`;
	const expired = createGoogleConnectTicket(CONSULTANT_ID, {
		now: () => Date.now() - ELEVEN_MINUTES_MS,
	}).token;
	const wrongPurpose = signToken(
		deriveSigningKey(env.APP_SIGNING_SECRET, GCAL_CONNECT_PURPOSE),
		GCAL_STATE_PURPOSE,
		{ consultantId: CONSULTANT_ID },
		{ ttlMs: 60_000 }
	).token;

	for (const ticket of [tampered, expired, wrongPurpose]) {
		const response = await app.inject({ method: "GET", url: startUrl(ticket) });
		assert.equal(response.statusCode, 400, ticket);
		assert.equal(response.headers.location, undefined);
	}

	const first = await app.inject({ method: "GET", url: startUrl(valid) });
	assert.equal(first.statusCode, 302);
	const reused = await app.inject({ method: "GET", url: startUrl(valid) });
	assert.equal(reused.statusCode, 400);
	assert.equal(reused.headers.location, undefined);
});

test("valid ticket → 302 to accounts.google.com with a signed state and a bound HttpOnly cookie", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const { token } = createGoogleConnectTicket(CONSULTANT_ID);
	const response = await app.inject({ method: "GET", url: startUrl(token) });

	assert.equal(response.statusCode, 302);
	const location = new URL(String(response.headers.location));
	assert.equal(location.hostname, "accounts.google.com");
	const state = location.searchParams.get("state");
	assert.ok(state);
	assert.ok(
		!location.toString().includes(token),
		"ticket must not reach Google"
	);
	assert.ok(!location.toString().includes(env.ADMIN_API_KEY));

	const cookie = String(response.headers["set-cookie"]);
	assert.match(cookie, COOKIE_NAME_VALUE);
	assert.match(cookie, HTTP_ONLY);
	assert.match(cookie, SAME_SITE_LAX);
	assert.match(cookie, CALLBACK_PATH);
	assert.match(cookie, MAX_AGE_600);

	const statePayload = verifyToken(
		state,
		deriveSigningKey(env.APP_SIGNING_SECRET, GCAL_STATE_PURPOSE),
		GCAL_STATE_PURPOSE
	);
	assert.equal(statePayload?.consultantId, CONSULTANT_ID);
	const cookieNonce = cookie.slice(
		"gcal_oauth_nonce=".length,
		cookie.indexOf(";")
	);
	assert.equal(statePayload?.nonce, cookieNonce);
});

test("the ticket value never appears in the logs", async (t) => {
	const lines: string[] = [];
	const app = buildTestApp(lines);
	t.after(() => app.close());

	const { token } = createGoogleConnectTicket(CONSULTANT_ID);
	const response = await app.inject({ method: "GET", url: startUrl(token) });
	assert.equal(response.statusCode, 302);
	const tampered = `${token}x`;
	await app.inject({ method: "GET", url: startUrl(tampered) });

	const log = lines.join("");
	assert.ok(
		log.includes("ticket=%5BRedacted%5D"),
		"redacted ticket in the URL log"
	);
	const [body, signature] = token.split(".") as [string, string];
	assert.ok(!log.includes(body), "ticket payload leaked");
	assert.ok(!log.includes(signature), "ticket signature leaked");
});

test("bad tickets count as auth failures: the 11th from one IP → 429", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());
	const remoteAddress = "203.0.113.77";

	for (let i = 0; i < 10; i += 1) {
		const response = await app.inject({
			method: "GET",
			remoteAddress,
			url: startUrl("bad.ticket"),
		});
		assert.equal(response.statusCode, 400);
	}
	const locked = await app.inject({
		method: "GET",
		remoteAddress,
		url: startUrl(createGoogleConnectTicket(CONSULTANT_ID).token),
	});
	assert.equal(locked.statusCode, 429);
	assert.ok(locked.headers["retry-after"]);
});

// ---- Step 6: callback (state + cookie), sem banco ----

const STATE_KEY = () =>
	deriveSigningKey(env.APP_SIGNING_SECRET, GCAL_STATE_PURPOSE);

function callbackRequest(state: string, cookieNonce?: string) {
	return {
		headers:
			cookieNonce === undefined
				? {}
				: { cookie: `other=1; gcal_oauth_nonce=${cookieNonce}` },
		method: "GET" as const,
		url: `/auth/google/callback?code=fake-code&state=${encodeURIComponent(state)}`,
	};
}

function assertRejected(response: { statusCode: number; body: string }) {
	assert.equal(response.statusCode, 400);
	assert.deepEqual(JSON.parse(response.body), {
		message: "State OAuth inválido.",
		success: false,
	});
}

test("callback: expired / tampered / wrong-purpose state → 400 before any DB access", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const expiredToken = signToken(
		STATE_KEY(),
		GCAL_STATE_PURPOSE,
		{ consultantId: CONSULTANT_ID },
		{ now: () => Date.now() - ELEVEN_MINUTES_MS, ttlMs: 10 * 60 * 1000 }
	);
	const valid = signToken(
		STATE_KEY(),
		GCAL_STATE_PURPOSE,
		{ consultantId: CONSULTANT_ID },
		{ ttlMs: 10 * 60 * 1000 }
	);
	const [body, signature] = valid.token.split(".") as [string, string];
	const tampered = `${body}.${signature.slice(0, -2)}${signature.endsWith("AA") ? "BB" : "AA"}`;
	const ticketAsState = createGoogleConnectTicket(CONSULTANT_ID);

	assertRejected(
		await app.inject(
			callbackRequest(expiredToken.token, expiredToken.payload.nonce)
		)
	);
	assertRejected(
		await app.inject(callbackRequest(tampered, valid.payload.nonce))
	);
	assertRejected(
		await app.inject(
			callbackRequest(ticketAsState.token, ticketAsState.payload.nonce)
		)
	);
});

test("callback: missing or mismatched browser cookie → 400 (login-CSRF)", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const { payload, token } = signToken(
		STATE_KEY(),
		GCAL_STATE_PURPOSE,
		{ consultantId: CONSULTANT_ID },
		{ ttlMs: 10 * 60 * 1000 }
	);

	assertRejected(await app.inject(callbackRequest(token)));
	assertRejected(await app.inject(callbackRequest(token, "")));
	assertRejected(await app.inject(callbackRequest(token, `${payload.nonce}x`)));
	assertRejected(
		await app.inject(callbackRequest(token, payload.nonce.slice(0, -1)))
	);
});

test("callback: ?error=<script> → fixed body, no echo, cookie cleared", async (t) => {
	const lines: string[] = [];
	const app = buildTestApp(lines);
	t.after(() => app.close());

	const evil = "<script>alert('x')</script>";
	const response = await app.inject({
		method: "GET",
		url: `/auth/google/callback?error=${encodeURIComponent(evil)}`,
	});

	assert.equal(response.statusCode, 400);
	assert.deepEqual(response.json(), {
		message: "Autorização Google recusada.",
		success: false,
	});
	assert.ok(!response.body.includes("script"));
	assert.match(String(response.headers["set-cookie"]), CLEARED_COOKIE);
});
