import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
	assertTestEgressAllowed,
	guardTestEgress,
	isForbiddenTestEgress,
	resolveTestNetworkPolicy,
	TestNetworkEgressError,
	takeBlockedEgressAttempts,
} from "./support/test-network-egress-guard";

const TSX_LOADER = require.resolve("tsx");
const UNIT_PRELOAD = path.resolve(
	import.meta.dirname,
	"support",
	"unit-test-preload.ts"
);

const GEMINI_HOST = "generativelanguage.googleapis.com";
const GEMINI_HOST_ERROR = /generativelanguage\.googleapis\.com/;
const LOUD_WARNING = /ALLOW_TEST_NETWORK=1/;
const PROBE_HOST = "egress-probe.invalid";
const BLOCKED_FIXTURE_HOST = /blocked egress to "example\.invalid"/;

// `lookup` falso: mesmo sem a guarda instalada, nenhum DNS real é consultado.
const fakeLookup = ((_host: string, _options: unknown, callback: unknown) => {
	(callback as (error: Error) => void)(new Error("probe lookup reached"));
}) as unknown as net.LookupFunction;

const isEgressError = (error: unknown) =>
	error instanceof Error &&
	error.name === "TestNetworkEgressError" &&
	error.message.includes(PROBE_HOST);

test("recusa um host fora do loopback e o erro nomeia o host", () => {
	assert.equal(
		isForbiddenTestEgress({ allowNetwork: false, host: GEMINI_HOST }),
		true
	);
	assert.equal(
		isForbiddenTestEgress({ allowNetwork: false, host: "10.0.0.5" }),
		true
	);
	assert.throws(
		() => assertTestEgressAllowed(GEMINI_HOST, { allowNetwork: false }),
		(error: unknown) =>
			error instanceof TestNetworkEgressError &&
			GEMINI_HOST_ERROR.test(error.message)
	);
});

test("permite 127.0.0.1, localhost e ::1", () => {
	for (const host of ["127.0.0.1", "localhost", "LOCALHOST", "::1", "[::1]"]) {
		assert.equal(
			isForbiddenTestEgress({ allowNetwork: false, host }),
			false,
			host
		);
		assert.doesNotThrow(() =>
			assertTestEgressAllowed(host, { allowNetwork: false })
		);
	}
});

test("não confunde um host que só começa com localhost ou 127.0.0.1", () => {
	for (const host of ["localhost.evil.example", "127.0.0.1.nip.io", ""]) {
		assert.equal(
			isForbiddenTestEgress({ allowNetwork: false, host }),
			true,
			host
		);
	}
});

test("ALLOW_TEST_NETWORK=1 permite tudo e registra um aviso alto", () => {
	const warnings: string[] = [];
	const policy = resolveTestNetworkPolicy({ ALLOW_TEST_NETWORK: "1" }, (line) =>
		warnings.push(line)
	);

	assert.equal(policy.allowNetwork, true);
	assert.equal(isForbiddenTestEgress({ ...policy, host: GEMINI_HOST }), false);
	assert.doesNotThrow(() => assertTestEgressAllowed(GEMINI_HOST, policy));
	assert.equal(warnings.length, 1);
	assert.match(warnings[0] ?? "", LOUD_WARNING);
});

test("sem ALLOW_TEST_NETWORK=1 a rede fica bloqueada e nada é avisado", () => {
	for (const value of [undefined, "", "0", "true"]) {
		const warnings: string[] = [];
		const policy = resolveTestNetworkPolicy(
			{ ALLOW_TEST_NETWORK: value },
			(line) => warnings.push(line)
		);

		assert.equal(policy.allowNetwork, false, String(value));
		assert.equal(warnings.length, 0);
	}
});

test("o preload instala a guarda: net.connect e http.request para fora do loopback falham localmente", {
	skip: process.env.ALLOW_TEST_NETWORK === "1",
}, () => {
	assert.throws(
		() => net.connect({ host: PROBE_HOST, lookup: fakeLookup, port: 9 }),
		isEgressError
	);
	assert.throws(
		() => http.request({ host: PROBE_HOST, lookup: fakeLookup, port: 9 }),
		isEgressError
	);
	// Bloqueios provocados de propósito: não devem falhar este arquivo.
	assert.deepEqual(takeBlockedEgressAttempts(), [PROBE_HOST, PROBE_HOST]);
});

/** Roda `fixture` com o preload unitário num `node --test` filho, cwd temporário. */
function runFixture(fixture: string, extraEnv: Record<string, string> = {}) {
	const dir = mkdtempSync(path.join(tmpdir(), "mariana-egress-fixture-"));
	try {
		const file = path.join(dir, "fixture.test.mjs");
		writeFileSync(file, fixture);
		return spawnSync(
			process.execPath,
			["--import", TSX_LOADER, "--import", UNIT_PRELOAD, "--test", file],
			{
				cwd: dir,
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "", ...extraEnv },
			}
		);
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
}

test("uma tentativa bloqueada e engolida por try/catch faz o arquivo falhar", {
	skip: process.env.ALLOW_TEST_NETWORK === "1",
}, () => {
	const result = runFixture(`import test from "node:test";
test("engole o erro", async () => {
	try {
		await fetch("https://example.invalid/");
	} catch {}
});
`);
	assert.notEqual(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout + result.stderr, BLOCKED_FIXTURE_HOST);
});

test("sem tentativa bloqueada o arquivo passa", () => {
	const result = runFixture(`import test from "node:test";
test("nada sai", () => {});
`);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("com ALLOW_TEST_NETWORK=1 nada é contado", () => {
	assert.deepEqual(takeBlockedEgressAttempts(), []);
	assert.doesNotThrow(() =>
		guardTestEgress(GEMINI_HOST, { allowNetwork: true })
	);
	assert.deepEqual(takeBlockedEgressAttempts(), []);

	assert.throws(
		() => guardTestEgress(GEMINI_HOST, { allowNetwork: false }),
		TestNetworkEgressError
	);
	assert.deepEqual(takeBlockedEgressAttempts(), [GEMINI_HOST]);
	assert.deepEqual(takeBlockedEgressAttempts(), []);

	// Com a válvula aberta a guarda nem é instalada: o lookup falso recebe a
	// chamada, nenhum pacote sai e o arquivo termina com código 0.
	const result = runFixture(
		`import test from "node:test";
import net from "node:net";
test("lookup falso", () => {
	const socket = net.connect({
		host: "egress-probe.invalid",
		lookup: (_h, _o, cb) => cb(new Error("fake lookup")),
		port: 9,
	});
	socket.on("error", () => {});
	socket.destroy();
});
`,
		{ ALLOW_TEST_NETWORK: "1" }
	);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});
