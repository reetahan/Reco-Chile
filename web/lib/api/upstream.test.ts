import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUpstreamUrl,
  clientAddress,
  DEFAULT_UPSTREAM_BASE_URL,
  proxyRequest,
  trustsForwardedFor,
  UNKNOWN_CLIENT_ADDRESS,
  upstreamBaseUrl,
} from "./upstream";

/** Env of a deployment that sits behind a proxy it controls. */
const TRUSTING_ENV = { TRUST_PROXY: "1" };

const RUN = "11111111-1";
const SIMULATE_BODY = JSON.stringify({
  student_id: RUN,
  wishes: [{ program_id: "1234:5" }],
});

function stubFetch(response: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const doFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      if (response instanceof Error) throw response;
      return response;
    },
  ) as unknown as typeof fetch;
  return { calls, doFetch };
}

describe("upstreamBaseUrl", () => {
  it("falls back to the documented dev origin", () => {
    expect(upstreamBaseUrl({})).toBe(DEFAULT_UPSTREAM_BASE_URL);
    expect(upstreamBaseUrl({ API_BASE_URL: " " })).toBe(
      DEFAULT_UPSTREAM_BASE_URL,
    );
  });

  it("uses API_BASE_URL and drops trailing slashes", () => {
    expect(upstreamBaseUrl({ API_BASE_URL: "http://api:8000/" })).toBe(
      "http://api:8000",
    );
  });
});

describe("buildUpstreamUrl", () => {
  const base = "http://localhost:8000";

  it("joins segments onto the base URL", () => {
    expect(buildUpstreamUrl(["meta"], "", base)).toBe(
      "http://localhost:8000/meta",
    );
    expect(buildUpstreamUrl(["programs", "1234:5"], "", base)).toBe(
      "http://localhost:8000/programs/1234%3A5",
    );
  });

  it("keeps the query string, with or without its leading ?", () => {
    expect(buildUpstreamUrl(["programs"], "?q=liceo&lang=es", base)).toBe(
      "http://localhost:8000/programs?q=liceo&lang=es",
    );
    expect(buildUpstreamUrl(["programs"], "track=TP&track=HC", base)).toBe(
      "http://localhost:8000/programs?track=TP&track=HC",
    );
  });

  it("rejects traversal and empty segments", () => {
    expect(() => buildUpstreamUrl([".."], "", base)).toThrow(/Invalid/);
    expect(() =>
      buildUpstreamUrl(["programs", "..", "admin"], "", base),
    ).toThrow(/Invalid/);
    expect(() => buildUpstreamUrl(["programs", ""], "", base)).toThrow(
      /Invalid/,
    );
    expect(() => buildUpstreamUrl([], "", base)).toThrow(
      /Missing upstream path/,
    );
  });

  it("cannot escape the upstream origin through an encoded segment", () => {
    const url = buildUpstreamUrl(["evil.example.com", "x"], "", base);
    expect(new URL(url).origin).toBe(base);
    expect(url).toBe("http://localhost:8000/evil.example.com/x");
  });
});

describe("trustsForwardedFor", () => {
  it("is opt-in through TRUST_PROXY=1 and nothing else", () => {
    expect(trustsForwardedFor({})).toBe(false);
    expect(trustsForwardedFor({ TRUST_PROXY: "1" })).toBe(true);
    // Tolerate the whitespace a compose file or a .env line can leave behind.
    expect(trustsForwardedFor({ TRUST_PROXY: " 1 " })).toBe(true);
    for (const value of ["", "0", "true", "yes", "on", "11"]) {
      expect(trustsForwardedFor({ TRUST_PROXY: value })).toBe(false);
    }
  });
});

