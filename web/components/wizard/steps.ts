/**
 * Route-level identity of the four wizard steps: slug ↔ number ↔ href.
 *
 * The *rules* (can-enter / can-continue) are NOT here — they live in
 * `@/lib/store/wizard` (`canEnterStep`, `canContinue`, `lastAllowedStep`) next
 * to the state they read, and `use-wizard-gating.ts` binds them to the router.
 * This module only translates between the store's numeric `WizardStep`
 * (`1 | 2 | 3 | 4`) and the URL slugs, and is deliberately
 * free of React so it can be unit-tested and used from server components.
 */

import type { WizardStep } from "@/lib/store/wizard";

/** URL slugs, in wizard order — `app/[locale]/(wizard)/<slug>/page.tsx`. */
export const STEP_SLUGS = ["student", "list", "result", "improve"] as const;

export type StepSlug = (typeof STEP_SLUGS)[number];

/**
 * The welcome page — `app/[locale]/page.tsx`, the wizard's front door.
 *
 * It is not a step: it carries no stepper, no Back/Continue bar and no number.
 * Its two buttons write `listExists`, which is what `canEnterStep(1)` now
 * requires, so it is also the step guard's redirect target while that choice is
 * unmade. Locale-free like every path here — `Link`/`useRouter` from
 * `@/i18n/navigation` add the `[locale]` prefix.
 */
export const WELCOME_PATH = "/";

/**
 * The "Before we continue" consent page — `app/[locale]/disclaimer/page.tsx`.
 *
 * Screen 2 of the front door: shown after the welcome page's Yes/No choice and
 * before step 1, with one checkbox ("I understand and want to continue") that
 * has to be checked before the family can reach step 1. Like the welcome page
 * it carries no stepper, no Back/Continue bar and no `/meta` fetch, and is
 * outside the `(wizard)` route group for the same reason.
 */
export const DISCLAIMER_PATH = "/disclaimer";

/**
 * The completion page — `app/[locale]/(wizard)/finish/page.tsx`.
 *
 * Deliberately *outside* the stepper: the rail keeps its four steps, and the
 * page is reached only from the result step's "Finish" button. It lives in the
 * `(wizard)` route group so it inherits `/meta` and the store, but
 * `components/wizard/wizard-shell.tsx` draws it without the rail and without
 * the Back/Continue bar, and guards it on a fresh simulation instead.
 */
export const FINISH_SLUG = "finish" as const;
export const FINISH_PATH = `/${FINISH_SLUG}`;

/** True for `/es/finish`, `/finish`, `/en/finish/` — the completion page. */
export function isFinishPathname(pathname: string): boolean {
  return pathname.split("/").filter(Boolean).at(-1) === FINISH_SLUG;
}

/**
 * Message ids, from `messages/{es,en}.json`.
 *
 * `steps.*` holds the short stepper labels; each step's own namespace holds its
 * page title. The lead sentence is the one line of copy that
 * orients the family on that step — deliberately reused rather than newly

 */
/** Leaf ids inside the `steps` namespace. */
export const STEP_LABEL_KEY = {
  student: "student",
  list: "list",
  result: "result",
  improve: "improve",
} as const satisfies Record<StepSlug, string>;

export const STEP_TITLE_KEY = {
  student: "student.title",
  list: "list.title",
  result: "result.title",
  improve: "improve.title",
} as const satisfies Record<StepSlug, string>;

export const STEP_LEAD_KEY = {
  // Why the identifier is needed at all, in one sentence; the detail is in the
  // "Why do we ask for this?" popover.
  student: "student.lead",
  list: "list.order.preferenceHint",
  // "About this estimate" — the caveat shown beside the result.
  result: "app.aboutEstimate.body",
  improve: "improve.methodBody",
} as const satisfies Record<StepSlug, string>;

export function isStepSlug(value: string): value is StepSlug {
  return (STEP_SLUGS as readonly string[]).includes(value);
}

/** The store's 1-based step number for a slug. */
export function stepNumber(slug: StepSlug): WizardStep {
  return (STEP_SLUGS.indexOf(slug) + 1) as WizardStep;
}

export function stepSlug(step: WizardStep): StepSlug {
  return STEP_SLUGS[step - 1];
}

/**
 * Locale-free path of a step. `Link` / `useRouter` from `@/i18n/navigation`
 * prepend the `[locale]` segment, so callers never hand-build `/es/student`.
 */
export function stepPath(slug: StepSlug): string {
  return `/${slug}`;
}

/**
 * The wizard step a pathname points at, or `null` when the path is not a wizard
 * route. Tolerates a leading `[locale]` segment (as `next/navigation` reports
 * it) and a trailing slash.
 */
export function stepFromPathname(pathname: string): StepSlug | null {
  const last = pathname.split("/").filter(Boolean).at(-1);
  return last !== undefined && isStepSlug(last) ? last : null;
}

/**
 * Does the step make its own onward choice, instead of the shell's Continue?
 *
 * Step 3 does, since the result page ends with an
 * explicit *I'm happy — finish* / *not happy — help me improve my list* pair
 * (`components/result/result-actions.tsx`). A third, unlabelled Continue below
 * them silently picked the "improve" branch, which is exactly the "you are not
 * done yet" reading the product feedback asked us to remove — so the bar keeps
 * Back and drops Continue there, as it already does on the terminal step.
 *
 * The gate itself is untouched: `canContinue(state, 3)` still means "a fresh
 * simulation exists" and still guards step 4 through `canEnterStep(4)`. The
 * choice is only rendered once the simulation succeeded, so there is no way
 * forward from a failed or stale result either way.
 */
export function ownsForwardChoice(slug: StepSlug): boolean {
  return slug === "result";
}

/** The slug a Continue press moves to, or `null` on the terminal step. */
export function nextSlug(slug: StepSlug): StepSlug | null {
  return STEP_SLUGS[STEP_SLUGS.indexOf(slug) + 1] ?? null;
}

/** The slug a Back press moves to, or `null` on the first step. */
export function previousSlug(slug: StepSlug): StepSlug | null {
  const index = STEP_SLUGS.indexOf(slug);
  return index > 0 ? STEP_SLUGS[index - 1] : null;
}
