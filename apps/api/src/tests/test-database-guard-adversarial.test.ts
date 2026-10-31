// Casos adversariais do guard de banco de teste (tester, Pacote A, batch E).
// E-4 e E-5 eram `todo`; os passos 14c e 14d os fecharam.
// Ver docs/work/2026-10-22-pkg-A/test-report-batch-E.md.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import { inspect } from "node:util";
import { parse as parsePgConnectionString } from "pg-connection-string";
import postgres from "postgres";
import { FAKE_EXTERNAL_ENV } from "./support/fake-external-env";
import {
	applyTestDatabaseEnv,
	assertAppliedTestDatabaseEnv,
	describeDatabaseHost,
	isForbiddenTestConnection,
	resolveTestDatabaseEnv,
	UnsafeTestDatabaseError,
} from "./support/test-database-guard";

const SAME_DATABASE_ERROR = /same database/;
const NEON_HOST_ERROR = /neon\.tech/;
const REQUIRED_ERROR = /TEST_DATABASE_URL is required/;
const NOT_APPLIED_ERROR = /not the applied/;
const NODE_ENV_ERROR = /NODE_ENV must be test/;
const WORKERS_ERROR = /RELIABILITY_WORKERS_ENABLED must be false/;
const localTestUrl = "postgresql://mariana:pw@localhost:5432/mariana_test";

test("recusa o mesmo banco local (o ramo 'mesmo banco' não fica só atrás do check de neon)", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				DATABASE_URL: "postgresql://other:x@LOCALHOST/mariana_test",
				TEST_DATABASE_URL: localTestUrl,
			}),
		SAME_DATABASE_ERROR
	);
});

test("allowlist não aceita hosts que só parecem locais", () => {
	const hosts = [
		"localhost.evil.com",
		"127.0.0.1.nip.io",
		"127.0.0.2",
		"0.0.0.0",
		"localhost.",
		"localhost,db.example.com",
		"[::ffff:127.0.0.1]",
	];
	for (const host of hosts) {
		assert.throws(
			() =>
				resolveTestDatabaseEnv({
					TEST_DATABASE_URL: `postgresql://u:p@${host}:5432/mariana_test`,
				}),
			UnsafeTestDatabaseError,
			host
		);
	}
});

test("allowlist não se engana com 'localhost' no usuário ou no nome do banco", () => {
	for (const url of [
		"postgresql://localhost:pw@db.example.com/mariana_test",
		"postgresql://u:p@db.example.com/localhost",
	]) {
		assert.throws(
			() => resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }),
			UnsafeTestDatabaseError,
			url
		);
	}
});

test("multihost com neon.tech é recusado mesmo com ALLOW_REMOTE_TEST_DB=1", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				ALLOW_REMOTE_TEST_DB: "1",
				TEST_DATABASE_URL:
					"postgresql://u:p@localhost,ep-x.sa-east-1.aws.neon.tech/mariana_test",
			}),
		NEON_HOST_ERROR
	);
});

test("ALLOW_REMOTE_TEST_DB=1 não libera RELIABILITY_WORKERS_ENABLED=true", () => {
	const warn = mock.method(console, "warn", () => undefined);
	try {
		assert.throws(
			() =>
				resolveTestDatabaseEnv({
					ALLOW_REMOTE_TEST_DB: "1",
					RELIABILITY_WORKERS_ENABLED: "true",
					TEST_DATABASE_URL: "postgresql://u:secret@db.example.com:5432/t",
				}),
			UnsafeTestDatabaseError
		);
	} finally {
		warn.mock.restore();
	}
});

test("applyTestDatabaseEnv não deixa o DATABASE_URL de desenvolvimento em lugar nenhum do source", () => {
	const devUrl =
		"postgresql://user:secret@ep-dev-123.sa-east-1.aws.neon.tech/neondb";
	const source: NodeJS.ProcessEnv = {
		DATABASE_URL: devUrl,
		TEST_DATABASE_URL: localTestUrl,
	};
	applyTestDatabaseEnv(source);
	for (const value of Object.values(source)) {
		assert.ok(!String(value).includes("neon.tech"));
	}
});

// Passo 13 (revisão 1, opção B): depois de applyTestDatabaseEnv, o filho
// `drizzle-kit push` valida com assertAppliedTestDatabaseEnv, que aceita o
// ambiente aplicado. resolveTestDatabaseEnv continua recusando "same database"
// nesse mesmo ambiente (a opção C, relaxar essa regra, foi rejeitada).
test("o filho do push aceita o ambiente aplicado e resolveTestDatabaseEnv continua recusando", () => {
	const source: NodeJS.ProcessEnv = {
		DATABASE_URL:
			"postgresql://user:secret@ep-dev-123.sa-east-1.aws.neon.tech/neondb",
		TEST_DATABASE_URL: localTestUrl,
	};
	applyTestDatabaseEnv(source);
	assert.equal(assertAppliedTestDatabaseEnv(source), localTestUrl);
	assert.throws(() => resolveTestDatabaseEnv(source), SAME_DATABASE_ERROR);
});

// E-1: o guard olha `URL.hostname`, mas `pg` (driver que o drizzle-kit push
// usa) honra `?host=` na query string e troca o host de verdade.
test("recusa ?host= remoto escondido atrás de localhost", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				TEST_DATABASE_URL:
					"postgresql://u:p@localhost:5432/mariana_test?host=ep-x.sa-east-1.aws.neon.tech",
			}),
		UnsafeTestDatabaseError
	);
});

// E-2: localhost e 127.0.0.1 são o mesmo servidor, mas a identidade compara texto.
test("recusa o mesmo banco escrito como localhost e 127.0.0.1", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/mariana_test",
				TEST_DATABASE_URL: localTestUrl,
			}),
		SAME_DATABASE_ERROR
	);
});

