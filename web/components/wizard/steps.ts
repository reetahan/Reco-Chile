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
 * The front door — `app/[locale]/page.tsx`: the "Before we continue" consent
 * screen, with one checkbox that has to be checked before the family can
 * reach step 1.
 *
 * It is not a step: it carries no stepper, no Back/Continue bar and no
 * number, and no `/meta` fetch. Locale-free like every path here —
 * `Link`/`useRouter` from `@/i18n/navigation` add the `[locale]` prefix.
 */
export const WELCOME_PATH = "/";

/**
 * Asked after step 1 (the RUN/IPE) rather than before it, so both paths start
 * the same way. Writes `listExists`, which `canEnterStep(2)` requires; like
 * the front door it carries no stepper and no Back/Continue bar.
 */
export const LIST_CHOICE_PATH = "/list-choice";

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
  student: "student.lead",
  list: "list.order.preferenceHint",
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

export function ownsForwardChoice(slug: StepSlug): boolean {
  return slug === "result";
}

/** The slug a Continue press moves to, or `null` on the terminal step. */
export function nextSlug(slug: StepSlug): StepSlug | null {
  return STEP_SLUGS[STEP_SLUGS.indexOf(slug) + 1] ?? null;
}

/**
 * The path a Continue press actually opens from `slug`. Same as
 * `stepPath(nextSlug(slug))`, except student's continue detours through
 * `LIST_CHOICE_PATH` first — every time, even if already answered, since that
 * question's only way back is finding the page again.
 */
export function forwardPath(slug: StepSlug): string | null {
  if (ownsForwardChoice(slug)) return null;
  if (slug === "student") return LIST_CHOICE_PATH;
  const next = nextSlug(slug);
  return next ? stepPath(next) : null;
}

/** The slug a Back press moves to, or `null` on the first step. */
export function previousSlug(slug: StepSlug): StepSlug | null {
  const index = STEP_SLUGS.indexOf(slug);
  return index > 0 ? STEP_SLUGS[index - 1] : null;
}
