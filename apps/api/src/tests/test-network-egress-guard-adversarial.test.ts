// Testes adversariais da guarda de saída de rede (passo 17, tester).
// Nenhum teste aqui faz uma requisição externa: todo host remoto é
// `egress-probe.invalid` com `lookup` falso, todo IP remoto é destruído antes
// do próximo tick, e o DNS/UDP aponta para o loopback. Os `todo` são buracos
// conhecidos (relatório: test-report-batch-E.md, seção "Step 17").
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import { lookup as esmPromisesLookup } from "node:dns/promises";
import http from "node:http";
import http2 from "node:http2";
import { request as esmHttpsRequest } from "node:https";
import net from "node:net";
import test from "node:test";
import tls from "node:tls";
import { Worker } from "node:worker_threads";

import { FAKE_EXTERNAL_ENV } from "./support/fake-external-env";
import {
	resolveTestNetworkPolicy,
	TEST_NETWORK_HATCH,
	takeBlockedEgressAttempts,
} from "./support/test-network-egress-guard";

const PROBE_HOST = "egress-probe.invalid";

// Todo bloqueio neste arquivo é provocado de propósito: drena o contador para
// que o passo 18 (falhar o arquivo em egress bloqueado) não reprove este arquivo.
test.afterEach(() => {
	takeBlockedEgressAttempts();
});

const guardOff = process.env.ALLOW_TEST_NETWORK === "1";

const lookupCalls: string[] = [];
const fakeLookup = ((host: string, _options: unknown, callback: unknown) => {
	lookupCalls.push(host);
	(callback as (error: Error) => void)(
		new Error(`fake lookup reached ${host}`)
	);
}) as unknown as net.LookupFunction;

const isEgressError = (host: string) => (error: unknown) =>
	error instanceof Error &&
	error.name === "TestNetworkEgressError" &&
	error.message.includes(host);

/** `true` se a guarda recusou; destrói o socket antes do connect real. */
function connectIsRefused(options: net.NetConnectOpts): boolean {
	try {
		const socket = net.connect(options);
		socket.on("error", () => undefined);
		socket.destroy();
		return false;
	} catch (error) {
		return error instanceof Error && error.name === "TestNetworkEgressError";
	}
}

test("guarda: tls.connect para fora do loopback falha localmente", {
	skip: guardOff,
}, () => {
	assert.throws(
		() => tls.connect({ host: PROBE_HOST, lookup: fakeLookup, port: 443 }),
		isEgressError(PROBE_HOST)
	);
});

test("guarda: http2.connect para fora do loopback falha localmente", {
	skip: guardOff,
}, () => {
	assert.throws(
		() =>
			http2.connect(`https://${PROBE_HOST}`, {
				lookup: fakeLookup,
			} as http2.SecureClientSessionOptions),
		isEgressError(PROBE_HOST)
	);
});

test("guarda: import nomeado ESM de https.request também é bloqueado", {
	skip: guardOff,
}, () => {
	assert.throws(
		() => esmHttpsRequest({ host: PROBE_HOST, lookup: fakeLookup }),
		isEgressError(PROBE_HOST)
	);
});

test("guarda: http.request(url localhost, { hostname: remoto }) não escapa pela URL", {
	skip: guardOff,
}, () => {
	assert.throws(
		() =>
			http.request("http://localhost:9/", {
				hostname: PROBE_HOST,
				lookup: fakeLookup,
			}),
		isEgressError(PROBE_HOST)
	);
});

test("guarda: import nomeado ESM de dns/promises.lookup é bloqueado", {
	skip: guardOff,
}, async () => {
	await assert.rejects(
		esmPromisesLookup(PROBE_HOST),
		isEgressError(PROBE_HOST)
	);
});

test("guarda: IP literal remoto, 0.0.0.0 e IPv4 mapeado em IPv6 são recusados", {
	skip: guardOff,
}, () => {
	for (const host of [
		"192.0.2.1",
		"0.0.0.0",
		"::ffff:192.0.2.1",
		"::ffff:127.0.0.1",
		"127.0.0.2",
		"0:0:0:0:0:0:0:1",
	]) {
		assert.equal(connectIsRefused({ host, port: 9 }), true, host);
	}
});

test("guarda: fetch com Request, URL e objeto com toString são recusados", {
	skip: guardOff,
}, async () => {
	await assert.rejects(
		fetch(new Request(`https://${PROBE_HOST}/`)),
		isEgressError(PROBE_HOST)
	);
	await assert.rejects(
		fetch(new URL(`https://${PROBE_HOST}/`)),
		(error: unknown) => isEgressError(PROBE_HOST)(error)
	);
	await assert.rejects(
		fetch({ toString: () => `https://${PROBE_HOST}/` } as unknown as string),
		(error: unknown) =>
			error instanceof Error && error.name === "TestNetworkEgressError"
	);
});