test("recusa o mesmo banco escrito como [::1] e localhost", () => {
	assert.throws(
		() =>
			resolveTestDatabaseEnv({
				DATABASE_URL: "postgresql://u:p@[::1]:5432/mariana_test",
				TEST_DATABASE_URL: localTestUrl,
			}),
		SAME_DATABASE_ERROR
	);
});

// --- Revisão 1 (tester, 2026-10-26): tentativas de contornar o guard novo. ---

test("a allowlist da query não se engana com caixa alta, percent-encoding ou chave vazia", () => {
	for (const [query, key] of [
		["HOST=db.example.com", "HOST"],
		["ho%73t=db.example.com", "host"],
		["sslmode=disable&host=db.example.com", "host"],
		["=db.example.com", '""'],
		["options=-csearch_path%3Devil", "options"],
	] as const) {
		assert.throws(
			() =>
				resolveTestDatabaseEnv({
					TEST_DATABASE_URL: `${localTestUrl}?${query}`,
				}),
			(error: unknown) => {
				assert.ok(error instanceof UnsafeTestDatabaseError, query);
				assert.ok(error.message.includes(key), error.message);
				assert.ok(!error.message.includes("db.example.com"), error.message);
				assert.ok(!error.message.includes("pw"), error.message);
				return true;
			}
		);
	}
});

test("assertAppliedTestDatabaseEnv recusa valores vazios e ambiente aplicado em neon, mesmo com a válvula", () => {
	const neonUrl =
		"postgresql://user:secret@ep-dev-123.sa-east-1.aws.neon.tech/neondb";
	const cases: [NodeJS.ProcessEnv, RegExp | typeof UnsafeTestDatabaseError][] =
		[
			[
				{
					DATABASE_URL: "",
					NODE_ENV: "test",
					RELIABILITY_WORKERS_ENABLED: "false",
					TEST_DATABASE_URL: "",
				},
				REQUIRED_ERROR,
			],
			[
				{
					DATABASE_URL: "",
					NODE_ENV: "test",
					RELIABILITY_WORKERS_ENABLED: "false",
					TEST_DATABASE_URL: localTestUrl,
				},
				NOT_APPLIED_ERROR,
			],
			[
				{
					ALLOW_REMOTE_TEST_DB: "1",
					DATABASE_URL: neonUrl,
					NODE_ENV: "test",
					RELIABILITY_WORKERS_ENABLED: "false",
					TEST_DATABASE_URL: neonUrl,
				},
				NEON_HOST_ERROR,
			],
			[
				{
					DATABASE_URL: localTestUrl,
					NODE_ENV: "TEST",
					RELIABILITY_WORKERS_ENABLED: "false",
					TEST_DATABASE_URL: localTestUrl,
				},
				NODE_ENV_ERROR,
			],
			[
				{
					DATABASE_URL: localTestUrl,
					NODE_ENV: "test",
					RELIABILITY_WORKERS_ENABLED: "0",
					TEST_DATABASE_URL: localTestUrl,
				},
				WORKERS_ERROR,
			],
		];
	for (const [source, expected] of cases) {
		assert.throws(() => assertAppliedTestDatabaseEnv(source), expected);
	}
});

// E-4 (tester, revisão 1): o guard usa o WHATWG URL, que separa o userinfo no
// ÚLTIMO "@". O postgres.js (usado pelo setup-test-db.ts para o DROP SCHEMA)
// corta no PRIMEIRO "@" e aceita lista de hosts separada por vírgula. A URL
// abaixo parece "localhost" para o guard, mas o postgres.js tenta "x" e depois
// o host neon, com a senha. Não abre conexão: só lê `options`.
test("recusa lista de hosts escondida no userinfo (postgres.js conectaria no neon)", () => {
	const crafted =
		"postgresql://user:secret@x,ep-dev-123.sa-east-1.aws.neon.tech:5432@localhost:5432/neondb";
	assert.throws(
		() => resolveTestDatabaseEnv({ TEST_DATABASE_URL: crafted }),
		UnsafeTestDatabaseError
	);
});

// E-5 (tester, revisão 1): sem porta (ou sem banco) na URL, o guard assume
// 5432 (ou "postgres"), mas pg e postgres.js usam PGPORT / PGDATABASE do
// ambiente. Com PGPORT=5433 o alvo real é outro container local.
test("exige porta e banco explícitos no TEST_DATABASE_URL (PGPORT/PGDATABASE não decidem o alvo)", () => {
	for (const url of [
		"postgresql://mariana:pw@localhost/mariana_test",
		"postgresql://mariana:pw@localhost:5432/",
	]) {
		assert.throws(
			() =>
				resolveTestDatabaseEnv({
					PGDATABASE: "neondb",
					PGPORT: "5433",
					TEST_DATABASE_URL: url,
				}),
			UnsafeTestDatabaseError,
			url
		);
	}
});

