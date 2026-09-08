/**
 * Typed fetch wrapper over the FastAPI contract.
 *
 * Every method name, query parameter, request body and 200 body is derived
 * from `schema.d.ts`, which `pnpm api:types` generates from the committed
 * `openapi.json`. Nothing here is hand-maintained: adding an endpoint on the
 * Python side and re-running `pnpm api:types` is enough.
 *
 * const meta = await api.get("/meta", { lang: "es" });
 * const sim = await api.post("/simulate", body, { lang: "en" });
 * const prog = await api.get("/programs/{program_id}", {
 * path: { program_id: "1234:5" },
 * });
 *
 * Base URL: the browser client talks to the **same-origin proxy** `/api`
 * (`web/app/api/[...path]/route.ts`), never to the Python origin. That is what
 * keeps the RUN/IPE first-party from the browser's point of view and keeps the
 * FastAPI port off the public internet. Server components
 * use `createApiClient({ baseUrl: upstreamBaseUrl() })` instead — see
 * `lib/meta/fetch-meta.ts` — because a relative URL has no origin in Node.
 */
import {
  ApiError,
  NETWORK_ERROR_KEY,
  NETWORK_ERROR_STATUS,
  toApiError,
} from "./errors";
import type { paths } from "./schema";

/** Same-origin proxy mount point. Never point this at the Python origin. */
export const PROXY_BASE_PATH = "/api";

/** Generic English fallbacks; the UI localizes by matching `errorKey`. */
const FALLBACK_HTTP_MESSAGE = "The service returned an unexpected response.";
const FALLBACK_NETWORK_MESSAGE = "The service could not be reached.";

// --- Types derived from the generated schema -------------------------------

type HttpMethod = "get" | "post";

/** The paths that actually declare `method` (others carry `method?: never`). */
type PathsWithMethod<M extends HttpMethod> = {
  [P in keyof paths]: paths[P] extends { [K in M]: unknown } ? P : never;
}[keyof paths];

type Operation<P extends keyof paths, M extends HttpMethod> = paths[P] extends {
  [K in M]: infer O;
}
  ? O
  : never;

type JsonResponse<O> = O extends {
  responses: { 200: { content: { "application/json": infer T } } };
}
  ? T
  : never;

type QueryParams<O> = O extends { parameters: { query?: infer Q } }
  ? NonNullable<Q>
  : never;

type PathParams<O> = O extends { parameters: { path?: infer P } }
  ? NonNullable<P>
  : never;

type JsonBody<O> = O extends {
  requestBody: { content: { "application/json": infer B } };
}
  ? B
  : never;

/** Options common to every call. */
type CommonOptions = {
  /**
   * UI locale. Sent as `?lang=` on every request — the contract's language
   * selector — and mirrored into `Accept-Language` so a
   * request that loses its query string still resolves the same language.
   * Only `message` fields change; enumerated values stay English codes.
   */
  lang?: string;
  signal?: AbortSignal;
  headers?: HeadersInit;
  /** Escape hatch for `cache` / `next` and friends. */
  fetchOptions?: Omit<RequestInit, "method" | "body" | "headers" | "signal">;
};

type QuerySlot<O> = [QueryParams<O>] extends [never]
  ? { query?: never }
  : { query?: QueryParams<O> };

type PathSlot<O> = [PathParams<O>] extends [never]
  ? { path?: never }
  : { path: PathParams<O> };

export type RequestOptions<O> = CommonOptions & QuerySlot<O> & PathSlot<O>;

/** Options stay optional unless the path has `{placeholders}` to fill. */
type OptionsArg<O> = [PathParams<O>] extends [never]
  ? [options?: RequestOptions<O>]
  : [options: RequestOptions<O>];

// --- Query / path serialization -------------------------------------------

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

/**
 * `form`/`explode` serialization, i.e. what FastAPI expects: repeated keys for
 * list parameters (`track=TP&track=HC`), `null`/`undefined` omitted entirely
 * so an absent filter never becomes the string "null".
 */
export function serializeQuery(
  query: Record<string, QueryValue> | undefined,
  extra?: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === undefined) continue;
        search.append(key, String(item));
      }
      continue;
    }
    search.append(key, String(value as string | number | boolean));
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === undefined || search.has(key)) continue;
    search.append(key, value);
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

/** Fill `{program_id}` style placeholders, percent-encoding each value. */
export function fillPath(
  template: string,
  params: Record<string, string | number> | undefined,
): string {
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing path parameter "${name}" for ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}

