import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
	isSessionInactivityGap,
	SESSION_INACTIVITY_MS,
} from "../services/conversations/session-choice-policy";

const DAY_MS = 4 * 60 * 60 * 1000;
const WHATSAPP_COMPLIANCE_IMPORT = /from\s+["'][^"']*whatsapp-compliance["']/;

test("4h exatas contam como inatividade, 4h menos 1 ms não", () => {
	const now = new Date("2026-10-22T12:00:00.000Z");

	assert.equal(
		isSessionInactivityGap({
			lastCustomerMessageAt: new Date(now.getTime() - DAY_MS),
			now,
		}),
		true
	);
	assert.equal(
		isSessionInactivityGap({
			lastCustomerMessageAt: new Date(now.getTime() - DAY_MS + 1),
			now,
		}),
		false
	);
});

test("timestamp nulo ou inválido não prova inatividade", () => {
	const now = new Date("2026-10-22T12:00:00.000Z");

	assert.equal(
		isSessionInactivityGap({ lastCustomerMessageAt: null, now }),
		false
	);
	assert.equal(
		isSessionInactivityGap({
			lastCustomerMessageAt: new Date("invalid"),
			now,
		}),
		false
	);
	assert.doesNotThrow(() => {
		isSessionInactivityGap({ lastCustomerMessageAt: null, now });
	});
});

test("timestamp futuro, relógio inválido ou valor não-Date não provam inatividade", () => {
	const now = new Date("2026-10-22T12:00:00.000Z");

	// Relógio do provedor adiantado (ou mensagem gravada no futuro) não pode
	// virar "gap negativo" e disparar a pergunta.
	assert.equal(
		isSessionInactivityGap({
			lastCustomerMessageAt: new Date(now.getTime() + DAY_MS),
			now,
		}),
		false
	);
	assert.equal(
		isSessionInactivityGap({
			lastCustomerMessageAt: now,
			now: new Date("invalid"),
		}),
		false
	);
	assert.equal(
		isSessionInactivityGap({ lastCustomerMessageAt: undefined, now }),
		false
	);
	// Contrato de tipo: o módulo não converte string (ex.: coluna lida como
	// texto) em data; sem Date válido não há prova de 24h.
	assert.equal(
		isSessionInactivityGap({
			lastCustomerMessageAt: new Date(
				now.getTime() - DAY_MS
			).toISOString() as unknown as Date,
			now,
		}),
		false
	);
});

test("a janela de sessão não reutiliza a janela do WhatsApp", () => {
	assert.equal(SESSION_INACTIVITY_MS, DAY_MS);

	const source = readFileSync(
		path.join(
			import.meta.dirname,
			"..",
			"services",
			"conversations",
			"session-choice-policy.ts"
		),
		"utf8"
	);

	assert.equal(WHATSAPP_COMPLIANCE_IMPORT.test(source), false);
});

// ---------------------------------------------------------------------------
// Rev1 step 23 — escolha de sessão removida (E3-a: tipos legados viram no-op)
// ---------------------------------------------------------------------------

const LEGACY_SESSION_CHOICE_TYPES = [
	"ask_session_choice",
	"remind_session_choice",
	"process_session_choice",
];

test("createAutonomousTaskHandlers não expõe a escolha de sessão como fluxo ativo", async () => {
	const { createAutonomousTaskHandlers } = await import(
		"../services/conversations/autonomous-task-handlers"
	);
	const handlers = createAutonomousTaskHandlers();
	const noop = handlers[LEGACY_SESSION_CHOICE_TYPES[0] as string];
	assert.ok(noop, "legacy types still have a handler for one release");
	for (const type of LEGACY_SESSION_CHOICE_TYPES) {
		assert.equal(handlers[type], noop, `${type} maps to the single no-op`);
	}
	for (const [type, handler] of Object.entries(handlers)) {
		if (!LEGACY_SESSION_CHOICE_TYPES.includes(type)) {
			assert.notEqual(handler, noop, `${type} is not the legacy no-op`);
		}
	}
	assert.equal(handlers.session_choice_state, undefined);

	// Sem eventId válido, o no-op não toca o banco nem responde.
	const result = await noop({
		leaseToken: "t",
		renewLease: async () => true,
		task: {
			conversationId: "00000000-0000-4000-8000-000000000000",
			payload: { buttonId: "sessao:nova", kind: "button" },
			taskType: "process_session_choice",
		},
	} as unknown as Parameters<typeof noop>[0]);
	assert.deepEqual(result, { legacySessionChoice: true });

	const policy = await import(
		"../services/conversations/session-choice-policy"
	);
	assert.deepEqual(Object.keys(policy).sort(), [
		"SESSION_INACTIVITY_MS",
		"isSessionInactivityGap",
	]);
	assert.equal(
		existsSync(
			path.join(
				import.meta.dirname,
				"..",
				"services",
				"conversations",
				"session-choice-store.ts"
			)
		),
		false,
		"session-choice-store.ts is deleted"
	);
});