// Passo 14c: o host que o guard aceita é o mesmo que o postgres.js usaria.
// `postgres(url)` é preguiçoso: só lê `options`, sem conexão nem query.
// Corpus: as tentativas do tester (test-report-batch-E.md, "Bypass attempts").
const DRIVER_AGREEMENT_CORPUS = [
	"postgresql://u:p@localhost:5432/mariana_test",
	"postgresql://u:p@127.0.0.1:5432/mariana_test",
	"postgresql://u:p@LOCALHOST:5432/mariana_test",
	"postgresql://u:p%40ss@localhost:5432/mariana_test",
	"postgresql://u:p@localhost:5432/mariana_test?sslmode=disable",
	"postgresql://u:p@localhost:5432/mariana_test#?host=db.example.com",
	"postgresql://user@db.example.com@localhost:5432/mariana_test",
	"postgresql://u:p@localhost:5432,db.example.com:5432/mariana_test",
	"postgresql://u:p@localhost,db.example.com:5432/mariana_test",
	"postgresql://u:p@x%2Cdb.example.com@localhost:5432/mariana_test",
	"postgresql://u:p@local%68ost:5432/mariana_test",
	"postgresql://u:p@[0:0:0:0:0:0:0:1]:5432/mariana_test",
	"postgresql://u:p@[::ffff:127.0.0.1]:5432/mariana_test",
	"postgresql://u:p@0x7f000001:5432/mariana_test",
	"postgresql://u:p@localhost.:5432/mariana_test",
	"postgresql://u:p@127.0.0.1.:5432/mariana_test",
	"postgresql://u:p@%2Fvar%2Frun%2Fpostgresql:5432/mariana_test",
	"postgresql:///mariana_test",
	"postgresql://user:secret@x,ep-dev-123.sa-east-1.aws.neon.tech:5432@localhost:5432/neondb",
	"postgresql://mariana:pw@localhost/mariana_test",
	"postgresql://mariana:pw@localhost:5432/",
];

function guardAccepts(url: string): boolean {
	try {
		resolveTestDatabaseEnv({ TEST_DATABASE_URL: url });
		return true;
	} catch (error) {
		assert.ok(error instanceof UnsafeTestDatabaseError, url);
		return false;
	}
}

test("o host aceito pelo guard é o mesmo que o postgres.js usaria", () => {
	let accepted = 0;
	for (const url of DRIVER_AGREEMENT_CORPUS) {
		if (!guardAccepts(url)) {
			continue;
		}
		accepted += 1;
		const guardHost = new URL(url).hostname.toLowerCase();
		const driverHosts = postgres(url).options.host.map((host) =>
			host.toLowerCase()
		);
		assert.deepEqual(driverHosts, [guardHost], url);
		assert.ok(["localhost", "127.0.0.1"].includes(guardHost), url);
	}
	assert.ok(accepted > 0, "o corpus precisa ter URLs aceitas");
});

// Tester, batch E-R2a. Casos extras sobre os passos 14c e 14d.
const NEON_HOST = "ep-dev-123.sa-east-1.aws.neon.tech";
const WORKERS_REFUSAL = /RELIABILITY_WORKERS_ENABLED=true is not allowed/;

// O `#` encerra a autoridade para o WHATWG URL e para o guard, mas não para o
// postgres.js (que corta só em "/" ou "?"). A URL abaixo vira, no postgres.js,
// a lista ["localhost", <neon>]. Hoje quem recusa é o 14d (caminho vazio); este
// teste trava isso caso a regra do caminho seja afrouxada.
test("tester E-R2a: lista de hosts depois de # antes do caminho é recusada", () => {
	const crafted = `postgresql://user:secret@localhost:5432#,${NEON_HOST}:5432/neondb`;
	assert.deepEqual(postgres(crafted).options.host, ["localhost", NEON_HOST]);
	for (const extra of [{}, { ALLOW_REMOTE_TEST_DB: "1" }]) {
		assert.throws(
			() => resolveTestDatabaseEnv({ ...extra, TEST_DATABASE_URL: crafted }),
			UnsafeTestDatabaseError
		);
	}
});

// O teste "ALLOW_REMOTE_TEST_DB=1 não libera RELIABILITY_WORKERS_ENABLED=true"
// só confere a classe do erro. Este fixa que a recusa vem da regra dos workers
// e que a mesma URL, sem workers, é aceita.
test("tester E-R2a: o fixture remoto com porta é recusado só pela regra dos workers", () => {
	const url = "postgresql://u:secret@db.example.com:5432/t";
	const warn = mock.method(console, "warn", () => undefined);
	try {
		assert.equal(
			resolveTestDatabaseEnv({
				ALLOW_REMOTE_TEST_DB: "1",
				TEST_DATABASE_URL: url,
			}).DATABASE_URL,
			url
		);
		assert.throws(
			() =>
				resolveTestDatabaseEnv({
					ALLOW_REMOTE_TEST_DB: "1",
					RELIABILITY_WORKERS_ENABLED: "true",
					TEST_DATABASE_URL: url,
				}),
			WORKERS_REFUSAL
		);
	} finally {
		warn.mock.restore();
	}
});

// Nenhuma mensagem de recusa mostra userinfo (usuário, senha ou pedaços dela).
test("tester E-R2a: mensagens de recusa nunca mostram o userinfo", () => {
	const secret = "Sup3rS3cr3t";
	const user = "alice";
	const refused = [
		`postgresql://${user}:${secret}@x@localhost:5432/db`,
		`postgresql://${user}:${secret}@x,${NEON_HOST}:5432@localhost:5432/neondb`,
		`postgresql://${user}:${secret}@localhost,db.example.com:5432/db`,
		`postgresql://${user}:${secret}@x%2Cevil@localhost:5432/db`,
		`postgresql://${user}:${secret}@local%68ost:5432/db`,
		`postgresql://${user}:${secret}@%2Fvar%2Frun%2Fpostgresql:5432/db`,
		`postgresql://${user}:${secret}@[0:0:0:0:0:0:0:1]:5432/db`,
		`postgresql://${user}:${secret}@localhost/db`,
		`postgresql://${user}:${secret}@localhost:5432/`,
		`postgresql://${user}:${secret}@localhost:5432/a/b`,
		`postgresql://${user}:${secret}@local\thost:5432/db`,
		`postgresql:/\t/${user}:${secret}@localhost:5432/db`,
		`postgresql://${user}:${secret}@localhost:5432/db?host=x`,
		`postgresql://${user}:${secret}@${NEON_HOST}:5432/neondb`,
		`postgresql://${user}%40x:${secret}@db.example.com/db`,
	];
	const cases: [string[], NodeJS.ProcessEnv][] = [
		[[...refused, `postgresql://${user}:${secret}@localhost.:5432/db`], {}],
		[refused, { ALLOW_REMOTE_TEST_DB: "1" }],
	];
	for (const [urls, extra] of cases) {
		const warn = mock.method(console, "warn", () => undefined);
		try {
			for (const url of urls) {
				assert.throws(
					() => resolveTestDatabaseEnv({ ...extra, TEST_DATABASE_URL: url }),
					(error: unknown) => {
						assert.ok(error instanceof UnsafeTestDatabaseError, url);
						assert.ok(!error.message.includes(secret), error.message);
						assert.ok(!error.message.includes(user), error.message);
						return true;
					},
					url
				);
			}
		} finally {
			warn.mock.restore();
		}
	}
});

