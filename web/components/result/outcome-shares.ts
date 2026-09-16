/**
 * Pure probability math for the result step's "more odds" section: which
 * outcomes are still worth showing, and how often each school was the top
 * choice across the compatible strict orders.
 */

import type { EstimatedOutcome, SimulationVariant } from "@/lib/api/types";

/** How close to 1 counts as "nothing left to show" — half of the smallest
 * unit `formatPercent` displays (one decimal place). */
const FULLY_COVERED = 1 - 0.0005;

/**
 * The #2 and #3 outcomes, dropping either once the outcomes already shown
 * cover ~100% of the probability — a #2 that would show 0.0% is not
 * information.
 */
export function otherOutcomes(
  outcomes: readonly EstimatedOutcome[],
): EstimatedOutcome[] {
  const top1 = outcomes[0]?.probability ?? 0;
  if (top1 >= FULLY_COVERED) return [];
  const top2 = top1 + (outcomes[1]?.probability ?? 0);
  return outcomes.slice(1, top2 >= FULLY_COVERED ? 2 : 3);
}

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
