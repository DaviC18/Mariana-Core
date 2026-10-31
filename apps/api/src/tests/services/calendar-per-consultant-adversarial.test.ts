/** biome-ignore-all lint/suspicious/useAwait: fakes assíncronos do Calendar */
/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/**
 * Tester (2026-10-27-scheduling-loop, Batch C, passos 4–5). Sem banco e sem
 * rede: GoogleCalendarService real com leitura de conexão e cliente do Google
 * injetados. Cobre o que os testes do implementador não cobrem:
 * - createEvent/deleteEvent usam o token do consultor pedido;
 * - conexão marcada não recebe createEvent/deleteEvent;
 * - invalid_grant de um consultor não marca o outro;
 * - erro que não é invalid_grant não marca (a próxima oferta consulta de novo);
 * - falha parcial: só horário verificado livre é ofertado;
 * - o erro e o log nunca carregam o token, nem pela `message`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	isBroken,
	resetForTests,
} from "../../integrations/google-calendar/calendar-connection-health";
import { CalendarAuthError } from "../../integrations/google-calendar/google-calendar-errors";
import {
	type BuildCalendarClient,
	GoogleCalendarService,
} from "../../integrations/google-calendar/google-calendar-service";
import {
	type Consultant,
	ConsultantAvailabilityService,
} from "../../services/calendar/consultant-availability";

const timeMin = new Date("2035-03-05T13:00:00.000Z");
const timeMax = new Date("2035-03-05T14:00:00.000Z");

const ana: Consultant = {
	calendarId: "cal-ana@test",
	id: "c-ana",
	name: "Ana",
};
const beto: Consultant = {
	calendarId: "cal-beto@test",
	id: "c-beto",
	name: "Beto",
};

interface Conn {
	id: string;
	refreshToken: string;
	updatedAt: Date;
}

function invalidGrant() {
	return Object.assign(new Error("invalid_grant"), {
		code: 400,
		response: { data: { error: "invalid_grant" } },
	});
}

/**
 * Cliente falso com freebusy, insert e delete. Cada chamada registra
 * `<op>:<token>:<calendarId>`. `behaviour(token)` decide erro/ocupado.
 */
function harness(
	connections: Map<string, Conn>,
	behaviour: (
		token: string
	) => "ok" | "invalid_grant" | "timeout" | "busy" = () => "ok"
) {
	const calls: string[] = [];
	const fail = (token: string) => {
		const mode = behaviour(token);
		if (mode === "invalid_grant") {
			throw invalidGrant();
		}
		if (mode === "timeout") {
			throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
		}
		return mode;
	};
	const build = ((token: string) => ({
		events: {
			delete: async ({ calendarId }: { calendarId: string }) => {
				calls.push(`delete:${token}:${calendarId}`);
				fail(token);
				return { data: {} };
			},
			insert: async ({ calendarId }: { calendarId: string }) => {
				calls.push(`insert:${token}:${calendarId}`);
				fail(token);
				return {
					data: {
						end: { dateTime: timeMax.toISOString() },
						htmlLink: "https://calendar.test/e",
						id: `evt-${calendarId}`,
						start: { dateTime: timeMin.toISOString() },
					},
				};
			},
		},
		freebusy: {
			query: async ({
				requestBody,
			}: {
				requestBody: { items: { id: string }[] };
			}) => {
				const ids = requestBody.items.map((item) => item.id);
				calls.push(`freebusy:${token}:${ids.join(",")}`);
				const mode = fail(token);
				const busy =
					mode === "busy"
						? [{ end: timeMax.toISOString(), start: timeMin.toISOString() }]
						: [];
				return {
					data: {
						calendars: Object.fromEntries(ids.map((id) => [id, { busy }])),
					},
				};
			},
		},
	})) as unknown as BuildCalendarClient;

	const service = new GoogleCalendarService({
		buildCalendarClient: build,
		loadConnection: async (consultantId) => ({
			connection: connections.get(consultantId),
			consultantName: consultantId,
		}),
	});

	return { calls, service };
}

function twoConnections() {
	return new Map<string, Conn>([
		[
			ana.id,
			{ id: "conn-ana", refreshToken: "tok-ana", updatedAt: new Date(10) },
		],
		[
			beto.id,
			{ id: "conn-beto", refreshToken: "tok-beto", updatedAt: new Date(10) },
		],
	]);
}

function captureConsoleError(t: { after: (fn: () => void) => void }) {
	const lines: string[] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => {
		lines.push(
			args
				.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
				.join(" ")
		);
	};
	t.after(() => {
		console.error = original;
	});
	return lines;
}