// O drizzle-kit push usa `pg` (pg-connection-string). Para cada URL aceita, o
// host, a porta e o banco têm de ser os mesmos no guard, no postgres.js e no pg.
// Não abre conexão.
const PG_AGREEMENT_ACCEPTED = [
	"postgresql://mariana:mariana@localhost:5432/mariana_test",
	"postgres://mariana:mariana@localhost:5432/mariana_test",
	"POSTGRESQL://mariana:mariana@LocalHost:5432/mariana_test",
	"postgresql://u:pa%40ss@localhost:5432/mariana_test",
	"postgresql://u:pa%3Ass@localhost:5432/mariana_test",
	"postgresql://u:pa%2Css@localhost:5432/mariana_test",
	"postgresql://u:pa%2Fss@localhost:5432/mariana_test",
	"postgresql://u:pa:ss@localhost:5432/mariana_test",
	"postgresql://u:p,x@localhost:5432/mariana_test",
	`postgresql://u%40${NEON_HOST}:p@localhost:5432/mariana_test`,
	`postgresql://u:p@localhost:5432/mariana_test#,${NEON_HOST}`,
	"postgresql://u:p@127.0.0.1:05432/mariana_test",
];

function threeWayIdentity(url: string) {
	const parsed = new URL(url);
	const guard = `${parsed.hostname.toLowerCase()}:${Number(parsed.port)}/${parsed.pathname.slice(1)}`;
	const { options } = postgres(url);
	const postgresJs = `${options.host.join(",").toLowerCase()}:${options.port.join(",")}/${options.database}`;
	const pg = parsePgConnectionString(url);
	const pgIdentity = `${String(pg.host).toLowerCase()}:${Number(pg.port)}/${pg.database}`;
	return { guard, pg: pgIdentity, postgresJs };
}

test("tester E-R2a: guard, postgres.js e pg leem o mesmo host, porta e banco", () => {
	for (const url of PG_AGREEMENT_ACCEPTED) {
		assert.equal(
			resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }).DATABASE_URL,
			url
		);
		const { guard, pg, postgresJs } = threeWayIdentity(url);
		assert.equal(postgresJs, guard, url);
		assert.equal(pg, guard, url);
	}
});

// E-11 (tester, E-R2a): o guard aceita estas URLs, mas o pg lê outro host ou
// outro banco. Espaço no início: o pg re-codifica (encodeURI) e resolve a URL
// como relativa a "postgres://base", ou seja, host "base". Espaço no fim e
// banco com %xx: o pg decodifica o caminho, o postgres.js não. Falha segura
// hoje (o reset usa postgres.js no alvo certo e o push do pg falha ou erra o
// banco local), mas quebra "uma URL, um alvo". Fechado no passo 21 (D-9).
test("tester E-R2a: guard recusa URL que o pg lê com outro host ou banco", () => {
	for (const url of [
		" postgresql://mariana:mariana@localhost:5432/mariana_test",
		"postgresql://mariana:mariana@localhost:5432/mariana_test ",
		"postgresql://mariana:mariana@localhost:5432/mariana%5Ftest",
	]) {
		const { guard, pg, postgresJs } = threeWayIdentity(url);
		assert.ok(pg !== guard || postgresJs !== guard, `controle: ${url}`);
		assert.throws(
			() => resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }),
			UnsafeTestDatabaseError,
			url
		);
	}
});

// ---------------------------------------------------------------------------
// Tester, batch E-R2b (step 16 amended): o gatilho de isForbiddenTestConnection
// e a fiação em src/db/connections.ts. Ver test-report-batch-E.md "E-R2b".
// ---------------------------------------------------------------------------
const fakeNeonUrl =
	"postgresql://u:segredo@ep-fake-1.sa-east-1.aws.neon.tech:5432/neondb";

test("isForbiddenTestConnection: NODE_TEST_CONTEXT 'child' e --test-isolation=none também são processo de teste", () => {
	for (const shape of [
		{ argv: [], env: { NODE_TEST_CONTEXT: "child" }, execArgv: [] },
		{ argv: [], env: {}, execArgv: ["--test", "--test-isolation=none"] },
	]) {
		assert.equal(
			isForbiddenTestConnection({ ...shape, url: fakeNeonUrl }),
			true
		);
	}
});

test("isForbiddenTestConnection: com ALLOW_REMOTE_TEST_DB=1 ainda recusa host escondido e ?host=", () => {
	const env = { ALLOW_REMOTE_TEST_DB: "1", NODE_TEST_CONTEXT: "child-v8" };
	for (const url of [
		"postgresql://u:p@x,ep-fake.neon.tech:5432@db.example.com:5432/t",
		"postgresql://u:p@db.example.com:5432/t?host=ep-fake.neon.tech",
	]) {
		assert.equal(
			isForbiddenTestConnection({ argv: [], env, execArgv: [], url }),
			true,
			url
		);
	}
});

