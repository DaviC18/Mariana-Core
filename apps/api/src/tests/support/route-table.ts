/**
 * Tabela de rotas esperada de `buildApp()`, compartilhada pelos testes de
 * inventário e de auth. Uma rota nova precisa entrar aqui (inventário) e,
 * se for pública, também em `PUBLIC_ROUTES` (teste de auth).
 */
export const PUBLIC_ROUTES = [
	"GET /",
	"GET /webhooks/whatsapp",
	"POST /webhooks/whatsapp",
	"GET /webhooks/meta-ads",
	"POST /webhooks/meta-ads",
	"POST /webhooks/google-ads",
	"GET /auth/google",
	"GET /auth/google/callback",
	"POST /admin/auth/totp",
].sort();

export const ADMIN_ROUTES = [
	"GET /leads",
	"GET /leads/:id",
	"POST /leads",
	"GET /conversations",
	"GET /conversations/:id",
	"POST /conversations",
	"GET /messages",
	"GET /messages/:id",
	"GET /conversations/:conversationId/messages",
	"GET /appointments",
	"GET /appointments/:id",
	"GET /appointments/availability",
	"POST /appointments",
	"POST /admin/google-calendar/connect-link",
	"GET /consultants",
	"POST /consultants",
	"PATCH /consultants/:id",
].sort();

export const EXPECTED_ROUTES = [...PUBLIC_ROUTES, ...ADMIN_ROUTES].sort();

const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";

/** "GET /leads/:id" → { method: "GET", url: "/leads/<uuid>" } */
export function toRequest(route: string) {
	const [method, pattern] = route.split(" ") as [string, string];
	return {
		method: method as "GET" | "POST" | "PATCH",
		url: pattern.replace(/:[A-Za-z]+/g, SAMPLE_ID),
	};
}
