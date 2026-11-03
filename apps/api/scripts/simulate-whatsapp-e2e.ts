/** biome-ignore-all lint/performance/noAwaitInLoops: conversations are sequential by nature */
// End-to-end WhatsApp simulation. Real path: signed webhook over HTTP, durable
// debounce, background workers, flow v2 with real Gemini and the outbox. The
// client is played by Gemini from a persona and reacts to what it receives.
// The Meta Graph API is answered locally (with Meta's size limits) and Google
// Calendar is an in-memory agenda. Any other network host is refused.
//
//   TEST_DATABASE_URL=postgresql://mariana:mariana@localhost:5432/mariana_test \
//     npx tsx scripts/simulate-whatsapp-e2e.ts <report.md> <debug.log>
//
// Calls the real Gemini API: owner permission only. The test database must be
// prepared (`npm run test:db`).
import "dotenv/config";

import { createHmac, randomInt, randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { FAKE_EXTERNAL_ENV } from "../src/tests/support/fake-external-env";
import {
	describeDatabaseHost,
	resolveTestDatabaseEnv,
} from "../src/tests/support/test-database-guard";

const MAX_TURNS = 12;
const REPLY_TIMEOUT_MS = 90_000;
const QUIET_AFTER_REPLY_MS = 3000;
const ALLOWED_HOSTS = new Set([
	"127.0.0.1",
	"generativelanguage.googleapis.com",
	"localhost",
]);

interface Persona {
	contactName: string;
	id: string;
	profile: string;
}

const PERSONAS: Persona[] = [
	{
		contactName: "Ju Almeida",
		id: "juliana-carro",
		profile: `Juliana, 34 anos, enfermeira em Niterói. Clicou num anúncio de consórcio no Instagram. Quer trocar um Onix 2016 por um SUV, por volta de 120 mil. Escreve tudo em minúsculas, abrevia (vc, tb, pq, tbm, msm), quase sem pontuação, e costuma picotar uma ideia em 2 ou 3 mensagens seguidas. Quer saber o valor da parcela e insiste uma vez. Trabalha em plantões. Se a conversa fluir, aceita falar com um consultor e marca um horário.`,
	},
	{
		contactName: "Antonio Carlos",
		id: "antonio-desconfiado",
		profile: `Seu Antônio, 58 anos, comerciante aposentado em Campos dos Goytacazes. Quer comprar uma casa para a filha, uns 300 mil. Escreve mensagens mais longas, com pontuação formal e "boa tarde" no início. É desconfiado: pergunta se é golpe, se está falando com robô ou com gente, e o que é taxa de administração. Se for bem tratado, topa conversar com um consultor, mas pergunta como será a reunião antes de marcar.`,
	},
	{
		contactName: "Rafa 🏍️",
		id: "rafa-indeciso",
		profile: `Rafael, 27 anos, entregador em São Gonçalo. Quer uma moto nova para trabalhar, mas não tem certeza se consórcio serve. Muda de assunto, faz uma piada ou pergunta fora do tema em algum momento, e pergunta se tem como ser contemplado rápido. Responde curto, com gírias e erros de digitação. Tenta primeiro pedir um horário escrevendo por texto em vez de usar botão. Ao confirmar um horário, recusa uma vez, e depois escolhe outro e confirma.`,
	},
];

interface GraphSend {
	buttons: { id: string; title: string }[];
	id: string;
	text: string;
	to: string;
}

interface TranscriptLine {
	atMs: number;
	buttons?: string[];
	latencyMs?: number;
	note?: string;
	text: string;
	who: "cliente" | "mariana" | "sistema";
}

interface ClientMove {
	action: "stop" | "tap" | "type";
	button?: string;
	messages?: string[];
}

const graphSends: GraphSend[] = [];
const metaViolations: string[] = [];
const traces = new Map<string, Record<string, unknown>[]>();

function pretendGraphApi(body: string): Response {
	const payload = JSON.parse(body) as {
		interactive?: {
			action: { buttons: { reply: { id: string; title: string } }[] };
			body: { text: string };
		};
		text?: { body: string };
		to: string;
	};
	const buttons =
		payload.interactive?.action.buttons.map(({ reply }) => reply) ?? [];
	const text = payload.interactive?.body.text ?? payload.text?.body ?? "";
	const limit = payload.interactive ? 1024 : 4096;
	const problems = [
		text.length > limit ? `corpo ${text.length} > ${limit}` : null,
		text.trim() === "" ? "corpo vazio" : null,
		buttons.length > 3 ? `${buttons.length} botões > 3` : null,
		...buttons.map(({ title }) =>
			title.length > 20 ? `botão "${title}" > 20` : null
		),
	].filter((problem) => problem !== null);

	if (problems.length > 0) {
		metaViolations.push(`${payload.to}: ${problems.join("; ")}`);
		return Response.json(
			{ error: { code: 131_009, message: problems.join("; ") } },
			{ status: 400 }
		);
	}

	const id = `wamid.sim_${randomUUID()}`;
	graphSends.push({ buttons, id, text, to: payload.to });
	return Response.json({
		contacts: [{ input: payload.to, wa_id: payload.to }],
		messages: [{ id }],
		messaging_product: "whatsapp",
	});
}

function guardNetwork() {
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.hostname === "graph.facebook.com") {
			return pretendGraphApi(String(init?.body));
		}
		if (!ALLOWED_HOSTS.has(url.hostname)) {
			throw new Error(`Simulation refused network host ${url.hostname}`);
		}
		return await realFetch(input, init);
	};
}

