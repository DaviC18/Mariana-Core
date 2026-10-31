// Prova, depois de `src/env.ts` ler o `.env`, que o `.env` nunca troca o
// `DATABASE_URL` do preload nem as credenciais falsas. Cada caso roda num
// processo filho com cwd numa pasta temporária que tem um `.env` falso, então o
// `.env` real nunca entra no filho. O filho só imprime nomes de chaves e
// booleanos, nunca um valor de credencial.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { envSchema } from "../env";
import { FAKE_EXTERNAL_ENV } from "./support/fake-external-env";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const TSX_LOADER = require.resolve("tsx");
const DOTENV_MAIN = require.resolve("dotenv");
const ENV_MODULE = path.join(REPO_ROOT, "src", "env.ts");
const UNIT_PRELOAD = path.join(
	REPO_ROOT,
	"src",
	"tests",
	"support",
	"unit-test-preload.ts"
);
const DB_PRELOAD = path.join(
	REPO_ROOT,
	"src",
	"tests",
	"support",
	"db-test-preload.ts"
);

const DOCTORED_DATABASE_URL = "postgresql://doctored@127.0.0.1:2/override";
const UNIT_SENTINEL_URL =
	"postgresql://unit-tests-have-no-database@127.0.0.1:1/none";
const PROBE_TEST_DATABASE_URL =
	"postgresql://mariana:mariana@localhost:5432/env_isolation_probe";

// Credenciais e ids de conta do envSchema. Ancorado no fim do nome para não
// pegar `GEMINI_MAX_OUTPUT_TOKENS`, que é configuração, não credencial.
const CREDENTIAL_KEY =
	/(KEY|TOKEN|SECRET|CLIENT_ID|EMAIL|PHONE_NUMBER_ID|WABA_ID)$/;

function missingFakeCredentials(fakes: Record<string, string>): string[] {
	return Object.keys(envSchema.shape)
		.filter((key) => CREDENTIAL_KEY.test(key))
		.filter((key) => !(key in fakes));
}

// Canário com o formato que o envSchema exige: um `*_EMAIL` precisa ser um
// e-mail válido, uma chave de admin/assinatura tem 32+ caracteres e um `*_URI`
// é a URL do callback do OAuth, senão um override quebraria o parse em vez de
// expor o canário.
function canaryValue(key: string): string {
	if (key.endsWith("_EMAIL")) {
		return `canary-${key}@example.test`;
	}
	if (key.endsWith("_URI")) {
		const host = `canary-${key.toLowerCase().replaceAll("_", "-")}`;
		return `https://${host}.example.test/auth/google/callback`;
	}
	return `canary-${key}`.padEnd(32, "-");
}

interface ProbeReport {
	canaryKeys: string[];
	envDatabaseUrlMatches: boolean;
	processDatabaseUrlMatches: boolean;
}

