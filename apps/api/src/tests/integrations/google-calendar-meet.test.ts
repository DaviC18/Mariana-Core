/** biome-ignore-all lint/correctness/noUnsafeOptionalChaining: asserts de teste */
/** biome-ignore-all lint/suspicious/noExplicitAny: cliente falso do Google */
/** biome-ignore-all lint/suspicious/useAwait: fakes assíncronos do Google */
/**
 * C-MEET (2026-10-28-flow-v2): sala do Google Meet, link de leitura e
 * descrição do evento. Sem banco e sem rede: cliente do Google injetado.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	type BuildCalendarClient,
	GoogleCalendarService,
} from "../../integrations/google-calendar/google-calendar-service";

const consultantId = "c-ana";
const calendarId = "cal-ana@test";
const eventId = "evt-1";

interface FakeOptions {
	getDescription?: string | null;
	hangoutLink?: string | null;
	/** Erro devolvido pelo primeiro insert (CM-3). */
	insertError?: unknown;
	/** Erros devolvidos pelos inserts, em ordem (CM-3); tem precedência. */
	insertErrors?: unknown[];
	/** Link devolvido pelo insert; sobrepõe `hangoutLink` quando presente. */
	insertHangoutLink?: string | null;
	videoUri?: string | null;
}

function harness(options: FakeOptions = {}) {
	const calls: Record<string, unknown>[] = [];
	let insertCalls = 0;
	const build = ((_token: string) => ({
		events: {
			get: async (request: Record<string, unknown>) => {
				calls.push({ op: "get", ...request });
				return {
					data: {
						conferenceData:
							options.videoUri === null
								? undefined
								: {
										entryPoints: [
											{
												entryPointType: "video",
												uri: options.videoUri ?? undefined,
											},
										],
									},
						description: options.getDescription ?? undefined,
						hangoutLink: options.hangoutLink ?? undefined,
					},
				};
			},
			insert: async (request: Record<string, unknown>) => {
				calls.push({ op: "insert", ...request });
				insertCalls += 1;

				const queuedError = options.insertErrors?.shift();
				const error = queuedError ?? options.insertError;

				if (error) {
					options.insertError = undefined;
					throw error;
				}

				return {
					data: {
						end: { dateTime: "2035-03-05T13:30:00.000Z" },
						hangoutLink:
							"insertHangoutLink" in options
								? (options.insertHangoutLink ?? undefined)
								: (options.hangoutLink ?? undefined),
						id: eventId,
						start: { dateTime: "2035-03-05T13:00:00.000Z" },
					},
				};
			},
			patch: async (request: Record<string, unknown>) => {
				calls.push({ op: "patch", ...request });
				return { data: {} };
			},
		},
	})) as unknown as BuildCalendarClient;

	return {
		calls,
		insertCount: () => insertCalls,
		service: new GoogleCalendarService({
			buildCalendarClient: build,
			loadConnection: async () => ({
				connection: {
					id: "conn-ana",
					refreshToken: "tok-ana",
					updatedAt: new Date(10),
				},
				consultantName: "Ana",
			}),
		}),
	};
}

test("createEvent asks for a hangoutsMeet room and returns the link", async () => {
	const { calls, service } = harness({
		hangoutLink: "https://meet.google.com/abc-defg-hij",
	});

	const created = await service.createEvent({
		calendarId,
		consultantId,
		description: "Cliente Ana — https://wa.me/5511999999999",
		end: new Date("2035-03-05T13:30:00.000Z"),
		requestId: "req-appointment-1",
		start: new Date("2035-03-05T13:00:00.000Z"),
		summary: "Atendimento - Ana",
	});

	const [insert] = calls;
	assert.equal(insert?.op, "insert");
	assert.equal(insert?.calendarId, calendarId);
	assert.equal(insert?.conferenceDataVersion, 1);
	assert.deepEqual((insert?.requestBody as any).conferenceData, {
		createRequest: {
			conferenceSolutionKey: { type: "hangoutsMeet" },
			requestId: "req-appointment-1",
		},
	});
	assert.equal(
		(insert?.requestBody as any).description,
		"Cliente Ana — https://wa.me/5511999999999"
	);
	assert.equal(created.hangoutLink, "https://meet.google.com/abc-defg-hij");
});