describe("clientAddress", () => {
  function requestWith(forwarded?: string) {
    return new Request(
      "http://localhost:3000/api/geocode",
      forwarded === undefined
        ? undefined
        : { headers: { "x-forwarded-for": forwarded } },
    );
  }

  it("takes the rightmost entry — the one the trusted hop observed", () => {
    expect(clientAddress(requestWith("203.0.113.7"), TRUSTING_ENV)).toBe(
      "203.0.113.7",
    );
    expect(
      clientAddress(requestWith("198.51.100.1, 203.0.113.7"), TRUSTING_ENV),
    ).toBe("203.0.113.7");
    expect(
      clientAddress(requestWith(" 198.51.100.1 , 203.0.113.7 "), TRUSTING_ENV),
    ).toBe("203.0.113.7");
  });

  it("falls back to a placeholder when no hop supplied one", () => {
    expect(clientAddress(requestWith(), TRUSTING_ENV)).toBe(
      UNKNOWN_CLIENT_ADDRESS,
    );
    expect(clientAddress(requestWith(" "), TRUSTING_ENV)).toBe(
      UNKNOWN_CLIENT_ADDRESS,
    );
    expect(clientAddress(requestWith(" , , "), TRUSTING_ENV)).toBe(
      UNKNOWN_CLIENT_ADDRESS,
    );
  });

  it("ignores the header entirely when no proxy is trusted", () => {
    // An exposed Next.js: X-Forwarded-For is client input, so believing it
    // would let one caller mint a fresh upstream rate-limit bucket per
    // request. Everyone shares the placeholder bucket instead.
    for (const env of [{}, { TRUST_PROXY: "0" }, { TRUST_PROXY: "true" }]) {
      expect(clientAddress(requestWith("203.0.113.7"), env)).toBe(
        UNKNOWN_CLIENT_ADDRESS,
      );
      expect(clientAddress(requestWith("198.51.100.1, 203.0.113.7"), env)).toBe(
        UNKNOWN_CLIENT_ADDRESS,
      );
    }
  });
});

