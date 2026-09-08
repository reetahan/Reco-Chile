import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  createApiClient,
  fillPath,
  PROXY_BASE_PATH,
  serializeQuery,
} from "./client";
import { ApiError, NETWORK_ERROR_KEY, UNEXPECTED_ERROR_KEY } from "./errors";
import type { WishItem } from "./types";

type Call = { url: string; init: RequestInit };

/** A wish with every priority flag off — the store's default shape. */
function wish(programId: string): WishItem {
  return {
    program_id: programId,
    priority_sibling: false,
    priority_student: false,
    priority_parent_civil_servant: false,
    priority_ex_student: false,
    priority_already_registered: false,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(...responses: (Response | Error | DOMException)[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const doFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      // `instanceof Response` rather than `instanceof Error`: jsdom's
      // DOMException does not extend Error.
      if (next instanceof Response) return next.clone();
      throw next;
    },
  ) as unknown as typeof fetch;
  return { calls, doFetch };
}

function headerOf(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

describe("serializeQuery", () => {
  it("returns an empty string when there is nothing to send", () => {
    expect(serializeQuery(undefined)).toBe("");
    expect(serializeQuery({ region: undefined, q: null })).toBe("");
  });

  it("repeats list parameters instead of joining them", () => {
    // FastAPI reads repeatable filters as `track=TP&track=HC`.
    expect(serializeQuery({ track: ["TP", "HC"] })).toBe("?track=TP&track=HC");
  });

  it("omits null and undefined but keeps 0 and false", () => {
    expect(serializeQuery({ offset: 0, q: null, limit: undefined })).toBe(
      "?offset=0",
    );
  });

  it("percent-encodes values", () => {
    expect(serializeQuery({ q: "Liceo Bicentenario & Co" })).toBe(
      "?q=Liceo+Bicentenario+%26+Co",
    );
  });

  it("appends extras without overwriting an explicit value", () => {
    expect(serializeQuery({ lang: "en" }, { lang: "es" })).toBe("?lang=en");
    expect(serializeQuery({ q: "x" }, { lang: "es" })).toBe("?q=x&lang=es");
  });
});

describe("fillPath", () => {
  it("encodes the program id, colon included", () => {
    expect(fillPath("/programs/{program_id}", { program_id: "1234:5" })).toBe(
      "/programs/1234%3A5",
    );
  });

  it("leaves a path without placeholders alone", () => {
    expect(fillPath("/meta", undefined)).toBe("/meta");
  });

  it("refuses to build a URL with a missing parameter", () => {
    expect(() => fillPath("/programs/{program_id}", {})).toThrow(
      /Missing path parameter/,
    );
  });
});

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to the same-origin proxy, never the Python origin", () => {
    expect(api.baseUrl).toBe(PROXY_BASE_PATH);
    expect(api.baseUrl).toBe("/api");
  });

  it("GETs through the proxy and returns the parsed body", async () => {
    const { calls, doFetch } = stubFetch(
      jsonResponse({ api_version: "1.0.0", max_wishes: 30 }),
    );
    const client = createApiClient({ fetch: doFetch });

    const meta = await client.get("/meta");

    expect(calls[0].url).toBe("/api/meta");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
    expect(headerOf(calls[0], "accept")).toBe("application/json");
    expect(meta.api_version).toBe("1.0.0");
  });

  it("passes the locale as ?lang= and as Accept-Language", async () => {
    const { calls, doFetch } = stubFetch(jsonResponse({}));
    const client = createApiClient({ fetch: doFetch });

    await client.get("/meta", { lang: "en" });

    expect(calls[0].url).toBe("/api/meta?lang=en");
    expect(headerOf(calls[0], "accept-language")).toBe("en");
  });

  it("takes a default locale from the client and lets a call override it", async () => {
    const { calls, doFetch } = stubFetch(jsonResponse({}));
    const spanish = createApiClient({ fetch: doFetch, lang: "es" });

    await spanish.get("/meta");
    await spanish.withLang("en").get("/meta");
    await spanish.get("/meta", { lang: "en" });

    expect(calls.map((call) => call.url)).toEqual([
      "/api/meta?lang=es",
      "/api/meta?lang=en",
      "/api/meta?lang=en",
    ]);
  });

  it("serializes filters and interpolates path parameters", async () => {
    const { calls, doFetch } = stubFetch(jsonResponse({ items: [], total: 0 }));
    const client = createApiClient({ fetch: doFetch, lang: "es" });

    await client.get("/programs", {
      query: { region: "Región Metropolitana", track: ["TP", "HC"], limit: 20 },
    });
    await client.get("/programs/{program_id}", {
      path: { program_id: "1234:5" },
    });

    expect(calls[0].url).toBe(
      "/api/programs?region=Regi%C3%B3n+Metropolitana&track=TP&track=HC&limit=20&lang=es",
    );
    expect(calls[1].url).toBe("/api/programs/1234%3A5?lang=es");
  });

  it("POSTs a JSON body", async () => {
    const { calls, doFetch } = stubFetch(
      jsonResponse({ unmatched_risk: 0.12 }),
    );
    const client = createApiClient({ fetch: doFetch });

    await client.post("/simulate", {
      student_id: "11111111-1",
      wishes: [wish("1234:5")],
    });

    expect(calls[0].init.method).toBe("POST");
    expect(headerOf(calls[0], "content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      student_id: "11111111-1",
      wishes: [wish("1234:5")],
    });
  });

  it("turns a 422 envelope into an ApiError", async () => {
    const { doFetch } = stubFetch(
      jsonResponse(
        {
          error_key: "too_many_equivalence_orders",
          message: "Demasiadas combinaciones.",
          params: { limit: 10000 },
        },
        422,
      ),
    );
    const client = createApiClient({ fetch: doFetch });

    const error = await client
      .post("/simulate", { student_id: "x", wishes: [] })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(ApiError.is(error)).toBe(true);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.errorKey).toBe("too_many_equivalence_orders");
    expect(apiError.message).toBe("Demasiadas combinaciones.");
    expect(apiError.params).toEqual({ limit: 10000 });
  });

  it("falls back when an error body is not JSON", async () => {
    const { doFetch } = stubFetch(
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );
    const client = createApiClient({ fetch: doFetch });

    const error = (await client
      .get("/meta")
      .catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(502);
    expect(error.errorKey).toBe(UNEXPECTED_ERROR_KEY);
    // The HTML body is not echoed into the message.
    expect(error.message).not.toContain("<html>");
  });

  it("reports a transport failure as an ApiError without leaking the request", async () => {
    const { doFetch } = stubFetch(new TypeError("fetch failed: 11111111-1"));
    const client = createApiClient({ fetch: doFetch });

    const error = (await client
      .post("/simulate", { student_id: "11111111-1", wishes: [] })
      .catch((e: unknown) => e)) as ApiError;

    expect(ApiError.is(error)).toBe(true);
    expect(error.status).toBe(0);
    expect(error.errorKey).toBe(NETWORK_ERROR_KEY);
    // The RUN/IPE must never resurface through an error message.
    expect(error.message).not.toContain("11111111-1");
  });

  it("lets an abort propagate untouched so callers can ignore it", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const { doFetch } = stubFetch(abort);
    const client = createApiClient({ fetch: doFetch });

    await expect(client.get("/meta")).rejects.toBe(abort);
  });

  it("refuses a relative base URL outside the browser", async () => {
    const { doFetch } = stubFetch(jsonResponse({}));
    const client = createApiClient({ fetch: doFetch });
    const originalWindow = globalThis.window;
    // Simulate a server component importing the browser client by mistake.
    Reflect.deleteProperty(globalThis, "window");
    try {
      await expect(client.get("/meta")).rejects.toThrow(/browser-only/);
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    }
  });

  it("accepts an absolute base URL for server-side use", async () => {
    const { calls, doFetch } = stubFetch(jsonResponse({}));
    const client = createApiClient({
      baseUrl: "http://localhost:8000/",
      fetch: doFetch,
    });

    await client.get("/meta");

    expect(calls[0].url).toBe("http://localhost:8000/meta");
  });
});
