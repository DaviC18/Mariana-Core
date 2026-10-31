import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
	applyTestDatabaseEnv,
	assertAppliedTestDatabaseEnv,
	describeDatabaseHost,
	isForbiddenTestConnection,
	resolveTestDatabaseEnv,
	UnsafeTestDatabaseError,
} from "./support/test-database-guard";

const NEON_HOST_ERROR = /neon\.tech/;
const SAME_DATABASE_ERROR = /same database/;

const devUrl =
	"postgresql://user:secret@ep-dev-123.sa-east-1.aws.neon.tech/neondb";

test("recusa quando TEST_DATABASE_URL não está definido", () => {
	assert.throws(
		() => resolveTestDatabaseEnv({ DATABASE_URL: devUrl }),
		UnsafeTestDatabaseError
	);
});

test("recusa quando TEST_DATABASE_URL aponta para o mesmo banco que DATABASE_URL", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				DATABASE_URL: devUrl,
				TEST_DATABASE_URL:
					"postgresql://other:pw@EP-DEV-123.sa-east-1.aws.neon.tech:5432/neondb?sslmode=require",
			}),
		UnsafeTestDatabaseError
	);
});

test("recusa URL que não é postgres", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				DATABASE_URL: devUrl,
				TEST_DATABASE_URL: "mysql://localhost/test",
			}),
		UnsafeTestDatabaseError
	);
});

test("recusa workers de confiabilidade habilitados", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				DATABASE_URL: devUrl,
				RELIABILITY_WORKERS_ENABLED: "true",
				TEST_DATABASE_URL:
					"postgresql://postgres:pw@localhost:5433/mariana_test",
			}),
		UnsafeTestDatabaseError
	);
});

test("recusa TEST_DATABASE_URL hospedado no Neon", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				DATABASE_URL: devUrl,
				TEST_DATABASE_URL:
					"postgresql://user:secret@ep-other-456.sa-east-1.aws.neon.tech/mariana_test",
			}),
		NEON_HOST_ERROR
	);
});

test("recusa Neon mesmo sem DATABASE_URL definido", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				TEST_DATABASE_URL:
					"postgresql://user:secret@EP-OTHER-456.NEON.TECH/mariana_test",
			}),
		UnsafeTestDatabaseError
	);
});

test("aceita outro banco no mesmo host e desliga os workers", () => {
	const localDevUrl = "postgresql://mariana:pw@localhost:5432/mariana";
	const testUrl = "postgresql://mariana:pw@localhost:5432/mariana_test";
	assert.deepEqual(
		resolveTestDatabaseEnv({
			DATABASE_URL: localDevUrl,
			TEST_DATABASE_URL: testUrl,
		}),
		{
			DATABASE_URL: testUrl,
			NODE_ENV: "test",
			RELIABILITY_WORKERS_ENABLED: "false",
		}
	);
});

test("describeDatabaseHost não expõe a senha", () => {
	const description = describeDatabaseHost(devUrl);
	assert.equal(description, "ep-dev-123.sa-east-1.aws.neon.tech:5432/neondb");
	assert.ok(!description.includes("secret"));
});

test("o setup de banco de teste reescreve DATABASE_URL antes de qualquer statement", () => {
	const testUrl = "postgresql://mariana:pw@localhost:5432/mariana_test";
	const source: NodeJS.ProcessEnv = {
		DATABASE_URL: devUrl,
		TEST_DATABASE_URL: testUrl,
	};
	const resolved = applyTestDatabaseEnv(source);
	assert.equal(source.DATABASE_URL, testUrl);
	assert.equal(source.NODE_ENV, "test");
	assert.equal(source.RELIABILITY_WORKERS_ENABLED, "false");
	assert.equal(resolved.DATABASE_URL, testUrl);
});

test("applyTestDatabaseEnv não altera o ambiente quando recusa", () => {
	const source: NodeJS.ProcessEnv = {
		DATABASE_URL: devUrl,
		TEST_DATABASE_URL:
			"postgresql://user:secret@ep-other-456.sa-east-1.aws.neon.tech/mariana_test",
	};
	assert.throws(() => applyTestDatabaseEnv(source), UnsafeTestDatabaseError);
	assert.equal(source.DATABASE_URL, devUrl);
});

test("recusa um host remoto que não é neon.tech", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				DATABASE_URL: devUrl,
				TEST_DATABASE_URL:
					"postgresql://user:secret@db.example.com/mariana_test",
			}),
		UnsafeTestDatabaseError
	);
});

test("aceita localhost, 127.0.0.1 e ::1", () => {
	for (const host of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) {
		const testUrl = `postgresql://mariana:pw@${host}:5432/mariana_test`;
		assert.equal(
			resolveTestDatabaseEnv({
				DATABASE_URL: devUrl,
				TEST_DATABASE_URL: testUrl,
			}).DATABASE_URL,
			testUrl
		);
	}
});