// E-12 (tester, E-R2b): rodar um arquivo de teste direto (`npx tsx x.test.ts`,
// "Run/Debug file" de IDE) executa node:test no próprio processo, sem --test e
// sem NODE_TEST_CONTEXT, e sem preload: o DATABASE_URL do .env passa.
test("E-12: um arquivo .test.ts executado direto também é processo de teste", () => {
	assert.equal(
		isForbiddenTestConnection({
			argv: [
				"/usr/bin/node",
				"/repo/src/tests/routes/webhook-whatsapp.test.ts",
			],
			env: {},
			execArgv: ["--require", "tsx/cjs", "--import", "tsx/esm"],
			url: fakeNeonUrl,
		}),
		true
	);
});

// Step 20: `directTestFile` roda o probe como `tsx f.test.mjs` (CLI do tsx,
// sem --test e sem NODE_TEST_CONTEXT), como um "Run file" de IDE.
function importConnectionsInChild(
	extraEnv: Record<string, string>,
	options: { directTestFile?: boolean } = {}
): {
	leaked: boolean;
	outcome: string;
} {
	const repoRoot = path.resolve(import.meta.dirname, "..", "..");
	const dir = mkdtempSync(path.join(tmpdir(), "mariana-connections-wiring-"));
	try {
		const fakeEnv = {
			...FAKE_EXTERNAL_ENV,
			DATABASE_URL: fakeNeonUrl,
			RELIABILITY_WORKERS_ENABLED: "false",
		};
		writeFileSync(
			path.join(dir, ".env"),
			`${Object.entries(fakeEnv)
				.map(([key, value]) => `${key}=${value}`)
				.join("\n")}\n`
		);
		const connections = path.join(repoRoot, "src", "db", "connections.ts");
		const script = `
import("node:url").then(({ pathToFileURL }) => import(pathToFileURL(${JSON.stringify(connections)}).href)).then(
	() => { process.stdout.write(JSON.stringify({ outcome: "imported", leaked: false })); process.exit(0); },
	(error) => {
		const text = String(error && error.message) + String(error && error.stack);
		process.stdout.write(JSON.stringify({ outcome: String(error && error.name), leaked: /neon|segredo|u:/.test(text) }));
		process.exit(0);
	}
);
`;
		const scriptPath = path.join(
			dir,
			options.directTestFile ? "f.test.mjs" : "probe.cjs"
		);
		writeFileSync(scriptPath, script);
		const launcher = options.directTestFile
			? [require.resolve("tsx/cli"), scriptPath]
			: ["--import", require.resolve("tsx"), scriptPath];
		const child = spawnSync(process.execPath, launcher, {
			cwd: dir,
			encoding: "utf8",
			env: { PATH: process.env.PATH ?? "", ...extraEnv },
		});
		assert.equal(child.status, 0, child.stderr.slice(0, 2000));
		return JSON.parse(child.stdout) as { leaked: boolean; outcome: string };
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
}

test("connections.ts recusa um DATABASE_URL neon num filho do test runner, sem imprimir a URL", () => {
	assert.deepEqual(
		importConnectionsInChild({ NODE_TEST_CONTEXT: "child-v8" }),
		{
			leaked: false,
			outcome: "UnsafeTestDatabaseError",
		}
	);
});

test("connections.ts recusa um DATABASE_URL neon quando um arquivo .test.mjs roda direto com tsx, sem imprimir a URL", () => {
	assert.deepEqual(importConnectionsInChild({}, { directTestFile: true }), {
		leaked: false,
		outcome: "UnsafeTestDatabaseError",
	});
});

test("connections.ts não interfere fora de um processo de teste (produção inalterada)", () => {
	assert.deepEqual(importConnectionsInChild({}), {
		leaked: false,
		outcome: "imported",
	});
});

// ---------------------------------------------------------------------------
// Tester E-R3a: limites do gatilho `argv[1]` do step 20 (D-8).
// ---------------------------------------------------------------------------

function directEntryForbidden(entry: string): boolean {
	return isForbiddenTestConnection({
		argv: ["/usr/bin/node", entry],
		env: {},
		execArgv: [],
		url: fakeNeonUrl,
	});
}

test("tester E-R3a: todas as extensões .test.* que o tsx executa contam como entrada de teste", () => {
	for (const entry of [
		"/r/a.test.ts",
		"/r/a.test.mts",
		"/r/a.test.cts",
		"/r/a.test.tsx",
		"/r/a.test.js",
		"/r/a.test.mjs",
		"/r/a.test.cjs",
		"/r/a.test.jsx",
		"D:\\r\\a.test.mts",
	]) {
		assert.equal(directEntryForbidden(entry), true, entry);
	}
});

test("tester E-R3a: nomes parecidos com teste não disparam (sem falso positivo)", () => {
	for (const entry of [
		"/app/dist/latest.js",
		"/app/dist/contest.js",
		"/app/attest.ts",
		"/app/f.test.ts.bak",
		"/app/tests/dist/server.js",
		"/app/src/test/x.ts",
		"C:\\app\\dist\\server.js",
	]) {
		assert.equal(directEntryForbidden(entry), false, entry);
	}
});

test("E-12c: .spec.ts executado direto também é processo de teste", {
	todo: "E-12c — D-8 só reconhece .test.*; o repo não tem .spec.* hoje (planner)",
}, () => {
	assert.equal(directEntryForbidden("/repo/src/f.spec.ts"), true);
});

test("E-12d: produção num diretório pai que tem src/tests não recusa o DATABASE_URL", {
	todo: "E-12d — D-8 procura src/tests em qualquer ponto do caminho, não relativo à raiz do repo (planner)",
}, () => {
	assert.equal(
		directEntryForbidden("/srv/src/tests/mariana/dist/server.js"),
		false
	);
});

// ---------------------------------------------------------------------------
// Tester E-R3b: limites do passo 21 (D-9). Sem conexão.
// ---------------------------------------------------------------------------

function threeWayCredentials(url: string) {
	const parsed = new URL(url);
	const guard = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
	const { options } = postgres(url);
	const postgresJs = `${options.user}:${String(options.pass)}`;
	const pg = parsePgConnectionString(url);
	return { guard, pg: `${pg.user}:${pg.password}`, postgresJs };
}

test("tester E-R3b: espaço Unicode (NBSP, U+2028, U+2029, BOM, U+3000) é recusado em qualquer parte", () => {
	const base = "postgresql://mariana:mariana@localhost:5432/mariana_test";
	for (const url of [
		`${base} `,
		`﻿${base}`,
		"postgresql://mariana:mariana@local host:5432/mariana_test",
		"postgresql://mariana:mariana@localhost:5432/mariana test",
		"postgresql://mariana:mariana@localhost:5432/mariana test",
		"postgresql://mariana:pa　ss@localhost:5432/mariana_test",
	]) {
		assert.throws(
			() => resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }),
			(error: unknown) => {
				assert.ok(error instanceof UnsafeTestDatabaseError, String(error));
				assert.ok(!error.message.includes("mariana:"), error.message);
				return true;
			},
			JSON.stringify(url)
		);
	}
});

