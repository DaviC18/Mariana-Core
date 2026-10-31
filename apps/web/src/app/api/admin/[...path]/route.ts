import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "mariana_admin_session";
const SESSION_IDLE_SECONDS = 5 * 60;
const readOnlyPaths = [
  /^leads$/,
  /^conversations$/,
  /^conversations\/[0-9a-f-]+\/messages$/,
  /^appointments$/,
  /^settings$/,
  /^consultants$/,
];
const consultantPath = /^consultants(?:\/[0-9a-f-]+)?$/;
const googleCalendarConnectPath = "google-calendar/connect-link";
const settingsPath = /^settings(?:\/[a-zA-Z_-]+)?$/;

function upstream(path: string) { return new URL(`/${path}`, process.env.API_BASE_URL ?? "http://localhost:3252"); }

async function login(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const response = await fetch(upstream("admin/auth/totp"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (!response.ok) return NextResponse.json(await response.json().catch(() => ({ error: "Não foi possível validar o código." })), { status: response.status });
  const { session } = await response.json() as { session: string };
  const result = NextResponse.json({ ok: true });
  result.cookies.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_IDLE_SECONDS });
  return result;
}

function clearSession() {
  const result = NextResponse.json({ ok: true });
  result.cookies.delete(SESSION_COOKIE);
  return result;
}

function refreshSession(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) return NextResponse.json({ error: "Autenticação administrativa necessária." }, { status: 401 });
  const result = NextResponse.json({ ok: true });
  result.cookies.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_IDLE_SECONDS });
  return result;
}

async function forward(request: NextRequest, context: RouteContext<"/api/admin/[...path]">) {
  const { path } = await context.params;
  const targetPath = path.join("/");
  if (targetPath === "auth" && request.method === "POST") return login(request);
  if (targetPath === "auth" && request.method === "DELETE") return clearSession();
  if (targetPath === "auth" && request.method === "GET") {
    const session = request.cookies.get(SESSION_COOKIE)?.value;
    return NextResponse.json({ authenticated: Boolean(session) });
  }
  if (targetPath === "activity" && request.method === "POST") return refreshSession(request);

  const isConsultantRequest = consultantPath.test(targetPath);
  const isConsultantMutation = isConsultantRequest && request.method !== "GET";
  const isGoogleCalendarConnect = targetPath === googleCalendarConnectPath;
  const isSettingsRequest = settingsPath.test(targetPath);
  const isSettingsMutation = isSettingsRequest && request.method === "PATCH";

  if (!isConsultantRequest && !isGoogleCalendarConnect && !isSettingsRequest && !readOnlyPaths.some((pattern) => pattern.test(targetPath))) {
    return NextResponse.json({ error: "Recurso não disponível no painel." }, { status: 404 });
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if ((isConsultantMutation || isGoogleCalendarConnect || isSettingsMutation) && !session) {
    return NextResponse.json({ error: "Autenticação administrativa necessária." }, { status: 401 });
  }

  const headers: HeadersInit = session ? { "X-Admin-Session": session } : {};

  if (isConsultantRequest && request.method === "DELETE") {
    const totpCode = request.headers.get("x-admin-totp");
    if (!totpCode) return NextResponse.json({ error: "Código do autenticador obrigatório." }, { status: 400 });
    const verifyResponse = await fetch(upstream("admin/auth/totp"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: totpCode }),
      cache: "no-store",
    });
    if (!verifyResponse.ok) {
      const errorBody = await verifyResponse.json().catch(() => null);
      return NextResponse.json(
        { error: errorBody?.error === "invalid_totp" ? "Código do autenticador inválido." : "Não foi possível validar o código." },
        { status: 401 }
      );
    }
    const { session: refreshedSession } = await verifyResponse.json() as { session: string };
    headers["X-Admin-Session"] = refreshedSession;
  }

  const target = upstream(isGoogleCalendarConnect ? "admin/google-calendar/connect-link" : targetPath);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  if (!isConsultantMutation && !isGoogleCalendarConnect && !isSettingsMutation) {
    const apiKey = process.env.ADMIN_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "A integração administrativa não está configurada." }, { status: 503 });
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const hasBody = request.method === "POST" || request.method === "PATCH";
  if (hasBody) headers["Content-Type"] = request.headers.get("content-type") ?? "application/json";
  try {
    const response = await fetch(target, { method: request.method, headers, body: hasBody ? await request.text() : undefined, cache: "no-store" });
    if (response.status === 204) {
      const result = new NextResponse(null, { status: 204 });
      const activeSession = (headers["X-Admin-Session"] as string) || session;
      if (activeSession) {
        result.cookies.set(SESSION_COOKIE, activeSession, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_IDLE_SECONDS });
      }
      return result;
    }
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "A API da Mariana está indisponível." }, { status: 502 }); }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
