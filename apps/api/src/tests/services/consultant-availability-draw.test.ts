/** biome-ignore-all lint/performance/noAwaitInLoops: <> */
/** biome-ignore-all lint/suspicious/useAwait: fakes assíncronos do Calendar */
// Unit tests (no DB) for the random consultant draw per offered time
// (D-R2-5, D-R2-7, R-SCH-01 v1.4). Google Calendar is a plain fake.
import assert from "node:assert/strict";
import test from "node:test";

import { resetForTests as resetCalendarHealthForTests } from "../../integrations/google-calendar/calendar-connection-health";
import { CalendarUnavailableError } from "../../integrations/google-calendar/google-calendar-errors";
import {
	type BuildCalendarClient,
	GoogleCalendarService,
} from "../../integrations/google-calendar/google-calendar-service";
import {
	type Consultant,
	ConsultantAvailabilityService,
} from "../../services/calendar/consultant-availability";

// One 30-minute window inside business hours: exactly one offered time.
const timeMin = new Date("2026-09-21T16:30:00-03:00");
const timeMax = new Date("2026-09-21T17:00:00-03:00");

const busyOne: Consultant = { calendarId: "busy@x", id: "c-busy", name: "A" };
const freeOne: Consultant = { calendarId: "free1@x", id: "c-free1", name: "B" };
const freeTwo: Consultant = { calendarId: "free2@x", id: "c-free2", name: "C" };

function fakeCalendar(busyCalendarIds: string[]) {
	return {
		getBusyPeriods: async (calendarIds: string[]) =>
			calendarIds.map((calendarId) => ({
				busy: busyCalendarIds.includes(calendarId)
					? [{ end: timeMax.toISOString(), start: timeMin.toISOString() }]
					: [],
				calendarId,
			})),
	} as unknown as GoogleCalendarService;
}

test("sorteia o consultor entre os livres naquele horário com a fonte aleatória injetada", async () => {
	const service = new ConsultantAvailabilityService(
		fakeCalendar([busyOne.calendarId])
	);
	const consultants = [busyOne, freeOne, freeTwo];

	const high = await service.getAvailableConsultants(
		consultants,
		timeMin,
		timeMax,
		{ random: () => 0.99 }
	);
	assert.equal(high.length, 1);
	assert.equal(high[0]?.consultant.id, freeTwo.id, "0.99 picks the 2nd free");

	const low = await service.getAvailableConsultants(
		consultants,
		timeMin,
		timeMax,
		{ random: () => 0 }
	);
	assert.equal(low.length, 1);
	assert.equal(low[0]?.consultant.id, freeOne.id, "0 picks the 1st free");

	for (const value of [0, 0.25, 0.5, 0.75, 0.999_999]) {
		const slots = await service.getAvailableConsultants(
			consultants,
			timeMin,
			timeMax,
			{ random: () => value }
		);
		assert.notEqual(slots[0]?.consultant.id, busyOne.id, "busy never picked");
	}
});

test("um único consultor livre é sempre o escolhido", async () => {
	const service = new ConsultantAvailabilityService(
		fakeCalendar([busyOne.calendarId, freeTwo.calendarId])
	);

	for (const value of [0, 0.5, 0.99]) {
		const slots = await service.getAvailableConsultants(
			[busyOne, freeOne, freeTwo],
			timeMin,
			timeMax,
			{ random: () => value }
		);
		assert.equal(slots.length, 1);
		assert.equal(slots[0]?.consultant.id, freeOne.id);
	}
});

test("sem fonte aleatória mantém a ordem recebida (rota admin)", async () => {
	const service = new ConsultantAvailabilityService(
		fakeCalendar([busyOne.calendarId])
	);

	const slots = await service.getAvailableConsultants(
		[busyOne, freeTwo, freeOne],
		timeMin,
		timeMax
	);
	assert.equal(slots[0]?.consultant.id, freeTwo.id);
});

// --- tester (steps 30–31): randomness, list-order independence, per-time draw.