test("tester E-R3b: % na porta, %25 no host e %25 no banco são recusados", () => {
	for (const url of [
		"postgresql://mariana:mariana@localhost:54%332/mariana_test",
		"postgresql://mariana:mariana@localhost:%35432/mariana_test",
		"postgresql://mariana:mariana@local%25host:5432/mariana_test",
		"postgresql://mariana:mariana@localhost:5432/mariana%25test",
	]) {
		assert.throws(
			() => resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }),
			UnsafeTestDatabaseError,
			url
		);
	}
});

test("tester E-R3b: % no usuário e %25/%40 na senha passam e os três leem o mesmo usuário e senha", () => {
	for (const [url, expected] of [
		[
			"postgresql://mari%61na:mariana@localhost:5432/mariana_test",
			"mariana:mariana",
		],
		["postgresql://u%40x:mariana@localhost:5432/mariana_test", "u@x:mariana"],
		["postgresql://mariana:p%25w@localhost:5432/mariana_test", "mariana:p%w"],
		[
			"postgresql://mariana:p%2540w@localhost:5432/mariana_test",
			"mariana:p%40w",
		],
		[
			"postgresql://mariana:pa%40ss@localhost:5432/mariana_test",
			"mariana:pa@ss",
		],
	] as const) {
		assert.equal(
			resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }).DATABASE_URL,
			url
		);
		const credentials = threeWayCredentials(url);
		assert.deepEqual(
			credentials,
			{ guard: expected, pg: expected, postgresJs: expected },
			url
		);
		const { guard, pg, postgresJs } = threeWayIdentity(url);
		assert.equal(postgresJs, guard, url);
		assert.equal(pg, guard, url);
	}
});

// E-11b (tester, E-R3b): o WHATWG URL e o postgres.js mantêm o nome do banco
// percent-codificado (`mariana%E2%80%8Btest`); o pg decodifica. D-9 só olha
// `%` no texto cru, então caracteres não-ASCII (zero-width, C1, acento) no
// banco passam e o pg lê outro banco. O host continua o mesmo (localhost).
test("E-11b: guard recusa caractere não-ASCII no nome do banco (pg lê outro banco)", {
	todo: "E-11b — D-9 não cobre não-ASCII no caminho; decisão do planner",
}, () => {
	for (const url of [
		"postgresql://mariana:mariana@localhost:5432/mariana_test​",
		"postgresql://mariana:mariana@localhost:5432/mariana‍test",
		"postgresql://mariana:mariana@localhost:5432/mariana\u0085test",
		"postgresql://mariana:mariana@localhost:5432/mariana_tést",
		'postgresql://mariana:mariana@localhost:5432/mariana"test',
	]) {
		const { guard, pg } = threeWayIdentity(url);
		assert.notEqual(pg, guard, `controle: ${JSON.stringify(url)}`);
		assert.throws(
			() => resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }),
			UnsafeTestDatabaseError,
			JSON.stringify(url)
		);
	}
});

// E-16 (tester, E-R3b): sem "//" depois do esquema (erro de digitação comum),
// o WHATWG URL lê host vazio e põe o userinfo no caminho; a mensagem de host
// não local imprime `databaseIdentity`, ou seja, a senha.
test("E-16: URL sem // não imprime a senha na mensagem de recusa", () => {
	for (const url of [
		"postgresql:mariana:SEGREDO@localhost:5432/mariana_test",
		"postgresql:/mariana:SEGREDO@localhost:5432/mariana_test",
	]) {
		assert.throws(
			() => resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }),
			(error: unknown) => {
				assert.ok(error instanceof UnsafeTestDatabaseError, String(error));
				assert.ok(!error.message.includes("SEGREDO"), error.message);
				return true;
			}
		);
	}
});

