import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import { buildApp } from "../../app";
import { closeDatabase, db } from "../../db/connections";
import { appointments, consultants, leads } from "../../db/schema";
import { env } from "../../env";

const ADMIN = { authorization: `Bearer ${env.ADMIN_API_KEY}` };

function suffix() {
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createConsultant() {
	const id = suffix();
	const [consultant] = await db
		.insert(consultants)
		.values({
			calendarId: `calendar-${id}`,
			email: `consultant-${id}@example.test`,
			name: "Consultor temporário",
		})
		.returning();
	assert.ok(consultant);
	return consultant;
}

test.after(async () => {
	await closeDatabase();
});

test("DELETE /consultants remove consultor sem histórico", async (t) => {
	const app = buildApp({ logger: false });
	const consultant = await createConsultant();
	t.after(() => app.close());

	const response = await app.inject({
		headers: ADMIN,
		method: "DELETE",
		url: `/consultants/${consultant.id}`,
	});

	assert.equal(response.statusCode, 204);
	const rows = await db
		.select({ id: consultants.id })
		.from(consultants)
		.where(eq(consultants.id, consultant.id));
	assert.equal(rows.length, 0);
});

test("DELETE /consultants preserva consultor com agendamento e responde 409", async (t) => {
	const app = buildApp({ logger: false });
	const consultant = await createConsultant();
	const id = suffix();
	const [lead] = await db
		.insert(leads)
		.values({
			name: "Lead temporário",
			phone: `55119${id.replaceAll(/\D/g, "").slice(-8).padStart(8, "0")}`,
		})
		.returning();
	assert.ok(lead);
	const [appointment] = await db
		.insert(appointments)
		.values({
			consultantId: consultant.id,
			endAt: new Date(Date.now() + 60 * 60 * 1000),
			externalEventId: `event-${id}`,
			leadId: lead.id,
			startAt: new Date(),
		})
		.returning();
	assert.ok(appointment);
	t.after(async () => {
		await app.close();
		await db.delete(appointments).where(eq(appointments.id, appointment.id));
		await db.delete(leads).where(eq(leads.id, lead.id));
		await db.delete(consultants).where(eq(consultants.id, consultant.id));
	});

	const response = await app.inject({
		headers: ADMIN,
		method: "DELETE",
		url: `/consultants/${consultant.id}`,
	});

	assert.equal(response.statusCode, 409);
	assert.deepEqual(response.json(), { error: "consultant_has_history" });
});
