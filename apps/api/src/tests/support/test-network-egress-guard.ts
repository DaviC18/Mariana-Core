// Guarda de saída de rede para processos de teste. Instalado pelos dois
// preloads (`unit-test-preload.ts` e `db-test-preload.ts`): uma chamada não
// mockada para Gemini, WhatsApp, Meta ou Google falha aqui, localmente, com o
// nome do host, em vez de sair da máquina. Só o loopback continua acessível
// (o Postgres local dos testes de banco). Válvula: `ALLOW_TEST_NETWORK=1`.
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";

export const TEST_NETWORK_HATCH = "ALLOW_TEST_NETWORK";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class TestNetworkEgressError extends Error {
	constructor(host: string) {
		super(
			`Test network egress blocked: a test tried to reach "${host}". Mock the call; only loopback is reachable in tests (escape hatch: ${TEST_NETWORK_HATCH}=1).`
		);
		this.name = "TestNetworkEgressError";
	}
}

export interface TestNetworkPolicy {
	allowNetwork: boolean;
}

/** Predicado puro: `true` quando o teste não pode alcançar `host`. */
export function isForbiddenTestEgress({
	allowNetwork,
	host,
}: TestNetworkPolicy & { host: string }): boolean {
	if (allowNetwork) {
		return false;
	}
	return !LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function assertTestEgressAllowed(
	host: string,
	policy: TestNetworkPolicy
): void {
	if (isForbiddenTestEgress({ ...policy, host })) {
		throw new TestNetworkEgressError(host);
	}
}

// Tentativas bloqueadas (só o host). Fica no `globalThis` porque o preload
// (ESM) e um arquivo de teste (CJS via tsx) podem carregar cópias distintas
// deste módulo; o contador precisa ser um só por processo.
const BLOCKED = Symbol.for("mariana.testNetworkEgressGuard.blocked");

function blockedAttempts(): string[] {
	const registry = globalThis as Record<symbol, unknown>;
	if (!Array.isArray(registry[BLOCKED])) {
		registry[BLOCKED] = [];
	}
	return registry[BLOCKED] as string[];
}

/** Esvazia e devolve os hosts bloqueados até agora neste processo. */
export function takeBlockedEgressAttempts(): string[] {
	return blockedAttempts().splice(0);
}

/** `assertTestEgressAllowed` que também conta o bloqueio (usado pela guarda). */
export function guardTestEgress(host: string, policy: TestNetworkPolicy): void {
	try {
		assertTestEgressAllowed(host, policy);
	} catch (error) {
		blockedAttempts().push(host);
		throw error;
	}
}

/**
 * No fim do processo, um bloqueio não drenado falha o arquivo: um `try/catch`
 * no código não pode transformar uma chamada externa não mockada em log.
 */
function failOnBlockedEgressAtExit(): void {
	process.on("exit", () => {
		const hosts = takeBlockedEgressAttempts();
		if (hosts.length === 0) {
			return;
		}
		const counts = new Map<string, number>();
		for (const host of hosts) {
			counts.set(host, (counts.get(host) ?? 0) + 1);
		}
		for (const [host, count] of counts) {
			process.stderr.write(
				`[test-network-guard] FAIL: blocked egress to "${host}" (${count}x). Mock the call.\n`
			);
		}
		process.exitCode = 1;
	});
}

export function resolveTestNetworkPolicy(
	source: Record<string, string | undefined>,
	warn: (line: string) => void = console.error
): TestNetworkPolicy {
	const allowNetwork = source[TEST_NETWORK_HATCH] === "1";
	if (allowNetwork) {
		warn(
			`[test-network-guard] WARNING: ${TEST_NETWORK_HATCH}=1 is set. Network egress is NOT blocked: an un-mocked call to Gemini, WhatsApp, Meta or Google will leave this machine.`
		);
	}
	return { allowNetwork };
}

interface HostOptions {
	host?: unknown;
	hostname?: unknown;
	path?: unknown;
}

function hostFromOptions(options: HostOptions): string {
	if (typeof options.hostname === "string") {
		return options.hostname;
	}
	if (typeof options.host === "string") {
		return options.host;
	}
	return "localhost";
}

/** Host alvo de `Socket#connect`, ou `null` para um socket IPC (local). */
function socketConnectHost(args: unknown[]): string | null {
	// `net.connect` repassa os argumentos já normalizados como um array.
	const first = Array.isArray(args[0]) ? args[0][0] : args[0];
	if (typeof first === "object" && first !== null) {
		const options = first as HostOptions;
		if (typeof options.path === "string") {
			return null;
		}
		// O `net` conecta em `host` e ignora `hostname` (E-6).
		return typeof options.host === "string" ? options.host : "localhost";
	}
	if (typeof first === "string" && Number.isNaN(Number(first))) {
		return null;
	}
	return typeof args[1] === "string" ? args[1] : "localhost";
}

function requestHost(args: unknown[]): string {
	const [first] = args;
	if (typeof first === "string" || first instanceof URL) {
		return new URL(first).hostname;
	}
	if (typeof first === "object" && first !== null) {
		return hostFromOptions(first as HostOptions);
	}
	return "localhost";
}

function fetchHost(input: unknown): string {
	if (typeof input === "string" || input instanceof URL) {
		return new URL(input).hostname;
	}
	if (input instanceof Request) {
		return new URL(input.url).hostname;
	}
	return String(input);
}

// Consultas DNS que não passam por `dns.lookup` (E-7). As funções do módulo
// são ligadas a um resolvedor padrão, então o protótipo sozinho não basta.
const DNS_QUERY_METHODS = [
	"resolve",
	"resolve4",
	"resolve6",
	"resolveAny",
	"resolveCaa",
	"resolveCname",
	"resolveMx",
	"resolveNaptr",
	"resolveNs",
	"resolvePtr",
	"resolveSoa",
	"resolveSrv",
	"resolveTxt",
	"reverse",
] as const;

function guardDnsQueries(
	target: Record<string, unknown>,
	policy: TestNetworkPolicy,
	rejects: boolean
): void {
	for (const method of DNS_QUERY_METHODS) {
		const original = target[method];
		if (typeof original !== "function") {
			continue;
		}
		target[method] = function guardedDnsQuery(
			this: unknown,
			name: unknown,
			...rest: unknown[]
		) {
			try {
				guardTestEgress(String(name), policy);
			} catch (error) {
				if (rejects) {
					return Promise.reject(error);
				}
				throw error;
			}
			return Reflect.apply(original, this, [name, ...rest]);
		};
	}
}

/** Endereço de `dgram.Socket#send`: a primeira string depois da mensagem. */
function datagramSendHost(args: unknown[]): string {
	const address = args
		.slice(1)
		.find((arg) => typeof arg === "string" && Number.isNaN(Number(arg)));
	return typeof address === "string" ? address : "localhost";
}

const INSTALLED = Symbol.for("mariana.testNetworkEgressGuard");

/**
 * Bloqueia `net` (Socket#connect, que cobre `net.connect`, `tls` e os
 * agentes HTTP), `dns.lookup`, `dns.resolve*`/`Resolver`, `dgram`,
 * `http(s).request/get` e `fetch` fora do loopback. Idempotente por processo.
 */
export function installTestNetworkGuard(
	source: Record<string, string | undefined>,
	warn: (line: string) => void = console.error
): void {
	const registry = globalThis as Record<symbol, unknown>;
	if (registry[INSTALLED]) {
		return;
	}
	registry[INSTALLED] = true;

	const policy = resolveTestNetworkPolicy(source, warn);
	if (policy.allowNetwork) {
		return;
	}
	failOnBlockedEgressAtExit();

	const originalSocketConnect = net.Socket.prototype.connect;
	net.Socket.prototype.connect = function guardedConnect(
		this: net.Socket,
		...args: unknown[]
	) {
		const host = socketConnectHost(args);
		if (host !== null) {
			guardTestEgress(host, policy);
		}
		return Reflect.apply(originalSocketConnect, this, args);
	} as typeof net.Socket.prototype.connect;

	const originalLookup = dns.lookup;
	dns.lookup = function guardedLookup(hostname: string, ...rest: unknown[]) {
		guardTestEgress(String(hostname), policy);
		return Reflect.apply(originalLookup, dns, [hostname, ...rest]);
	} as typeof dns.lookup;

	const originalPromisesLookup = dns.promises.lookup;
	dns.promises.lookup = function guardedPromisesLookup(
		hostname: string,
		...rest: unknown[]
	) {
		try {
			guardTestEgress(String(hostname), policy);
		} catch (error) {
			return Promise.reject(error);
		}
		return Reflect.apply(originalPromisesLookup, dns.promises, [
			hostname,
			...rest,
		]);
	} as typeof dns.promises.lookup;

	guardDnsQueries(dns as unknown as Record<string, unknown>, policy, false);
	guardDnsQueries(
		dns.Resolver.prototype as unknown as Record<string, unknown>,
		policy,
		false
	);
	guardDnsQueries(
		dns.promises as unknown as Record<string, unknown>,
		policy,
		true
	);
	guardDnsQueries(
		dns.promises.Resolver.prototype as unknown as Record<string, unknown>,
		policy,
		true
	);

	const originalDatagramSend = dgram.Socket.prototype.send;
	dgram.Socket.prototype.send = function guardedDatagramSend(
		this: dgram.Socket,
		...args: unknown[]
	) {
		guardTestEgress(datagramSendHost(args), policy);
		return Reflect.apply(originalDatagramSend, this, args);
	} as typeof dgram.Socket.prototype.send;

	const originalDatagramConnect = dgram.Socket.prototype.connect;
	dgram.Socket.prototype.connect = function guardedDatagramConnect(
		this: dgram.Socket,
		...args: unknown[]
	) {
		guardTestEgress(
			typeof args[1] === "string" ? args[1] : "localhost",
			policy
		);
		return Reflect.apply(originalDatagramConnect, this, args);
	} as typeof dgram.Socket.prototype.connect;

	for (const client of [http, https]) {
		for (const method of ["request", "get"] as const) {
			const original = client[method];
			client[method] = function guardedRequest(...args: unknown[]) {
				guardTestEgress(requestHost(args), policy);
				return Reflect.apply(original, client, args);
			} as typeof original;
		}
	}

	const originalFetch = globalThis.fetch;
	globalThis.fetch = function guardedFetch(
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1]
	) {
		try {
			guardTestEgress(fetchHost(input), policy);
		} catch (error) {
			return Promise.reject(error);
		}
		return originalFetch(input, init);
	} as typeof fetch;

	syncBuiltinESMExports();
}