function runProbe(options: {
	expectedDatabaseUrl: string;
	extraEnv?: Record<string, string>;
	overrideAfterImport?: boolean;
	overrideBeforeImport?: boolean;
	preload: string;
}): ProbeReport {
	const dir = mkdtempSync(path.join(tmpdir(), "mariana-env-isolation-"));
	try {
		const dotenvLines = [
			`DATABASE_URL=${DOCTORED_DATABASE_URL}`,
			...Object.keys(FAKE_EXTERNAL_ENV).map(
				(key) => `${key}=${canaryValue(key)}`
			),
		];
		writeFileSync(path.join(dir, ".env"), `${dotenvLines.join("\n")}\n`);

		const script = `
const { pathToFileURL } = require("node:url");
(async () => {
	if (${options.overrideBeforeImport === true}) {
		require(${JSON.stringify(DOTENV_MAIN)}).config({ override: true, quiet: true });
	}
	const { env } = await import(pathToFileURL(${JSON.stringify(ENV_MODULE)}).href);
	if (${options.overrideAfterImport === true}) {
		require(${JSON.stringify(DOTENV_MAIN)}).config({ override: true, quiet: true });
	}
	const canaries = ${JSON.stringify(
		Object.fromEntries(
			Object.keys(FAKE_EXTERNAL_ENV).map((key) => [key, canaryValue(key)])
		)
	)};
	const expected = ${JSON.stringify(options.expectedDatabaseUrl)};
	process.stdout.write(JSON.stringify({
		canaryKeys: Object.keys(canaries).filter(
			(key) => process.env[key] === canaries[key] || env[key] === canaries[key]
		),
		envDatabaseUrlMatches: env.DATABASE_URL === expected,
		processDatabaseUrlMatches: process.env.DATABASE_URL === expected,
	}));
})();
`;
		const scriptPath = path.join(dir, "probe.cjs");
		writeFileSync(scriptPath, script);

		const result = spawnSync(
			process.execPath,
			["--import", TSX_LOADER, "--import", options.preload, scriptPath],
			{
				cwd: dir,
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "", ...options.extraEnv },
			}
		);
		assert.equal(
			result.status,
			0,
			`probe child failed: ${result.stderr.slice(0, 2000)}`
		);
		return JSON.parse(result.stdout) as ProbeReport;
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
}

test("com o preload unitário, o .env não troca DATABASE_URL nem credenciais", () => {
	const report = runProbe({
		expectedDatabaseUrl: UNIT_SENTINEL_URL,
		preload: UNIT_PRELOAD,
	});
	assert.deepEqual(report, {
		canaryKeys: [],
		envDatabaseUrlMatches: true,
		processDatabaseUrlMatches: true,
	});
});

test("com o preload de banco, o .env não troca DATABASE_URL nem credenciais", () => {
	const report = runProbe({
		expectedDatabaseUrl: PROBE_TEST_DATABASE_URL,
		extraEnv: { TEST_DATABASE_URL: PROBE_TEST_DATABASE_URL },
		preload: DB_PRELOAD,
	});
	assert.deepEqual(report, {
		canaryKeys: [],
		envDatabaseUrlMatches: true,
		processDatabaseUrlMatches: true,
	});
});

test("o harness detecta um dotenv com override", () => {
	const report = runProbe({
		expectedDatabaseUrl: UNIT_SENTINEL_URL,
		overrideAfterImport: true,
		preload: UNIT_PRELOAD,
	});
	assert.equal(report.processDatabaseUrlMatches, false);
	assert.deepEqual(
		[...report.canaryKeys].sort(),
		Object.keys(FAKE_EXTERNAL_ENV).sort()
	);
});

// Simula um `env.ts:1` adulterado com `override: true`: o `.env` entra antes do
// parse do envSchema. O canário precisa passar na validação (ex.: e-mail), senão
// o filho cai em "Invalid email address" e a falha não aponta o canário.
test("o harness detecta um override antes do parse do env.ts pelo canário", () => {
	const report = runProbe({
		expectedDatabaseUrl: UNIT_SENTINEL_URL,
		overrideBeforeImport: true,
		preload: UNIT_PRELOAD,
	});
	assert.equal(report.envDatabaseUrlMatches, false);
	assert.equal(report.processDatabaseUrlMatches, false);
	assert.deepEqual(
		[...report.canaryKeys].sort(),
		Object.keys(FAKE_EXTERNAL_ENV).sort()
	);
});

test("toda credencial do envSchema tem valor falso em FAKE_EXTERNAL_ENV", () => {
	assert.deepEqual(missingFakeCredentials(FAKE_EXTERNAL_ENV), []);
});

test("o controle da cobertura nomeia uma credencial sem valor falso", () => {
	const { GEMINI_API_KEY: _removed, ...withoutGemini } = FAKE_EXTERNAL_ENV;
	assert.deepEqual(missingFakeCredentials(withoutGemini), ["GEMINI_API_KEY"]);
});
