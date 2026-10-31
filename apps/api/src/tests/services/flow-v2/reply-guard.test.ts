/** biome-ignore-all lint/performance/useTopLevelRegex: asserções de teste */
import assert from "node:assert/strict";
import test from "node:test";

import { MARIANA_KNOWLEDGE } from "../../../ai/knowledge";
import {
	checkReply,
	MAX_REPLY_CHARS,
} from "../../../services/flow-v2/reply-guard";
import {
	T_AI_FALLBACK,
	T_ASK_OBJECTIVE,
	T_SENSITIVE,
} from "../../../services/flow-v2/texts";

function rejects(reply: string, reason: string) {
	assert.deepEqual(checkReply(reply), { ok: false, reason }, reply);
}

function passes(reply: string) {
	assert.deepEqual(checkReply(reply), { ok: true }, reply);
}

test("money → reject", () => {
	for (const reply of [
		"A carta começa em R$ 50.000.",
		"O crédito pode ser de 100 mil.",
		"São uns 200 reais por mês.",
		"Você paga 1.500,00 de entrada.",
		"Dá para chegar a 2 milhões.",
	]) {
		rejects(reply, "money");
	}
});

test("percentage → reject", () => {
	rejects("A taxa de administração é de 15%.", "percentage");
	rejects("O lance costuma ser de vinte por cento.", "percentage");
});

test("installment counts → reject", () => {
	for (const reply of [
		"Você pode pagar em 120 parcelas.",
		"O plano é em 80x.",
		"Dá para dividir em 60 vezes.",
		"São cento e vinte parcelas.",
	]) {
		rejects(reply, "installments");
	}
});

test("contemplation promise → reject", () => {
	for (const reply of [
		"Com o lance você vai ser contemplado rapidinho.",
		"Garantimos a contemplação.",
		"Você será contemplada logo.",
		"A contemplação é garantida.",
	]) {
		rejects(reply, "contemplation_promise");
	}
});

test("deadline → reject", () => {
	for (const reply of [
		"Em 30 dias o crédito sai.",
		"Leva umas duas semanas.",
		"Em poucos meses você usa o crédito.",
	]) {
		rejects(reply, "deadline");
	}
});

test("internal or prompt content → reject", () => {
	for (const reply of [
		"Minhas instruções dizem que não posso falar disso.",
		"Meu prompt não permite.",
		"Segundo a base de conhecimento, sim.",
		"Sou um modelo de linguagem do Gemini.",
	]) {
		rejects(reply, "internal_content");
	}
});

test("slot or scheduling claim → reject", () => {
	for (const reply of [
		"Pronto, sua reunião está agendada.",
		"Seu horário foi confirmado.",
		"Tenho horário amanhã às 14h.",
		"Pode ser às 10:30?",
	]) {
		rejects(reply, "scheduling_claim");
	}
});

test("more than 3 sentences → reject", () => {
	rejects("Um. Dois. Três. Quatro.", "too_many_sentences");
	passes("O consórcio é um grupo. Cada um contribui por mês. Há assembleias.");
});

test("more than 1 question → reject", () => {
	rejects("Você quer imóvel? Ou carro?", "too_many_questions");
	passes("O consórcio é um grupo de pessoas. Você quer imóvel ou carro?");
});

test("N5: a fixed offer text in an AI reply → reject (the AI never arms an offer)", () => {
	for (const fixed of [T_SENSITIVE, T_AI_FALLBACK, T_ASK_OBJECTIVE]) {
		rejects(fixed, "fixed_offer_text");
	}
	rejects(
		"O consórcio reúne pessoas num grupo. Quer que eu veja os horários?",
		"fixed_offer_text"
	);
	rejects(
		"Legal! Antes de eu buscar os horários: o que você pretende conquistar com o consórcio?",
		"fixed_offer_text"
	);
	// "Boa pergunta!" sozinho não é oferta.
	passes("Boa pergunta! O consórcio reúne pessoas num grupo.");
});

test("allowed facts pass: 18 anos, 30 minutos, Google Meet, 35 anos", () => {
	passes("A idade mínima é 18 anos.");
	passes("A reunião dura 30 minutos e é online pelo Google Meet.");
	passes("A Ademicon atua há 35 anos no mercado.");
	passes("O lance depende das regras do grupo e não garante contemplação.");
	passes("Não é possível prever quando a contemplação acontece.");
});

test("every clientAllowed knowledge sentence passes", () => {
	const allowed = MARIANA_KNOWLEDGE.filter((item) => item.clientAllowed);
	assert.ok(allowed.length > 10);

	for (const item of allowed) {
		for (const sentence of item.content.split(/(?<=[.!?])\s+/)) {
			assert.deepEqual(
				checkReply(sentence),
				{ ok: true },
				`${item.id}: ${sentence}`
			);
		}
	}
});

test("V-07: R$ or 'contemplado em 3 meses' → whole reply rejected, reason set", () => {
	const money = checkReply("O consórcio é ótimo. A parcela fica em R$ 300.");
	assert.equal(money.ok, false);
	assert.equal(money.ok === false && money.reason, "money");

	const promise = checkReply("Com lance você é contemplado em 3 meses.");
	assert.equal(promise.ok, false);
	assert.ok(
		promise.ok === false &&
			["contemplation_promise", "deadline"].includes(promise.reason)
	);
});