// --- Client ----------------------------------------------------------------

export type ApiClientOptions = {
  /** Defaults to {@link PROXY_BASE_PATH}. */
  baseUrl?: string;
  /** Locale applied when a call does not pass its own `lang`. */
  lang?: string;
  /** Injectable for tests and for server-side callers with a custom fetch. */
  fetch?: typeof fetch;
};

export type ApiClient = {
  readonly baseUrl: string;
  get<P extends PathsWithMethod<"get">>(
    path: P,
    ...args: OptionsArg<Operation<P, "get">>
  ): Promise<JsonResponse<Operation<P, "get">>>;
  post<P extends PathsWithMethod<"post">>(
    path: P,
    body: JsonBody<Operation<P, "post">>,
    ...args: OptionsArg<Operation<P, "post">>
  ): Promise<JsonResponse<Operation<P, "post">>>;
  /** A copy of this client with a different default locale. */
  withLang(lang: string): ApiClient;
};

type InternalOptions = CommonOptions & {
  query?: Record<string, QueryValue>;
  path?: Record<string, string | number>;
};

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = (options.baseUrl ?? PROXY_BASE_PATH).replace(/\/+$/, "");
  const defaultLang = options.lang;
  const doFetch = options.fetch ?? globalThis.fetch;

  async function request(
    method: "GET" | "POST",
    template: string,
    body: unknown,
    opts: InternalOptions,
  ): Promise<unknown> {
    if (baseUrl.startsWith("/") && typeof window === "undefined") {
      // A relative base URL only resolves against a document. On the server
      // build a client with an absolute `baseUrl` (see upstreamBaseUrl()).
      throw new Error(
        `The "${baseUrl}" API client is browser-only; server code must pass an absolute baseUrl.`,
      );
    }
    const lang = opts.lang ?? defaultLang;
    const url =
      baseUrl +
      fillPath(template, opts.path) +
      serializeQuery(opts.query, { lang });

    const headers = new Headers(opts.headers);
    headers.set("accept", "application/json");
    if (lang && !headers.has("accept-language")) {
      headers.set("accept-language", lang);
    }
    if (body !== undefined) headers.set("content-type", "application/json");

    let response: Response;
    try {
      response = await doFetch(url, {
        ...opts.fetchOptions,
        method,
        headers,
        signal: opts.signal,
        // The request body holds the RUN/IPE: it is serialized straight into
        // the request and never logged, stored, or echoed into an error.
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      // An abort is the caller's own doing (a superseded search, an unmounted
      // component); it is re-thrown untouched so it can be ignored. Matched by
      // name, not by `instanceof DOMException`: the class differs between
      // Node, undici and jsdom realms.
      if (isAbortError(cause)) throw cause;
      throw new ApiError(
        NETWORK_ERROR_STATUS,
        NETWORK_ERROR_KEY,
        FALLBACK_NETWORK_MESSAGE,
      );
    }

    let payload: unknown;
    try {
      payload = await readJson(response);
    } catch (cause) {
      // The connection dropped after the headers arrived.
      if (isAbortError(cause)) throw cause;
      throw new ApiError(
        NETWORK_ERROR_STATUS,
        NETWORK_ERROR_KEY,
        FALLBACK_NETWORK_MESSAGE,
      );
    }
    if (!response.ok) {
      throw toApiError(response.status, payload, FALLBACK_HTTP_MESSAGE);
    }
    return payload;
  }

  const client: ApiClient = {
    baseUrl,
    get(path, ...args) {
      return request(
        "GET",
        path as string,
        undefined,
        (args[0] ?? {}) as InternalOptions,
      ) as never;
    },
    post(path, body, ...args) {
      return request(
        "POST",
        path as string,
        body,
        (args[0] ?? {}) as InternalOptions,
      ) as never;
    },
    withLang(lang) {
      return createApiClient({ ...options, baseUrl, lang });
    },
  };
  return client;
}

function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A non-JSON body (an HTML error page from a misconfigured origin) is not
    // surfaced verbatim: it could be arbitrarily large and is never useful.
    return null;
  }
}

/**
 * The browser client: same-origin `/api` proxy, default locale unset (the
 * server then falls back to `es`). Wrap with `api.withLang(locale)` — or pass
 * `{ lang }` per call — inside the `[locale]` tree.
 */
export const api: ApiClient = createApiClient();
