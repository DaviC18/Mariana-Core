/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/** biome-ignore-all lint/suspicious/useAwait: <> */
// Opt-in conversation simulator. Runs scripted client messages through the
// REAL generateMarianaResponse path (real Gemini) on the local test database.
// WhatsApp and Google Calendar are stubbed; nothing is sent to a client and
// no Calendar event or OAuth token is ever touched.
// Entry point: scripts/simulate-conversation.ts (`npm run sim:conversation`).

import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import { db } from "../../db/connections";
import { messages, outboundMessages } from "../../db/schema";
import { GoogleCalendarService } from "../../integrations/google-calendar/google-calendar-service";
import { WhatsAppService } from "../../integrations/whatsapp/whatsapp-service";
import { isNameKnown } from "../../services/conversations/conversation-stage";
import { generateMarianaResponse } from "../../services/conversations/generateMarianaResponse";
import {
	runFlowV2Turn,
	type UnderstandFn,
} from "../../services/flow-v2/run-turn";
import {
	buildFakeAvailabilityService,
	cleanupConversationFixture,
	createConversationFixture,
	loadLead,
} from "./conversation-harness";
import type { SimulationFlow } from "./simulation-args";
import {
	evaluateSimulatedConversation,
	type SimulatedTurn,
} from "./simulation-checks";

export interface SimulationScenario {
	id: string;
	leadName?: string;
	offerWithinTurns: number;
	title: string;
	turns: string[][];
}

export const SIMULATION_SCENARIOS: SimulationScenario[] = [
	{
		id: "1",
		leadName: "Davi",
		offerWithinTurns: 7,
		title: "Transcript de produção (lead 3cc1444c-…)",
		turns: [
			["Ola Mariana boa noite meu nome é Davi", "eu quero fazer um consorcio"],
			["eu quero comprar um carro novo"],
			[
				"eu ja tenho um veiculo mas ele é usado",
				"mas agora eu quero um novinho",
			],
			["necessidade"],
			["sim gostaria"],
			["eu ja disse isso", "veiculo"],
			["eu quero comprar um carro novo", "eu posso falar com o consultor?"],
		],
	},
	{
		id: "2",
		offerWithinTurns: 4,
		title: "Caminho feliz: oi → nome → motivo → oferta → sim",
		turns: [["oi"], ["Davi"], ["quero um carro novo"], ["sim"]],
	},
	{
		id: "3",
		leadName: "Davi",
		offerWithinTurns: 2,
		title: "Pedido explícito de consultor logo no início",
		turns: [
			["oi, quero falar com um consultor"],
			["quero comprar um apartamento"],
		],
	},
	{
		id: "8",
		leadName: "Davi",
		offerWithinTurns: 3,
		title: "Pergunta sensível → handoff + oferta na mesma mensagem",
		turns: [
			["oi, quero comprar um carro"],
			["quanto fica a parcela?"],
			["sim"],
		],
	},
];

export interface ScenarioResult {
	failures: string[];
	scenario: SimulationScenario;
	turns: SimulatedTurn[];
}

/**
 * v2 scenarios: the same plumbing (real DB, handlers' dependencies, outbox)
 * with Gemini mocked by default. Offer checks use the `R8-slots` route.
 */
export const V2_SIMULATION_SCENARIOS: SimulationScenario[] = [
	{
		id: "v2-1",
		leadName: "Davi",
		offerWithinTurns: 2,
		title: "v2: oi → consultor com objetivo → oferta",
		turns: [["oi"], ["quero um carro", "quero falar com um consultor"]],
	},
	{
		id: "v2-2",
		leadName: "Davi",
		offerWithinTurns: 1,
		title: "v2: lote único (oi + consultor + carro) → uma resposta com oferta",
		turns: [["oi", "quero falar com um consultor", "quero um carro"]],
	},
];

/** Gemini falso do simulador v2: responde, extrai o objetivo e a intenção. */
const CAR_OBJECTIVE = /carro|ve[íi]culo/;
const CONSULTANT_INTENT = /consultor|atendente/;

const simulationUnderstand: UnderstandFn = async ({ currentMessages }) => {
	const text = currentMessages.join(" ").toLowerCase();
	const objective = CAR_OBJECTIVE.test(text) ? "carro" : undefined;
	return {
		fields: objective ? { objective } : {},
		intent: CONSULTANT_INTENT.test(text) ? "wants_consultant" : "question",
		reply: "Entendi.",
	};
};

export interface SimulationOptions {
	flow?: SimulationFlow;
	/** Opt-in real Gemini (owner permission only). */
	realGemini?: boolean;
	understand?: UnderstandFn;
}

const BLOCKED = (name: string) => async () => {
	throw new Error(`${name} is blocked in the conversation simulator`);
};

// WhatsApp becomes a no-op stub; Google Calendar throws if anything reaches it.
export function stubExternalServicesForSimulation() {
	const noopSend = async () => ({
		contacts: [],
		messages: [{ id: `wamid.simulator_${Date.now()}` }],
		messaging_product: "whatsapp",
	});
	for (const method of Object.getOwnPropertyNames(WhatsAppService.prototype)) {
		if (method.startsWith("send")) {
			Object.assign(WhatsAppService.prototype, { [method]: noopSend });
		}
	}
	Object.assign(GoogleCalendarService.prototype, {
		createEvent: BLOCKED("GoogleCalendarService.createEvent"),
		deleteEvent: BLOCKED("GoogleCalendarService.deleteEvent"),
		getBusyPeriods: BLOCKED("GoogleCalendarService.getBusyPeriods"),
	});
}