test("permite host remoto só com ALLOW_REMOTE_TEST_DB=1", () => {
	const testUrl = "postgresql://user:secret@db.example.com:6543/mariana_test";
	for (const allow of [undefined, "", "0", "true"]) {
		assert.throws(
			() =>
				resolveTestDatabaseEnv({
					ALLOW_REMOTE_TEST_DB: allow,
					DATABASE_URL: devUrl,
					TEST_DATABASE_URL: testUrl,
				}),
			UnsafeTestDatabaseError
		);
	}

	const warn = mock.method(console, "warn", () => undefined);
	try {
		const resolved = resolveTestDatabaseEnv({
			ALLOW_REMOTE_TEST_DB: "1",
			DATABASE_URL: devUrl,
			TEST_DATABASE_URL: testUrl,
		});
		assert.equal(resolved.DATABASE_URL, testUrl);
		assert.equal(warn.mock.callCount(), 1);
		const message = String(warn.mock.calls[0]?.arguments[0]);
		assert.ok(message.includes("db.example.com:6543/mariana_test"));
		assert.ok(message.includes("ALLOW_REMOTE_TEST_DB"));
		assert.ok(!message.includes("secret"));
	} finally {
		warn.mock.restore();
	}
});

test("ALLOW_REMOTE_TEST_DB=1 não libera neon.tech", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				ALLOW_REMOTE_TEST_DB: "1",
				DATABASE_URL: devUrl,
				TEST_DATABASE_URL:
					"postgresql://user:secret@ep-other-456.sa-east-1.aws.neon.tech/mariana_test",
			}),
		NEON_HOST_ERROR
	);
});

test("recusa ?hostaddr= e qualquer parâmetro de conexão na query", () => {
	for (const [query, key] of [
		["hostaddr=10.0.0.5", "hostaddr"],
		["port=6543", "port"],
	] as const) {
		assert.throws(
			() =>
				resolveTestDatabaseEnv({
					TEST_DATABASE_URL: `postgresql://u:p@localhost:5432/mariana_test?${query}`,
				}),
			(error: unknown) => {
				assert.ok(error instanceof UnsafeTestDatabaseError);
				assert.ok(error.message.includes(key), error.message);
				assert.ok(!error.message.includes("10.0.0.5"), error.message);
				assert.ok(!error.message.includes("6543"), error.message);
				return true;
			}
		);
	}
});

test("aceita ?sslmode=disable", () => {
	const testUrl =
		"postgresql://u:p@localhost:5432/mariana_test?sslmode=disable";
	const resolved = resolveTestDatabaseEnv({ TEST_DATABASE_URL: testUrl });
	assert.equal(resolved.DATABASE_URL, testUrl);
});

const appliedLocalUrl = "postgresql://u:p@localhost:5432/mariana_test";

function appliedEnv(url: string): NodeJS.ProcessEnv {
	return {
		DATABASE_URL: url,
		NODE_ENV: "test",
		RELIABILITY_WORKERS_ENABLED: "false",
		TEST_DATABASE_URL: url,
	};
}

test("assertAppliedTestDatabaseEnv aceita o ambiente gravado por applyTestDatabaseEnv", () => {
	const source: NodeJS.ProcessEnv = {
		DATABASE_URL: devUrl,
		TEST_DATABASE_URL: appliedLocalUrl,
	};
	applyTestDatabaseEnv(source);
	assert.equal(assertAppliedTestDatabaseEnv(source), appliedLocalUrl);
});

test("assertAppliedTestDatabaseEnv recusa um ambiente não aplicado", () => {
	assert.throws(
		() =>
			assertAppliedTestDatabaseEnv({
				DATABASE_URL: devUrl,
				NODE_ENV: "test",
				RELIABILITY_WORKERS_ENABLED: "false",
				TEST_DATABASE_URL: appliedLocalUrl,
			}),
		UnsafeTestDatabaseError
	);
});

test("assertAppliedTestDatabaseEnv recusa NODE_ENV diferente de test ou workers ligados", () => {
	const cases: NodeJS.ProcessEnv[] = [
		{ ...appliedEnv(appliedLocalUrl), NODE_ENV: "development" },
		{ ...appliedEnv(appliedLocalUrl), NODE_ENV: undefined },
		{ ...appliedEnv(appliedLocalUrl), RELIABILITY_WORKERS_ENABLED: "true" },
		{ ...appliedEnv(appliedLocalUrl), RELIABILITY_WORKERS_ENABLED: undefined },
	];
	for (const source of cases) {
		assert.throws(
			() => assertAppliedTestDatabaseEnv(source),
			UnsafeTestDatabaseError,
			JSON.stringify({
				NODE_ENV: source.NODE_ENV,
				RELIABILITY_WORKERS_ENABLED: source.RELIABILITY_WORKERS_ENABLED,
			})
		);
	}
});

