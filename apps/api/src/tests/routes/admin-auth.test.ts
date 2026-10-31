/** biome-ignore-all lint/performance/noAwaitInLoops: requests must run in order (failure limiter). */
/**
 * Camada de admin: toda rota fora da allowlist pública exige
 * `Authorization: Bearer <ADMIN_API_KEY>`. Roda sem banco (preload unitário):
 * se um handler protegido chegasse a rodar, a consulta ao banco falharia e o
 * status não seria 401.
 */
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { buildApp } from "../../app";
import { closeDatabase } from "../../db/connections";
import { env } from "../../env";
import { baseLoggerOptions } from "../../lib/logger";
import { AuthFailureLimiter } from "../../lib/security/auth-failure-limiter";
import {
	ADMIN_ROUTES,
	EXPECTED_ROUTES,
	PUBLIC_ROUTES,
	toRequest,
} from "../support/route-table";

const STUB_URL = "/__test/admin-stub";

// Sob `test:db` as rotas públicas chegam ao banco real e abrem o pool;
// sem fechar, o processo do arquivo não termina.
test.after(async () => {
	await closeDatabase();
});

function buildTestApp(
	options: { limiter?: AuthFailureLimiter; capture?: string[] } = {}
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
		registerAdminRoutes: (scope) => {
			scope.get(STUB_URL, async () => ({ ok: true }));
		},
	});
}

function bearer(key: string) {
	return { authorization: `Bearer ${key}` };
}

test("every non-public route returns 401 without credentials", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const unprotected: string[] = [];
	// Um IP por rota: o limitador (10 falhas/IP) não interfere neste teste.
	for (const [index, route] of EXPECTED_ROUTES.entries()) {
		const response = await app.inject({
			...toRequest(route),
			remoteAddress: `10.1.0.${index + 1}`,
		});
		if (response.statusCode !== 401 || !response.headers["www-authenticate"]) {
			unprotected.push(route);
			continue;
		}
		assert.deepEqual(response.json(), { error: "unauthorized" }, route);
	}

	// O que ficou sem a camada de admin é exatamente a allowlist pública.
	assert.deepEqual(unprotected.sort(), PUBLIC_ROUTES);
	assert.ok(ADMIN_ROUTES.length > 0);
});

test("wrong key / wrong scheme / shorter key / longer key → identical 401 body and headers", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const key = env.ADMIN_API_KEY;
	const attempts: Record<string, string>[] = [
		{},
		bearer(`${key.slice(0, -1)}x`),
		bearer(key.slice(0, -1)),
		bearer(`${key}x`),
		bearer(""),
		{ authorization: `Basic ${key}` },
		{ authorization: key },
		{ authorization: `Bearer ${key} extra` },
	];

	const seen = new Set<string>();
	for (const headers of attempts) {
		const response = await app.inject({
			headers,
			method: "GET",
			remoteAddress: "10.0.0.1",
			url: "/leads",
		});
		assert.equal(response.statusCode, 401);
		seen.add(
			JSON.stringify({
				body: response.body,
				contentType: response.headers["content-type"],
				wwwAuthenticate: response.headers["www-authenticate"],
			})
		);
	}
	assert.equal(seen.size, 1, [...seen].join("\n"));
});

test("401 carries WWW-Authenticate: Bearer and logs no key", async (t) => {
	const lines: string[] = [];
	const app = buildTestApp({ capture: lines });
	t.after(() => app.close());

	const wrongKey = "wrong-admin-key-leak-check-7319-abcdefghijkl";
	const response = await app.inject({
		headers: bearer(wrongKey),
		method: "GET",
		url: "/leads/00000000-0000-4000-8000-000000000000",
	});

	assert.equal(response.statusCode, 401);
	assert.equal(response.headers["www-authenticate"], "Bearer");

	const ok = await app.inject({
		headers: bearer(env.ADMIN_API_KEY),
		method: "GET",
		url: STUB_URL,
	});
	assert.equal(ok.statusCode, 200);

	const logs = lines.join("");
	assert.ok(logs.includes('"event":"admin_auth_failed"'), logs);
	assert.ok(logs.includes('"route":"/leads/:id"'), logs);
	assert.ok(logs.includes('"reason":"invalid"'), logs);
	assert.ok(!logs.includes(wrongKey), "wrong key leaked into the logs");
	assert.ok(!logs.includes(env.ADMIN_API_KEY), "admin key leaked into logs");
});

