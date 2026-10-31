import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
	isClearNegative,
	isGreetingOnly,
	type RouterState,
	routeStartScheduling,
	routeTurn,
	routeUnderstood,
	type SchedulingGate,
	UNDERSTAND_INTENTS,
} from "../../../services/flow-v2/router";

const BASE: RouterState = {
	hasActiveSession: false,
	hasAssistantReply: false,
	hasFutureAppointment: false,
	optedOut: false,
	pendingOffer: null,
};

function route(state: Partial<RouterState>, messages: string[]) {
	return routeTurn({ ...BASE, ...state }, { messages }).route;
}

test("R1: opt-out never replies and never calls the AI", () => {
	for (const messages of [["oi"], ["sim"], ["como funciona?"]]) {
		assert.equal(
			route({ optedOut: true, pendingOffer: "consultant_offer" }, messages),
			"R1"
		);
	}
});

test("R4: greeting only, no assistant reply yet → T-WELCOME", () => {
	for (const text of [
		"oi",
		"Oi!",
		"olá",
		"Bom dia 😀",
		"boa tarde!!",
		"BOA NOITE",
		"e aí",
		"opa",
		"oi, tudo bem?",
	]) {
		assert.equal(isGreetingOnly(text), true, text);
		assert.equal(route({}, [text]), "R4", text);
	}
	assert.equal(route({}, ["oi", "bom dia"]), "R4");
});

test("R5: greeting only after an assistant reply → T-GREETING-AGAIN", () => {
	assert.equal(route({ hasAssistantReply: true }, ["oi"]), "R5");
	assert.equal(
		route({ hasAssistantReply: true, pendingOffer: "consultant_offer" }, [
			"bom dia",
		]),
		"R5"
	);
});

test("R6 yes: pending consultant offer + clear affirmative → R8", () => {
	for (const text of ["sim", "Sim!", "pode ser", "quero sim", "ok"]) {
		assert.equal(
			route({ hasAssistantReply: true, pendingOffer: "consultant_offer" }, [
				text,
			]),
			"R6-accept",
			text
		);
	}
	assert.equal(
		route({ hasAssistantReply: true, pendingOffer: null }, ["sim"]),
		"R7"
	);
	assert.equal(
		route({ hasAssistantReply: true, pendingOffer: "objective_question" }, [
			"sim",
		]),
		"R7"
	);
});

test("R6 no: pending consultant offer + clear negative → T-DECLINE", () => {
	for (const text of [
		"não",
		"Não.",
		"nao",
		"agora não",
		"não, obrigado",
		"não obrigada",
	]) {
		assert.equal(isClearNegative(text), true, text);
		assert.equal(
			route({ hasAssistantReply: true, pendingOffer: "consultant_offer" }, [
				text,
			]),
			"R6-decline",
			text
		);
	}
	assert.equal(
		route({ hasAssistantReply: true, pendingOffer: null }, ["não"]),
		"R7"
	);
});

test("N1: pending consultant offer → yes/no lists run before the greeting rules", () => {
	const offer: Partial<RouterState> = {
		hasAssistantReply: true,
		pendingOffer: "consultant_offer",
	};
	for (const text of [
		"tudo bem",
		"Opa!",
		"tudo bem!",
		"fechado",
		"com certeza",
	]) {
		assert.equal(route(offer, [text]), "R6-accept", text);
	}
	// Sem oferta pendente, continuam sendo saudação.
	assert.equal(route({ hasAssistantReply: true }, ["tudo bem"]), "R5");
	assert.equal(route({}, ["opa"]), "R4");
	// Saudação que não é sim/não segue como saudação.
	assert.equal(route(offer, ["bom dia"]), "R5");
});

test("N2: closed 'no' list covers common compound forms", () => {
	const offer: Partial<RouterState> = {
		hasAssistantReply: true,
		pendingOffer: "consultant_offer",
	};
	for (const text of [
		"não, agora não",
		"Agora não.",
		"não obrigado",
		"depois",
		"mais tarde",
		"deixa pra depois",
		"agora não, obrigada",
	]) {
		assert.equal(isClearNegative(text), true, text);
		assert.equal(route(offer, [text]), "R6-decline", text);
	}
	for (const text of ["depois eu vejo o preço", "não sei", "nãão"]) {
		assert.equal(isClearNegative(text), false, text);
	}
});