test("assertAppliedTestDatabaseEnv aplica as mesmas regras de host", () => {
	for (const url of [
		"postgresql://u:p@db.example.com:5432/mariana_test",
		"postgresql://u:p@localhost:5432/mariana_test?host=db.example.com",
	]) {
		assert.throws(
			() => assertAppliedTestDatabaseEnv(appliedEnv(url)),
			UnsafeTestDatabaseError,
			url
		);
	}
});

test("resolveTestDatabaseEnv continua recusando DATABASE_URL igual a TEST_DATABASE_URL", () => {
	assert.throws(
		() => resolveTestDatabaseEnv(appliedEnv(appliedLocalUrl)),
		SAME_DATABASE_ERROR
	);
});

// Passo 14c (E-4): o postgres.js corta o userinfo no PRIMEIRO "@" e lê "," como
// lista de hosts; o WHATWG URL corta no ÚLTIMO "@". O guard recusa o que os
// dois leriam diferente.
test("recusa @ a mais, vírgula ou host codificado na autoridade", () => {
	const cases: [string, NodeJS.ProcessEnv][] = [
		["postgresql://u:p@x@localhost:5432/db", {}],
		["postgresql://u:p@localhost,db.example.com:5432/db", {}],
		[
			"postgresql://u:p@localhost,db.example.com:5432/db",
			{ ALLOW_REMOTE_TEST_DB: "1" },
		],
		["postgresql://u:p@x%2Cevil@localhost:5432/db", {}],
	];
	const warn = mock.method(console, "warn", () => undefined);
	try {
		for (const [url, extra] of cases) {
			assert.throws(
				() => resolveTestDatabaseEnv({ ...extra, TEST_DATABASE_URL: url }),
				(error: unknown) => {
					assert.ok(error instanceof UnsafeTestDatabaseError, url);
					assert.ok(!error.message.includes("u:p"), error.message);
					return true;
				},
				url
			);
		}
	} finally {
		warn.mock.restore();
	}
});

test("aceita senha com %40 codificado", () => {
	const testUrl = "postgresql://u:p%40ss@localhost:5432/mariana_test";
	assert.equal(
		resolveTestDatabaseEnv({ TEST_DATABASE_URL: testUrl }).DATABASE_URL,
		testUrl
	);
});

// Passo 21 (E-11): o WHATWG URL apara espaços e mantém %xx no caminho; o pg
// re-codifica e decodifica. O texto cru não pode ter espaço, caractere de
// controle nem % fora do userinfo.
test("recusa espaço, caractere de controle e % no host ou no banco", () => {
	for (const url of [
		" postgresql://mariana:mariana@localhost:5432/mariana_test",
		"postgresql://mariana:mariana@localhost:5432/mariana_test ",
		"postgresql://mariana:mariana@local\thost:5432/mariana_test",
		"postgresql://mariana:mariana@localhost:5432/mariana_test\n",
		"postgresql://mariana:mariana@localhost:5432/mariana%5Ftest",
		"postgresql://mariana:mariana@local%68ost:5432/mariana_test",
	]) {
		assert.throws(
			() => resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }),
			(error: unknown) => {
				assert.ok(error instanceof UnsafeTestDatabaseError, String(error));
				assert.ok(!error.message.includes("mariana:mariana"), error.message);
				return true;
			},
			JSON.stringify(url)
		);
	}
});

// Passo 14d (E-5): sem porta ou banco na URL, pg e postgres.js usam PGPORT /
// PGDATABASE do ambiente, não o 5432/postgres que o guard assumiria.
test("a mensagem de porta ou banco ausente nomeia o que falta", () => {
	for (const [url, missing] of [
		["postgresql://mariana:segredo@localhost/mariana_test", "port"],
		["postgresql://mariana:segredo@localhost:/mariana_test", "port"],
		["postgresql://mariana:segredo@localhost:5432/", "database"],
		["postgresql://mariana:segredo@localhost:5432", "database"],
		["postgresql://mariana:segredo@localhost:5432/a/b", "database"],
	] as const) {
		assert.throws(
			() => resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }),
			(error: unknown) => {
				assert.ok(error instanceof UnsafeTestDatabaseError, url);
				assert.ok(error.message.includes(missing), error.message);
				assert.ok(!error.message.includes("segredo"), error.message);
				return true;
			},
			url
		);
	}
});

// Step 16: o predicado puro que `src/db/connections.ts` usa antes de abrir a
// conexão. Num filho do test runner o Node tira `--test` do execArgv e define
// NODE_TEST_CONTEXT, por isso os dois gatilhos.
const unitSentinelUrl =
	"postgresql://unit-tests-have-no-database@127.0.0.1:1/none";
