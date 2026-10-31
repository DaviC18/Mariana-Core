/** biome-ignore-all lint/suspicious/useAwait: fakes assíncronos do Calendar */
/**
 * 2026-10-27-scheduling-loop, passo 4 (RC-2, Q3): cada consultor é lido com a
 * própria conexão do Google Calendar. Consultor sem linha de conexão →
 * `CalendarAuthError('not_connected')`, com log, nunca em silêncio.
 *
 * Banco de teste local. O cliente do Google é falso (injetado): nenhuma
 * chamada real. Os consultores daqui são inativos, para não entrar nos
 * sorteios dos outros testes; o delete em cascata leva as conexões.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { inArray } from "drizzle-orm";

import { closeDatabase, db } from "../../db/connections";
import { consultants } from "../../db/schema/consultants";
import { googleCalendarConnections } from "../../db/schema/google-calendar-connections";
import { CalendarAuthError } from "../../integrations/google-calendar/google-calendar-errors";
import {
	type BuildCalendarClient,
	GoogleCalendarService,
} from "../../integrations/google-calendar/google-calendar-service";

test.after(async () => {
	await closeDatabase();
});

const timeMin = new Date("2035-03-01T13:00:00.000Z");
const timeMax = new Date("2035-03-01T13:30:00.000Z");

/** Cliente falso: registra o refresh token usado em cada consulta. */
function recordingClientFactory() {
	const tokensUsed: string[] = [];
	const build = ((refreshToken: string) => ({
		freebusy: {
			query: async ({
				requestBody,
			}: {
				requestBody: { items: { id: string }[] };
			}) => {
				tokensUsed.push(refreshToken);
				return {
					data: {
						calendars: Object.fromEntries(
							requestBody.items.map((item) => [item.id, { busy: [] }])
						),
					},
				};
			},
		},
	})) as unknown as BuildCalendarClient;

	return { build, tokensUsed };
}

async function seedConsultants(t: {
	after: (fn: () => Promise<void>) => void;
}) {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const rows = await db
		.insert(consultants)
		.values(
			["a", "b", "c"].map((label) => ({
				active: false,
				calendarId: `gcs-${label}-${suffix}@test`,
				email: `gcs-${label}-${suffix}@test.local`,
				name: `Consultor GCS ${label.toUpperCase()}`,
			}))
		)
		.returning({ calendarId: consultants.calendarId, id: consultants.id });

	t.after(async () => {
		await db.delete(consultants).where(
			inArray(
				consultants.id,
				rows.map((row) => row.id)
			)
		);
	});

	const [first, second, unconnected] = rows;
	assert.ok(first && second && unconnected);

	// Duas conexões; o terceiro consultor fica sem linha.
	await db.insert(googleCalendarConnections).values([
		{
			consultantId: first.id,
			googleAccountEmail: "shared@test.local",
			refreshToken: `refresh-first-${suffix}`,
		},
		{
			consultantId: second.id,
			googleAccountEmail: "shared@test.local",
			refreshToken: `refresh-second-${suffix}`,
		},
	]);

	return { first, second, suffix, unconnected };
}

test("getBusyPeriods usa a conexão do consultor pedido, não a primeira", async (t) => {
	const { first, second, suffix } = await seedConsultants(t);
	const client = recordingClientFactory();
	const service = new GoogleCalendarService({
		buildCalendarClient: client.build,
	});

	await service.getBusyPeriods(
		[second.calendarId],
		timeMin,
		timeMax,
		second.id
	);
	await service.getBusyPeriods([first.calendarId], timeMin, timeMax, first.id);

	assert.deepEqual(client.tokensUsed, [
		`refresh-second-${suffix}`,
		`refresh-first-${suffix}`,
	]);
});

test("consultor sem linha de conexão → CalendarAuthError not_connected, logado sem token", async (t) => {
	const { unconnected } = await seedConsultants(t);
	const client = recordingClientFactory();
	const service = new GoogleCalendarService({
		buildCalendarClient: client.build,
	});
	const lines: string[] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => {
		lines.push(args.map(String).join(" "));
	};
	t.after(() => {
		console.error = original;
	});

	await assert.rejects(
		() =>
			service.getBusyPeriods(
				[unconnected.calendarId],
				timeMin,
				timeMax,
				unconnected.id
			),
		(error: unknown) =>
			error instanceof CalendarAuthError &&
			error.reason === "not_connected" &&
			error.consultantId === unconnected.id
	);

	assert.equal(client.tokensUsed.length, 0, "nenhuma chamada ao Google");
	const reauth = lines
		.filter((line) => line.includes('"event":"google_calendar_needs_reauth"'))
		.map((line) => JSON.parse(line));
	assert.equal(reauth.length, 1, lines.join("\n"));
	assert.equal(reauth[0].consultantId, unconnected.id);
	assert.equal(reauth[0].reason, "not_connected");
	assert.ok(!lines.join("\n").includes("refresh-"), "nunca o token");
});
