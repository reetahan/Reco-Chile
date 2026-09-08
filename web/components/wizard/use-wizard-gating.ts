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
  DISCLAIMER_PATH,
  FINISH_SLUG,
  isFinishPathname,
  STEP_SLUGS,
  stepFromPathname,
  stepNumber,
  stepPath,
  WELCOME_PATH,
  type StepSlug,
} from "./steps";

/**
 * Binds the store's step gates to the current route.
 *
 * The rules themselves live in `@/lib/store/wizard`; this hook only decides
 * *which* route the URL is on, supplies `/meta.max_exact_equiv_permutations` and
 * `/meta.max_wishes` as the two server limits, and re-exposes the gates as plain booleans so every
 * component below takes props instead of touching the store.
 *
 * Two routes under `(wizard)` are not steps and are told apart by `kind`:
 * the completion page `/finish`, which the shell draws without the
 * rail; and — as a redirect target only — the welcome page at `WELCOME_PATH`,
 * which is where an unanswered welcome question sends the family.
 *
 * Each gate is a separate primitive subscription, so the shell re-renders only
 * when a gate actually flips — not on every keystroke in the wish list.
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
  // Both server caps , straight from `/meta`, so every gate the shell
  // draws — the stepper links, Continue, and the guard's fallback — uses the
  // numbers the API will enforce, and does so from the first render rather than
  // waiting for some step to have called `setMaxWishes`.
  const options: StepGateOptions = {
    maxOrders: meta?.max_exact_equiv_permutations ?? null,
    maxWishes: meta?.max_wishes ?? null,
  };

  // Step 1 needs the welcome answer and the consent checkbox so all
  // four need a subscription — plus the two raw flags, to tell which of the
  // two front-door screens is the right redirect target when neither step is
  // reachable yet.
  const listExists = useWizardStore((state) => state.listExists);
  const canEnterStudent = useWizardStore(selectCanEnterStep(1, options));
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
  // even step 1 — is the welcome page.
  let fallbackSlug: StepSlug | null = null;
  for (const candidate of STEP_SLUGS) {
    if (!entry[candidate]) break;
    fallbackSlug = candidate;
  }
  // Not even step 1: either the welcome question is unanswered (→ the welcome
  // page) or it is answered but the consent checkbox is not (→ the disclaimer
  // page). `canEnterStep(1)` conflates both into `false`, so the raw
  // `listExists` flag is what tells them apart here.
  const fallbackHref =
    fallbackSlug !== null
      ? stepPath(fallbackSlug)
      : listExists === null
        ? WELCOME_PATH
        : DISCLAIMER_PATH;

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