// Deterministic seeded PRNG (Park-Miller, no bitwise ops) so the
// statistical checks never flake.
function seededRandom(seed: number): () => number {
	let state = seed % 2_147_483_647 || 1;
	return () => {
		state = (state * 48_271) % 2_147_483_647;
		return (state - 1) / 2_147_483_646;
	};
}

const freeThree: Consultant = {
	calendarId: "free3@x",
	id: "c-free3",
	name: "D",
};

async function countDraws(order: Consultant[], seed: number, draws: number) {
	const service = new ConsultantAvailabilityService(
		fakeCalendar([busyOne.calendarId])
	);
	const random = seededRandom(seed);
	const counts = new Map<string, number>();
	for (let index = 0; index < draws; index += 1) {
		const [slot] = await service.getAvailableConsultants(
			order,
			timeMin,
			timeMax,
			{ random }
		);
		assert.ok(slot);
		counts.set(slot.consultant.id, (counts.get(slot.consultant.id) ?? 0) + 1);
	}
	return counts;
}

test("tester: sorteio com fonte semeada é uniforme entre os livres e nunca escolhe o ocupado", async () => {
	const draws = 3000;
	const counts = await countDraws(
		[busyOne, freeOne, freeTwo, freeThree],
		42,
		draws
	);
	assert.equal(counts.get(busyOne.id), undefined, "busy never drawn");
	for (const consultant of [freeOne, freeTwo, freeThree]) {
		const share = (counts.get(consultant.id) ?? 0) / draws;
		// Expected 1/3; ±5 pp is > 6 standard deviations at n = 3000.
		assert.ok(
			share > 0.283 && share < 0.383,
			`${consultant.id} share ${share.toFixed(3)} is not ~1/3`
		);
	}
});

test("tester: a ordem da lista (carga/nome) não enviesa o sorteio", async () => {
	const draws = 3000;
	for (const order of [
		[freeOne, freeTwo, freeThree, busyOne],
		[freeThree, busyOne, freeTwo, freeOne],
	]) {
		const counts = await countDraws(order, 7, draws);
		const first = order.find((c) => c.id !== busyOne.id);
		assert.ok(first);
		const firstShare = (counts.get(first.id) ?? 0) / draws;
		assert.ok(
			firstShare < 0.383,
			`first-listed ${first.id} share ${firstShare.toFixed(3)} is biased`
		);
		assert.equal(counts.size, 3, "every free consultant is drawn sometimes");
	}
});

test("tester: cada horário tem o seu próprio sorteio (uma chamada a random por horário)", async () => {
	// Two 30-minute times, both consultants free at both.
	const twoTimesMax = new Date("2026-09-21T17:30:00-03:00");
	const service = new ConsultantAvailabilityService({
		getBusyPeriods: async (calendarIds: string[]) =>
			calendarIds.map((calendarId) => ({ busy: [], calendarId })),
	} as unknown as GoogleCalendarService);
	const sequence = [0, 0.99];
	let calls = 0;
	const slots = await service.getAvailableConsultants(
		[freeOne, freeTwo],
		timeMin,
		twoTimesMax,
		{
			random: () => {
				const value = sequence[calls] ?? 0;
				calls += 1;
				return value;
			},
		}
	);
	assert.equal(slots.length, 2);
	assert.equal(calls, 2, "one draw per offered time");
	assert.deepEqual(
		slots.map((slot) => slot.consultant.id),
		[freeOne.id, freeTwo.id]
	);
});

test("tester: random() fora de [0,1) não derruba o horário nem escolhe o ocupado", async () => {
	const service = new ConsultantAvailabilityService(
		fakeCalendar([busyOne.calendarId])
	);
	for (const value of [1, 1.5, -0.2]) {
		const slots = await service.getAvailableConsultants(
			[busyOne, freeOne, freeTwo],
			timeMin,
			timeMax,
			{ random: () => value }
		);
		assert.equal(slots.length, 1, `random=${value} keeps the time`);
		assert.notEqual(slots[0]?.consultant.id, busyOne.id);
	}
});

// --- 2026-10-27-scheduling-loop, passos 4–5: conexão por consultor e
// consultores quebrados fora do sorteio. GoogleCalendarService real, com a
// leitura da conexão e o cliente do Google injetados (sem banco, sem rede).