test("valid key on a stub route inside the admin scope → 200", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const response = await app.inject({
		headers: bearer(env.ADMIN_API_KEY),
		method: "GET",
		url: STUB_URL,
	});
	assert.equal(response.statusCode, 200);
	assert.deepEqual(response.json(), { ok: true });

	const scheme = await app.inject({
		headers: { authorization: `bearer ${env.ADMIN_API_KEY}` },
		method: "GET",
		url: STUB_URL,
	});
	assert.equal(scheme.statusCode, 200, "the scheme is case-insensitive");
});

test("11th failure from one IP → 429 with Retry-After; another IP with valid key → 200; success resets", async (t) => {
	let now = 1_000_000;
	const limiter = new AuthFailureLimiter({ now: () => now });
	const app = buildTestApp({ limiter });
	t.after(() => app.close());

	const fail = (ip: string) =>
		app.inject({
			headers: bearer("nope"),
			method: "GET",
			remoteAddress: ip,
			url: STUB_URL,
		});
	const pass = (ip: string) =>
		app.inject({
			headers: bearer(env.ADMIN_API_KEY),
			method: "GET",
			remoteAddress: ip,
			url: STUB_URL,
		});

	// Sucesso zera o contador: 9 falhas + 1 sucesso + 9 falhas ainda é 401.
	for (let i = 0; i < 9; i += 1) {
		assert.equal((await fail("10.0.0.2")).statusCode, 401);
	}
	assert.equal((await pass("10.0.0.2")).statusCode, 200);
	for (let i = 0; i < 9; i += 1) {
		assert.equal((await fail("10.0.0.2")).statusCode, 401);
	}

	// 10 falhas seguidas → a 11ª tentativa recebe 429, mesmo com a chave certa.
	for (let i = 0; i < 10; i += 1) {
		assert.equal((await fail("10.0.0.3")).statusCode, 401, `failure ${i + 1}`);
	}
	const locked = await fail("10.0.0.3");
	assert.equal(locked.statusCode, 429);
	assert.equal(locked.headers["retry-after"], String(15 * 60));
	assert.deepEqual(locked.json(), { error: "too_many_requests" });
	assert.equal((await pass("10.0.0.3")).statusCode, 429);

	// Outro IP não é afetado.
	assert.equal((await pass("10.0.0.4")).statusCode, 200);

	// Passada a janela, o IP volta a ser atendido.
	now += 15 * 60 * 1000 + 1;
	assert.equal((await pass("10.0.0.3")).statusCode, 200);
});

test("webhooks are never 401/429 from the admin layer, even after an IP is locked", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());
	const ip = "10.0.0.5";

	for (let i = 0; i < 11; i += 1) {
		await app.inject({ method: "GET", remoteAddress: ip, url: "/leads" });
	}
	const locked = await app.inject({
		method: "GET",
		remoteAddress: ip,
		url: "/leads",
	});
	assert.equal(locked.statusCode, 429);

	for (const { path, token } of [
		{ path: "/webhooks/whatsapp", token: env.WHATSAPP_VERIFY_TOKEN },
		{ path: "/webhooks/meta-ads", token: env.META_ADS_VERIFY_TOKEN },
	]) {
		const response = await app.inject({
			method: "GET",
			remoteAddress: ip,
			url: `${path}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=C9`,
		});
		assert.equal(response.statusCode, 200, path);
		assert.equal(response.body, "C9", path);
	}

	for (const route of PUBLIC_ROUTES) {
		const response = await app.inject({
			...toRequest(route),
			remoteAddress: ip,
		});
		// O ticket do OAuth usa o mesmo limitador por desenho (plano, passo 5).
		if (route === "GET /auth/google") {
			assert.equal(response.statusCode, 429, route);
			continue;
		}
		assert.notEqual(response.statusCode, 429, route);
		assert.equal(response.headers["www-authenticate"], undefined, route);
	}
});

