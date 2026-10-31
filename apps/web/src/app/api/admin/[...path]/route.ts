import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "mariana_admin_session";
const readOnlyPaths = [/^leads$/, /^conversations$/, /^conversations\/[0-9a-f-]+\/messages$/, /^appointments$/];
const consultantPath = /^consultants(?:\/[0-9a-f-]+)?$/;

function upstream(path: string) { return new URL(`/${path}`, process.env.API_BASE_URL ?? "http://localhost:3252"); }

async function login(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const response = await fetch(upstream("admin/auth/totp"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (!response.ok) return NextResponse.json(await response.json().catch(() => ({ error: "Não foi possível validar o código." })), { status: response.status });
  const { session } = await response.json() as { session: string };
  const result = NextResponse.json({ ok: true });
  result.cookies.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 60 * 60 });
  return result;
}

async function forward(request: NextRequest, context: RouteContext<"/api/admin/[...path]">) {
  const { path } = await context.params;
  const targetPath = path.join("/");
  if (targetPath === "auth" && request.method === "POST") return login(request);
  const isConsultantRequest = consultantPath.test(targetPath);
  if (!isConsultantRequest && !readOnlyPaths.some((pattern) => pattern.test(targetPath))) return NextResponse.json({ error: "Recurso não disponível no painel." }, { status: 404 });
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (isConsultantRequest && !session) return NextResponse.json({ error: "Autenticação administrativa necessária." }, { status: 401 });
  const target = upstream(targetPath);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  const headers: HeadersInit = session ? { "X-Admin-Session": session } : {};
  if (!isConsultantRequest) {
    const apiKey = process.env.ADMIN_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "A integração administrativa não está configurada." }, { status: 503 });
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (request.method !== "GET") headers["Content-Type"] = request.headers.get("content-type") ?? "application/json";
  try {
    const response = await fetch(target, { method: request.method, headers, body: request.method === "GET" ? undefined : await request.text(), cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "A API da Mariana está indisponível." }, { status: 502 }); }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
