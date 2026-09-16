/**
 * How often each school was the top choice across the compatible strict
 * orders — the tied-preference breakdown on the result step.
 */

import type { SimulationVariant } from "@/lib/api/types";

export type OutcomeShare = {
  label: string;
  programId: string | null;
  /** Orders whose top choice was this outcome. */
  count: number;
  /** `count / variants.length`. */
  share: number;
};

/**
 * The most common top choices across `variants`, most frequent first, capped
 * at `maxRows`. Grouped by `predicted_outcome_program_id`, falling back to the
 * label for `Unmatched` (whose id is always `null`).
 */
export function topOutcomeShares(
  variants: readonly SimulationVariant[],
  maxRows = 3,
): OutcomeShare[] {
  const counts = new Map<string, OutcomeShare>();
  for (const variant of variants) {
    const key =
      variant.predicted_outcome_program_id ?? variant.predicted_outcome;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        label: variant.predicted_outcome,
        programId: variant.predicted_outcome_program_id,
        count: 1,
        share: 0,
      });
    }
  }

  const total = variants.length;
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, maxRows)
    .map((row) => ({ ...row, share: total > 0 ? row.count / total : 0 }));
}