test("getMeetLink reads hangoutLink, falls back to the video entry point, else null", async () => {
	const direct = harness({ hangoutLink: "https://meet.google.com/direct" });
	assert.equal(
		await direct.service.getMeetLink({ calendarId, consultantId, eventId }),
		"https://meet.google.com/direct"
	);
	assert.deepEqual(direct.calls[0], {
		calendarId,
		eventId,
		op: "get",
	});

	const entryPoint = harness({
		hangoutLink: null,
		videoUri: "https://meet.google.com/video",
	});
	assert.equal(
		await entryPoint.service.getMeetLink({ calendarId, consultantId, eventId }),
		"https://meet.google.com/video"
	);

	const none = harness({ hangoutLink: null, videoUri: null });
	assert.equal(
		await none.service.getMeetLink({ calendarId, consultantId, eventId }),
		null
	);
});

test("appendEventDescription reads the event and patches the line at the end", async () => {
	const { calls, service } = harness({
		getDescription: "Agendamento da Mariana para o lead x.",
	});

	await service.appendEventDescription({
		calendarId,
		consultantId,
		eventId,
		line: "Cliente pediu remarcação pelo WhatsApp em 28/10/2026.",
	});

	assert.deepEqual(
		calls.map((call) => call.op),
		["get", "patch"]
	);
	assert.equal(calls[0]?.calendarId, calendarId);
	assert.equal(calls[0]?.eventId, eventId);
	assert.equal(calls[1]?.calendarId, calendarId);
	assert.equal(calls[1]?.eventId, eventId);
	assert.equal(
		(calls[1]?.requestBody as any).description,
		"Agendamento da Mariana para o lead x.\n\nCliente pediu remarcação pelo WhatsApp em 28/10/2026."
	);
});

test("appendEventDescription starts the description when the event has none", async () => {
	const { calls, service } = harness({ getDescription: null });

	await service.appendEventDescription({
		calendarId,
		consultantId,
		eventId,
		line: "Cliente pediu remarcação pelo WhatsApp em 28/10/2026.",
	});

	assert.equal(
		(calls[1]?.requestBody as any).description,
		"Cliente pediu remarcação pelo WhatsApp em 28/10/2026."
	);
});

const meetInput = {
	calendarId,
	consultantId,
	description:
		"Agendamento da Mariana.\nCliente: Ana Teste\nWhatsApp: https://wa.me/5511999999999\nObjetivo: casa própria",
	end: new Date("2035-03-05T13:30:00.000Z"),
	requestId: "req-appointment-1",
	start: new Date("2035-03-05T13:00:00.000Z"),
	summary: "Atendimento - Ana",
};

function conferenceRejection() {
	return Object.assign(new Error("Invalid conference type value."), {
		response: {
			data: { error: { code: 400, message: "Invalid conference type value." } },
			status: 400,
		},
	});
}

function captureMeetMissingLogs() {
	const logs: Record<string, unknown>[] = [];
	const originalInfo = console.info;
	console.info = (line?: unknown) => {
		originalInfo(line);
		if (
			typeof line === "string" &&
			line.includes('"calendar_meet_link_missing"')
		) {
			logs.push(JSON.parse(line));
		}
	};

	return {
		logs,
		restore() {
			console.info = originalInfo;
		},
	};
}

test("createEvent: conference rejected → event created without conferenceData, one insert, one log", async () => {
	const { calls, insertCount, service } = harness({
		insertError: conferenceRejection(),
	});
	const capture = captureMeetMissingLogs();

	let created: Awaited<ReturnType<typeof service.createEvent>>;

	try {
		created = await service.createEvent(meetInput);
	} finally {
		capture.restore();
	}

	assert.equal(insertCount(), 2);
	assert.equal(created.id, eventId);
	assert.equal(created.hangoutLink, undefined);

	const [withConference, fallback] = calls;
	assert.equal(withConference?.conferenceDataVersion, 1);
	assert.deepEqual((withConference?.requestBody as any).conferenceData, {
		createRequest: {
			conferenceSolutionKey: { type: "hangoutsMeet" },
			requestId: "req-appointment-1",
		},
	});
	assert.equal(fallback?.calendarId, calendarId);
	assert.equal(fallback?.conferenceDataVersion, undefined);
	assert.equal((fallback?.requestBody as any).conferenceData, undefined);
	assert.equal(
		(fallback?.requestBody as any).description,
		meetInput.description
	);
	assert.equal((fallback?.requestBody as any).summary, meetInput.summary);
	assert.equal(
		(fallback?.requestBody as any).start.dateTime,
		meetInput.start.toISOString()
	);
	assert.equal(
		(fallback?.requestBody as any).end.dateTime,
		meetInput.end.toISOString()
	);

	assert.equal(capture.logs.length, 1);
	assert.equal(capture.logs[0]?.event, "calendar_meet_link_missing");
	const logged = JSON.stringify(capture.logs);
	assert.ok(!logged.includes("Ana Teste"));
	assert.ok(!logged.includes("5511999999999"));
	assert.ok(!logged.includes("casa própria"));
	assert.ok(!logged.includes(meetInput.summary));
});

