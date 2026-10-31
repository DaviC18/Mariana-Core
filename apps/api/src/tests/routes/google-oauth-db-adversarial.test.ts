/** biome-ignore-all lint/performance/noAwaitInLoops: requests must run in order. */
/**
 * Tester (api-auth, passos 5–6): callback do OAuth com banco. Os tokens só
 * são gravados para o consultor do ticket; um state de outro navegador não
 * queima o state legítimo; nenhum token ou code vaza na resposta ou no log.
 * `googleOAuth2Client.getToken` é mockado; nenhuma chamada real ao Google.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import test from "node:test";

import { eq, inArray } from "drizzle-orm";

import { buildApp } from "../../app";
import { closeDatabase, db } from "../../db/connections";
import { consultants, googleCalendarConnections } from "../../db/schema";
import { googleOAuth2Client } from "../../integrations/google-calendar/oauth";
import { baseLoggerOptions } from "../../lib/logger";
import { createGoogleConnectTicket } from "../../routes/google-calendar/auth-google";

type App = ReturnType<typeof buildApp>;

const CODE = "4/0AVG7-db-adversarial-auth-code";
const ACCESS = "ya29.db-adversarial-access-token";
const REFRESH = "1//db-adversarial-refresh-token";

test.after(async () => {
	await closeDatabase();
});

async function createConsultant() {
	const suffix = randomUUID();
	const [consultant] = await db
		.insert(consultants)
		.values({
			calendarId: `oauth-adv-${suffix}@calendar.test`,
			email: `oauth-adv-${suffix}@example.test`,
			name: `Consultor ${suffix.slice(0, 6)}`,
		})
		.returning();
	assert.ok(consultant);
	return consultant;
}

async function cleanup(ids: string[]) {
	await db
		.delete(googleCalendarConnections)
		.where(inArray(googleCalendarConnections.consultantId, ids));
	await db.delete(consultants).where(inArray(consultants.id, ids));
}

async function connectionsFor(id: string) {
	return await db
		.select()
		.from(googleCalendarConnections)
		.where(eq(googleCalendarConnections.consultantId, id));
}

async function start(app: App, consultantId: string) {
	const { token } = createGoogleConnectTicket(consultantId);
	const response = await app.inject({
		method: "GET",
		url: `/auth/google?ticket=${encodeURIComponent(token)}`,
	});
	assert.equal(response.statusCode, 302);
	const state = String(
		new URL(String(response.headers.location)).searchParams.get("state")
	);
	const cookie = String(String(response.headers["set-cookie"]).split(";")[0]);
	return { cookie, state };
}

function callback(state: string, cookie: string) {
	return {
		headers: { cookie },
		method: "GET" as const,
		url: `/auth/google/callback?code=${encodeURIComponent(CODE)}&state=${encodeURIComponent(state)}`,
	};
}

function mockTokens(t: test.TestContext, refresh: string | null = REFRESH) {
	return t.mock.method(googleOAuth2Client, "getToken", async () => ({
		res: null,
		tokens: { access_token: ACCESS, refresh_token: refresh },
	}));
}

test("tokens are written only for the consultant bound in the ticket", async (t) => {
	const app = buildApp({ logger: false });
	const a = await createConsultant();
	const b = await createConsultant();
	t.after(async () => {
		await app.close();
		await cleanup([a.id, b.id]);
	});
	mockTokens(t);

	const flowA = await start(app, a.id);
	const response = await app.inject(callback(flowA.state, flowA.cookie));
	assert.equal(response.statusCode, 200, response.body);

	assert.equal((await connectionsFor(a.id)).length, 1);
	assert.equal((await connectionsFor(b.id)).length, 0);
});

test("a state tried with another browser's cookie is refused and does not burn the legitimate state", async (t) => {
	const app = buildApp({ logger: false });
	const victim = await createConsultant();
	const attacker = await createConsultant();
	t.after(async () => {
		await app.close();
		await cleanup([victim.id, attacker.id]);
	});
	const getToken = mockTokens(t);

	const victimFlow = await start(app, victim.id);
	const attackerFlow = await start(app, attacker.id);

	// Login-CSRF: o state do atacante no navegador da vítima, e vice-versa.
	const crossA = await app.inject(
		callback(attackerFlow.state, victimFlow.cookie)
	);
	const crossB = await app.inject(
		callback(victimFlow.state, attackerFlow.cookie)
	);
	assert.equal(crossA.statusCode, 400);
	assert.equal(crossB.statusCode, 400);
	assert.equal(getToken.mock.callCount(), 0, "Google never called");
	assert.equal((await connectionsFor(victim.id)).length, 0);
	assert.equal((await connectionsFor(attacker.id)).length, 0);

	const legit = await app.inject(callback(victimFlow.state, victimFlow.cookie));
	assert.equal(legit.statusCode, 200, legit.body);
	assert.equal((await connectionsFor(victim.id)).length, 1);
	assert.equal((await connectionsFor(attacker.id)).length, 0);
});

test("callback success: no token or code in the body or the logs", async (t) => {
	const lines: string[] = [];
	const app = buildApp({
		logger: {
			...baseLoggerOptions,
			stream: new Writable({
				write(chunk, _encoding, cb) {
					lines.push(chunk.toString());
					cb();
				},
			}),
		},
	});
	const consultant = await createConsultant();
	t.after(async () => {
		await app.close();
		await cleanup([consultant.id]);
	});
	mockTokens(t);

	const flow = await start(app, consultant.id);
	const response = await app.inject(callback(flow.state, flow.cookie));
	assert.equal(response.statusCode, 200, response.body);

	const log = lines.join("");
	for (const secret of [
		CODE,
		ACCESS,
		REFRESH,
		flow.state.split(".")[1] ?? "",
	]) {
		assert.ok(!response.body.includes(secret), "leaked in body");
		assert.ok(!log.includes(secret), "leaked in log");
	}
});

test("no refresh_token → 400, no row written; consultant deleted after the ticket → 404, no row", async (t) => {
	const app = buildApp({ logger: false });
	const noRefresh = await createConsultant();
	const deleted = await createConsultant();
	t.after(async () => {
		await app.close();
		await cleanup([noRefresh.id, deleted.id]);
	});
	mockTokens(t, null);

	const flow1 = await start(app, noRefresh.id);
	const r1 = await app.inject(callback(flow1.state, flow1.cookie));
	assert.equal(r1.statusCode, 400);
	assert.equal((await connectionsFor(noRefresh.id)).length, 0);

	const flow2 = await start(app, deleted.id);
	await cleanup([deleted.id]);
	const r2 = await app.inject(callback(flow2.state, flow2.cookie));
	assert.equal(r2.statusCode, 404);
	assert.equal((await connectionsFor(deleted.id)).length, 0);
});

test("connect-link: body validation and admin key; consultantId never in the URL", async (t) => {
	const app = buildApp({ logger: false });
	t.after(() => app.close());
	const admin = { authorization: `Bearer ${process.env.ADMIN_API_KEY}` };

	for (const payload of [
		{},
		{ consultantId: "not-a-uuid" },
		{ consultantId: "' OR 1=1 --" },
		{ consultantId: 42 },
	]) {
		const response = await app.inject({
			headers: admin,
			method: "POST",
			payload,
			url: "/admin/google-calendar/connect-link",
		});
		assert.equal(response.statusCode, 400, JSON.stringify(payload));
	}
	const wrongKey = await app.inject({
		headers: { authorization: "Bearer x".padEnd(40, "x") },
		method: "POST",
		payload: { consultantId: randomUUID() },
		url: "/admin/google-calendar/connect-link",
	});
	assert.equal(wrongKey.statusCode, 401);
});
