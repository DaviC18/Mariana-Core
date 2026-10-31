import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { env } from "../../env";
import { createAdminSession, verifyTotp } from "../../lib/security/admin-totp";
import type { AuthFailureLimiter } from "../../lib/security/auth-failure-limiter";

export const adminTotpAuth =
	(limiter: AuthFailureLimiter): FastifyPluginCallbackZod =>
	(app, _options, done) => {
		app.post(
			"/admin/auth/totp",
			{ schema: { body: z.object({ code: z.string() }) } },
			(request, reply) => {
				const limit = limiter.check(request.ip);
				if (limit.limited) {
					return reply
						.code(429)
						.header("Retry-After", String(limit.retryAfterSeconds))
						.send({ error: "too_many_requests" });
				}
				if (!verifyTotp(env.ADMIN_TOTP_SECRET, request.body.code)) {
					limiter.recordFailure(request.ip);
					return reply.code(401).send({ error: "invalid_totp" });
				}
				limiter.reset(request.ip);
				return reply.send({
					session: createAdminSession(env.APP_SIGNING_SECRET),
				});
			}
		);
		done();
	};