test("createEvent: no hangoutLink in the created event → no second insert, one log", async () => {
	const { insertCount, service } = harness({
		hangoutLink: null,
		insertHangoutLink: null,
	});
	const capture = captureMeetMissingLogs();

	let created: Awaited<ReturnType<typeof service.createEvent>>;

	try {
		created = await service.createEvent(meetInput);
	} finally {
		capture.restore();
	}

	assert.equal(insertCount(), 1);
	assert.equal(created.id, eventId);
	assert.equal(created.hangoutLink, undefined);
	assert.equal(capture.logs.length, 1);
	assert.equal(capture.logs[0]?.event, "calendar_meet_link_missing");
});

test("createEvent: non-conference insert error is rethrown without a second insert", async () => {
	const failure = Object.assign(new Error("Backend Error"), {
		response: {
			data: { error: { code: 500, message: "Backend Error" } },
			status: 500,
		},
	});
	const { insertCount, service } = harness({ insertError: failure });

	await assert.rejects(() => service.createEvent(meetInput), {
		message: "Backend Error",
	});
	assert.equal(insertCount(), 1);
});

test("tester CM-3: network, timeout and auth errors are rethrown with one insert and no log", async () => {
	const cases = [
		{
			error: Object.assign(new Error("socket hang up"), {
				code: "ECONNRESET",
			}),
			name: "network",
		},
		{
			error: Object.assign(new Error("timeout of 5000ms exceeded"), {
				code: "ETIMEDOUT",
			}),
			name: "timeout",
		},
		{
			error: Object.assign(new Error("Invalid Credentials"), {
				response: {
					data: { error: { code: 401, message: "Invalid Credentials" } },
					status: 401,
				},
			}),
			name: "auth 401",
		},
		{
			error: Object.assign(new Error("The caller does not have permission"), {
				response: {
					data: {
						error: {
							code: 403,
							message: "The caller does not have permission",
						},
					},
					status: 403,
				},
			}),
			name: "auth 403 without conference wording",
		},
	];

	for (const { error, name } of cases) {
		const { insertCount, service } = harness({ insertError: error });
		const capture = captureMeetMissingLogs();

		try {
			// biome-ignore lint/performance/noAwaitInLoops: cada caso tem harness próprio.
			await assert.rejects(
				() => service.createEvent(meetInput),
				(thrown) => thrown === error,
				name
			);
		} finally {
			capture.restore();
		}

		assert.equal(insertCount(), 1, name);
		assert.equal(capture.logs.length, 0, name);
	}
});

test("tester CM-3: a failed fallback insert is not retried a third time", async () => {
	const fallbackFailure = Object.assign(new Error("Backend Error"), {
		response: {
			data: { error: { code: 500, message: "Backend Error" } },
			status: 500,
		},
	});
	const { insertCount, service } = harness({
		insertErrors: [conferenceRejection(), fallbackFailure],
	});
	const capture = captureMeetMissingLogs();

	try {
		await assert.rejects(() => service.createEvent(meetInput), {
			message: "Backend Error",
		});
	} finally {
		capture.restore();
	}

	assert.equal(insertCount(), 2);
	assert.equal(capture.logs.length, 0);
});

test("tester CM-3: the meet-missing log carries only technical ids and a reason", async () => {
	const missing = harness({ hangoutLink: null, insertHangoutLink: null });
	const missingCapture = captureMeetMissingLogs();
	try {
		await missing.service.createEvent(meetInput);
	} finally {
		missingCapture.restore();
	}

	assert.equal(missingCapture.logs.length, 1);
	assert.deepEqual(Object.keys(missingCapture.logs[0] ?? {}).sort(), [
		"consultantId",
		"event",
		"reason",
		"source",
	]);
	assert.equal(missingCapture.logs[0]?.reason, "no_link");
	assert.equal(missingCapture.logs[0]?.consultantId, consultantId);
	const missingLogged = JSON.stringify(missingCapture.logs);
	assert.ok(!missingLogged.includes("tok-ana"));
	assert.ok(!missingLogged.includes("Ana Teste"));
	assert.ok(!missingLogged.includes("5511999999999"));
	assert.ok(!missingLogged.includes("casa própria"));
	assert.ok(!missingLogged.includes(meetInput.summary));

	const rejected = harness({ insertError: conferenceRejection() });
	const rejectedCapture = captureMeetMissingLogs();
	try {
		await rejected.service.createEvent(meetInput);
	} finally {
		rejectedCapture.restore();
	}

	assert.equal(rejectedCapture.logs.length, 1);
	assert.equal(rejectedCapture.logs[0]?.reason, "conference_rejected");
});
