/** biome-ignore-all assist/source/organizeImports: <> */
/** biome-ignore-all lint/correctness/noUndeclaredVariables: <> */
/** biome-ignore-all assist/source/useSortedKeys: <> */
/** biome-ignore-all lint/suspicious/useAwait: <> */
/** biome-ignore-all lint/correctness/noUnusedVariables: <> */
import { buildApp } from "./app";
import { env } from "./env";
import {
	startReliabilityWorkers,
	stopReliabilityWorkers,
} from "./services/reliability/background-workers";

const app = buildApp();

const host = "0.0.0.0";
const port = Number(env.PORT) || 3252;

let shuttingDown = false;

const shutdown = async (signal: string) => {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;

	app.log.info({ event: "shutdown_started", signal });
	console.log(`[BOOT] Received ${signal}, shutting down...`);

	try {
		await stopReliabilityWorkers();
		await app.close();
		app.log.info({ event: "shutdown_complete", signal });
		process.exit(0);
	} catch (err) {
		app.log.error({ err, event: "shutdown_failed" });
		process.exit(1);
	}
};

process.on("SIGINT", () => {
	shutdown("SIGINT").catch(() => undefined);
});
process.on("SIGTERM", () => {
	shutdown("SIGTERM").catch(() => undefined);
});

const listen = async () => {
	try {
		const address = await app.listen({
			port,
			host,
		});
		app.log.info(`Server running at ${address}`);
		console.log(`[BOOT] Server running at ${address}`);

		if (env.RELIABILITY_WORKERS_ENABLED === "true") {
			const { started } = startReliabilityWorkers({ logger: app.log });
			app.log.info({ event: "reliability_workers_started", workers: started });
			console.log(`[BOOT] Reliability workers started: ${started.join(", ")}`);
		}
	} catch (err) {
		app.log.error(err);
		console.error("[BOOT] Failed to start server:", err);
		process.exit(1);
	}
};

listen();
