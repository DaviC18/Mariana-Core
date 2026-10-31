import assert from "node:assert/strict";
import test from "node:test";

import {
	buildAppointmentInfoText,
	buildBookingConfirmationText,
	buildDeclineText,
	buildWelcomeText,
	CONSULTANT_BUTTON,
	firstNameForGreeting,
	pickVariant,
	T_RESCHEDULE,
} from "../../../services/flow-v2/texts";
import { formatSlotDate } from "../../../utils/date-formatter";

const CONVERSATION_A = "6f1d2c3b-0000-4000-8000-000000000001";
const CONVERSATION_B = "6f1d2c3b-0000-4000-8000-000000000002";

test("button title ≤ 20", () => {
	assert.equal(CONSULTANT_BUTTON.id, "consultor:falar");
	assert.equal(CONSULTANT_BUTTON.title, "Falar com consultor");
	assert.ok(CONSULTANT_BUTTON.title.length <= 20);
});

test("greeting never uses the phone as name", () => {
	const phone = "5511987654321";

	assert.equal(firstNameForGreeting(phone, phone), null);
	assert.equal(firstNameForGreeting("+55 11 98765-4321", phone), null);
	assert.equal(firstNameForGreeting("12345", phone), null);
	assert.equal(firstNameForGreeting("   ", phone), null);
	assert.equal(firstNameForGreeting("😀😀", phone), null);
	assert.equal(
		firstNameForGreeting("Maximiliano-Bartolomeu-Augusto", phone),
		null
	);
	assert.equal(firstNameForGreeting("  ana  paula ", phone), "Ana");
	assert.equal(firstNameForGreeting("JOÃO", phone), "João");

	const anonymous = buildWelcomeText({
		conversationId: CONVERSATION_A,
		name: phone,
		phone,
	});
	assert.equal(
		anonymous,
		"Oi! Eu sou a Mariana, atendente virtual da Ademicon. Como posso ajudar você hoje?"
	);
	assert.ok(!anonymous.includes("98765"));
	assert.equal(
		buildWelcomeText({ conversationId: CONVERSATION_A, name: "Ana", phone }),
		"Oi, Ana! Eu sou a Mariana, atendente virtual da Ademicon. Como posso ajudar você hoje?"
	);
});

test("variation is deterministic", () => {
	const variants = ["a", "b", "c"] as const;
	const first = pickVariant(variants, CONVERSATION_A);

	for (let index = 0; index < 5; index += 1) {
		assert.equal(pickVariant(variants, CONVERSATION_A), first);
	}
	assert.ok(variants.includes(pickVariant(variants, CONVERSATION_B)));
	assert.equal(
		buildDeclineText(CONVERSATION_A),
		buildDeclineText(CONVERSATION_A)
	);
	assert.equal(
		buildDeclineText(CONVERSATION_A),
		"Tudo bem! Se surgir qualquer dúvida, é só me chamar por aqui."
	);
});

test("T-RESCHEDULE: approved wording (reschedule and cancel)", () => {
	assert.equal(
		T_RESCHEDULE,
		"Tudo bem! Anotei seu pedido e o consultor entra em contato com você. Precisa de mais alguma coisa?"
	);
});

test("T-APPOINTMENT-INFO: consultant, pt-BR weekday, date and time in São Paulo", () => {
	assert.equal(
		buildAppointmentInfoText({
			consultantName: "Carla Souza",
			// 03/11/2026 17:30 UTC = terça-feira 14:30 em São Paulo.
			startAt: new Date("2026-11-03T17:30:00.000Z"),
		}),
		"Sua reunião com Carla Souza está marcada para terça-feira, 03/11, às 14:30, pelo Google Meet (30 minutos). Obrigada pela confiança! Precisa de mais alguma coisa?"
	);
	// 02:00 UTC de domingo ainda é sábado 23:00 em São Paulo.
	assert.equal(
		buildAppointmentInfoText({
			consultantName: "Rui",
			startAt: new Date("2026-11-08T02:00:00.000Z"),
		}),
		"Sua reunião com Rui está marcada para sábado, 07/11, às 23:00, pelo Google Meet (30 minutos). Obrigada pela confiança! Precisa de mais alguma coisa?"
	);
});

test("T-APPOINTMENT-INFO: appends the Meet link only when there is one", () => {
	const args = {
		consultantName: "Carla Souza",
		startAt: new Date("2026-11-03T17:30:00.000Z"),
	};
	const base = buildAppointmentInfoText(args);
	const link = "https://meet.google.com/abc-defg-hij";

	assert.equal(
		buildAppointmentInfoText({ ...args, meetLink: link }),
		`${base}\n\nLink do Google Meet: ${link}`
	);
	assert.equal(buildAppointmentInfoText({ ...args, meetLink: null }), base);
	assert.equal(buildAppointmentInfoText({ ...args, meetLink: "  " }), base);
});

test("booking confirmation: approved text, Meet link appended when present", () => {
	const startAt = new Date(2026, 10, 3, 14, 30);
	const base = `Agendamento confirmado para ${formatSlotDate(startAt)} com Carla Souza.`;

	assert.equal(
		buildBookingConfirmationText({ consultantName: "Carla Souza", startAt }),
		base
	);
	assert.equal(
		buildBookingConfirmationText({
			consultantName: "Carla Souza",
			meetLink: "https://meet.google.com/abc-defg-hij",
			startAt,
		}),
		`${base}\n\nLink do Google Meet: https://meet.google.com/abc-defg-hij`
	);
});

test("tester A4: T-APPOINTMENT-INFO at midnight and year boundary in São Paulo", () => {
	const tail =
		", pelo Google Meet (30 minutos). Obrigada pela confiança! Precisa de mais alguma coisa?";
	// 03:00 UTC = 00:00 em São Paulo: nunca "24:00", dia novo.
	assert.equal(
		buildAppointmentInfoText({
			consultantName: "João Silva",
			startAt: new Date("2027-01-01T03:00:00.000Z"),
		}),
		`Sua reunião com João Silva está marcada para sexta-feira, 01/01, às 00:00${tail}`
	);
	// 02:59 UTC ainda é o dia anterior.
	assert.equal(
		buildAppointmentInfoText({
			consultantName: "João Silva",
			startAt: new Date("2027-01-01T02:59:00.000Z"),
		}),
		`Sua reunião com João Silva está marcada para quinta-feira, 31/12, às 23:59${tail}`
	);
});
