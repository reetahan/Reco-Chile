/**
 * The `/simulate` request body, built from the wizard store.
 *
 * Assembles what the engine needs before the simulation runs: the list in its
 * current order, the five flags per wish, and — in ties mode only — the
 * preference group. In strict mode `equivalence_group` is omitted entirely,
 * which the contract defines as "each wish is its own group equal to its
 * position", i.e. mathematically identical to strict ranking.
 */

import type { SimulationRequest, WishItem } from "@/lib/api/types";
import type { Wish } from "@/lib/store/wizard";

export type SimulationInputs = {
  studentId: string;
  wishes: readonly Wish[];
  useEquivalenceClasses: boolean;
};

/** One wire wish. `equivalence_group` is present only in ties mode. */
export function toWishItem(
  wish: Wish,
  index: number,
  useEquivalenceClasses: boolean,
): WishItem {
  const item: WishItem = {
    program_id: wish.programId,
    priority_sibling: wish.prioritySibling,
    priority_student: wish.priorityStudent,
    priority_parent_civil_servant: wish.priorityParentCivilServant,
    priority_ex_student: wish.priorityExStudent,
    priority_already_registered: wish.priorityAlreadyRegistered,
  };
  if (useEquivalenceClasses) {
    // A wish the family never numbered falls back to its position, exactly as
    // `prepare_ordered_wishes` does for a missing group.
    item.equivalence_group = wish.equivalenceGroup ?? index + 1;
  }
  return item;
}

export function buildSimulationRequest(
  inputs: SimulationInputs,
): SimulationRequest {
  return {
    // The RUN/IPE is passed through untouched (only trimmed); the engine's
    // `normalize_student_identifier` is the authority on its shape.
    student_id: inputs.studentId.trim(),
    wishes: inputs.wishes.map((wish, index) =>
      toWishItem(wish, index, inputs.useEquivalenceClasses),
    ),
  };
}

/** Can this list be simulated at all? Mirrors the engine's own precondition
 * ("Enter the student's RUN/IPE…" / "Add at least one program…"). */
export function canSimulate(inputs: SimulationInputs): boolean {
  return inputs.studentId.trim() !== "" && inputs.wishes.length > 0;
}