test("A4 list: consultant / scheduling → R8 without the AI", () => {
	for (const text of [
		"quero falar com consultor",
		"Quero falar com o consultor!",
		"quero marcar",
		"agendar",
		"marcar reunião",
		"oi, quero marcar uma reunião",
		"quero agendar, por favor",
	]) {
		assert.equal(route({}, [text]), "list-consultant", text);
		assert.equal(route({ hasAssistantReply: true }, [text]), "list-consultant");
	}
});

test("A4 list: sensitive → T-SENSITIVE without the AI", () => {
	for (const text of [
		"quanto é a parcela?",
		"qual a taxa?",
		"lance",
		"simulação",
		"valor da parcela",
		"quanto fica a parcela",
		"Mariana, qual o valor da parcela?",
	]) {
		assert.equal(
			route({ hasAssistantReply: true }, [text]),
			"list-sensitive",
			text
		);
	}
});

test("A4 list: status / thanks with a future appointment → T-APPOINTMENT-INFO", () => {
	const booked: Partial<RouterState> = {
		hasAssistantReply: true,
		hasFutureAppointment: true,
	};
	for (const text of [
		"está confirmada?",
		"tá marcado?",
		"quando é a reunião?",
		"obrigado",
		"Obrigada!",
		"valeu",
		"muito obrigado",
	]) {
		assert.equal(route(booked, [text]), "list-appointment-info", text);
	}
	// Agradecimento sem reunião futura não é a lista: vai para a IA.
	assert.equal(route({ hasAssistantReply: true }, ["obrigado"]), "R7");
});

test("A4 list: status during an open scheduling session → stage status", () => {
	const scheduling: Partial<RouterState> = {
		hasActiveSession: true,
		hasAssistantReply: true,
	};
	for (const text of ["está confirmada?", "tá marcado?", "ta confirmado"]) {
		assert.equal(route(scheduling, [text]), "list-status", text);
	}
	// Sem sessão nem reunião, a pergunta de status vai para a IA.
	assert.equal(route({ hasAssistantReply: true }, ["está confirmada?"]), "R7");
	// Agradecimento durante o agendamento não é status.
	assert.equal(route(scheduling, ["obrigado"]), "R7");
});

test("A4 list: reschedule → R7d without the AI", () => {
	for (const text of [
		"remarcar",
		"quero remarcar",
		"mudar o horário",
		"trocar o horário",
		"cancelar a reunião",
		"desmarcar",
	]) {
		assert.equal(
			route({ hasAssistantReply: true, hasFutureAppointment: true }, [text]),
			"list-reschedule",
			text
		);
	}
});

test("A4 lists stay closed: free text with substance goes to the AI", () => {
	for (const text of [
		"oi, quero saber como funciona",
		"quanto tempo dura a reunião?",
		"quero marcar mas antes quanto custa?",
		"qual a taxa de administração da ademicon comparada com outros?",
		"lanceiro",
		"obrigado, e como funciona o lance?",
	]) {
		assert.equal(
			route({ hasAssistantReply: true, hasFutureAppointment: true }, [text]),
			"R7",
			text
		);
	}
	// Um lote com uma mensagem fora da lista vai inteiro para a IA.
	assert.equal(route({}, ["quero marcar", "como funciona?"]), "R7");
});

test("unsure → AI", () => {
	const offer: Partial<RouterState> = {
		hasAssistantReply: true,
		pendingOffer: "consultant_offer",
	};

	for (const text of [
		"oi, quero saber como funciona o consórcio de carro",
		"olá mariana",
		"bom dia, tudo bem? quanto custa? e como funciona?",
		"",
	]) {
		assert.equal(isGreetingOnly(text), false, text);
		assert.equal(route({}, [text]), "R7", text);
	}
	for (const text of [
		"sim, mas quanto custa?",
		"talvez",
		"não sei",
		"não, quero outro horário",
		"sim?",
	]) {
		assert.equal(route(offer, [text]), "R7", text);
	}
	assert.equal(route(offer, ["sim", "não"]), "R7");
	assert.equal(route({}, ["oi", "como funciona?"]), "R7");
});

