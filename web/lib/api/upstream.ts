/**
 * Server-side plumbing for `web/app/api/[...path]/route.ts`: the browser calls
 * same-origin `/api/...` and this module forwards it to `API_BASE_URL`, so
 * there is no CORS, the RUN/IPE stays first-party, and the Python port need
 * not be published.
 *
 * PRIVACY — do not add logging here. Request bodies carry the RUN/IPE
 * (`/simulate`, `/recommend`) and the home address (`/geocode`); they are
 * forwarded as an opaque string and never reach a log, an error message, or an
 * analytics sink.
 *
 * Headers are rebuilt, not relayed: only `FORWARDED_REQUEST_HEADERS` cross over
 * (no cookies, no authorization), plus one `X-Forwarded-For` this hop derives
 * itself — see `clientAddress` and the `TRUST_PROXY` flag.
 *
 * Not the locale middleware — that is `web/proxy.ts` and does not match
 * `/api/*`.
 */
import { NETWORK_ERROR_KEY } from "./errors";

/** Used when `API_BASE_URL` is unset — the dev default. */
export const DEFAULT_UPSTREAM_BASE_URL = "http://localhost:8000";

/**
 * Ceiling on one upstream call — generous, because an equivalence-class
 * simulation can enumerate many orders server-side. It only exists so a wedged
 * upstream cannot pin a Node worker forever.
 */
export const UPSTREAM_TIMEOUT_MS = 120_000;

/** Request headers forwarded browser → FastAPI. Everything else is dropped. */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  // The contract's second language selector, after `?lang=`.
  "accept-language",
  "content-type",
] as const;

/**
 * Client address for a request whose origin cannot be established (dev, a
 * platform that omits `X-Forwarded-For`, or `TRUST_PROXY` off). Every such
 * caller shares one rate-limit bucket upstream.
 */
export const UNKNOWN_CLIENT_ADDRESS = "unknown";

/**
 * Whether a hop in front of this process is trusted to set `X-Forwarded-For`.
 * Opt-in (`TRUST_PROXY=1`): with Next.js exposed directly, the header is pure
 * client input, and honouring it would let one caller mint a fresh rate-limit
 * bucket per request. Off, everyone shares the `unknown` bucket — the safe
 * failure.
 */
export function trustsForwardedFor(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.TRUST_PROXY?.trim() === "1";
}

/** Response headers forwarded FastAPI → browser. */
const FORWARDED_RESPONSE_HEADERS = ["content-type", "retry-after"] as const;

export function upstreamBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.API_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_UPSTREAM_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

/**
 * Join the catch-all segments and the incoming query string onto the upstream
 * base URL.
 *
 * Next.js hands the segments percent-decoded, so each one is re-encoded: a
 * `program_id` is `"<rbd>:<program_code>"` and the colon must survive. Empty
 * and dot segments are rejected so a crafted path cannot climb out of the
 * upstream origin (`/api/..%2f..%2fadmin`).
 */
export function buildUpstreamUrl(
  segments: readonly string[],
  search = "",
  baseUrl: string = upstreamBaseUrl(),
): string {
  if (segments.length === 0) {
    throw new Error("Missing upstream path");
  }
  const encoded = segments.map((segment) => {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`Invalid upstream path segment: "${segment}"`);
    }
    return encodeURIComponent(segment);
  });
  const query = search.startsWith("?") ? search : search ? `?${search}` : "";
  return `${baseUrl.replace(/\/+$/, "")}/${encoded.join("/")}${query}`;
}

/**
 * The browser's address as the hop in front of Next.js saw it — the *rightmost*
 * `X-Forwarded-For` entry (Next 16 gives a route handler no socket address of
 * its own). Entries to its left are unverified client claims. Without
 * `TRUST_PROXY=1` the whole header is client input and is ignored.
 */
export function clientAddress(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): string {
  if (!trustsForwardedFor(env)) return UNKNOWN_CLIENT_ADDRESS;
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return UNKNOWN_CLIENT_ADDRESS;
  const entries = forwarded
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.at(-1) ?? UNKNOWN_CLIENT_ADDRESS;
}

function forwardedRequestHeaders(
  request: Request,
  env: Record<string, string | undefined>,
): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("accept")) headers.set("accept", "application/json");
  // FastAPI buckets /geocode's per-IP budget by the rightmost X-Forwarded-For
  // entry. The header is *set* to the one value this hop can honestly assert
  // (see `clientAddress`), not relayed — and it is always an address, never a
  // request-body field.
  headers.set("x-forwarded-for", clientAddress(request, env));
  return headers;
}

function forwardedResponseHeaders(response: Response): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  // Nothing the API returns is cacheable by a shared cache: responses depend
  // on the RUN/IPE in the request body.
  headers.set("cache-control", "no-store");
  return headers;
}

function errorEnvelopeResponse(
  status: number,
  errorKey: string,
  message: string,
): Response {
  // Shaped like the contract's envelope so the browser client's ApiError
  // parsing covers proxy failures too, without a second code path.
  return Response.json(
    { error_key: errorKey, message, params: {} },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Forward one GET/POST request to FastAPI and stream the answer back.
 *
 * The upstream body is handed to the `Response` unread, so a large
 * `/programs` page is streamed rather than buffered.
 */
export async function proxyRequest(
  request: Request,
  segments: readonly string[],
  options: {
    baseUrl?: string;
    fetch?: typeof fetch;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<Response> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const env = options.env ?? process.env;

  let url: string;
  try {
    url = buildUpstreamUrl(
      segments,
      new URL(request.url).search,
      options.baseUrl ?? upstreamBaseUrl(env),
    );
  } catch {
    // The message deliberately omits the path: it is attacker-controlled.
    return errorEnvelopeResponse(404, "not_found", "Unknown API path.");
  }

  const method = request.method.toUpperCase();
  const body = method === "GET" ? undefined : await request.text();

  let upstream: Response;
  try {
    upstream = await doFetch(url, {
      method,
      headers: forwardedRequestHeaders(request, env),
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Never include the caught error: an undici cause can quote the request
    // body, which is exactly what must not escape.
    return errorEnvelopeResponse(
      502,
      NETWORK_ERROR_KEY,
      "The estimation service is unavailable. Try again in a moment.",
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: forwardedResponseHeaders(upstream),
  });
}
