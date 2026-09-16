import { describe, expect, it } from "vitest";

import type { SimulationVariant } from "@/lib/api/types";

import { topOutcomeShares } from "./outcome-shares";

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
