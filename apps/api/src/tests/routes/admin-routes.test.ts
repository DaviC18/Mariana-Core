/**
 * Rotas de admin reais (com banco): a chave válida chega ao handler; sem
 * chave, nada é lido nem gravado.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import { buildApp } from "../../app";
import { closeDatabase, db } from "../../db/connections";
import { conversations } from "../../db/schema/conversations";
import { leads } from "../../db/schema/leads";
import { env } from "../../env";

test.after(async () => {
	await closeDatabase();
});

function uniquePhone() {
	return `55119${Math.floor(10_000_000 + Math.random() * 90_000_000)}`;
}

async function createLead() {
	const [lead] = await db
		.insert(leads)
		.values({ name: "Lead admin-routes", phone: uniquePhone() })
		.returning();
	assert.ok(lead);
	return lead;
}

const ADMIN = { authorization: `Bearer ${env.ADMIN_API_KEY}` };

test("valid key → GET /leads 200 and POST /conversations 201", async (t) => {
	const app = buildApp({ logger: false });
	const lead = await createLead();
	t.after(async () => {
		await app.close();
		await db.delete(leads).where(eq(leads.id, lead.id));
	});

	const list = await app.inject({
		headers: ADMIN,
		method: "GET",
		url: "/leads",
	});
	assert.equal(list.statusCode, 200);
	const listed = list.json() as { leads: { id: string }[] };
	assert.ok(listed.leads.some((row) => row.id === lead.id));

	const created = await app.inject({
		headers: ADMIN,
		method: "POST",
		payload: { leadId: lead.id },
		url: "/conversations",
	});
	assert.equal(created.statusCode, 201);

	// Invariante 1: a segunda chamada devolve a mesma conversa ativa.
	const again = await app.inject({
		headers: ADMIN,
		method: "POST",
		payload: { leadId: lead.id },
		url: "/conversations",
	});
	assert.equal(again.statusCode, 200);
	const rows = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.leadId, lead.id));
	assert.equal(rows.length, 1);
});

test("no key → 401 on POST /conversations and POST /leads, no row written", async (t) => {
	const app = buildApp({ logger: false });
	const lead = await createLead();
	const phone = uniquePhone();
	t.after(async () => {
		await app.close();
		await db.delete(leads).where(eq(leads.id, lead.id));
		await db.delete(leads).where(eq(leads.phone, phone));
	});

	const conversation = await app.inject({
		method: "POST",
		payload: { leadId: lead.id },
		url: "/conversations",
	});
	assert.equal(conversation.statusCode, 401);

	const newLead = await app.inject({
		method: "POST",
		payload: { name: "Sem chave", phone },
		url: "/leads",
	});
	assert.equal(newLead.statusCode, 401);

	const conversationRows = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.leadId, lead.id));
	assert.equal(conversationRows.length, 0);
	const leadRows = await db
		.select({ id: leads.id })
		.from(leads)
		.where(eq(leads.phone, phone));
	assert.equal(leadRows.length, 0);
});
