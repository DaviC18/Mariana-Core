import { eq } from "drizzle-orm";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { db } from "../../db/connections";
import { systemSettings } from "../../db/schema";
import {
	DEFAULT_SETTINGS,
	type SystemSettingsPayload,
} from "../../services/settings/default-settings";

const companySchema = z.object({
	description: z.string().trim().min(1),
	name: z.string().trim().min(1),
	phone: z.string().trim().min(1),
});

const productSchema = z.array(
	z.object({
		desc: z.string().trim().min(1),
		id: z.string(),
		title: z.string().trim().min(1),
	})
);

const faqSchema = z.array(
	z.object({
		a: z.string().trim().min(1),
		id: z.string(),
		q: z.string().trim().min(1),
	})
);

const agentSchema = z.object({
	instructions: z.string().trim().min(1),
	maxWaitMinutes: z.number().int().min(1).max(120),
	tone: z.string().trim().min(1),
});

const keySchemas = {
	agent: agentSchema,
	company: companySchema,
	faq: faqSchema,
	products: productSchema,
} as const;

export const systemSettingsRoutes: FastifyPluginCallbackZod = (
	app,
	_options,
	done
) => {
	app.get("/settings", async () => {
		const rows = await db.select().from(systemSettings);
		const settings: SystemSettingsPayload = { ...DEFAULT_SETTINGS };

		for (const row of rows) {
			if (row.key in settings) {
				const key = row.key as keyof SystemSettingsPayload;
				// biome-ignore lint/suspicious/noExplicitAny: JSON parsed from DB
				settings[key] = row.value as any;
			}
		}

		return { settings };
	});

	app.patch(
		"/settings/:key",
		{
			schema: {
				params: z.object({
					key: z.enum(["company", "products", "faq", "agent"]),
				}),
			},
		},
		async (request, reply) => {
			const { key } = request.params;
			const schema = keySchemas[key];
			const parsed = schema.safeParse(request.body);

			if (!parsed.success) {
				return reply.code(400).send({
					error: "invalid_payload",
					issues: parsed.error.issues,
				});
			}

			await db
				.insert(systemSettings)
				.values({
					key,
					updatedAt: new Date(),
					value: parsed.data,
				})
				.onConflictDoUpdate({
					set: {
						updatedAt: new Date(),
						value: parsed.data,
					},
					target: systemSettings.key,
				});

			return reply.send({ key, ok: true, value: parsed.data });
		}
	);

	done();
};