export async function runScenario(
	scenario: SimulationScenario,
	options: SimulationOptions = {}
): Promise<ScenarioResult> {
	if (options.flow === "v2") {
		return await runV2Scenario(
			scenario,
			options.realGemini
				? options.understand
				: (options.understand ?? simulationUnderstand)
		);
	}

	const fixture = await createConversationFixture({ name: scenario.leadName });
	const schedulingAvailabilityService = buildFakeAvailabilityService({
		count: 0,
	});
	const turns: SimulatedTurn[] = [];

	try {
		for (const user of scenario.turns) {
			const result = await generateMarianaResponse({
				currentMessages: user,
				leadId: fixture.leadId,
				schedulingAvailabilityService,
			});
			const lead = await loadLead(fixture.leadId);

			turns.push({
				known: {
					currentSituation: Boolean(lead.currentSituation?.trim()),
					interestedInConsultant: lead.interestedInConsultant === true,
					name: isNameKnown(lead.name, lead.phone),
					objective: Boolean(lead.objective?.trim()),
					painPoint: Boolean(lead.painPoint?.trim()),
				},
				offered: Boolean(result.schedulingOffer),
				reply: result.result.reply,
				user,
			});

			if (result.schedulingOffer) {
				break;
			}
		}
	} finally {
		await cleanupConversationFixture(fixture.leadId);
	}

	return {
		failures: evaluateSimulatedConversation({
			offerWithinTurns: scenario.offerWithinTurns,
			turns,
		}),
		scenario,
		turns,
	};
}

/** v2 path: real `runFlowV2Turn`, fake availability, Gemini mocked unless opted in. */
async function runV2Scenario(
	scenario: SimulationScenario,
	understand: UnderstandFn | undefined
): Promise<ScenarioResult> {
	const fixture = await createConversationFixture({ name: scenario.leadName });
	const availability = buildFakeAvailabilityService({ count: 0 });
	const turns: SimulatedTurn[] = [];

	try {
		for (const user of scenario.turns) {
			const [inbound] = await db
				.insert(messages)
				.values({
					content: user.join("\n"),
					conversationId: fixture.conversationId,
					createdAt: new Date(),
					externalId: `wamid.sim_${randomUUID()}`,
					role: "user",
				})
				.returning({ id: messages.id });
			if (!inbound) {
				throw new Error("Inbound message not created");
			}

			const before = await outboundPayloads(fixture.conversationId);
			const result = await runFlowV2Turn({
				conversationId: fixture.conversationId,
				currentMessages: user,
				deps: { availability, understand },
				leadId: fixture.leadId,
				messageIds: [inbound.id],
				runKey: `sim:${randomUUID()}`,
				traceTurnId: randomUUID(),
			});
			const after = await outboundPayloads(fixture.conversationId);
			const fresh = after.slice(before.length);
			const payload = fresh.at(-1);
			const lead = await loadLead(fixture.leadId);
			const route = "route" in result ? result.route : null;

			turns.push({
				known: {
					currentSituation: Boolean(lead.currentSituation?.trim()),
					interestedInConsultant: lead.interestedInConsultant === true,
					name: isNameKnown(lead.name, lead.phone),
					objective: Boolean(lead.objective?.trim()),
					painPoint: Boolean(lead.painPoint?.trim()),
				},
				offered: route === "R8-slots",
				reply: payload?.body ?? payload?.text ?? "",
				route: route ?? undefined,
				user,
			});

			if (route === "R8-slots") {
				break;
			}
		}
	} finally {
		await cleanupConversationFixture(fixture.leadId);
	}

	return {
		failures: evaluateSimulatedConversation({
			offerWithinTurns: scenario.offerWithinTurns,
			turns,
		}),
		scenario,
		turns,
	};
}

async function outboundPayloads(conversationId: string) {
	const rows = await db
		.select({ payload: outboundMessages.payload })
		.from(outboundMessages)
		.where(eq(outboundMessages.conversationId, conversationId))
		.orderBy(asc(outboundMessages.createdAt));
	return rows.map(
		(row) => row.payload as { body?: string; kind: string; text?: string }
	);
}

export function formatSimulationReport(
	results: ScenarioResult[],
	generatedAt: Date,
	flow: SimulationFlow,
	realGemini: boolean
): string {
	// D2-1: the label comes from the actual option (`--real-gemini`), never fixed.
	const gemini = realGemini ? "Real Gemini" : "Mocked Gemini";
	const lines = [
		"# Conversation simulator report",
		"",
		`Generated: ${generatedAt.toISOString()}. Flow: ${flow}. ${gemini}, local test database, WhatsApp stubbed, Calendar mocked.`,
		"",
	];

	for (const { failures, scenario, turns } of results) {
		lines.push(
			`## Scenario ${scenario.id} — ${scenario.title}: ${failures.length === 0 ? "PASS" : "FAIL"}`,
			"",
			`Offer flow required within ${scenario.offerWithinTurns} turns.`,
			""
		);
		for (const [index, turn] of turns.entries()) {
			lines.push(
				`**${index + 1}. Cliente:** ${turn.user.join(" / ")}`,
				"",
				`**Mariana:** ${turn.offered ? "[horários] " : ""}${turn.reply.replace(/\n+/g, " ")}`,
				""
			);
		}
		if (failures.length > 0) {
			lines.push(
				"Failures:",
				"",
				...failures.map((failure) => `- ${failure}`),
				""
			);
		}
	}

	return `${lines.join("\n").trimEnd()}\n`;
}