test("R7a–R7d: understood intent maps to one responder", () => {
	const expected: Record<(typeof UNDERSTAND_INTENTS)[number], string> = {
		accept_offer: "R7c",
		decline_offer: "R7c",
		off_topic: "R7c",
		provides_info: "R7c",
		question: "R7c",
		reschedule_or_cancel: "R7d",
		schedule_status: "R7c",
		sensitive_question: "R7b",
		smalltalk: "R7c",
		unclear: "R7c",
		wants_consultant: "R7a",
	};

	for (const intent of UNDERSTAND_INTENTS) {
		assert.equal(
			routeUnderstood(
				{ pendingOffer: null },
				{ hasObjective: false, intent, reply: "Resposta." }
			).route,
			expected[intent],
			intent
		);
	}

	// accept_offer only counts with the backend marker.
	assert.equal(
		routeUnderstood(
			{ pendingOffer: "consultant_offer" },
			{ hasObjective: false, intent: "accept_offer", reply: null }
		).route,
		"R7a"
	);
	// The objective question was answered → R8 ("then slots").
	assert.equal(
		routeUnderstood(
			{ pendingOffer: "objective_question" },
			{ hasObjective: true, intent: "provides_info", reply: "Legal!" }
		).route,
		"R7a"
	);
	assert.equal(
		routeUnderstood(
			{ pendingOffer: null },
			{ hasObjective: true, intent: "provides_info", reply: "Legal!" }
		).route,
		"R7c"
	);
	// No reply → fixed fallback, never an empty send.
	assert.equal(
		routeUnderstood(
			{ pendingOffer: null },
			{ hasObjective: false, intent: "question", reply: null }
		).route,
		"R7c-fallback"
	);
	assert.equal(
		routeUnderstood(
			{ pendingOffer: null },
			{ hasObjective: false, intent: "question", reply: "   " }
		).route,
		"R7c-fallback"
	);
	// C1: schedule_status only becomes the fixed state text during a session.
	assert.equal(
		routeUnderstood(
			{ hasActiveSession: true, pendingOffer: null },
			{ hasObjective: false, intent: "schedule_status", reply: null }
		).route,
		"R7e-status"
	);
	assert.equal(
		routeUnderstood(
			{ hasActiveSession: false, pendingOffer: null },
			{ hasObjective: false, intent: "schedule_status", reply: null }
		).route,
		"R7c-fallback"
	);
	// C2 (R-SES-05): a future appointment wins over the session for status.
	assert.equal(
		routeUnderstood(
			{
				hasActiveSession: false,
				hasFutureAppointment: true,
				pendingOffer: null,
			},
			{ hasObjective: false, intent: "schedule_status", reply: null }
		).route,
		"R7-appointment-info"
	);
	assert.equal(
		routeUnderstood(
			{
				hasActiveSession: true,
				hasFutureAppointment: true,
				pendingOffer: null,
			},
			{ hasObjective: false, intent: "schedule_status", reply: null }
		).route,
		"R7-appointment-info"
	);
});

test("R8 precedence: under 18, future appointment, active stage, objective, slots", () => {
	const gate: SchedulingGate = {
		askedObjective: false,
		hasActiveSession: true,
		hasFutureAppointment: true,
		objectiveKnown: false,
		underAge: true,
	};

	assert.equal(routeStartScheduling(gate), "R8-under-18");
	assert.equal(
		routeStartScheduling({ ...gate, underAge: false }),
		"R8-appointment-info"
	);
	assert.equal(
		routeStartScheduling({
			...gate,
			hasFutureAppointment: false,
			underAge: false,
		}),
		"R8-stage-buttons"
	);
	assert.equal(
		routeStartScheduling({
			...gate,
			hasActiveSession: false,
			hasFutureAppointment: false,
			underAge: false,
		}),
		"R8-ask-objective"
	);
	assert.equal(
		routeStartScheduling({
			askedObjective: true,
			hasActiveSession: false,
			hasFutureAppointment: false,
			objectiveKnown: false,
			underAge: false,
		}),
		"R8-offer"
	);
	assert.equal(
		routeStartScheduling({
			askedObjective: false,
			hasActiveSession: false,
			hasFutureAppointment: false,
			objectiveKnown: true,
			underAge: false,
		}),
		"R8-offer"
	);
});

const SRC = path.join(import.meta.dirname, "..", "..", "..");
const FLOW_V2_DIR = path.join(SRC, "services", "flow-v2");
const FORBIDDEN_V1_BRAIN = [
	"ai/agent.ts",
	"ai/prompt.ts",
	"ai/knowledge/retrieve.ts",
	"ai/knowledge/validate-response.ts",
	"ai/schemas/mariana-response-schema.ts",
	"services/agent/execute-next-action.ts",
	"services/conversations/conversation-stage.ts",
	"services/conversations/generateMarianaResponse.ts",
	"services/conversations/mariana-safety.ts",
].map((file) => path.join(SRC, file));
const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

function listTs(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			return listTs(full);
		}
		return full.endsWith(".ts") ? [full] : [];
	});
}