// E-16 (implementer): todo caminho de recusa roda com uma senha canário. O
// canário não pode aparecer na mensagem, no `inspect` do erro (inclui `cause`,
// cujo `input` do TypeError de `new URL` traz a URL inteira) nem nos avisos.
test("E-16: nenhum caminho de recusa imprime a senha (canário)", () => {
	const canary = "C4n4ryPw9x";
	const u = `u:${canary}`;
	const refused = [
		`postgresql://${u}@localhost:5432/db `,
		`postgresql://${u}@localhost:5432/d\u0001b`,
		`postgresql://${u}@local%68ost:5432/db`,
		`postgresql://${u}@localhost:5432/mariana%5Ftest`,
		`postgresql://${u}@ho^st:5432/db`,
		`mysql://${u}@localhost:5432/db`,
		`postgresql:${u}@localhost:5432/db`,
		`postgresql:/${u}@localhost:5432/db`,
		`postgresql:///${u}@localhost:5432/db`,
		`postgresql://${u}@ep-x.${NEON_HOST}:5432/db`,
		`postgresql://${u}@localhost:5432/db?host=x`,
		`postgresql://${u}@x@localhost:5432/db`,
		`postgresql://${u}@localhost,db.example.com:5432/db`,
		`postgresql://${u}@[0:0:0:0:0:0:0:1]:5432/db`,
		`postgresql://${u}@db.example.com:5432/db`,
		`postgresql://${u}@localhost/db`,
		`postgresql://${u}@localhost:5432/a/b`,
	];
	const local = `postgresql://${u}@localhost:5432/mariana_test`;
	const printed: string[] = [];
	const warn = mock.method(console, "warn", (...args: unknown[]) => {
		printed.push(inspect(args));
	});
	const refuse = (label: string, run: () => unknown) => {
		assert.throws(
			run,
			(error: unknown) => {
				assert.ok(error instanceof UnsafeTestDatabaseError, label);
				printed.push(inspect(error));
				return true;
			},
			label
		);
	};
	try {
		for (const allow of [{}, { ALLOW_REMOTE_TEST_DB: "1" }]) {
			for (const url of refused) {
				if (
					allow.ALLOW_REMOTE_TEST_DB &&
					url.includes("db.example.com:5432/db")
				) {
					continue;
				}
				refuse(url, () =>
					resolveTestDatabaseEnv({ ...allow, TEST_DATABASE_URL: url })
				);
				refuse(url, () =>
					assertAppliedTestDatabaseEnv({ ...allow, TEST_DATABASE_URL: url })
				);
			}
		}
		// Host remoto liberado: o aviso também não pode mostrar a senha.
		resolveTestDatabaseEnv({
			ALLOW_REMOTE_TEST_DB: "1",
			TEST_DATABASE_URL: `postgresql://${u}@db.example.com:5432/db`,
		});
		refuse("same database", () =>
			resolveTestDatabaseEnv({ DATABASE_URL: local, TEST_DATABASE_URL: local })
		);
		refuse("workers", () =>
			resolveTestDatabaseEnv({
				RELIABILITY_WORKERS_ENABLED: "true",
				TEST_DATABASE_URL: local,
			})
		);
		for (const devUrl of [
			`postgresql:${u}@localhost:5432/db`,
			`postgresql://${u}@ho^st:5432/db`,
		]) {
			refuse(devUrl, () =>
				resolveTestDatabaseEnv({
					DATABASE_URL: devUrl,
					TEST_DATABASE_URL: local,
				})
			);
		}
		refuse("not applied", () =>
			assertAppliedTestDatabaseEnv({ TEST_DATABASE_URL: local })
		);
		refuse("node env", () =>
			assertAppliedTestDatabaseEnv({
				DATABASE_URL: local,
				TEST_DATABASE_URL: local,
			})
		);
		refuse("applied workers", () =>
			assertAppliedTestDatabaseEnv({
				DATABASE_URL: local,
				NODE_ENV: "test",
				TEST_DATABASE_URL: local,
			})
		);
		for (const url of [
			`postgresql:${u}@localhost:5432/db`,
			`postgresql:///${u}@localhost:5432/db`,
			`postgresql://${u}@ho^st:5432/db`,
		]) {
			refuse(url, () => describeDatabaseHost(url));
		}
	} finally {
		warn.mock.restore();
	}
	assert.ok(printed.length > 40, String(printed.length));
	for (const text of printed) {
		assert.ok(!text.includes(canary), text);
	}
});

// E-16b (tester, E-16 fix): uma senha com "/" ou "?" sem codificar, cujo
// trecho antes desse caractere são só dígitos (`u:1234/resto@host`), faz o
// WHATWG URL ler host `u`, porta 1234 e pôr o resto da senha no caminho ou na
// query. A mensagem de host não local, o aviso de ALLOW_REMOTE_TEST_DB=1, a
// mensagem de chave de query e `describeDatabaseHost` imprimem esse trecho.
test("E-16b: senha com / ou ? sem codificar não aparece em nenhuma saída", () => {
	const canary = "C4n4ryPw9x";
	const printed: string[] = [];
	const warn = mock.method(console, "warn", (...args: unknown[]) => {
		printed.push(inspect(args));
	});
	try {
		for (const allow of [{}, { ALLOW_REMOTE_TEST_DB: "1" }]) {
			for (const url of [
				`postgresql://u:1234/${canary}@localhost:5432/db`,
				`postgresql://u:1234/${canary}@db`,
				`postgresql://u:1234?${canary}@localhost:5432/db`,
			]) {
				try {
					resolveTestDatabaseEnv({ ...allow, TEST_DATABASE_URL: url });
				} catch (error) {
					printed.push(String((error as Error).message), inspect(error));
				}
			}
		}
		try {
			printed.push(
				describeDatabaseHost(`postgresql://u:1234/${canary}@localhost:5432/db`)
			);
		} catch (error) {
			printed.push(inspect(error));
		}
	} finally {
		warn.mock.restore();
	}
	for (const text of printed) {
		assert.ok(!text.includes(canary), text);
	}
});

