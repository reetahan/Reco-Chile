import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import type { GeocodeResponse } from "@/lib/api/types";

import {
  geocodeFeedback,
  hasUsableCoordinates,
  normalizeAddress,
  type GeocodeAttempt,
} from "./use-geocode";

function response(overrides: Partial<GeocodeResponse> = {}): GeocodeResponse {
  return {
    ok: true,
    address: "Av. Siempre Viva 742, Santiago",
    lat: -33.45,
    lon: -70.66,
    precision: "address",
    display_name: "Av. Siempre Viva 742, Santiago, Chile",
    warning_key: null,
    error_key: null,
    params: {},
    message: "",
    ...overrides,
  };
}

function attempt(overrides: Partial<GeocodeAttempt> = {}): GeocodeAttempt {
  return {
    address: "Av. Siempre Viva 742, Santiago",
    result: response(),
    error: null,
    ...overrides,
  };
}

describe("normalizeAddress", () => {
  it("collapses whitespace like Python's ' '.join(x.strip().split())", () => {
    expect(normalizeAddress(" Av. Siempre \n Viva 742 ")).toBe(
      "Av. Siempre Viva 742",
    );
    expect(normalizeAddress(" ")).toBe("");
  });
});

describe("hasUsableCoordinates", () => {
  it("requires ok plus finite coordinates", () => {
    expect(hasUsableCoordinates(response())).toBe(true);
    expect(hasUsableCoordinates(response({ ok: false }))).toBe(false);
    expect(hasUsableCoordinates(response({ lat: null }))).toBe(false);
    expect(hasUsableCoordinates(response({ lon: Number.NaN }))).toBe(false);
  });
});

describe("geocodeFeedback", () => {
  it("is idle before any lookup and for an empty field", () => {
    expect(geocodeFeedback(null, "anything")).toEqual({ kind: "idle" });
    expect(geocodeFeedback(attempt(), " ")).toEqual({ kind: "idle" });
  });

  it("confirms an exact address match", () => {
    expect(
      geocodeFeedback(attempt(), " Av. Siempre Viva 742, Santiago "),
    ).toEqual({
      kind: "confirmed",
      address: "Av. Siempre Viva 742, Santiago, Chile",
    });
  });

  it("warns with the server's own precision message below address level", () => {
    const message =
      "The geocoder could only identify the city or municipality.";
    expect(
      geocodeFeedback(
        attempt({ result: response({ precision: "city", message }) }),
        "Av. Siempre Viva 742, Santiago",
      ),
    ).toEqual({
      kind: "approximate",
      address: "Av. Siempre Viva 742, Santiago, Chile",
      message,
    });
  });

  it("reports a failed lookup with the server message", () => {
    expect(
      geocodeFeedback(
        attempt({
          result: response({
            ok: false,
            lat: null,
            lon: null,
            precision: null,
            display_name: null,
            error_key: "No result found for this address in Chile.",
            message:
              "No se encontró ningún resultado para esta dirección en Chile.",
          }),
        }),
        "Av. Siempre Viva 742, Santiago",
      ),
    ).toEqual({
      kind: "failed",
      message: "No se encontró ningún resultado para esta dirección en Chile.",
    });
  });

  it("reports a transport failure with the ApiError message", () => {
    expect(
      geocodeFeedback(
        attempt({
          result: null,
          error: new ApiError(429, "rate_limited", "Too many address lookups."),
        }),
        "Av. Siempre Viva 742, Santiago",
      ),
    ).toEqual({ kind: "failed", message: "Too many address lookups." });
  });

  it("asks for a fresh lookup once the field no longer matches", () => {
    // The coordinates on file describe a different string, so showing them as
    // confirmed would be a lie — the API makes the same check.
    expect(geocodeFeedback(attempt(), "Otra calle 1, Santiago")).toEqual({
      kind: "changed",
    });
  });

  it("falls back to the typed address when Nominatim returns no display name", () => {
    expect(
      geocodeFeedback(
        attempt({ result: response({ display_name: null }) }),
        "Av. Siempre Viva 742, Santiago",
      ),
    ).toEqual({
      kind: "confirmed",
      address: "Av. Siempre Viva 742, Santiago",
    });
  });
});