function captureLogs(logPath: string) {
	const write = (...args: unknown[]) => {
		const line = args
			.map((arg) => (arg instanceof Error ? arg.stack : String(arg)))
			.join(" ");
		appendFileSync(logPath, `${line}\n`);
		if (!line.startsWith('{"event":"mariana_turn"')) {
			return;
		}
		const trace = JSON.parse(line) as Record<string, unknown>;
		const conversationId = String(trace.conversationId);
		traces.set(conversationId, [...(traces.get(conversationId) ?? []), trace]);
	};
	console.log = write;
	console.info = write;
	console.warn = write;
	console.error = write;
}

async function main() {
	const [reportPath, logPath] = process.argv.slice(2);
	if (!(reportPath && logPath)) {
		process.stderr.write("Usage: simulate-whatsapp-e2e <report.md> <debug.log>\n");
		process.exit(2);
	}

	const databaseEnv = resolveTestDatabaseEnv(process.env);
	const geminiApiKey = process.env.GEMINI_API_KEY;
	if (!geminiApiKey || geminiApiKey === FAKE_EXTERNAL_ENV.GEMINI_API_KEY) {
		process.stderr.write("Refusing to run: GEMINI_API_KEY is not set.\n");
		process.exit(2);
	}
	Object.assign(process.env, FAKE_EXTERNAL_ENV, databaseEnv, {
		GEMINI_API_KEY: geminiApiKey,
		MARIANA_FLOW: "v2",
		RELIABILITY_WORKERS_ENABLED: "false",
	});
	process.stderr.write(
		`[sim] test database ${describeDatabaseHost(databaseEnv.DATABASE_URL)}\n`
	);

	guardNetwork();
	captureLogs(logPath);

	const { and, desc, eq, inArray, lte, or } = await import("drizzle-orm");
	const { ai } = await import("../src/ai/client");
	const { buildApp } = await import("../src/app");
	const { closeDatabase, db } = await import("../src/db/connections");
	const schema = await import("../src/db/schema");
	const { env } = await import("../src/env");
	const { GoogleCalendarService } = await import(
		"../src/integrations/google-calendar/google-calendar-service"
	);
	const { startReliabilityWorkers, stopReliabilityWorkers } = await import(
		"../src/services/reliability/background-workers"
	);
	const { cleanupConversationFixture } = await import(
		"../src/tests/support/conversation-harness"
	);

	// In-memory agenda: consultants start free; booked events become busy.
	const booked = new Map<string, { end: string; start: string }[]>();
	Object.assign(GoogleCalendarService.prototype, {
		appendEventDescription: async () => undefined,
		createEvent: async (input: {
			calendarId: string;
			end: Date;
			start: Date;
		}) => {
			const start = input.start.toISOString();
			const end = input.end.toISOString();
			booked.set(input.calendarId, [
				...(booked.get(input.calendarId) ?? []),
				{ end, start },
			]);
			return {
				end,
				hangoutLink: `https://meet.google.com/sim-${randomInt(1000, 9999)}`,
				id: `sim-event-${randomUUID()}`,
				start,
			};
		},
		deleteEvent: async () => undefined,
		getBusyPeriods: async (calendarIds: string[]) =>
			calendarIds.map((calendarId) => ({
				busy: booked.get(calendarId) ?? [],
				calendarId,
			})),
		getMeetLink: async () => "https://meet.google.com/sim-link",
	});

	const app = buildApp({ logger: false });
	const address = await app.listen({ host: "127.0.0.1", port: 0 });
	startReliabilityWorkers();

	const postWebhook = async (value: Record<string, unknown>) => {
		const body = JSON.stringify({
			entry: [
				{
					changes: [
						{
							field: "messages",
							value: {
								messaging_product: "whatsapp",
								metadata: {
									display_phone_number: "5521900000000",
									phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID,
								},
								...value,
							},
						},
					],
					id: env.WHATSAPP_WABA_ID,
				},
			],
			object: "whatsapp_business_account",
		});
		const signature = createHmac("sha256", env.WHATSAPP_APP_SECRET)
			.update(body)
			.digest("hex");
		const response = await fetch(`${address}/webhooks/whatsapp`, {
			body,
			headers: {
				"content-type": "application/json",
				"x-hub-signature-256": `sha256=${signature}`,
			},
			method: "POST",
		});
		if (!response.ok) {
			throw new Error(
				`Webhook answered ${response.status}: ${await response.text()}`
			);
		}
	};

	const inbound = async (
		persona: Persona,
		phone: string,
		message: Record<string, unknown>
	) =>
		await postWebhook({
			contacts: [{ profile: { name: persona.contactName }, wa_id: phone }],
			messages: [
				{
					from: phone,
					id: `wamid.client_${randomUUID()}`,
					timestamp: String(Math.floor(Date.now() / 1000)),
					...message,
				},
			],
		});

	const markRead = async (phone: string, messageId: string) =>
		await postWebhook({
			statuses: [
				{
					id: messageId,
					recipient_id: phone,
					status: "read",
					timestamp: String(Math.floor(Date.now() / 1000)),
				},
			],
		});

	const findLead = async (phone: string) => {
		const [lead] = await db
			.select()
			.from(schema.leads)
			.where(eq(schema.leads.phone, phone))
			.limit(1);
		return lead;
	};

	const findConversation = async (leadId: string) => {
		const [conversation] = await db
			.select({ id: schema.conversations.id })
			.from(schema.conversations)
			.where(eq(schema.conversations.leadId, leadId))
			.orderBy(desc(schema.conversations.startedAt))
			.limit(1);
		return conversation?.id;
	};

	const hasPendingWork = async (phone: string) => {
		const lead = await findLead(phone);
		const conversationId = lead && (await findConversation(lead.id));
		if (!conversationId) {
			return true;
		}
		const soon = new Date(Date.now() + env.MESSAGE_DEBOUNCE_MS + 5000);
		const [task] = await db
			.select({ id: schema.autonomousTasks.id })
			.from(schema.autonomousTasks)
			.where(
				and(
					eq(schema.autonomousTasks.conversationId, conversationId),
					inArray(schema.autonomousTasks.status, ["pending", "processing"]),
					lte(schema.autonomousTasks.availableAt, soon)
				)
			)
			.limit(1);
		const [outbound] = await db
			.select({ id: schema.outboundMessages.id })
			.from(schema.outboundMessages)
			.where(
				and(
					eq(schema.outboundMessages.conversationId, conversationId),
					or(
						eq(schema.outboundMessages.status, "pending"),
						eq(schema.outboundMessages.status, "sending")
					)
				)
			)
			.limit(1);
		return Boolean(task || outbound);
	};

	const waitForReply = async (phone: string, seen: number) => {
		const startedAt = Date.now();
		let count = seen;
		let lastChangeAt = startedAt;
		while (Date.now() - startedAt < REPLY_TIMEOUT_MS) {
			await sleep(500);
			const current = graphSends.filter(({ to }) => to === phone).length;
			if (current !== count) {
				count = current;
				lastChangeAt = Date.now();
			}
			if (
				Date.now() - lastChangeAt >= QUIET_AFTER_REPLY_MS &&
				!(await hasPendingWork(phone))
			) {
				return;
			}
		}
	};

	const decideMove = async (
		persona: Persona,
		transcript: TranscriptLine[],
		buttons: string[]
	): Promise<ClientMove> => {
		const history = transcript
			.filter(({ who }) => who !== "sistema")
			.map(
				({ buttons: shown, text, who }) =>
					`${who === "cliente" ? "VOCÊ" : "MARIANA"}: ${text}${shown?.length ? ` [botões: ${shown.join(" | ")}]` : ""}`
			)
			.join("\n");
		const response = await ai.models.generateContent({
			config: {
				responseMimeType: "application/json",
				systemInstruction: `Você interpreta uma pessoa real conversando no WhatsApp com a Mariana, atendente de uma empresa de consórcio. Nunca saia do personagem.

${persona.profile}

Regras:
- Escreva como essa pessoa digita no celular, em mensagens curtas. Nada de texto de IA, listas ou formalidade artificial.
- Reaja ao que a Mariana acabou de dizer. Não repita o que já disse sem motivo.
- Devolva JSON. Para digitar: {"action":"type","messages":["..."]}, com 1 a 3 mensagens seguidas.
- Se há botões na última mensagem e você quer usar um: {"action":"tap","button":"<título exato>"}.
- Quando a conversa tiver terminado (reunião marcada e você já agradeceu, ou desistiu): {"action":"stop"}.`,
				temperature: 1,
			},
			contents:
				history === ""
					? "Você acabou de abrir o WhatsApp da Mariana. Mande a primeira mensagem."
					: `Conversa até agora:\n${history}\n\nBotões disponíveis agora: ${buttons.join(" | ") || "nenhum"}\n\nQual é o seu próximo movimento?`,
			model: env.GEMINI_MODEL,
		});
		return JSON.parse(response.text ?? "{}") as ClientMove;
	};

	const runConversation = async (persona: Persona, phone: string) => {
		const startedAt = Date.now();
		const transcript: TranscriptLine[] = [];
		const elapsed = () => Date.now() - startedAt;
		let seen = 0;
		let buttons: { id: string; title: string }[] = [];
		let lastSendId: string | undefined;

		for (let turn = 0; turn < MAX_TURNS; turn += 1) {
			const move = await decideMove(
				persona,
				transcript,
				buttons.map(({ title }) => title)
			);
			if (move.action === "stop") {
				break;
			}

			const tapped = buttons.find(({ title }) => title === move.button);
			let sentAt = Date.now();
			if (move.action === "tap" && tapped) {
				await sleep(randomInt(1500, 4000));
				transcript.push({
					atMs: elapsed(),
					text: `[tocou no botão] ${tapped.title}`,
					who: "cliente",
				});
				sentAt = Date.now();
				await inbound(persona, phone, {
					context: { from: "5521900000000", id: lastSendId },
					interactive: { button_reply: tapped, type: "button_reply" },
					type: "interactive",
				});
			} else {
				for (const text of move.messages ?? []) {
					await sleep(Math.min(6000, 800 + text.length * 70));
					transcript.push({ atMs: elapsed(), text, who: "cliente" });
					sentAt = Date.now();
					await inbound(persona, phone, { text: { body: text }, type: "text" });
				}
			}

			await waitForReply(phone, seen);
			const fresh = graphSends.filter(({ to }) => to === phone).slice(seen);
			seen += fresh.length;
			if (fresh.length === 0) {
				transcript.push({
					atMs: elapsed(),
					text: "sem resposta da automação",
					who: "sistema",
				});
			}
			for (const send of fresh) {
				transcript.push({
					atMs: elapsed(),
					buttons: send.buttons.map(({ title }) => title),
					latencyMs: Date.now() - sentAt,
					text: send.text,
					who: "mariana",
				});
				lastSendId = send.id;
				await markRead(phone, send.id);
			}
			buttons = fresh.at(-1)?.buttons ?? buttons;
		}

		const lead = await findLead(phone);
		const conversationId = lead && (await findConversation(lead.id));
		const booking = lead
			? await db
					.select({
						scheduledAt: schema.appointments.startAt,
						status: schema.appointments.status,
					})
					.from(schema.appointments)
					.where(eq(schema.appointments.leadId, lead.id))
			: [];
		return { booking, conversationId, lead, persona, phone, transcript };
	};

	const results = await Promise.allSettled(
		PERSONAS.map((persona, index) =>
			sleep(index * 2000).then(() =>
				runConversation(persona, `5521900000${randomInt(100, 1000)}`)
			)
		)
	);

	const lines = ["# Simulação WhatsApp ponta a ponta", ""];
	lines.push(
		`Gerado em ${new Date().toISOString()}. Modelo ${env.GEMINI_MODEL}, flow v2, debounce ${env.MESSAGE_DEBOUNCE_MS}ms, banco ${describeDatabaseHost(databaseEnv.DATABASE_URL)}.`,
		""
	);
	for (const result of results) {
		if (result.status === "rejected") {
			lines.push("## Conversa abortada", "", String(result.reason), "");
			continue;
		}
		const { booking, conversationId, lead, persona, transcript } = result.value;
		lines.push(`## ${persona.id} (${persona.contactName})`, "");
		for (const line of transcript) {
			const clock = `${Math.round(line.atMs / 1000)}s`;
			const latency =
				line.latencyMs === undefined
					? ""
					: ` (+${Math.round(line.latencyMs / 1000)}s)`;
			const shown = line.buttons?.length
				? ` [${line.buttons.join(" | ")}]`
				: "";
			lines.push(`- ${clock} **${line.who}**${latency}: ${line.text}${shown}`);
		}
		lines.push(
			"",
			`Lead: ${JSON.stringify({
				currentSituation: lead?.currentSituation,
				interestedInConsultant: lead?.interestedInConsultant,
				name: lead?.name,
				objective: lead?.objective,
				painPoint: lead?.painPoint,
				status: lead?.status,
			})}`,
			`Agendamentos: ${JSON.stringify(booking)}`,
			`Rotas: ${(traces.get(conversationId ?? "") ?? [])
				.map(
					(trace) =>
						`${trace.route}/${trace.responder}${trace.guardRejected ? `(guard:${trace.guardReason})` : ""}`
				)
				.join(" ")}`,
			""
		);
	}
	lines.push(`Violações de limite da Meta: ${metaViolations.length}`, "");
	lines.push(...metaViolations.map((violation) => `- ${violation}`), "");
	writeFileSync(reportPath, `${lines.join("\n").trimEnd()}\n`);

	await stopReliabilityWorkers();
	await app.close();
	for (const result of results) {
		if (result.status === "fulfilled" && result.value.lead) {
			await cleanupConversationFixture(result.value.lead.id);
			await db
				.delete(schema.whatsappWebhookEvents)
				.where(eq(schema.whatsappWebhookEvents.phone, result.value.phone));
		}
	}
	await closeDatabase();
	process.stderr.write(`[sim] report written to ${reportPath}\n`);
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
	process.exit(1);
});