// E-16 (tester): formas pedidas na verificação que já saem limpas — senha com
// "@", ":", "/" (não numérico antes), "#", "%" inválido, IPv6 aberto, host
// vazio. Checa mensagem, `err.stack`, `inspect` (cadeia de `cause`) e
// `JSON.stringify(err)`, com e sem ALLOW_REMOTE_TEST_DB=1.
test("E-16: mensagem, stack, inspect e JSON do erro não mostram a senha", () => {
	const canary = "C4n4ryPw9x";
	const printed: string[] = [];
	const warn = mock.method(console, "warn", (...args: unknown[]) => {
		printed.push(inspect(args));
	});
	try {
		for (const allow of [{}, { ALLOW_REMOTE_TEST_DB: "1" }]) {
			for (const url of [
				`postgresql://u:p@${canary}@localhost:5432/db`,
				`postgresql://u:p/${canary}@localhost:5432/db`,
				`postgresql://u:1234#${canary}@localhost:5432/db`,
				`postgresql://u:${canary}@[::1`,
				`postgresql://u:${canary}@:5432/db`,
				`postgresql://u:${canary}@`,
				`postgresql://u:${canary}@localhost:5432/d%zz`,
				`postgresql://u:${canary}@local%zzhost:5432/db`,
				`postgresql://u:${canary}@localhost:99999/db`,
				`postgresql:u:${canary}@localhost:5432/db`,
				`postgresql:////u:${canary}@localhost:5432/db`,
				`postgres:\\\\u:${canary}@localhost:5432/db`,
			]) {
				assert.throws(
					() => resolveTestDatabaseEnv({ ...allow, TEST_DATABASE_URL: url }),
					(error: unknown) => {
						assert.ok(error instanceof UnsafeTestDatabaseError, url);
						printed.push(
							error.message,
							String(error.stack),
							inspect(error, { depth: 10 }),
							JSON.stringify(error),
							String((error.cause as Error | undefined)?.stack ?? "")
						);
						return true;
					},
					url
				);
			}
		}
	} finally {
		warn.mock.restore();
	}
	for (const text of printed) {
		assert.ok(!text.includes(canary), text);
	}
});

const AT_AFTER_HOST = /"@" after its host/;

// E-16b (tester, verificação): mais formas de senha. "/", "?", "#" cru, com e
// sem prefixo numérico, senha vazia antes do separador, host IPv6, esquema
// `postgres:` e maiúsculo. Todas têm um "@" depois do fim da autoridade e são
// recusadas antes de qualquer mensagem que cite caminho ou query.
test("tester E-16b: senha com /, ? ou # cru é recusada sem mostrar a senha", () => {
	const canary = "C4n4ryPw9x";
	const printed: string[] = [];
	const warn = mock.method(console, "warn", (...args: unknown[]) => {
		printed.push(inspect(args));
	});
	try {
		for (const allow of [{}, { ALLOW_REMOTE_TEST_DB: "1" }]) {
			for (const url of [
				`postgresql://u:1234#${canary}@localhost:5432/db`,
				`postgresql://u:p?${canary}@localhost:5432/db`,
				`postgresql://u:/${canary}@localhost:5432/db`,
				`postgresql://u:?${canary}@localhost:5432/db`,
				`postgresql://u:#${canary}@localhost:5432/db`,
				`postgresql://u:${canary}/@localhost:5432/db`,
				`postgresql://u:1234/${canary}@[::1]:5432/db`,
				`postgresql://u:5432/${canary}@localhost:5432/mariana_test`,
				`postgres://u:1234/${canary}@localhost:5432/db`,
				`POSTGRESQL://u:1234/${canary}@localhost:5432/db`,
			]) {
				assert.throws(
					() => resolveTestDatabaseEnv({ ...allow, TEST_DATABASE_URL: url }),
					(error: unknown) => {
						assert.ok(error instanceof UnsafeTestDatabaseError, url);
						assert.match(error.message, AT_AFTER_HOST, url);
						printed.push(error.message, inspect(error, { depth: 10 }));
						return true;
					},
					url
				);
				assert.throws(
					() => describeDatabaseHost(url),
					(error: unknown) => {
						printed.push(inspect(error, { depth: 10 }));
						return error instanceof UnsafeTestDatabaseError;
					}
				);
			}
		}
	} finally {
		warn.mock.restore();
	}
	for (const text of printed) {
		assert.ok(!text.includes(canary), text);
	}
});

// E-16b (tester): senha local legítima com %40, %2F, %3F, %23, %5C, "\" cru,
// ou só dígitos continua aceita, e o guard (WHATWG), postgres.js e pg leem a
// mesma senha, host, porta e banco. IPv6 fica de fora: postgres.js lê `[`.
test("tester E-16b: senha com %40, %2F, %3F ou só dígitos passa e os três leem igual", () => {
	for (const password of [
		"a%40b",
		"a%2Fb",
		"a%3Fb",
		"a%23b",
		"12%2F34",
		"1234",
		"a%5Cb",
		"a\\b",
	]) {
		for (const host of ["localhost", "127.0.0.1"]) {
			const url = `postgresql://mariana:${password}@${host}:5432/mariana_test`;
			const resolved = resolveTestDatabaseEnv({ TEST_DATABASE_URL: url });
			assert.equal(resolved.DATABASE_URL, url);
			const guardPassword = decodeURIComponent(new URL(url).password);
			const driver = postgres(url).options;
			const pg = parsePgConnectionString(url);
			assert.equal(driver.pass, guardPassword, url);
			assert.equal(pg.password, guardPassword, url);
			assert.deepEqual(driver.host, [host], url);
			assert.equal(pg.host, host, url);
			assert.deepEqual(driver.port, [5432], url);
			assert.equal(pg.port, "5432", url);
			assert.equal(driver.database, "mariana_test", url);
			assert.equal(pg.database, "mariana_test", url);
		}
	}
});

// E-16b (tester): userinfo sem senha (`u@`, `u:@`) continua aceito.
test("tester E-16b: userinfo sem senha é aceito", () => {
	for (const url of [
		"postgresql://mariana@localhost:5432/mariana_test",
		"postgresql://mariana:@localhost:5432/mariana_test",
	]) {
		assert.equal(
			resolveTestDatabaseEnv({ TEST_DATABASE_URL: url }).DATABASE_URL,
			url
		);
		assert.equal(new URL(url).username, "mariana", url);
		assert.equal(new URL(url).password, "", url);
	}
});
