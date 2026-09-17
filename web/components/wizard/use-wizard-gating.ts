"use client";

import { usePathname } from "@/i18n/navigation";

import { useMetaOptional } from "@/lib/meta";
import {
  selectCanContinue,
  selectCanEnterStep,
  useWizardStore,
  type StepGateOptions,
} from "@/lib/store/wizard";

import {
  FINISH_SLUG,
  isFinishPathname,
  LIST_CHOICE_PATH,
  STEP_SLUGS,
  stepFromPathname,
  stepNumber,
  stepPath,
  FRONT_DOOR_PATH,
  type StepSlug,
} from "./steps";

/**
 * Binds the store's step gates (in `@/lib/store/wizard`) to the current route:
 * decides which route the URL is on, supplies the two server limits from
 * `/meta`, and re-exposes the gates as plain booleans so components below take
 * props instead of touching the store.
 *
 * The completion page `/finish` is under `(wizard)` but is not a step — told
 * apart here by `kind`. Each gate is a separate subscription so the shell
 * re-renders only when a gate actually flips, not on every keystroke.
 */
export type WizardGating = {
  /** `"step"` for the four numbered steps, `"finish"` for the completion page. */
  kind: "step" | typeof FINISH_SLUG;
  /** Current step slug; `student` when the pathname is not a wizard step. */
  slug: StepSlug;
  /** May the family be on this route right now? */
  allowed: boolean;
  /** Where the guard sends them when they may not — a locale-free path. */
  fallbackHref: string;
  canEnter: (slug: StepSlug) => boolean;
  canContinue: boolean;
};

export function useWizardGating(): WizardGating {
  const pathname = usePathname();
  const meta = useMetaOptional();

  const path = pathname ?? "";
  const finish = isFinishPathname(path);
  const slug = stepFromPathname(path) ?? "student";
  // Both caps come straight from `/meta`, available on the first render
  // rather than waiting for some step to have called `setMaxWishes`.
  const options: StepGateOptions = {
    maxOrders: meta?.max_exact_equiv_permutations ?? null,
    maxWishes: meta?.max_wishes ?? null,
  };

  // `canContinueStudent` is only needed to tell apart the two reasons step 2
  // can be out of reach with step 1 itself showing as "enterable" (see
  // `fallbackHref` below): an invalid RUN, or a valid one with the list
  // choice still unanswered.
  const canEnterStudent = useWizardStore(selectCanEnterStep(1, options));
  const canContinueStudent = useWizardStore(selectCanContinue(1, options));
  const canEnterList = useWizardStore(selectCanEnterStep(2, options));
  const canEnterResult = useWizardStore(selectCanEnterStep(3, options));
  const canEnterImprove = useWizardStore(selectCanEnterStep(4, options));
  const canContinueHere = useWizardStore(
    selectCanContinue(stepNumber(slug), options),
  );

  const entry: Record<StepSlug, boolean> = {
    student: canEnterStudent,
    list: canEnterList,
    result: canEnterResult,
    improve: canEnterImprove,
  };

  // `lastAllowedStep` from the store needs the whole state object; the same
  // answer falls out of the four booleans already subscribed to. `null` — not
  // even step 1 — is the front door, which is also where `reset()` sends
  // the family, so the guard must not pick a different page there.
  let fallbackSlug: StepSlug | null = null;
  for (const candidate of STEP_SLUGS) {
    if (!entry[candidate]) break;
    fallbackSlug = candidate;
  }
  const fallbackHref =
    fallbackSlug === "student" && canContinueStudent
      ? // Step 1 is done and the RUN is valid, but the list-choice question
        // that now gates step 2 has not been answered — send them there
        // instead of back through a step they already passed.
        LIST_CHOICE_PATH
      : fallbackSlug !== null
        ? stepPath(fallbackSlug)
        : FRONT_DOOR_PATH;

  if (finish) {
    return {
      kind: FINISH_SLUG,
      slug,
      // The completion page shows the result again, so it needs the same fresh
      // simulation step 4 does — `canEnterStep(4)` is exactly that condition.
      allowed: entry.improve,
      // "else redirect to result"; when the result step itself is
      // out of reach the family goes wherever they may legally be instead, so
      // one redirect lands rather than bouncing through a locked step.
      fallbackHref: entry.result ? stepPath("result") : fallbackHref,
      canEnter: (candidate) => entry[candidate],
      canContinue: false,
    };
  }

  return {
    kind: "step",
    slug,
    allowed: entry[slug],
    fallbackHref,
    canEnter: (candidate) => entry[candidate],
    canContinue: canContinueHere,
  };
}