function resolveImport(from: string, specifier: string): string | null {
	const base = path.resolve(path.dirname(from), specifier);
	for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			return candidate;
		}
	}
	return null;
}

test("flow-v2 imports no v1-brain module", () => {
	const roots = listTs(FLOW_V2_DIR);
	assert.ok(roots.length >= 2, "flow-v2 has no modules to check");

	const seen = new Set<string>();
	const parents = new Map<string, string>();
	const queue = [...roots];

	while (queue.length > 0) {
		const file = queue.shift() as string;
		if (seen.has(file)) {
			continue;
		}
		seen.add(file);

		for (const match of readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)) {
			const resolved = resolveImport(file, match[1] as string);
			assert.ok(resolved, `unresolved import ${match[1]} in ${file}`);
			if (!seen.has(resolved)) {
				parents.set(resolved, file);
				queue.push(resolved);
			}
		}
	}

	for (const forbidden of FORBIDDEN_V1_BRAIN) {
		assert.ok(existsSync(forbidden), `forbidden list is stale: ${forbidden}`);
		const chain: string[] = [];
		let cursor: string | undefined = forbidden;
		while (cursor && seen.has(forbidden)) {
			chain.unshift(path.relative(SRC, cursor));
			cursor = parents.get(cursor);
		}
		assert.equal(
			seen.has(forbidden),
			false,
			`flow-v2 reaches a v1-brain file: ${chain.join(" → ")}`
		);
	}
});

// Tester (Batch A): casos adversariais do roteador.
test("tester: greeting plus content is never greeting-only", () => {
	for (const text of [
		"oi, quero saber como funciona o consórcio de carro",
		"bom dia, sim",
		"olá 123",
	]) {
		assert.equal(isGreetingOnly(text), false, text);
		assert.equal(route({}, [text]), "R7", text);
	}
	// A4: saudação + frase da lista fechada responde pela lista, não pela IA.
	assert.equal(isGreetingOnly("Oi! Quanto custa?"), false);
	assert.equal(route({}, ["Oi! Quanto custa?"]), "list-sensitive");
	// Emoji sozinho não é saudação: vai para a IA.
	assert.equal(isGreetingOnly("👋"), false);
	assert.equal(route({}, ["Oi!! 👋"]), "R4");
});

test("tester: two messages in one debounce window need every message to match", () => {
	assert.equal(route({}, ["oi", "quero saber do consórcio"]), "R7");
	assert.equal(route({}, ["oi", "bom dia"]), "R4");
	assert.equal(
		route({ pendingOffer: "consultant_offer" }, ["sim", "não"]),
		"R7"
	);
	assert.equal(
		route({ pendingOffer: "consultant_offer" }, ["sim", "quanto custa?"]),
		"R7"
	);
	assert.equal(
		route({ pendingOffer: "consultant_offer" }, ["sim", "pode ser"]),
		"R6-accept"
	);
	assert.equal(route({}, []), "R7");
});

test("tester: yes/no only count with a pending consultant offer", () => {
	for (const pendingOffer of [null, "objective_question"] as const) {
		assert.equal(route({ pendingOffer }, ["sim"]), "R7");
		assert.equal(route({ pendingOffer }, ["não"]), "R7");
	}
	// Afirmativa com pergunta, negação ou adiamento nunca aceita.
	for (const text of [
		"sim, mas quanto custa?",
		"sim?",
		"não, agora não",
		"talvez depois",
		"não sei",
	]) {
		assert.notEqual(
			route({ pendingOffer: "consultant_offer" }, [text]),
			"R6-accept",
			text
		);
	}
	// N2 (A4): a negativa composta comum entrou na lista fechada.
	assert.equal(isClearNegative("não, agora não"), true);
	assert.equal(isClearNegative("não?"), false);
	assert.equal(route({ pendingOffer: "consultant_offer" }, ["não sei"]), "R7");
});

test("tester: accept_offer without a backend marker never starts scheduling", () => {
	for (const pendingOffer of [null, "objective_question"] as const) {
		assert.notEqual(
			routeUnderstood(
				{ pendingOffer },
				{ hasObjective: false, intent: "accept_offer", reply: "Ok!" }
			).route,
			"R7a"
		);
	}
	// Objetivo vindo da IA só leva a R8 quando o backend perguntou.
	assert.equal(
		routeUnderstood(
			{ pendingOffer: null },
			{ hasObjective: true, intent: "provides_info", reply: "Legal!" }
		).route,
		"R7c"
	);
});