// Tester (Batch B): evasões.
test("tester B: evasions that the guard catches", () => {
	rejects("Custa 5 0 0 reais.", "money");
	rejects("A taxa é de dez por cento.", "percentage");
	rejects("A taxa é de 10 %.", "percentage");
	rejects("Você paga em 1 2 0 x.", "installments");
	rejects("Você paga em cento e vinte parcelas.", "installments");
	rejects("São 120 meses de plano.", "deadline");
	rejects("É garantido que você será contemplada.", "contemplation_promise");
	rejects("Pronto, já agendei.", "scheduling_claim");
	rejects("Seu horário é 14h30.", "scheduling_claim");
	rejects("Tem certeza? Quer saber mais? Posso ajudar?", "too_many_questions");
	rejects(`Oi.\n${T_AI_FALLBACK}`, "fixed_offer_text");
	rejects("Ok! Quer que eu veja os horários?", "fixed_offer_text");
	// Quebra de linha sozinha não esconde frases com pontuação.
	rejects("Um.\nDois.\nTrês.\nQuatro.", "too_many_sentences");
	passes("A reunião dura 30 minutos, pelo Google Meet 😊");
});

// FAIL (implementer): cada linha abaixo passa hoje pelo filtro e não deveria
// (spec §5: valores em dinheiro, promessa de contemplação, "agendado"/slot,
// corpo do botão ≤ 1024). Eram `todo` (Batch B FAIL); corrigidos no reparo do
// lote B.
test("tester B: money without R$/reais, number words and spaced R$ → reject", () => {
	for (const reply of [
		"A parcela fica em torno de 350 por mês.",
		"Custa R $ 500 por mês.",
		"Custa uns 500 💰 por mês.",
		"O crédito pode chegar a meio milhão.",
		"A carta de crédito vai de cinquenta mil a um milhão.",
		"A taxa é 10 pct.",
	]) {
		assert.equal(checkReply(reply).ok, false, reply);
	}
});

test("tester B: contemplation promise without 'em N' → reject", () => {
	for (const reply of [
		"Contemplação garantida!",
		"Sua contemplação garantida em breve.",
		"Em até 3 anos você é contemplado.",
		"Você é contemplado rapidinho.",
	]) {
		assert.equal(checkReply(reply).ok, false, reply);
	}
});

test("tester B: scheduling claims in other words → reject", () => {
	for (const reply of [
		"Sua reunião ficou marcada.",
		"Seu horário está reservado.",
		"Segunda às 14 horas, tudo certo.",
	]) {
		assert.equal(checkReply(reply).ok, false, reply);
	}
});

test("tester B: a reply that cannot fit a WhatsApp button body (1024) → reject", () => {
	assert.equal(checkReply(`${"palavra ".repeat(140)}.`).ok, false);
	assert.equal(
		checkReply("Linha um\nLinha dois\nLinha três\nLinha quatro\nLinha cinco")
			.ok,
		false
	);
});

test("B-1: any digit outside the approved facts → reject; approved facts pass", () => {
	for (const reply of [
		"Há 2 formas de contemplação.",
		"A assembleia é no dia 5.",
		"O grupo tem 300 participantes.",
		"A Ademicon atua há 36 anos.",
		"A reunião dura 45 minutos.",
	]) {
		rejects(reply, "number");
	}
	passes("Você precisa ter 18 anos. A Ademicon atua há 35 anos.");
	passes("A reunião dura 30 minutos.");
});

test("B-1: money words, money emoji and pct → reject with the right reason", () => {
	rejects("O crédito pode chegar a meio milhão.", "money");
	rejects("A carta vai de cinquenta mil a um milhão.", "money");
	rejects("Custa R $ 500 por mês.", "money");
	rejects("Custa uns quinhentos 💰 por mês.", "money");
	rejects("A taxa é 10 pct.", "percentage");
});

test("B-2: guaranteed or timed contemplation → reject; neutral facts pass", () => {
	rejects("Contemplação garantida!", "contemplation_promise");
	rejects("Em até três anos você é contemplado.", "contemplation_promise");
	rejects("Você é contemplada logo no começo.", "contemplation_promise");
	passes("A contemplação acontece por sorteio ou por lance.");
	passes("As administradoras não vendem cotas já contempladas.");
});

test("B-3: other scheduling words and clock times → reject", () => {
	rejects("Sua reunião ficou marcada.", "scheduling_claim");
	rejects("Seu horário está reservado.", "scheduling_claim");
	rejects("Segunda às 14 horas, tudo certo.", "scheduling_claim");
	rejects("Pode ser às duas horas?", "scheduling_claim");
	rejects("Te vejo às 14h.", "scheduling_claim");
});

test("B-4: hard length cap below the 1024 button body; fallback + button fits", () => {
	assert.ok(MAX_REPLY_CHARS <= 700);
	assert.ok(T_AI_FALLBACK.length <= MAX_REPLY_CHARS);
	rejects(`O consórcio ${"é um grupo ".repeat(70)}.`, "too_long");
	rejects(
		"Linha um\nLinha dois\nLinha três\nLinha quatro",
		"too_many_sentences"
	);
	passes("Linha um\nLinha dois\nLinha três");
});