test("tester: createEvent e deleteEvent usam o token do consultor pedido", async (t) => {
	resetForTests();
	captureConsoleError(t);
	const { calls, service } = harness(twoConnections());

	await service.createEvent({
		calendarId: beto.calendarId,
		consultantId: beto.id,
		end: timeMax,
		start: timeMin,
		summary: "x",
	});
	await service.deleteEvent(ana.calendarId, "evt", ana.id);
	await service.createEvent({
		calendarId: ana.calendarId,
		consultantId: ana.id,
		end: timeMax,
		start: timeMin,
		summary: "x",
	});

	assert.deepEqual(calls, [
		`insert:tok-beto:${beto.calendarId}`,
		`delete:tok-ana:${ana.calendarId}`,
		`insert:tok-ana:${ana.calendarId}`,
	]);
});

test("tester: consultor marcado não recebe createEvent nem deleteEvent", async (t) => {
	resetForTests();
	captureConsoleError(t);
	const { calls, service } = harness(twoConnections(), (token) =>
		token === "tok-beto" ? "invalid_grant" : "ok"
	);

	await assert.rejects(
		() => service.getBusyPeriods([beto.calendarId], timeMin, timeMax, beto.id),
		(error: unknown) =>
			error instanceof CalendarAuthError && error.reason === "invalid_grant"
	);
	calls.length = 0;

	await assert.rejects(
		() =>
			service.createEvent({
				calendarId: beto.calendarId,
				consultantId: beto.id,
				end: timeMax,
				start: timeMin,
				summary: "x",
			}),
		CalendarAuthError
	);
	await assert.rejects(
		() => service.deleteEvent(beto.calendarId, "evt", beto.id),
		CalendarAuthError
	);
	assert.deepEqual(calls, [], "nenhuma chamada ao Google para o marcado");
});

test("tester: invalid_grant de um consultor não marca a conexão do outro", async (t) => {
	resetForTests();
	captureConsoleError(t);
	const { service } = harness(twoConnections(), (token) =>
		token === "tok-beto" ? "invalid_grant" : "ok"
	);
	const availability = new ConsultantAvailabilityService(service);

	await availability.getAvailableConsultants([ana, beto], timeMin, timeMax);

	assert.equal(isBroken("conn-beto", 10), true);
	assert.equal(isBroken("conn-ana", 10), false);
});

test("tester: erro que não é invalid_grant não marca; próxima oferta consulta de novo", async (t) => {
	resetForTests();
	const lines = captureConsoleError(t);
	const { calls, service } = harness(twoConnections(), (token) =>
		token === "tok-beto" ? "timeout" : "ok"
	);
	const availability = new ConsultantAvailabilityService(service);

	for (let offer = 0; offer < 2; offer += 1) {
		const slots = await availability.getAvailableConsultants(
			[ana, beto],
			timeMin,
			timeMax,
			{ random: () => 0.99 }
		);
		assert.ok(slots.every((slot) => slot.consultant.id === ana.id));
	}

	assert.equal(
		calls.filter((call) => call.startsWith("freebusy:tok-beto")).length,
		2
	);
	assert.equal(isBroken("conn-beto", 10), false);
	const skipped = lines.filter((line) =>
		line.includes('"event":"scheduling_consultant_calendar_skipped"')
	);
	assert.equal(skipped.length, 2, "uma linha por oferta, nunca em silêncio");
	assert.ok(
		!lines.some((line) => line.includes("google_calendar_needs_reauth")),
		"timeout não pede reautorização"
	);
});

test("tester: falha parcial com o saudável ocupado → nenhum horário (só verificado livre)", async (t) => {
	resetForTests();
	captureConsoleError(t);
	const { service } = harness(twoConnections(), (token) =>
		token === "tok-beto" ? "invalid_grant" : "busy"
	);
	const availability = new ConsultantAvailabilityService(service);

	for (const value of [0, 0.5, 0.99]) {
		const slots = await availability.getAvailableConsultants(
			[ana, beto],
			timeMin,
			timeMax,
			{ random: () => value }
		);
		assert.deepEqual(slots, [], "nunca oferta o quebrado nem o ocupado");
	}
});

test("tester: erro de auth e logs nunca trazem o token", async (t) => {
	resetForTests();
	const lines = captureConsoleError(t);
	const connections = twoConnections();
	connections.delete(ana.id);
	const { service } = harness(connections, () => "invalid_grant");

	const errors: unknown[] = [];
	for (const consultant of [ana, beto, beto]) {
		try {
			await service.getBusyPeriods(
				[consultant.calendarId],
				timeMin,
				timeMax,
				consultant.id
			);
		} catch (error) {
			errors.push(error);
		}
	}

	assert.equal(errors.length, 3);
	for (const error of errors) {
		assert.ok(error instanceof CalendarAuthError);
		assert.ok(!error.message.includes("tok-"));
		assert.ok(!JSON.stringify(error).includes("tok-"));
	}
	assert.ok(!lines.join("\n").includes("tok-"), lines.join("\n"));
	// not_connected (ana) + invalid_grant recém-marcado (beto) = 2 linhas.
	assert.equal(
		lines.filter((line) => line.includes("google_calendar_needs_reauth"))
			.length,
		2
	);
});