// Tester (A4): listas fechadas, contexto e N1.
test("tester A4: near-miss phrases go to the AI in every context", () => {
	const contexts: Partial<RouterState>[] = [
		{},
		{ hasAssistantReply: true },
		{ hasActiveSession: true, hasAssistantReply: true },
		{ hasAssistantReply: true, hasFutureAppointment: true },
		{
			hasActiveSession: true,
			hasAssistantReply: true,
			hasFutureAppointment: true,
		},
	];
	for (const text of [
		"quanto tempo dura a reunião?",
		"oi, quero saber como funciona",
		"não sei se quero marcar",
		"quero marcar mas antes uma dúvida",
		"não quero falar com consultor",
		"não quero marcar",
		"quanto custa o consórcio de carro?",
		"a taxa de juros é alta?",
		"obrigado pela ajuda, quanto custa?",
		"marcar amanhã às 10",
		"quero remarcar para sexta",
		"não está confirmada?",
		"já está confirmada a reunião de amanhã com o João?",
		"obrigado mas não",
		"Mariana",
		"por favor",
	]) {
		for (const context of contexts) {
			assert.equal(
				route(context, [text]),
				"R7",
				`${text} ${JSON.stringify(context)}`
			);
		}
	}
});

test("tester A4: polite filler and a leading greeting are stripped, nothing else", () => {
	assert.equal(
		route({}, ["Mariana, quero marcar uma reunião, por favor!"]),
		"list-consultant"
	);
	assert.equal(route({}, ["Bom dia! Qual a taxa?"]), "list-sensitive");
	assert.equal(route({}, ["e aí, quero desmarcar"]), "list-reschedule");
	// Saudação no fim ou no meio não é removida.
	assert.equal(route({}, ["quanto custa, bom dia"]), "R7");
	assert.equal(route({}, ["quero tudo bem marcar"]), "R7");
});

test("tester A4: status and thanks depend on backend context only", () => {
	for (const text of ["está confirmada?", "tá marcado?"]) {
		assert.equal(route({ hasAssistantReply: true }, [text]), "R7", text);
		assert.equal(
			route({ hasActiveSession: true, hasAssistantReply: true }, [text]),
			"list-status",
			text
		);
		assert.equal(
			route({ hasAssistantReply: true, hasFutureAppointment: true }, [text]),
			"list-appointment-info",
			text
		);
	}
	for (const text of ["obrigado", "valeu!", "quando é a reunião?"]) {
		assert.equal(route({ hasAssistantReply: true }, [text]), "R7", text);
		// Agradecimento durante a sessão não é status: vai para a IA.
		assert.equal(
			route({ hasActiveSession: true, hasAssistantReply: true }, [text]),
			"R7",
			text
		);
		assert.equal(
			route({ hasAssistantReply: true, hasFutureAppointment: true }, [text]),
			"list-appointment-info",
			text
		);
	}
	// Reunião futura vence a sessão aberta.
	assert.equal(
		route(
			{
				hasActiveSession: true,
				hasAssistantReply: true,
				hasFutureAppointment: true,
			},
			["tá confirmado?"]
		),
		"list-appointment-info"
	);
	// Lote misto: todas precisam casar com a mesma lista.
	assert.equal(
		route({ hasFutureAppointment: true }, ["obrigado", "quanto custa?"]),
		"R7"
	);
	assert.equal(route({}, ["oi", "quanto custa?"]), "R7");
});

test("tester N1: 'tudo bem' / 'opa' are yes only while a consultant offer is pending", () => {
	const offer: Partial<RouterState> = {
		hasAssistantReply: true,
		pendingOffer: "consultant_offer",
	};
	for (const text of ["tudo bem", "Opa!", "tá bom", "com certeza"]) {
		assert.equal(route(offer, [text]), "R6-accept", text);
	}
	assert.equal(route({ hasAssistantReply: true }, ["tudo bem"]), "R5");
	assert.equal(route({}, ["opa"]), "R4");
	assert.equal(
		route({ hasAssistantReply: true, pendingOffer: "objective_question" }, [
			"tudo bem",
		]),
		"R5"
	);
	// "tudo bem?" é pergunta/saudação, nunca aceite.
	assert.equal(route(offer, ["tudo bem?"]), "R5");
	// "tá" sem oferta não é lista nenhuma.
	assert.equal(route({ hasAssistantReply: true }, ["tá"]), "R7");
	// Negação com oferta pendente não aceita.
	assert.equal(route(offer, ["não quero falar com consultor"]), "R7");
});
