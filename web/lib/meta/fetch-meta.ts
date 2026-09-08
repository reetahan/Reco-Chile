/**
 * Server-side loader for `GET /meta` — the single source of every threshold,
 * limit and filter option list. The `(wizard)` layout calls this once per
 * render and passes the result to `<MetaProvider>`.
 *
 * Runs on the server, so it hits the FastAPI origin directly; the `/api` proxy
 * exists to keep that origin away from the browser. Browser code uses `api`
 * from `@/lib/api`.
 */
import { createApiClient } from "@/lib/api/client";
import { upstreamBaseUrl } from "@/lib/api/upstream";
import type { Meta } from "@/lib/api/types";

/** Fetch `/meta` for one locale (only `message`-like copy depends on `lang`). */
export async function fetchMeta(lang?: string): Promise<Meta> {
  const client = createApiClient({ baseUrl: upstreamBaseUrl(), lang });
  // `no-store`: a redeployed API must not serve stale limits through a
  // long-lived Next.js cache entry.
  return client.get("/meta", { fetchOptions: { cache: "no-store" } });
}
