/**
 * OAuth do Google Calendar com banco: link de conexão de admin e callback.
 * `googleOAuth2Client.getToken` é mockado; nenhuma chamada real ao Google.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import test from "node:test";

import { eq } from "drizzle-orm";

import { buildApp } from "../../app";
import { closeDatabase, db } from "../../db/connections";
import { consultants, googleCalendarConnections } from "../../db/schema";
import { env } from "../../env";
import { googleOAuth2Client } from "../../integrations/google-calendar/oauth";
import { baseLoggerOptions } from "../../lib/logger";
import { createGoogleConnectTicket } from "../../routes/google-calendar/auth-google";

const CLEARED_COOKIE =
	/^gcal_oauth_nonce=; Path=\/auth\/google\/callback; Max-Age=0;/;
const ADMIN = { authorization: `Bearer ${env.ADMIN_API_KEY}` };

test.after(async () => {
	await closeDatabase();
});

async function createConsultant() {
	const suffix = randomUUID();
	const [consultant] = await db
		.insert(consultants)
		.values({
			calendarId: `oauth-${suffix}@calendar.test`,
			email: `oauth-${suffix}@example.test`,
			name: "Consultor OAuth",
		})
		.returning();
	assert.ok(consultant);
	return consultant;
}

async function deleteConsultant(id: string) {
	await db
		.delete(googleCalendarConnections)
		.where(eq(googleCalendarConnections.consultantId, id));
	await db.delete(consultants).where(eq(consultants.id, id));
}

test("connect-link: valid key + unknown consultant → 404", async (t) => {
	const app = buildApp({ logger: false });
	t.after(() => app.close());

	const response = await app.inject({
		headers: ADMIN,
		method: "POST",
		payload: { consultantId: randomUUID() },
		url: "/admin/google-calendar/connect-link",
	});

	assert.equal(response.statusCode, 404);
	assert.deepEqual(response.json(), { error: "consultant_not_found" });
});

test("connect-link: valid → URL with a ticket and no key; the URL starts the OAuth once", async (t) => {
	const app = buildApp({ logger: false });
	const consultant = await createConsultant();
	t.after(async () => {
		await app.close();
		await deleteConsultant(consultant.id);
	});

	const response = await app.inject({
		headers: ADMIN,
		method: "POST",
		payload: { consultantId: consultant.id },
		url: "/admin/google-calendar/connect-link",
	});

	assert.equal(response.statusCode, 200);
	const body = response.json() as { expiresAt: string; url: string };
	const url = new URL(body.url);
	assert.equal(url.pathname, "/auth/google");
	assert.equal(url.origin, new URL(env.GOOGLE_REDIRECT_URI).origin);
	assert.ok(url.searchParams.get("ticket"));
	assert.ok(!body.url.includes(env.ADMIN_API_KEY));
	assert.ok(
		!body.url.includes(consultant.id),
		"consultantId only inside the signed ticket"
	);
	const ttl = Date.parse(body.expiresAt) - Date.now();
	assert.ok(ttl > 9 * 60 * 1000 && ttl <= 10 * 60 * 1000, String(ttl));

	const start = await app.inject({
		method: "GET",
		url: `${url.pathname}${url.search}`,
	});
	assert.equal(start.statusCode, 302);
	const again = await app.inject({
		method: "GET",
		url: `${url.pathname}${url.search}`,
	});
	assert.equal(again.statusCode, 400);
});

type App = ReturnType<typeof buildApp>;

/** Faz o passo do navegador: ticket → redirect com state + cookie. */
async function startOAuth(app: App, consultantId: string) {
	const { token } = createGoogleConnectTicket(consultantId);
	const start = await app.inject({
		method: "GET",
		url: `/auth/google?ticket=${encodeURIComponent(token)}`,
	});
	assert.equal(start.statusCode, 302);
	const state = new URL(String(start.headers.location)).searchParams.get(
		"state"
	);
	assert.ok(state);
	const [cookie] = String(start.headers["set-cookie"]).split(";");
	assert.ok(cookie);
	return {
		headers: { cookie },
		method: "GET" as const,
		url: `/auth/google/callback?code=fake-code&state=${encodeURIComponent(state)}`,
	};
}

test("callback: valid state + cookie → 200, one connection row, cookie cleared; replay → 400", async (t) => {
	const app = buildApp({ logger: false });
	const consultant = await createConsultant();
	t.after(async () => {
		await app.close();
		await deleteConsultant(consultant.id);
	});
	const getToken = t.mock.method(googleOAuth2Client, "getToken", async () => ({
		res: null,
		tokens: { access_token: "fake-access", refresh_token: "fake-refresh" },
	}));
	const setCredentials = t.mock.method(googleOAuth2Client, "setCredentials");

	const callback = await startOAuth(app, consultant.id);
	const response = await app.inject(callback);

	assert.equal(response.statusCode, 200, response.body);
	assert.equal(response.json().success, true);
	assert.match(String(response.headers["set-cookie"]), CLEARED_COOKIE);
	const rows = await db
		.select()
		.from(googleCalendarConnections)
		.where(eq(googleCalendarConnections.consultantId, consultant.id));
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.refreshToken, "fake-refresh");
	assert.equal(getToken.mock.callCount(), 1);
	assert.equal(
		setCredentials.mock.callCount(),
		0,
		"no tokens kept on the shared OAuth client"
	);

	const replay = await app.inject(callback);
	assert.equal(replay.statusCode, 400);
	assert.equal(
		getToken.mock.callCount(),
		1,
		"replayed state never reaches Google"
	);
});

test("callback: a Google error is logged with safe fields only", async (t) => {
	const lines: string[] = [];
	const app = buildApp({
		logger: {
			...baseLoggerOptions,
			stream: new Writable({
				write(chunk, _encoding, callback) {
					lines.push(chunk.toString());
					callback();
				},
			}),
		},
	});
	const consultant = await createConsultant();
	t.after(async () => {
		await app.close();
		await deleteConsultant(consultant.id);
	});
	t.mock.method(googleOAuth2Client, "getToken", () => {
		const error = new Error("invalid_grant SECRET-REFRESH-abc123") as Error & {
			code?: string;
			config?: unknown;
		};
		error.code = "400";
		error.config = { data: "client_secret=SECRET-CLIENT-xyz" };
		return Promise.reject(error);
	});

	const response = await app.inject(await startOAuth(app, consultant.id));

	assert.equal(response.statusCode, 500);
	const log = lines.join("");
	assert.ok(log.includes("google_oauth_callback_failed"));
	assert.ok(!log.includes("SECRET-REFRESH"), "raw error message leaked");
	assert.ok(!log.includes("SECRET-CLIENT"), "request config leaked");
});