function invalidGrant() {
	return Object.assign(new Error("invalid_grant"), {
		code: 400,
		response: { data: { error: "invalid_grant" } },
	});
}

interface FakeConnection {
	id: string;
	refreshToken: string;
	updatedAt: Date;
}

/**
 * Serviço real com conexões em memória. `failingTokens` lança invalid_grant;
 * `calls` conta as consultas ao Google por refresh token.
 */
function calendarWithConnections(
	connections: Map<string, FakeConnection>,
	failingTokens: Set<string> = new Set()
) {
	const calls = new Map<string, number>();
	const service = new GoogleCalendarService({
		buildCalendarClient: ((refreshToken: string) => ({
			freebusy: {
				query: async ({
					requestBody,
				}: {
					requestBody: { items: { id: string }[] };
				}) => {
					calls.set(refreshToken, (calls.get(refreshToken) ?? 0) + 1);
					if (failingTokens.has(refreshToken)) {
						throw invalidGrant();
					}
					return {
						data: {
							calendars: Object.fromEntries(
								requestBody.items.map((item) => [item.id, { busy: [] }])
							),
						},
					};
				},
			},
		})) as unknown as BuildCalendarClient,
		loadConnection: async (consultantId: string) => ({
			connection: connections.get(consultantId),
			consultantName: `Nome ${consultantId}`,
		}),
	});

	return { calls, service };
}

function captureConsoleError(t: { after: (fn: () => void) => void }) {
	const lines: string[] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => {
		lines.push(args.map(String).join(" "));
	};
	t.after(() => {
		console.error = original;
	});
	return lines;
}

function reauthLines(lines: string[]) {
	return lines
		.filter((line) => line.includes('"event":"google_calendar_needs_reauth"'))
		.map((line) => JSON.parse(line));
}

test("consultor sem linha de conexão sai do sorteio e é logado", async (t) => {
	resetCalendarHealthForTests();
	const lines = captureConsoleError(t);
	const { service } = calendarWithConnections(
		new Map([
			[
				freeOne.id,
				{ id: "conn-1", refreshToken: "tok-one", updatedAt: new Date(1) },
			],
		])
	);
	const availability = new ConsultantAvailabilityService(service);

	for (const value of [0, 0.5, 0.99]) {
		const slots = await availability.getAvailableConsultants(
			[freeOne, freeTwo],
			timeMin,
			timeMax,
			{ random: () => value }
		);
		assert.equal(slots.length, 1);
		assert.equal(slots[0]?.consultant.id, freeOne.id);
	}

	const reauth = reauthLines(lines);
	assert.equal(reauth.length, 3, "uma linha por oferta, nunca em silêncio");
	for (const line of reauth) {
		assert.equal(line.consultantId, freeTwo.id);
		assert.equal(line.reason, "not_connected");
	}
	assert.ok(!lines.join("\n").includes("tok-"), "nunca o token");
});

function twoConnections(): Map<string, FakeConnection> {
	return new Map([
		[
			freeOne.id,
			{ id: "conn-one", refreshToken: "tok-one", updatedAt: new Date(1) },
		],
		[
			freeTwo.id,
			{ id: "conn-two", refreshToken: "tok-two", updatedAt: new Date(1) },
		],
	]);
}

test("consultor com invalid_grant sai do sorteio; os outros seguem", async (t) => {
	resetCalendarHealthForTests();
	captureConsoleError(t);
	const { service } = calendarWithConnections(
		twoConnections(),
		new Set(["tok-two"])
	);
	const availability = new ConsultantAvailabilityService(service);

	for (const value of [0, 0.99]) {
		const slots = await availability.getAvailableConsultants(
			[freeOne, freeTwo],
			timeMin,
			timeMax,
			{ random: () => value }
		);
		assert.equal(slots.length, 1);
		assert.equal(slots[0]?.consultant.id, freeOne.id);
	}

	// Outro erro (ex.: timeout) também tira só aquele consultor desta oferta.
	const timeoutOnTwo = new ConsultantAvailabilityService({
		getBusyPeriods: async (calendarIds: string[]) => {
			if (calendarIds[0] === freeTwo.calendarId) {
				throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
			}
			return calendarIds.map((calendarId) => ({ busy: [], calendarId }));
		},
	} as unknown as GoogleCalendarService);
	const slots = await timeoutOnTwo.getAvailableConsultants(
		[freeTwo, freeOne],
		timeMin,
		timeMax,
		{ random: () => 0 }
	);
	assert.deepEqual(
		slots.map((slot) => slot.consultant.id),
		[freeOne.id]
	);
});

