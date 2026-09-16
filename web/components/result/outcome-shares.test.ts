import { describe, expect, it } from "vitest";

import type { EstimatedOutcome, SimulationVariant } from "@/lib/api/types";

import { otherOutcomes, topOutcomeShares } from "./outcome-shares";

function outcome(overrides: Partial<EstimatedOutcome> = {}): EstimatedOutcome {
  return { label: "Liceo A", probability: 0, program_id: "1:A", ...overrides };
}

function variant(
  overrides: Partial<SimulationVariant> = {},
): SimulationVariant {
  return {
    order_index: 1,
    program_order: [],
    tied_order: [],
    predicted_outcome: "Liceo A",
    predicted_outcome_program_id: "1:A",
    predicted_outcome_final_chance: 0.9,
    unmatched_risk: 0.1,
    at_risk: false,
    ...overrides,
  };
}

describe("topOutcomeShares", () => {
  it("reports a single row at 100% when every order agrees", () => {
    const variants = [variant(), variant(), variant()];
    expect(topOutcomeShares(variants)).toEqual([
      { label: "Liceo A", programId: "1:A", count: 3, share: 1 },
    ]);
  });

  it("ranks a three-way split by frequency, most common first", () => {
    const variants = [
      ...Array(12).fill(
        variant({ predicted_outcome: "A", predicted_outcome_program_id: "a" }),
      ),
      ...Array(12).fill(
        variant({ predicted_outcome: "B", predicted_outcome_program_id: "b" }),
      ),
      ...Array(12).fill(
        variant({ predicted_outcome: "C", predicted_outcome_program_id: "c" }),
      ),
    ];
    const shares = topOutcomeShares(variants);
    expect(shares).toHaveLength(3);
    for (const row of shares) {
      expect(row.count).toBe(12);
      expect(row.share).toBeCloseTo(1 / 3);
    }
  });

  it("caps at maxRows even with more distinct outcomes", () => {
    const variants = [
      variant({ predicted_outcome: "A", predicted_outcome_program_id: "a" }),
      variant({ predicted_outcome: "A", predicted_outcome_program_id: "a" }),
      variant({ predicted_outcome: "B", predicted_outcome_program_id: "b" }),
      variant({ predicted_outcome: "C", predicted_outcome_program_id: "c" }),
      variant({ predicted_outcome: "D", predicted_outcome_program_id: "d" }),
    ];
    const shares = topOutcomeShares(variants, 3);
    expect(shares).toHaveLength(3);
    expect(shares[0]).toMatchObject({ programId: "a", count: 2 });
  });

  it("groups Unmatched by label, since its program id is always null", () => {
    const variants = [
      variant({
        predicted_outcome: "Unmatched",
        predicted_outcome_program_id: null,
      }),
      variant({
        predicted_outcome: "Unmatched",
        predicted_outcome_program_id: null,
      }),
    ];
    expect(topOutcomeShares(variants)).toEqual([
      { label: "Unmatched", programId: null, count: 2, share: 1 },
    ]);
  });

  it("returns an empty list for no variants", () => {
    expect(topOutcomeShares([])).toEqual([]);
  });
});

describe("otherOutcomes", () => {
  it("returns #2 and #3 when the top choice leaves room for both", () => {
    const outcomes = [
      outcome({ label: "A", probability: 0.5 }),
      outcome({ label: "B", probability: 0.3 }),
      outcome({ label: "C", probability: 0.2 }),
    ];
    expect(otherOutcomes(outcomes).map((o) => o.label)).toEqual(["B", "C"]);
  });

  it("drops #2 and #3 once the top choice alone is ~100%", () => {
    const outcomes = [
      outcome({ label: "A", probability: 1 }),
      outcome({ label: "B", probability: 0 }),
    ];
    expect(otherOutcomes(outcomes)).toEqual([]);
  });

  it("keeps #2 but drops #3 once the top two together are ~100%", () => {
    const outcomes = [
      outcome({ label: "A", probability: 0.6 }),
      outcome({ label: "B", probability: 0.4 }),
      outcome({ label: "C", probability: 0 }),
    ];
    expect(otherOutcomes(outcomes).map((o) => o.label)).toEqual(["B"]);
  });

  it("treats a rounding-distance-from-100% top choice as fully covered", () => {
    // Would display as 100.0%, so a #2 would only ever show 0.0%.
    const outcomes = [
      outcome({ label: "A", probability: 0.99991 }),
      outcome({ label: "B", probability: 0.00009 }),
    ];
    expect(otherOutcomes(outcomes)).toEqual([]);
  });

  it("returns nothing for fewer than two outcomes", () => {
    expect(otherOutcomes([outcome({ probability: 0.4 })])).toEqual([]);
    expect(otherOutcomes([])).toEqual([]);
  });
});
