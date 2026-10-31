/** biome-ignore-all lint/performance/useTopLevelRegex: <> */
// Plumbing test for the opt-in simulator with a canned Gemini client: the
// real run (`npm run sim:conversation -- --real-gemini`) uses the same code.
import assert from "node:assert/strict";
import test from "node:test";

import { ai } from "../../ai/client";
import { closeDatabase } from "../../db/connections";
import {
	formatSimulationReport,
	runScenario,
	type ScenarioResult,
	SIMULATION_SCENARIOS,
	stubExternalServicesForSimulation,
	V2_SIMULATION_SCENARIOS,
} from "../support/conversation-simulator";
import { parseSimulatorArgs } from "../support/simulation-args";

test.after(async () => {
	await closeDatabase();
});

test("simulador roda o caminho feliz e gera relatório", async () => {
	const original = ai.models.generateContent;
	Object.assign(ai.models, {
		generateContent: async () => ({
			text: JSON.stringify({
				leadUpdate: { status: "qualifying" },
				nextAction: "continue_qualification",
				reply: "Entendi.",
			}),
		}),
	});
	stubExternalServicesForSimulation();

	try {
		const scenario = SIMULATION_SCENARIOS.find((item) => item.id === "2");
		assert.ok(scenario);
		const result = await runScenario(scenario);

		assert.deepEqual(result.failures, []);
		assert.equal(result.turns.at(-1)?.offered, true);

		const report = formatSimulationReport([result], new Date(0), "v1", false);
		assert.match(report, /## Scenario 2 .*: PASS/);
		assert.match(report, /\*\*1\. Cliente:\*\* oi/);
		// D2-1: the report must state that this run used a mocked Gemini.
		assert.match(report, /Flow: v1\. Mocked Gemini, local test database/);
		assert.doesNotMatch(report, /Real Gemini/);
	} finally {
		Object.assign(ai.models, { generateContent: original });
	}
});

test("parseSimulatorArgs: --flow v2 is mocked by default; bad flow rejected", () => {
	assert.deepEqual(parseSimulatorArgs(["--flow", "v2"]), {
		flow: "v2",
		realGemini: false,
	});
	assert.deepEqual(parseSimulatorArgs(["--real-gemini"]), {
		flow: "v1",
		realGemini: true,
	});
	assert.deepEqual(parseSimulatorArgs(["--flow", "v1", "--real-gemini"]), {
		flow: "v1",
		realGemini: true,
	});
	assert.throws(() => parseSimulatorArgs(["--flow", "v3"]), /Unknown --flow/);
});

test("simulador --flow v2 roda cenário com Gemini falso e relatório", async () => {
	stubExternalServicesForSimulation();
	const scenario = V2_SIMULATION_SCENARIOS.find((item) => item.id === "v2-2");
	assert.ok(scenario);

	const result = await runScenario(scenario, { flow: "v2" });
	const last = result.turns.at(-1);

	assert.deepEqual(result.failures, []);
	assert.equal(last?.offered, true);
	assert.equal(last?.route, "R8-slots");
	const report = formatSimulationReport([result], new Date(0), "v2", false);
	assert.match(report, /## Scenario v2-2 .*: PASS/);
	// D2-1: v2 is mocked unless --real-gemini is passed.
	assert.match(report, /Flow: v2\. Mocked Gemini, local test database/);
	assert.doesNotMatch(report, /Real Gemini/);
});

test("relatório diz 'Real Gemini' só quando o flag real é verdadeiro (D2-1)", () => {
	const result: ScenarioResult = {
		failures: [],
		scenario: { id: "x", offerWithinTurns: 1, title: "x", turns: [] },
		turns: [],
	};

	const mocked = formatSimulationReport([result], new Date(0), "v2", false);
	const real = formatSimulationReport([result], new Date(0), "v2", true);

	assert.match(mocked, /Flow: v2\. Mocked Gemini, local test database/);
	assert.doesNotMatch(mocked, /Real Gemini/);
	assert.match(real, /Flow: v2\. Real Gemini, local test database/);
	assert.doesNotMatch(real, /Mocked Gemini/);
});
