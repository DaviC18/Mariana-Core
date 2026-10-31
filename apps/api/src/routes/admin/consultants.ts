import { asc, eq } from "drizzle-orm";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { db } from "../../db/connections";
import { consultants } from "../../db/schema";

const consultantInput = z.object({
	active: z.boolean().optional(),
	calendarId: z.string().trim().min(1).max(255),
	email: z.string().trim().email(),
	name: z.string().trim().min(2).max(120),
});

export const adminConsultants: FastifyPluginCallbackZod = (
	app,
	_options,
	done
) => {
	app.get("/consultants", async () => ({
		consultants: await db
			.select()
			.from(consultants)
			.orderBy(asc(consultants.name)),
	}));
	app.post(
		"/consultants",
		{ schema: { body: consultantInput } },
		async (request, reply) => {
			try {
				const [consultant] = await db
					.insert(consultants)
					.values({ ...request.body, active: request.body.active ?? true })
					.returning();
				return reply.code(201).send({ consultant });
			} catch (error) {
				if ((error as { code?: string }).code === "23505") {
					return reply.code(409).send({ error: "consultant_already_exists" });
				}
				throw error;
			}
		}
	);
	app.patch(
		"/consultants/:id",
		{
			schema: {
				body: consultantInput
					.partial()
					.refine((value) => Object.keys(value).length > 0),
				params: z.object({ id: z.uuid() }),
			},
		},
		async (request, reply) => {
			try {
				const [consultant] = await db
					.update(consultants)
					.set({ ...request.body, updatedAt: new Date() })
					.where(eq(consultants.id, request.params.id))
					.returning();
				return consultant
					? { consultant }
					: reply.code(404).send({ error: "consultant_not_found" });
			} catch (error) {
				if ((error as { code?: string }).code === "23505") {
					return reply.code(409).send({ error: "consultant_already_exists" });
				}
				throw error;
			}
		}
	);
	done();
};