test("AuthFailureLimiter keeps at most maxKeys IPs (oldest evicted)", () => {
	const limiter = new AuthFailureLimiter({ maxFailures: 1, maxKeys: 3 });
	for (const ip of ["a", "b", "c", "d"]) {
		limiter.recordFailure(ip);
	}
	assert.equal(limiter.size, 3);
	assert.equal(limiter.check("a").limited, false, "oldest key evicted");
	assert.equal(limiter.check("d").limited, true);
});

// `request.ip` é o peer TCP (trustProxy: false). X-Forwarded-For forjado
// não pode criar um IP novo a cada tentativa e escapar do limitador.
test("a spoofed X-Forwarded-For does not escape the failure limiter", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const statuses: number[] = [];
	for (let i = 0; i < 11; i += 1) {
		const response = await app.inject({
			headers: { ...bearer("nope"), "x-forwarded-for": `203.0.113.${i}` },
			method: "GET",
			remoteAddress: "10.9.9.9",
			url: STUB_URL,
		});
		statuses.push(response.statusCode);
	}
	assert.equal(statuses.at(-1), 429);
});

// ---- Step 8: headers de segurança, sem CORS ----

const SECURITY_HEADERS = {
	"content-security-policy": "default-src 'none'; frame-ancestors 'none'",
	"referrer-policy": "no-referrer",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
} as const;

function assertSecurityHeaders(
	response: { headers: Record<string, unknown> },
	label: string
) {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		assert.equal(response.headers[name], value, `${label}: ${name}`);
	}
	assert.equal(
		response.headers["strict-transport-security"],
		undefined,
		`${label}: no HSTS (D-6)`
	);
}

test("security headers on GET /, on a 401, on the webhook verify and on a 404", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const root = await app.inject({ method: "GET", url: "/" });
	assert.equal(root.statusCode, 200);
	assert.equal(root.body, "ok");
	assertSecurityHeaders(root, "GET /");

	const unauthorized = await app.inject({ method: "GET", url: "/leads" });
	assert.equal(unauthorized.statusCode, 401);
	assertSecurityHeaders(unauthorized, "401");

	const verify = await app.inject({
		method: "GET",
		url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=H1`,
	});
	assert.equal(verify.statusCode, 200);
	assert.equal(verify.body, "H1");
	assertSecurityHeaders(verify, "webhook verify");

	const notFound = await app.inject({ method: "GET", url: "/nope" });
	assert.equal(notFound.statusCode, 404);
	assertSecurityHeaders(notFound, "404");
});

test("Cache-Control: no-store on admin routes and /auth/google*, not on webhooks", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const admin401 = await app.inject({ method: "GET", url: "/leads" });
	assert.equal(admin401.headers["cache-control"], "no-store");
	const admin200 = await app.inject({
		headers: bearer(env.ADMIN_API_KEY),
		method: "GET",
		url: STUB_URL,
	});
	assert.equal(admin200.statusCode, 200);
	assert.equal(admin200.headers["cache-control"], "no-store");
	for (const url of ["/auth/google", "/auth/google/callback"]) {
		const response = await app.inject({ method: "GET", url });
		assert.equal(response.statusCode, 400, url);
		assert.equal(response.headers["cache-control"], "no-store", url);
		assertSecurityHeaders(response, url);
	}
	const verify = await app.inject({
		method: "GET",
		url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=H2`,
	});
	assert.equal(verify.headers["cache-control"], undefined);
});

test("no CORS: OPTIONS and GET with an Origin get no Access-Control-Allow-Origin", async (t) => {
	const app = buildTestApp();
	t.after(() => app.close());

	const preflight = await app.inject({
		headers: {
			"access-control-request-method": "GET",
			origin: "https://evil.example",
		},
		method: "OPTIONS",
		url: "/leads",
	});
	assert.equal(preflight.headers["access-control-allow-origin"], undefined);
	assert.notEqual(preflight.statusCode, 204);

	const simple = await app.inject({
		headers: {
			...bearer(env.ADMIN_API_KEY),
			origin: "https://evil.example",
		},
		method: "GET",
		url: STUB_URL,
	});
	assert.equal(simple.statusCode, 200);
	assert.equal(simple.headers["access-control-allow-origin"], undefined);
});
