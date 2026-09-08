/**
 * Same-origin proxy to the FastAPI service.
 *
 * `/api/<anything>` → `${API_BASE_URL ?? "http://localhost:8000"}/<anything>`,
 * query string included, status and JSON body streamed straight back. All the
 * logic lives in `lib/api/upstream.ts` so it is unit-testable; this file is only
 * the Next.js binding.
 *
 * PRIVACY: request bodies (RUN/IPE, home address) are never logged here or in
 * `upstream.ts`.
 *
 * Deployment: set `TRUST_PROXY=1` only when a reverse proxy you control always
 * rewrites `X-Forwarded-For`; see `clientAddress` in `upstream.ts` and
 * `.env.example`.
 */
import { proxyRequest } from "@/lib/api/upstream";

// The handler needs Node's fetch and `process.env.API_BASE_URL`; the Edge
// runtime is deprecated in Next 16 anyway.
export const runtime = "nodejs";
// Every call depends on the incoming request (query string, body, headers) and
// on data that lives in another process: nothing here may ever be prerendered
// or cached.
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path);
}
