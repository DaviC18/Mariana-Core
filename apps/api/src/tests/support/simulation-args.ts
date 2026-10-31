// CLI flags for the opt-in conversation simulator. Pure so the entry point can
// resolve the flow before importing anything that reads the environment.
export type SimulationFlow = "v1" | "v2";

export interface SimulatorArgs {
	flow: SimulationFlow;
	realGemini: boolean;
}

export function parseSimulatorArgs(argv: string[]): SimulatorArgs {
	let flow: SimulationFlow = "v1";
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--real-gemini") {
			continue;
		}
		if (arg === "--flow") {
			const value = argv[index + 1];
			if (value !== "v1" && value !== "v2") {
				throw new Error(`Unknown --flow value: ${value ?? "(missing)"}`);
			}
			flow = value;
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return { flow, realGemini: argv.includes("--real-gemini") };
}