describe("proxyRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards a GET with its query string and Accept-Language", async () => {
    const { calls, doFetch } = stubFetch(
      Response.json({ regions: [] }, { status: 200 }),
    );
    const request = new Request("http://localhost:3000/api/programs?q=liceo", {
      headers: { "accept-language": "en", cookie: "session=secret" },
    });

    const response = await proxyRequest(request, ["programs"], {
      baseUrl: "http://localhost:8000",
      fetch: doFetch,
    });

    expect(calls[0].url).toBe("http://localhost:8000/programs?q=liceo");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
    const forwarded = new Headers(calls[0].init.headers);
    expect(forwarded.get("accept-language")).toBe("en");
    // Browser credentials are not part of this contract and are not forwarded.
    expect(forwarded.get("cookie")).toBeNull();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ regions: [] });
  });

  it("passes a POST body through untouched and streams the answer back", async () => {
    const { calls, doFetch } = stubFetch(
      Response.json({ unmatched_risk: 0.12 }, { status: 200 }),
    );
    const request = new Request("http://localhost:3000/api/simulate?lang=es", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: SIMULATE_BODY,
    });

    const response = await proxyRequest(request, ["simulate"], {
      baseUrl: "http://localhost:8000",
      fetch: doFetch,
    });

    expect(calls[0].url).toBe("http://localhost:8000/simulate?lang=es");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(SIMULATE_BODY);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ unmatched_risk: 0.12 });
  });

  it("relays the upstream status and error envelope unchanged", async () => {
    const envelope = {
      error_key: "invalid_student_id",
      message: "El RUN no es válido.",
      params: {},
    };
    const { doFetch } = stubFetch(Response.json(envelope, { status: 422 }));
    const request = new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      body: SIMULATE_BODY,
    });

    const response = await proxyRequest(request, ["simulate"], {
      baseUrl: "http://localhost:8000",
      fetch: doFetch,
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual(envelope);
  });

  it("answers an unreachable upstream with the same envelope shape", async () => {
    const { doFetch } = stubFetch(new TypeError(`fetch failed for ${RUN}`));
    const request = new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      body: SIMULATE_BODY,
    });

    const response = await proxyRequest(request, ["simulate"], {
      baseUrl: "http://localhost:8000",
      fetch: doFetch,
    });

    expect(response.status).toBe(502);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error_key).toBe("network_error");
    expect(typeof body.message).toBe("string");
    expect(body.params).toEqual({});
    // The upstream error text (which can quote the request) is not relayed.
    expect(JSON.stringify(body)).not.toContain(RUN);
  });

  it("404s an invalid path without echoing it", async () => {
    const { calls, doFetch } = stubFetch(Response.json({}, { status: 200 }));
    const request = new Request("http://localhost:3000/api/..");

    const response = await proxyRequest(request, [".."], {
      baseUrl: "http://localhost:8000",
      fetch: doFetch,
    });

    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("never logs the request body", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    // Both the happy path and the failure path.
    const ok = stubFetch(Response.json({}, { status: 200 }));
    await proxyRequest(
      new Request("http://localhost:3000/api/simulate", {
        method: "POST",
        body: SIMULATE_BODY,
      }),
      ["simulate"],
      { baseUrl: "http://localhost:8000", fetch: ok.doFetch },
    );
    const down = stubFetch(new TypeError("boom"));
    await proxyRequest(
      new Request("http://localhost:3000/api/geocode", {
        method: "POST",
        body: JSON.stringify({ address: "Av. Siempre Viva 742" }),
      }),
      ["geocode"],
      { baseUrl: "http://localhost:8000", fetch: down.doFetch },
    );

    // The RUN/IPE and the home address never reach a log.
    for (const spy of [log, info, warn, error, debug]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("hands FastAPI the caller's address as the last X-Forwarded-For entry", async () => {
    const { calls, doFetch } = stubFetch(Response.json({}, { status: 200 }));
    const request = new Request("http://localhost:3000/api/geocode", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // As a platform proxy leaves it: the client's own claim first, the
        // address that proxy actually observed last.
        "x-forwarded-for": "198.51.100.1, 203.0.113.7",
      },
      body: JSON.stringify({ address: "Av. Siempre Viva 742" }),
    });

    await proxyRequest(request, ["geocode"], {
      baseUrl: "http://localhost:8000",
      fetch: doFetch,
      env: TRUSTING_ENV,
    });

    const forwarded = new Headers(calls[0].init.headers);
    // Set, not relayed: the unverified leftmost claim does not reach FastAPI,
    // and the value it buckets on is the rightmost entry either way.
    expect(forwarded.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("sends the placeholder instead of a spoofable address without TRUST_PROXY", async () => {
    const { calls, doFetch } = stubFetch(Response.json({}, { status: 200 }));
    const request = new Request("http://localhost:3000/api/geocode", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.1, 203.0.113.7",
      },
      body: JSON.stringify({ address: "Av. Siempre Viva 742" }),
    });

    await proxyRequest(request, ["geocode"], {
      baseUrl: "http://localhost:8000",
      fetch: doFetch,
      env: {},
    });

    const forwarded = new Headers(calls[0].init.headers);
    expect(forwarded.get("x-forwarded-for")).toBe(UNKNOWN_CLIENT_ADDRESS);
  });

  it("still sends a placeholder address when no hop supplied one", async () => {
    const { calls, doFetch } = stubFetch(Response.json({}, { status: 200 }));

    await proxyRequest(
      new Request("http://localhost:3000/api/geocode", {
        method: "POST",
        body: JSON.stringify({ address: "x" }),
      }),
      ["geocode"],
      { baseUrl: "http://localhost:8000", fetch: doFetch, env: TRUSTING_ENV },
    );

    const forwarded = new Headers(calls[0].init.headers);
    expect(forwarded.get("x-forwarded-for")).toBe(UNKNOWN_CLIENT_ADDRESS);
  });

  it("puts nothing but the address in the forwarded headers", async () => {
    const { calls, doFetch } = stubFetch(Response.json({}, { status: 200 }));
    const request = new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.7",
        cookie: "session=secret",
        authorization: "Bearer secret",
        "x-real-ip": "198.51.100.9",
      },
      body: SIMULATE_BODY,
    });

    await proxyRequest(request, ["simulate"], {
      baseUrl: "http://localhost:8000",
      fetch: doFetch,
      env: TRUSTING_ENV,
    });

    const forwarded = new Headers(calls[0].init.headers);
    expect([...forwarded.keys()].sort()).toEqual([
      "accept",
      "content-type",
      "x-forwarded-for",
    ]);
    // The RUN never leaves the body for a header.
    expect(JSON.stringify([...forwarded])).not.toContain(RUN);
  });
});
