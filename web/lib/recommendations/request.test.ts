import { describe, expect, it } from "vitest";

import { emptyFilters } from "@/lib/store/wizard";
import type { GeocodeResult, Wish } from "@/lib/store/wizard";

import {
  buildRecommendationRequest,
  toHomeLocation,
  toWishItem,
} from "./request";

function wish(overrides: Partial<Wish> = {}): Wish {
  return {
    programId: "1234:5",
    equivalenceGroup: null,
    prioritySibling: false,
    priorityStudent: false,
    priorityParentCivilServant: false,
    priorityExStudent: false,
    priorityAlreadyRegistered: false,
    ...overrides,
  };
}

function geocode(overrides: Partial<GeocodeResult> = {}): GeocodeResult {
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

describe("toWishItem", () => {
  it("renames every priority flag to its wire spelling", () => {
    expect(
      toWishItem(
        wish({
          equivalenceGroup: 2,
          prioritySibling: true,
          priorityParentCivilServant: true,
        }),
      ),
    ).toEqual({
      program_id: "1234:5",
      equivalence_group: 2,
      priority_sibling: true,
      priority_student: false,
      priority_parent_civil_servant: true,
      priority_ex_student: false,
      priority_already_registered: false,
    });
  });

  it("sends a null group for strict ranking", () => {
    // The contract's own words: "Omit for strict ranking, where each wish
    // defaults to its own group equal to its position in the list."
    expect(toWishItem(wish()).equivalence_group).toBeNull();
  });
});

describe("toHomeLocation", () => {
  it("passes the precision through verbatim", () => {
    // The engine reads this string to decide whether the hard distance filter
    // may apply at all (`home_geocoding_supports_hard_filter`).
    expect(toHomeLocation(geocode({ precision: "city" }))).toEqual({
      lat: -33.45,
      lon: -70.66,
      precision: "city",
    });
  });

  it("is null for anything that is not a usable point", () => {
    expect(toHomeLocation(null)).toBeNull();
    expect(toHomeLocation(geocode({ ok: false }))).toBeNull();
    expect(toHomeLocation(geocode({ lat: null }))).toBeNull();
    expect(toHomeLocation(geocode({ lon: null }))).toBeNull();
  });

  it("defaults a missing precision to the engine's own fallback", () => {
    expect(toHomeLocation(geocode({ precision: null }))?.precision).toBe(
      "approximate",
    );
  });
});

describe("buildRecommendationRequest", () => {
  it("builds the full body", () => {
    expect(
      buildRecommendationRequest({
        studentId: " 12.345.678-5 ",
        wishes: [wish(), wish({ programId: "9:1" })],
        maxRecommendations: 7,
        home: geocode(),
      }),
    ).toEqual({
      student_id: "12.345.678-5",
      wishes: [
        expect.objectContaining({ program_id: "1234:5" }),
        expect.objectContaining({ program_id: "9:1" }),
      ],
      max_recommendations: 7,
      home: { lat: -33.45, lon: -70.66, precision: "address" },
    });
  });

  it("includes the sidebar filters only when at least one is set", () => {
    const base = {
      studentId: "12.345.678-5",
      wishes: [wish()],
      maxRecommendations: 5,
      home: null,
    };

    // No filters slice, or an empty one: the field is omitted entirely.
    expect("filters" in buildRecommendationRequest(base)!).toBe(false);
    expect(
      "filters" in
        buildRecommendationRequest({ ...base, filters: emptyFilters() })!,
    ).toBe(false);

    // Region plus one multi-select → the wire shape `/programs` uses.
    const request = buildRecommendationRequest({
      ...base,
      filters: {
        ...emptyFilters(),
        region: "Región Metropolitana de Santiago",
        pie: ["With PIE"],
      },
    });
    expect(request?.filters).toEqual({
      region: "Región Metropolitana de Santiago",
      pie: ["With PIE"],
    });
  });

  it("omits the home point when the geocode failed", () => {
    const request = buildRecommendationRequest({
      studentId: "12.345.678-5",
      wishes: [wish()],
      maxRecommendations: 5,
      home: geocode({ ok: false, lat: null, lon: null }),
    });
    expect(request?.home).toBeNull();
  });

  it("is null when there is nothing to ask for", () => {
    expect(
      buildRecommendationRequest({
        studentId: "",
        wishes: [wish()],
        maxRecommendations: 5,
        home: null,
      }),
    ).toBeNull();
    expect(
      buildRecommendationRequest({
        studentId: "12.345.678-5",
        wishes: [],
        maxRecommendations: 5,
        home: null,
      }),
    ).toBeNull();
  });
});
