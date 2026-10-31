import { eq } from "drizzle-orm";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import z from "zod";

import { db } from "../../db/connections";
import { consultants } from "../../db/schema";
import { env } from "../../env";
import { createGoogleConnectTicket } from "./auth-google";

/**
 * Rota de admin: gera o link de "Conectar Google Calendar" de um consultor.
 * O link carrega um ticket assinado de uso único e 10 min, nunca a chave de
 * admin. A origem é a de `GOOGLE_REDIRECT_URI` (o callback mora neste mesmo
 * servidor).
 */
export const googleCalendarConnectLink: FastifyPluginCallbackZod = (
	app,
	_options,
	done
) => {
	app.post(
		"/admin/google-calendar/connect-link",
		{
			schema: {
				body: z.object({ consultantId: z.string().uuid() }),
			},
		},
		async (request, reply) => {
			const [consultant] = await db
				.select({ id: consultants.id })
				.from(consultants)
				.where(eq(consultants.id, request.body.consultantId))
				.limit(1);

			if (!consultant) {
				return reply.status(404).send({ error: "consultant_not_found" });
			}

			const { payload, token } = createGoogleConnectTicket(consultant.id);
			const url = new URL("/auth/google", env.GOOGLE_REDIRECT_URI);
			url.searchParams.set("ticket", token);

			return reply.send({
				expiresAt: new Date(payload.exp).toISOString(),
				url: url.toString(),
			});
		}
	);
	done();
};
