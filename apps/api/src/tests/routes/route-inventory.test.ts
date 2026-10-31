/**
 * Inventário de rotas: `buildApp()` monta a tabela completa sem `listen()`.
 * Uma rota nova que não esteja nesta lista quebra o teste, então ninguém
 * publica uma rota sem decidir se ela é pública ou de admin.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../app";
import { env } from "../../env";
import { EXPECTED_ROUTES } from "../support/route-table";

function collectRoutes() {
	const routes = new Set<string>();
	const app = buildApp({
		logger: false,
		onRoute: (route) => {
			const methods = Array.isArray(route.method)
				? route.method
				: [route.method];
			for (const method of methods) {
				if (method !== "HEAD") {
					routes.add(`${method} ${route.url}`);
				}
			}
		},
	});
	return { app, routes };
}

test("buildApp registers exactly the expected routes", async (t) => {
	const { app, routes } = collectRoutes();
	t.after(() => app.close());
	await app.ready();

	assert.deepEqual([...routes].sort(), EXPECTED_ROUTES);
});

test("GET / returns ok", async (t) => {
	// Sem logger: o transport pino-pretty roda num worker que recarrega o
	// preload de DB e é recusado pelo guard (falha só sob `test:db`).
	const app = buildApp({ logger: false });
	t.after(() => app.close());

	const response = await app.inject({ method: "GET", url: "/" });

	assert.equal(response.statusCode, 200);
	assert.equal(response.body, "ok");
});

test("POST /conversations/:id/messages → 404 with and without key (D-2)", async (t) => {
	const app = buildApp({ logger: false });
	t.after(() => app.close());
	const url = "/conversations/00000000-0000-4000-8000-000000000000/messages";
	const payload = { content: "oi", role: "system" };

	const responses = await Promise.all(
		[{}, { authorization: `Bearer ${env.ADMIN_API_KEY}` }].map((headers) =>
			app.inject({ headers, method: "POST", payload, url })
		)
	);
	for (const response of responses) {
		assert.equal(response.statusCode, 404);
	}
});
