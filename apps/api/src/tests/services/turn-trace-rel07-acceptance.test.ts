/** biome-ignore-all lint/suspicious/useAwait: <> */
// Aceitação do tester (flow-review R1-a passo 1) para R-REL-07 da spec v1.2:
// "Cada turno registra um rastro mínimo: modelo usado, latência, tokens,
// etapa, e quais camadas alteraram o texto do modelo, com tamanhos e hashes,
// nunca o texto do cliente. O nome do modelo e os parâmetros (temperatura,
// raciocínio, limite de saída) vêm de variáveis de ambiente."
//
// Os testes existentes afirmam a forma da linha com metadata stubada
// (`usage: null`). Este passa pelo agente real (L0–L4) com um
// `generateContentFn` falso que devolve contagens de tokens, e afirma que
// modelo, parâmetros, latência, tokens e etapa chegam à linha emitida.
// Nenhuma chamada real ao Gemini.
import assert from "node:assert/strict";
import test from "node:test";
import type { GenerateContentResponse } from "@google/genai";

import { generateMarianaReply } from "../../ai/agent";
import { closeDatabase, db } from "../../db/connections";
import { conversations, leads } from "../../db/schema";
import { env } from "../../env";
import { hashText } from "../../lib/turn-trace";
import { generateMarianaResponse } from "../../services/conversations/generateMarianaResponse";

const MARIANA_TURN_EVENT = '"event":"mariana_turn"';
const ELEVEN_DIGITS = /\d{11}/;
const HEX_12 = /^[0-9a-f]{12}$/;
// UUIDs e hashes aleatórios podem conter 11 dígitos seguidos (~1,6% com dois
// UUIDs: a causa do flake em generate-mariana-response.test.ts:936). Eles
// saem da linha antes de procurar um telefone.
const UUID_OR_HEX12 =
	/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|"[0-9a-f]{12}"/g;

test.after(async () => {
	await closeDatabase();
});

function captureTurnTraceLines() {
	const lines: string[] = [];
	const original = console.info;

	console.info = (...args: unknown[]) => {
		if (typeof args[0] === "string" && args[0].includes(MARIANA_TURN_EVENT)) {
			lines.push(args[0]);
			return;
		}

		original(...(args as []));
	};

	return {
		lines,
		restore: () => {
			console.info = original;
		},
	};
}

test("R-REL-07: a linha do turno traz modelo e parâmetros do ambiente, latência, tokens, etapa e camadas com tamanho e hash", async () => {
	const phone = `551196${Date.now().toString().slice(-8)}`;
	const [lead] = await db
		.insert(leads)
		.values({ name: "Lead REL07", phone })
		.returning({ id: leads.id });

	assert.ok(lead);

	await db.insert(conversations).values({ leadId: lead.id });

	const clientText = `meu telefone é ${phone}, como funciona o consórcio?`;
	const rawReply =
		"O consórcio é uma compra planejada. Os grupos são formados por pessoas. E qual é o seu prazo?";
	let calls = 0;
	const capture = captureTurnTraceLines();

	try {
		await generateMarianaResponse({
			currentMessages: [clientText],
			generateMarianaReplyFn: (params) =>
				generateMarianaReply({
					...params,
					generateContentFn: () => {
						calls += 1;
						return Promise.resolve({
							candidates: [{ finishReason: "STOP" }],
							modelVersion: "gemini-fake-version-001",
							text: JSON.stringify({
								businessAction: "answer_basic_question",
								evidenceUsed: [],
								leadUpdate: { status: "qualifying" },
								nextAction: "continue_qualification",
								reply: rawReply,
							}),
							usageMetadata: {
								candidatesTokenCount: 42,
								promptTokenCount: 1234,
								thoughtsTokenCount: 17,
								totalTokenCount: 1293,
							},
						} as unknown as GenerateContentResponse);
					},
				}),
			leadId: lead.id,
			traceTurnId: "5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
		});
	} finally {
		capture.restore();
	}

	assert.equal(calls, 1);
	assert.equal(capture.lines.length, 1);

	const [line] = capture.lines;
	const trace = JSON.parse(line);

	// Modelo e parâmetros vêm do ambiente.
	assert.equal(trace.model, env.GEMINI_MODEL);
	assert.equal(trace.temperature, env.GEMINI_TEMPERATURE);
	assert.equal(trace.thinkingLevel, env.GEMINI_THINKING_LEVEL);
	assert.equal(trace.maxOutputTokens, env.GEMINI_MAX_OUTPUT_TOKENS);
	assert.equal(trace.modelVersionReturned, "gemini-fake-version-001");

	// Latência medida e tokens propagados.
	assert.equal(typeof trace.latencyMs, "number");
	assert.ok(trace.latencyMs >= 0);
	assert.deepEqual(trace.usage, {
		candidatesTokens: 42,
		promptTokens: 1234,
		thoughtsTokens: 17,
		totalTokens: 1293,
	});

	// Etapa antes e depois do turno.
	assert.equal(typeof trace.stage, "string");
	assert.ok(trace.stage.length > 0);
	assert.equal(typeof trace.postTurnStage, "string");

	// Camadas com tamanho e hash, encadeadas a partir da resposta crua.
	assert.equal(trace.rawReplyLength, rawReply.length);
	assert.equal(trace.rawReplyHash, hashText(rawReply));
	assert.ok(Array.isArray(trace.rewrites));
	for (const record of trace.rewrites) {
		assert.equal(typeof record.lengthBefore, "number");
		assert.equal(typeof record.lengthAfter, "number");
		assert.match(record.hashBefore, HEX_12);
		assert.match(record.hashAfter, HEX_12);
	}
	assert.match(trace.sentReplyHash, HEX_12);

	// Nunca o texto do cliente, o telefone ou a resposta.
	assert.equal(line.includes("telefone"), false);
	assert.equal(line.includes(phone), false);
	assert.equal(line.includes("compra planejada"), false);
	assert.equal(ELEVEN_DIGITS.test(line.replace(UUID_OR_HEX12, "")), false);
});
