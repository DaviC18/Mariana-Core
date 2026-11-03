import assert from "node:assert/strict";
import test from "node:test";

import {
	parseDatePreference,
	parseMonthPreference,
	parsePeriodPreference,
} from "../../../services/flow-v2/date-preference";

/**
 * Regressão do teste no WhatsApp de 2026-11-03: o lead pediu quarta-feira e a
 * oferta voltou com a janela inteira de 5 dias, porque este módulo não existia
 * no mariana-core. "quarta" não era coberta por nenhum teste, nos dois repos.
 */
test("regressão: 'tem algum horário para a quarta-feira?' restringe a busca à quarta", () => {
	// Terça-feira, 03/11/2026, 18:00 em São Paulo.
	const preference = parseDatePreference(
		["tem algum horario para a quarta-feira?"],
		new Date("2026-11-03T21:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-04T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-05T03:00:00.000Z");
});

test("quarta é reconhecida com e sem acento, sufixo e gatilho", () => {
	const now = new Date("2026-11-03T21:00:00.000Z");
	for (const message of [
		"tem algum horário para a quarta-feira?",
		"tem algum horario para quarta?",
		"quarta-feira",
		"pode ser quarta",
		"tem para quarta-feira",
		"prefiro quarta",
	]) {
		const preference = parseDatePreference([message], now);
		assert.ok(preference && preference.kind === "date", message);
		assert.equal(
			preference.timeMin.toISOString(),
			"2026-11-04T03:00:00.000Z",
			message
		);
		assert.equal(
			preference.timeMax.toISOString(),
			"2026-11-05T03:00:00.000Z",
			message
		);
	}
});

test("quarta pedida na própria quarta cai na semana seguinte", () => {
	// Quarta-feira, 04/11/2026, 18:00 em São Paulo.
	const preference = parseDatePreference(
		["tem para quarta-feira?"],
		new Date("2026-11-04T21:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-11T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-12T03:00:00.000Z");
});

test("próxima segunda-feira atravessa o mês no fuso de São Paulo", () => {
	const preference = parseDatePreference(
		["tem para a próxima segunda-feira?"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-02T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-03T03:00:00.000Z");
});

test("eu prefiro segunda reconhece Monday sem a palavra 'tem' ou 'próxima'", () => {
	const preference = parseDatePreference(
		["eu prefiro segunda"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-02T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-03T03:00:00.000Z");
});

test("prefiro segunda-feira reconhece com sufixo -feira", () => {
	const preference = parseDatePreference(
		["prefiro segunda-feira"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-02T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-03T03:00:00.000Z");
});

test("amanhã no dia 29/10 dá dia 30/10", () => {
	const preference = parseDatePreference(
		["amanhã"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-10-30T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-10-31T03:00:00.000Z");
});

test("tem outros dias? sem data específica pede esclarecimento", () => {
	assert.deepEqual(
		parseDatePreference(
			["tem outros dias?"],
			new Date("2026-10-29T18:00:00.000Z")
		),
		{ kind: "ambiguous" }
	);
});

test("pedido de horário sem data inequívoca pede esclarecimento", () => {
	assert.deepEqual(
		parseDatePreference(["tem horário?"], new Date("2026-10-29T18:00:00.000Z")),
		{ kind: "ambiguous" }
	);
});

test("prefiro terça no dia 29/10 dá terça-feira 03/11", () => {
	const preference = parseDatePreference(
		["prefiro terça"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-03T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-04T03:00:00.000Z");
});

test("pode ser na quinta no dia 29/10 dá próxima quinta 05/11", () => {
	const preference = parseDatePreference(
		["pode ser na quinta?"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-05T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-06T03:00:00.000Z");
});

test("dia 30 no dia 29/10 reconhece sexta-feira 30/10", () => {
	const preference = parseDatePreference(
		["eu prefiro dia 30"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-10-30T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-10-31T03:00:00.000Z");
});

test("dia 2 no dia 29/10 reconhece virada de mês para 02/11", () => {
	const preference = parseDatePreference(
		["pode ser dia 2?"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-02T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-03T03:00:00.000Z");
});

test("formato com barra 03/11 reconhece 03 de novembro", () => {
	const preference = parseDatePreference(
		["tem vaga 03/11?"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-03T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-04T03:00:00.000Z");
});

test("dia com nome de mês 'dia 4 de novembro' reconhece a data", () => {
	const preference = parseDatePreference(
		["prefiro dia 4 de novembro"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-04T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-05T03:00:00.000Z");
});

test("pergunta geral não é interpretada como preferência de data", () => {
	assert.equal(
		parseDatePreference(
			["como funciona o consórcio de carro?"],
			new Date("2026-10-29T18:00:00.000Z")
		),
		null
	);
});

test("dia da semana solto em frase comercial não é preferência de data", () => {
	const now = new Date("2026-10-29T18:00:00.000Z");
	for (const message of [
		"quanto fica a segunda parcela?",
		"e a quinta parcela?",
		"segunda opção pode ser",
		"me passa o link da reunião de segunda",
	]) {
		assert.equal(parseDatePreference([message], now), null, message);
	}
});

test("dia da semana com -feira sozinho continua sendo preferência", () => {
	const preference = parseDatePreference(
		["segunda-feira"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-11-02T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-11-03T03:00:00.000Z");
});

test("data no passado pede esclarecimento em vez de oferecer o dia errado", () => {
	const now = new Date("2026-10-29T18:00:00.000Z");
	for (const message of ["dia 5 de outubro funciona?", "05/10 tem vaga?"]) {
		assert.deepEqual(
			parseDatePreference([message], now),
			{ kind: "ambiguous" },
			message
		);
	}
});

test("dia de hoje continua válido e não vira ambíguo", () => {
	const preference = parseDatePreference(
		["pode ser hoje?"],
		new Date("2026-10-29T18:00:00.000Z")
	);
	assert.ok(preference && preference.kind === "date");
	assert.equal(preference.timeMin.toISOString(), "2026-10-29T03:00:00.000Z");
	assert.equal(preference.timeMax.toISOString(), "2026-10-30T03:00:00.000Z");
});

test("novembro isolado vira mês", () => {
	const now = new Date("2026-10-29T18:00:00.000Z");
	assert.equal(parseMonthPreference(["novembro"], now), "2026-11");
	assert.equal(parseMonthPreference(["prefiro novembro"], now), "2026-11");
	assert.equal(parseMonthPreference(["novembro de 2027"], now), "2027-11");
	assert.equal(parseMonthPreference(["janeiro"], now), "2027-01");
	assert.equal(parseMonthPreference(["dia 4 de novembro"], now), null);
	assert.equal(parseMonthPreference(["04/11"], now), null);
});

test("mês que vem vira o mês seguinte", () => {
	const now = new Date("2026-10-29T18:00:00.000Z");
	assert.equal(parseMonthPreference(["mês que vem"], now), "2026-11");
	assert.equal(parseMonthPreference(["próximo mês"], now), "2026-11");
	const dec = new Date("2026-12-15T18:00:00.000Z");
	assert.equal(parseMonthPreference(["mês que vem"], dec), "2027-01");
});

test("mês isolado não vira data", () => {
	const now = new Date("2026-10-29T18:00:00.000Z");
	assert.equal(parseDatePreference(["novembro"], now), null);
	assert.equal(parseDatePreference(["mês que vem"], now), null);
	assert.equal(parseDatePreference(["próximo mês"], now), null);
});

test("de manhã e à tarde viram período", () => {
	assert.equal(parsePeriodPreference(["de manhã"]), "manha");
	assert.equal(parsePeriodPreference(["manhã"]), "manha");
	assert.equal(parsePeriodPreference(["pela manhã"]), "manha");
	assert.equal(parsePeriodPreference(["prefiro de manhã"]), "manha");
	assert.equal(parsePeriodPreference(["à tarde"]), "tarde");
	assert.equal(parsePeriodPreference(["tarde"]), "tarde");
	assert.equal(parsePeriodPreference(["pela tarde"]), "tarde");
	assert.equal(parsePeriodPreference(["pode ser à tarde"]), "tarde");
	assert.equal(parsePeriodPreference(["boa tarde"]), null);
	assert.equal(parsePeriodPreference(["falo mais tarde"]), null);
});

test("período sem data não vira data", () => {
	const now = new Date("2026-10-29T18:00:00.000Z");
	assert.equal(parseDatePreference(["de manhã"], now), null);
	assert.equal(parseDatePreference(["à tarde"], now), null);
	assert.equal(parseDatePreference(["prefiro à tarde"], now), null);
});

test("segunda parcela continua fora do parser de mês e período", () => {
	const now = new Date("2026-10-29T18:00:00.000Z");
	assert.equal(
		parseMonthPreference(["quanto fica a segunda parcela?"], now),
		null
	);
	assert.equal(parsePeriodPreference(["quanto fica a segunda parcela?"]), null);
	assert.equal(
		parseDatePreference(["quanto fica a segunda parcela?"], now),
		null
	);
});