test("todos quebrados → CalendarUnavailableError", async (t) => {
	resetCalendarHealthForTests();
	captureConsoleError(t);
	const { service } = calendarWithConnections(
		twoConnections(),
		new Set(["tok-one", "tok-two"])
	);
	const availability = new ConsultantAvailabilityService(service);

	await assert.rejects(
		() =>
			availability.getAvailableConsultants(
				[freeOne, freeTwo],
				timeMin,
				timeMax,
				{
					random: () => 0,
				}
			),
		(error: unknown) =>
			error instanceof CalendarUnavailableError && error.failures.length === 2
	);

	// Já marcados: a segunda oferta também cai no texto fixo, sem Google.
	await assert.rejects(
		() =>
			availability.getAvailableConsultants(
				[freeOne, freeTwo],
				timeMin,
				timeMax
			),
		CalendarUnavailableError
	);
});

test("consultor marcado não recebe nova chamada ao Calendar", async (t) => {
	resetCalendarHealthForTests();
	captureConsoleError(t);
	const { calls, service } = calendarWithConnections(
		twoConnections(),
		new Set(["tok-two"])
	);
	const availability = new ConsultantAvailabilityService(service);

	for (let offer = 0; offer < 3; offer += 1) {
		await availability.getAvailableConsultants(
			[freeOne, freeTwo],
			timeMin,
			timeMax,
			{ random: () => 0 }
		);
	}

	assert.equal(calls.get("tok-two"), 1, "só a 1ª oferta consulta o quebrado");
	assert.equal(calls.get("tok-one"), 3);
});

test("reautorização (updatedAt novo) devolve o consultor ao sorteio", async (t) => {
	resetCalendarHealthForTests();
	captureConsoleError(t);
	const connections = twoConnections();
	const failing = new Set(["tok-two"]);
	const { calls, service } = calendarWithConnections(connections, failing);
	const availability = new ConsultantAvailabilityService(service);

	await availability.getAvailableConsultants(
		[freeOne, freeTwo],
		timeMin,
		timeMax
	);

	// Reautorização: o upsert troca token e updatedAt da mesma linha.
	connections.set(freeTwo.id, {
		id: "conn-two",
		refreshToken: "tok-two-new",
		updatedAt: new Date(2),
	});

	const slots = await availability.getAvailableConsultants(
		[freeOne, freeTwo],
		timeMin,
		timeMax,
		{ random: () => 0.99 }
	);
	assert.equal(slots[0]?.consultant.id, freeTwo.id);
	assert.equal(calls.get("tok-two-new"), 1);
});

test("log de reauth traz consultantId e nunca token", async (t) => {
	resetCalendarHealthForTests();
	const lines = captureConsoleError(t);
	const { service } = calendarWithConnections(
		twoConnections(),
		new Set(["tok-two"])
	);
	const availability = new ConsultantAvailabilityService(service);

	for (let offer = 0; offer < 3; offer += 1) {
		await availability.getAvailableConsultants(
			[freeOne, freeTwo],
			timeMin,
			timeMax
		);
	}

	const reauth = reauthLines(lines);
	assert.equal(reauth.length, 1, "uma linha por consultor recém-marcado");
	assert.deepEqual(reauth[0], {
		connectionId: "conn-two",
		consultantId: freeTwo.id,
		consultantName: `Nome ${freeTwo.id}`,
		event: "google_calendar_needs_reauth",
		reason: "invalid_grant",
	});
	assert.ok(!lines.join("\n").includes("tok-"), "nunca o token");
});
