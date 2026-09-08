"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { STEP_LEAD_KEY, STEP_TITLE_KEY, type StepSlug } from "./steps";

/**
 * Shared frame for a wizard step: the step title (the page's single `<h1>` —
 * the header brand is a `<p>`), an optional lead sentence, then the step body.
 * The centred, max-width column comes from the locale layout; this sets no
 * width of its own.
 */
export function StepPage({
  slug,
  lead,
  leadTestId,
  children,
}: {
  slug: StepSlug;
  /**
   * Replaces the step's static lead sentence. Step 2 needs it because its
   * caption depends on whether the family already has a list, which a fixed
   * `STEP_LEAD_KEY` entry cannot express. Pass `null` to show no lead line at
   * all (step 1: that sentence lives in the "Why do we ask for this?" popover
   * instead of under the heading).
   */
  lead?: React.ReactNode | null;
  leadTestId?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations();
  const heading = useStepHeadingFocus(slug);
  const resolvedLead = lead === undefined ? t(STEP_LEAD_KEY[slug]) : lead;

  return (
    <section className="flex flex-col gap-6" data-testid={`step-${slug}`}>
      <header className="flex flex-col gap-2">
        <h1
          ref={heading}
          // Focus target, not a tab stop: `-1` lets the wizard move focus here
          // after a step change without adding a stop to the Tab order.
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight text-balance focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {t(STEP_TITLE_KEY[slug])}
        </h1>
        {resolvedLead === null ? null : (
          <p
            className="text-sm text-pretty text-muted-foreground"
            data-testid={leadTestId}
          >
            {resolvedLead}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * The last step this document rendered. Module scope so it survives one step
 * page's unmount and the next's mount (a ref cannot); a full page load resets
 * it, which is the point.
 */
let renderedSlug: StepSlug | null = null;

/**
 * Move focus to the step's `<h1>` after a step change, so a screen reader is
 * not left on a button the client-side router just removed.
 *
 * Triggers on "the slug changed since the last render of this document", not on
 * mount: a first load must not steal focus, the check is idempotent under
 * React's dev double-invoke, and a locale switch (`/es/list` → `/en/list`) is
 * the same step so focus stays put.
 */
function useStepHeadingFocus(
  slug: StepSlug,
): React.RefObject<HTMLHeadingElement | null> {
  const heading = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    const previous = renderedSlug;
    renderedSlug = slug;
    if (previous === null || previous === slug) return;
    heading.current?.focus();
  }, [slug]);

  return heading;
}
