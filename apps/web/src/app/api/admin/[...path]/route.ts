import { NextRequest } from "next/server";

const allowedPaths = [/^leads$/, /^conversations$/, /^conversations\/[0-9a-f-]+\/messages$/, /^appointments$/];

export async function GET(request: NextRequest, context: RouteContext<"/api/admin/[...path]">) {
  const { path } = await context.params; const targetPath = path.join("/");
  if (!allowedPaths.some((pattern) => pattern.test(targetPath))) return Response.json({ error: "Recurso não disponível no painel." }, { status: 404 });
  const apiKey = process.env.ADMIN_API_KEY;
  if (!apiKey) return Response.json({ error: "A integração administrativa não está configurada." }, { status: 503 });
  const target = new URL(`/${targetPath}`, process.env.API_BASE_URL ?? "http://localhost:3252");
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  try {
    const upstream = await fetch(target, { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store" });
    return new Response(await upstream.text(), { status: upstream.status, headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "A API da Mariana está indisponível." }, { status: 502 }); }
}