const localTestUrl = "postgresql://mariana:mariana@localhost:5432/mariana_test";
const runnerChild = {
	argv: ["node", "/repo/src/tests/x.test.ts"],
	env: { NODE_TEST_CONTEXT: "child-v8" },
	execArgv: [],
};

test("isForbiddenTestConnection recusa Neon em um filho do test runner", () => {
	assert.equal(
		isForbiddenTestConnection({ ...runnerChild, url: devUrl }),
		true
	);
	assert.equal(
		isForbiddenTestConnection({
			argv: [],
			env: {},
			execArgv: ["--test"],
			url: devUrl,
		}),
		true
	);
	assert.equal(
		isForbiddenTestConnection({
			argv: ["node", "--test"],
			env: {},
			execArgv: [],
			url: devUrl,
		}),
		true
	);
});

test("isForbiddenTestConnection recusa a URL do E-4 e uma URL sem porta", () => {
	for (const url of [
		"postgresql://user:secret@x,ep-dev-123.sa-east-1.aws.neon.tech:5432@localhost:5432/neondb",
		"postgresql://mariana:mariana@localhost/mariana_test",
		"postgresql://mariana:mariana@localhost:5432/",
	]) {
		assert.equal(
			isForbiddenTestConnection({ ...runnerChild, url }),
			true,
			"expected a refusal"
		);
	}
});

test("isForbiddenTestConnection aceita o sentinela unitário e o banco local de teste", () => {
	for (const url of [unitSentinelUrl, localTestUrl]) {
		assert.equal(isForbiddenTestConnection({ ...runnerChild, url }), false);
	}
});

test("isForbiddenTestConnection não interfere fora de testes", () => {
	assert.equal(
		isForbiddenTestConnection({
			argv: ["node", "/repo/dist/server.js"],
			env: {},
			execArgv: [],
			url: devUrl,
		}),
		false
	);
});

// Step 20 (E-12): um arquivo de teste executado direto (`tsx x.test.ts`, "Run
// file" de IDE) não tem NODE_TEST_CONTEXT nem --test; o argv[1] marca o teste.
function directRun(entry: string, url: string): boolean {
	return isForbiddenTestConnection({
		argv: ["/usr/bin/node", entry],
		env: {},
		execArgv: [],
		url,
	});
}

test("isForbiddenTestConnection trata um arquivo .test.* como entrada de teste", () => {
	for (const entry of ["/tmp/x/f.test.mjs", "C:\\repo\\src\\x.test.ts"]) {
		assert.equal(directRun(entry, devUrl), true, entry);
	}
});

test("isForbiddenTestConnection trata uma entrada em src/tests/ como processo de teste", () => {
	for (const entry of [
		"/repo/src/tests/support/conversation-harness.ts",
		"C:\\repo\\src\\tests\\a.ts",
	]) {
		assert.equal(directRun(entry, devUrl), true, entry);
	}
});

test("isForbiddenTestConnection não interfere com as entradas de produção", () => {
	for (const entry of [
		"/app/dist/server.js",
		"/repo/src/server.ts",
		"/repo/src/db/seed.ts",
		"/repo/scripts/simulate-conversation.ts",
		"/home/u/tests/app/dist/server.js",
		"/repo/src/testsuite/a.ts",
		"/repo/src/latest.ts",
	]) {
		assert.equal(directRun(entry, devUrl), false, entry);
	}
	assert.equal(
		isForbiddenTestConnection({
			argv: ["/usr/bin/node"],
			env: {},
			execArgv: [],
			url: devUrl,
		}),
		false
	);
});

test("isForbiddenTestConnection: entrada de teste com banco local passa", () => {
	assert.equal(directRun("/repo/src/tests/x.test.ts", localTestUrl), false);
	assert.equal(directRun("/tmp/x/f.test.mjs", localTestUrl), false);
});

test("isForbiddenTestConnection com ALLOW_REMOTE_TEST_DB=1 libera host remoto, nunca neon.tech", () => {
	const warn = mock.method(console, "warn", () => undefined);
	try {
		const hatch = {
			...runnerChild,
			env: { ...runnerChild.env, ALLOW_REMOTE_TEST_DB: "1" },
		};
		assert.equal(
			isForbiddenTestConnection({
				...hatch,
				url: "postgresql://u:p@db.example.com:5432/t",
			}),
			false
		);
		assert.equal(isForbiddenTestConnection({ ...hatch, url: devUrl }), true);
		assert.equal(
			isForbiddenTestConnection({
				...runnerChild,
				url: "postgresql://u:p@db.example.com:5432/t",
			}),
			true
		);
	} finally {
		warn.mock.restore();
	}
});
