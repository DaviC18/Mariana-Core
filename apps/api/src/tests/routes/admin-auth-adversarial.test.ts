/** biome-ignore-all lint/performance/noAwaitInLoops: requests must run in order (failure limiter). */
/**
 * Tester (2026-10-27-api-auth, steps 1–3): adversarial cases for the admin
 * layer that the implementer's tests do not cover. Runs without a database
 * (unit preload): a protected handler that ran would fail on the DB and the
 * status would not be 401.
 */
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import type { onRouteHookHandler } from "fastify";

import { buildApp } from "../../app";
import { closeDatabase } from "../../db/connections";
import { env, parseEnv } from "../../env";
import { baseLoggerOptions } from "../../lib/logger";
import { AuthFailureLimiter } from "../../lib/security/auth-failure-limiter";
import { PUBLIC_ROUTES, toRequest } from "../support/route-table";

const STUB_URL = "/__test/admin-stub";
const SECRET_VAR_NAME = /ADMIN_API_KEY|APP_SIGNING_SECRET/;
const KEY = env.ADMIN_API_KEY;

// Under `test:db` public routes reach the real test DB and open the pool.
test.after(async () => {
	await closeDatabase();
});

let ipCounter = 0;
function freshIp() {
	ipCounter += 1;
	return `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

function buildTestApp(
	options: {
		capture?: string[];
		limiter?: AuthFailureLimiter;
		onRoute?: onRouteHookHandler;
	} = {}
) {
	const lines = options.capture;
	const logger = lines
		? {
				...baseLoggerOptions,
				stream: new Writable({
					write(chunk, _encoding, callback) {
						lines.push(chunk.toString());
						callback();
					},
				}),
			}
		: false;
	return buildApp({
		authFailureLimiter: options.limiter,
		logger,
		onRoute: options.onRoute,
		registerAdminRoutes: (scope) => {
			scope.get(STUB_URL, async () => ({ ok: true }));
		},
	});
}

test("real route table (incl. auto HEAD): every route outside the public allowlist answers 401 without a key", async (t) => {
	const real: string[] = [];
	const app = buildTestApp({
		onRoute: (route) => {
			const methods = Array.isArray(route.method)
				? route.method
				: [route.method];
			for (const method of methods) {
				real.push(`${method} ${route.url}`);
			}
		},
	});
	t.after(() => app.close());
	await app.ready();

	const publicSet = new Set(PUBLIC_ROUTES);
	const isPublic = (route: string) => {
		const [method, url] = route.split(" ") as [string, string];
		const asGet = method === "HEAD" ? `GET ${url}` : route;
		return publicSet.has(route) || publicSet.has(asGet);
	};

	assert.ok(
		real.some((route) => route.startsWith("HEAD ")),
		"HEAD routes are exposed"
	);
	const leaked: string[] = [];
	for (const route of real) {
		if (isPublic(route)) {
			continue;
		}
		const response = await app.inject({
			...toRequest(route),
			method: route.split(" ")[0] as "GET",
			remoteAddress: freshIp(),
		});
		if (
			response.statusCode !== 401 ||
			response.headers["www-authenticate"] !== "Bearer"
		) {
			leaked.push(`${route} → ${response.statusCode}`);
		}
	}
	assert.deepEqual(leaked, []);

	// The public set is exactly webhooks, /auth/google*, GET /.
	for (const route of PUBLIC_ROUTES) {
		const url = route.split(" ")[1] as string;
		assert.ok(
			url === "/" ||
				url.startsWith("/webhooks/") ||
				url.startsWith("/auth/google"),
			`unexpected public route ${route}`
		);
	}
});

test("Bearer parsing: every malformed variant gets the same 401, no 500", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const variants: Record<string, string> = {
		"bearer-no-token": "Bearer",
		"bearer-space-only": "Bearer ",
		"double-space": `Bearer  ${KEY}`,
		empty: "",
		"key-plus-suffix": `Bearer ${KEY}${KEY}`,
		"key-prefix-1": `Bearer ${KEY.slice(0, 1)}`,
		"key-prefix-half": `Bearer ${KEY.slice(0, KEY.length / 2)}`,
		"key-prefix-minus-1": `Bearer ${KEY.slice(0, -1)}`,
		"leading-scheme-noise": `xBearer ${KEY}`,
		"other-scheme-token": `Token ${KEY}`,
		"tab-separator": `Bearer\t${KEY}`,
		"two-values-joined": `Bearer ${KEY}x, Bearer ${KEY}`,
		"upper-key": `Bearer ${KEY.toUpperCase()}`,
		"very-long-1mb": `Bearer ${"A".repeat(1024 * 1024)}`,
		whitespace: "   ",
	};

	const seen = new Set<string>();
	for (const [name, authorization] of Object.entries(variants)) {
		const started = Date.now();
		const response = await app.inject({
			headers: { authorization },
			method: "GET",
			remoteAddress: freshIp(),
			url: STUB_URL,
		});
		assert.equal(response.statusCode, 401, name);
		assert.ok(Date.now() - started < 2000, `${name} is slow`);
		seen.add(
			JSON.stringify({
				body: response.body,
				wwwAuthenticate: response.headers["www-authenticate"],
			})
		);
	}
	assert.equal(seen.size, 1, [...seen].join("\n"));
});

test("scheme is case-insensitive (RFC 7235) but the key is not", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	for (const scheme of ["Bearer", "bearer", "BEARER", "BeArEr"]) {
		const response = await app.inject({
			headers: { authorization: `${scheme} ${KEY}` },
			method: "GET",
			remoteAddress: freshIp(),
			url: STUB_URL,
		});
		assert.equal(response.statusCode, 200, scheme);
	}
});

test("path variants of admin routes never reach a handler without a key", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	for (const url of [
		"/LEADS",
		"/leads/",
		"//leads",
		"/leads?x=1",
		"/leads%2F",
		"/./leads",
		"/webhooks/../leads",
		"/Leads",
		"/appointments/availability/",
	]) {
		const response = await app.inject({
			method: "GET",
			remoteAddress: freshIp(),
			url,
		});
		assert.ok(
			response.statusCode === 401 || response.statusCode === 404,
			`${url} → ${response.statusCode}`
		);
	}
});

test("forged X-Real-IP / Forwarded / X-Forwarded-For do not escape the limiter", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const statuses: number[] = [];
	for (let i = 0; i < 12; i += 1) {
		const response = await app.inject({
			headers: {
				authorization: "Bearer nope",
				forwarded: `for=198.51.100.${i}`,
				"x-forwarded-for": `203.0.113.${i}, 10.0.0.${i}`,
				"x-real-ip": `192.0.2.${i}`,
			},
			method: "GET",
			remoteAddress: "10.66.66.66",
			url: STUB_URL,
		});
		statuses.push(response.statusCode);
	}
	assert.deepEqual(statuses.slice(0, 10), new Array(10).fill(401));
	assert.deepEqual(statuses.slice(10), [429, 429]);
});

test("a locked IP stays locked for the whole window; requests during lockout do not extend it", () => {
	let now = 0;
	const limiter = new AuthFailureLimiter({ now: () => now });
	for (let i = 0; i < 10; i += 1) {
		limiter.recordFailure("ip");
	}
	assert.equal(limiter.check("ip").limited, true);
	now = 14 * 60 * 1000;
	const check = limiter.check("ip");
	assert.ok(check.limited && check.retryAfterSeconds === 60);
	now = 15 * 60 * 1000 + 1;
	assert.equal(limiter.check("ip").limited, false);
	assert.equal(limiter.size, 0, "expired entry dropped on access");
});

test("the limiter map stays bounded under a many-IP flood through the app", async (t) => {
	const limiter = new AuthFailureLimiter({ maxKeys: 50 });
	const app = buildTestApp({ limiter });
	t.after(() => app.close());

	for (let i = 0; i < 300; i += 1) {
		await app.inject({
			headers: { authorization: "Bearer nope" },
			method: "GET",
			remoteAddress: `172.16.${Math.floor(i / 250)}.${i % 250}`,
			url: "/leads",
		});
	}
	assert.ok(limiter.size <= 50, `size ${limiter.size}`);
});

test("POST webhooks from a locked IP are not answered by the admin layer", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());
	const ip = "10.55.55.55";
	for (let i = 0; i < 11; i += 1) {
		await app.inject({ method: "GET", remoteAddress: ip, url: "/leads" });
	}

	// No signature → the webhook's own check answers (not 401/429 from admin).
	for (const url of [
		"/webhooks/whatsapp",
		"/webhooks/meta-ads",
		"/webhooks/google-ads",
	]) {
		const response = await app.inject({
			headers: { authorization: "Bearer nope" },
			method: "POST",
			payload: {},
			remoteAddress: ip,
			url,
		});
		assert.notEqual(response.statusCode, 429, url);
		assert.equal(response.headers["www-authenticate"], undefined, url);
		assert.notDeepEqual(response.body.includes("too_many_requests"), true, url);
	}
});

test("no secret in logs: Authorization on success, failure and lockout; Basic credentials too", async (t) => {
	const lines: string[] = [];
	const app = buildTestApp({ capture: lines });
	t.after(() => app.close());
	const wrong = "attacker-guess-for-log-leak-0123456789abcdef";
	const ip = freshIp();

	await app.inject({
		headers: { authorization: `Bearer ${KEY}` },
		method: "GET",
		remoteAddress: ip,
		url: `${STUB_URL}?probe=1`,
	});
	for (let i = 0; i < 11; i += 1) {
		await app.inject({
			headers: { authorization: `Bearer ${wrong}` },
			method: "GET",
			remoteAddress: ip,
			url: "/leads",
		});
	}
	await app.inject({
		headers: {
			authorization: `Basic ${Buffer.from(`u:${wrong}`).toString("base64")}`,
		},
		method: "GET",
		remoteAddress: freshIp(),
		url: "/leads",
	});

	const logs = lines.join("");
	assert.ok(logs.includes("admin_auth_rate_limited"), "lockout is logged");
	assert.ok(!logs.includes(KEY), "admin key in logs");
	assert.ok(!logs.includes(wrong), "guessed key in logs");
	assert.ok(!logs.includes(Buffer.from(`u:${wrong}`).toString("base64")));
	assert.ok(!logs.includes(env.APP_SIGNING_SECRET), "signing secret in logs");
});

test("parseEnv errors name the variable but never echo the secret value", () => {
	const base = { ...process.env };
	const shortKey = "short-admin-key-LEAKCHECK-0123";
	const sameSecret = "same-secret-for-both-LEAKCHECK-0123456789";
	for (const source of [
		{ ...base, ADMIN_API_KEY: shortKey },
		{ ...base, ADMIN_API_KEY: sameSecret, APP_SIGNING_SECRET: sameSecret },
		{ ...base, ADMIN_API_KEY: "   " },
	]) {
		try {
			parseEnv(source);
			assert.fail("parseEnv accepted an invalid key");
		} catch (error) {
			const { message } = error as Error;
			assert.ok(!message.includes("LEAKCHECK"), message);
			assert.match(message, SECRET_VAR_NAME);
		}
	}
});

test("GET / is public and plain", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());
	const response = await app.inject({
		headers: { authorization: "Bearer nope" },
		method: "GET",
		url: "/",
	});
	assert.equal(response.statusCode, 200);
	assert.equal(response.body, "ok");
});