test("guarda: fetch para o loopback que redireciona para fora é bloqueado no socket", {
	skip: guardOff,
}, async (t) => {
	const server = http.createServer((_request, response) => {
		response.writeHead(302, { location: `http://${PROBE_HOST}:8080/` });
		response.end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const { port } = server.address() as net.AddressInfo;

	await assert.rejects(fetch(`http://127.0.0.1:${port}/`), (error: unknown) => {
		const { cause } = error as { cause?: unknown };
		return isEgressError(PROBE_HOST)(cause);
	});
});

test("guarda: o loopback continua acessível (servidor local em 127.0.0.1)", {
	skip: guardOff,
}, async (t) => {
	const server = http.createServer((_request, response) => response.end("ok"));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const { port } = server.address() as net.AddressInfo;

	const reply = await fetch(`http://localhost:${port}/`);
	assert.equal(await reply.text(), "ok");
});

test("válvula: só ALLOW_TEST_NETWORK=1 exato abre a rede", () => {
	for (const value of [" 1", "1 ", "01", "1\n", "yes", "TRUE", "on", "2"]) {
		const warnings: string[] = [];
		const policy = resolveTestNetworkPolicy(
			{ [TEST_NETWORK_HATCH]: value },
			(line) => warnings.push(line)
		);
		assert.equal(policy.allowNetwork, false, JSON.stringify(value));
		assert.equal(warnings.length, 0, JSON.stringify(value));
	}
});

test("válvula: as credenciais falsas não ligam ALLOW_TEST_NETWORK", () => {
	assert.equal(TEST_NETWORK_HATCH in FAKE_EXTERNAL_ENV, false);
});

// ---- Buracos conhecidos (todo). Cada um prova o vazamento sem sair da máquina.

test("buraco E-6: net.connect({ hostname: 'localhost', host: remoto }) — a guarda lê hostname, o net usa host", {
	skip: guardOff,
}, () => {
	lookupCalls.length = 0;
	assert.equal(
		connectIsRefused({
			host: PROBE_HOST,
			hostname: "localhost",
			lookup: fakeLookup,
			port: 9,
		} as net.NetConnectOpts),
		true
	);
});

test("buraco E-7: dns.Resolver/resolve* não são bloqueados (consulta UDP sai para o resolvedor)", {
	skip: guardOff,
}, async () => {
	const resolver = new dns.promises.Resolver();
	resolver.setServers(["127.0.0.1:1"]);
	await assert.rejects(
		resolver.resolve4(PROBE_HOST),
		isEgressError(PROBE_HOST)
	);
});

test("buraco E-8: dgram (UDP) não é bloqueado", {
	skip: guardOff,
}, async () => {
	const socket = dgram.createSocket({
		lookup: fakeLookup as unknown as dgram.SocketOptions["lookup"],
		type: "udp4",
	});
	try {
		await assert.rejects(
			new Promise<void>((resolve, reject) => {
				try {
					socket.send(Buffer.from("x"), 9, PROBE_HOST, (error) =>
						error ? reject(error) : resolve()
					);
				} catch (error) {
					reject(error);
				}
			}),
			(error: unknown) =>
				error instanceof Error && error.name === "TestNetworkEgressError"
		);
	} finally {
		socket.close();
	}
});

test("buraco E-9: worker_threads não herdam a guarda", {
	skip: guardOff,
	todo: "instalar a guarda também em Workers (ou proibir Worker em testes)",
}, async () => {
	const worker = new Worker(
		`require("node:worker_threads").parentPort.postMessage(typeof fetch === "function" ? fetch.name : "none")`,
		{ eval: true }
	);
	const fetchName = await new Promise((resolve) =>
		worker.once("message", resolve)
	);
	await worker.terminate();
	assert.equal(fetchName, "guardedFetch");
});

test("buraco E-9b: processo filho node não herda a guarda", {
	skip: guardOff,
	todo: "propagar o preload via NODE_OPTIONS ou documentar como fora do escopo",
}, () => {
	const child = spawnSync(process.execPath, [
		"-e",
		"process.stdout.write(globalThis.fetch.name)",
	]);
	assert.equal(child.stdout.toString(), "guardedFetch");
});

// E-14 (tester, E-R2c): se um wrapper regredir, a consulta não pode sair para o
// resolvedor do sistema. `dns.setServers` vale para `dns` e `dns.promises`.
const DEAD_RESOLVER = "127.0.0.1:1";
const systemDnsServers = dns.getServers();

test("E-7/E-8: dns.resolve* do módulo, Resolver de callback, reverse e dgram.connect também são bloqueados", {
	skip: guardOff,
}, async () => {
	const previousDnsServers = dns.getServers();
	dns.setServers([DEAD_RESOLVER]);
	try {
		await probeModuleDnsAndDgram();
	} finally {
		dns.setServers(previousDnsServers);
	}
});

async function probeModuleDnsAndDgram(): Promise<void> {
	assert.deepEqual(dns.getServers(), [DEAD_RESOLVER]);
	assert.deepEqual(dns.promises.getServers(), [DEAD_RESOLVER]);
	await assert.rejects(
		dns.promises.resolve4(PROBE_HOST),
		isEgressError(PROBE_HOST)
	);
	assert.throws(
		() => dns.resolve4(PROBE_HOST, () => undefined),
		isEgressError(PROBE_HOST)
	);
	assert.throws(
		() => dns.resolve(PROBE_HOST, "A", () => undefined),
		isEgressError(PROBE_HOST)
	);
	const resolver = new dns.Resolver();
	resolver.setServers(["127.0.0.1:1"]);
	assert.throws(
		() => resolver.resolveTxt(PROBE_HOST, () => undefined),
		isEgressError(PROBE_HOST)
	);
	await assert.rejects(
		dns.promises.reverse("192.0.2.1"),
		isEgressError("192.0.2.1")
	);
	const socket = dgram.createSocket("udp4");
	try {
		assert.throws(
			() => socket.connect(9, PROBE_HOST),
			isEgressError(PROBE_HOST)
		);
	} finally {
		socket.close();
	}
}

test("E-14: o teste E-7/E-8 restaura os servidores DNS do sistema", {
	skip: guardOff,
}, () => {
	assert.deepEqual(dns.getServers(), systemDnsServers);
	assert.deepEqual(dns.promises.getServers(), systemDnsServers);
});

// ---------------------------------------------------------------------------
// tester E-R2c: o contador do passo 18 também pega bloqueios fora do corpo do
// teste. Fixture num `node --test` filho, cwd temporário, env mínimo; o fetch é
// barrado pela guarda antes de qualquer DNS.
// ---------------------------------------------------------------------------

const ADV_TSX_LOADER = require.resolve("tsx");
const AFTER_HOOK_BLOCKED = /blocked egress to "after-hook\.invalid"/;
const LATE_TIMER_BLOCKED = /blocked egress to "late\.invalid"/;
const ADV_UNIT_PRELOAD = new URL(
	"./support/unit-test-preload.ts",
	import.meta.url
).pathname;

function runCounterFixture(fixture: string) {
	const { mkdtempSync, rmSync, writeFileSync } =
		require("node:fs") as typeof import("node:fs");
	const { tmpdir } = require("node:os") as typeof import("node:os");
	const path = require("node:path") as typeof import("node:path");
	const dir = mkdtempSync(path.join(tmpdir(), "mariana-egress-counter-"));
	try {
		const file = path.join(dir, "fixture.test.mjs");
		writeFileSync(file, fixture);
		return spawnSync(
			process.execPath,
			[
				"--import",
				ADV_TSX_LOADER,
				"--import",
				ADV_UNIT_PRELOAD,
				"--test",
				file,
			],
			{ cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } }
		);
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
}

test("tester E-R2c: bloqueio engolido num hook after falha o arquivo", {
	skip: guardOff,
}, () => {
	const result = runCounterFixture(`import test, { after } from "node:test";
test("ok", () => {});
after(async () => { try { await fetch("https://after-hook.invalid/"); } catch {} });
`);
	assert.notEqual(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout + result.stderr, AFTER_HOOK_BLOCKED);
});

test("tester E-R2c: bloqueio num timer que dispara depois do último teste falha o arquivo", {
	skip: guardOff,
}, () => {
	const result = runCounterFixture(`import test from "node:test";
test("ok", () => {
	setTimeout(async () => { try { await fetch("https://late.invalid/"); } catch {} }, 100);
});
`);
	assert.notEqual(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout + result.stderr, LATE_TIMER_BLOCKED);
});

test("buraco E-15: dns.lookupService (getnameinfo, PTR pelo resolvedor do sistema) não é bloqueado", {
	skip: guardOff,
	todo: "envolver dns.lookupService e dns.promises.lookupService com o mesmo predicado",
}, () => {
	// Só a identidade: chamar a função faria uma consulta reversa real.
	assert.notEqual(dns.lookupService.name, "lookupService");
	assert.notEqual(dns.promises.lookupService.name, "lookupService");
});
