"use client";

import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

import {
  STEP_LABEL_KEY,
  STEP_SLUGS,
  stepNumber,
  stepPath,
  type StepSlug,
} from "./steps";

type StepperProps = {
  current: StepSlug;
  /** The store's `canEnterStep`, per slug; a locked step is not a link. */
  canEnter: (slug: StepSlug) => boolean;
};

/**
 * The `○────●────○────○` rail
 *
 * Every step is a link, but only while its "can enter" condition holds. A step
 * that cannot be entered renders as inert text marked `aria-disabled`, carrying
 * `steps.locked` as its tooltip, so keyboard and screen-reader users meet the
 * same gate — and the same explanation — as the guard enforces on the route. It
 * is deliberately *not* given `role="link"`: an assistive-technology user must
 * not be offered a link that goes nowhere, and the rail's link count is what
 * `e2e/wizard.spec.ts` asserts a locked step by.
 *
 * The rail is a named `navigation` landmark (`steps.navLabel`) so it can be
 * skipped to, and separately reachable from the locale switcher's own landmark;
 * `steps.progress` rides along as screen-reader-only text because "step 2 of 4"
 * is otherwise only conveyed by the marker styling. The current step is the one
 * carrying `aria-current="step"`.
 *
 * Mobile first: four numbered markers stay on one row down to 360 px, with the
 * labels beneath them shrinking rather than wrapping the rail.
 */
export function Stepper({ current, canEnter }: StepperProps) {
  const t = useTranslations("steps");
  const currentIndex = STEP_SLUGS.indexOf(current);

  return (
    <nav aria-label={t("navLabel")}>
      <p className="sr-only">
        {t("progress", {
          current: currentIndex + 1,
          total: STEP_SLUGS.length,
        })}
      </p>
      <ol className="flex items-start">
        {STEP_SLUGS.map((slug, index) => {
          const isCurrent = slug === current;
          const isDone = index < currentIndex;
          // "Locked" is about the gate only: the current step is never a link
          // (it is already here), but it is not disabled either.
          const isLocked = !canEnter(slug);
          const isLink = !isLocked && !isCurrent;
          const label = t(STEP_LABEL_KEY[slug]);

          const marker = (
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                isCurrent &&
                  "border-primary bg-primary text-primary-foreground",
                !isCurrent &&
                  isDone &&
                  "border-primary/40 bg-primary/10 text-primary",
                !isCurrent && !isDone && "border-border bg-background",
                !isCurrent && !isDone && !isLink && "text-muted-foreground",
              )}
            >
              {isDone ? (
                <CheckIcon className="size-3.5" aria-hidden="true" />
              ) : (
                stepNumber(slug)
              )}
            </span>
          );

          // A locked step used to be dimmed to `text-muted-foreground/60`,
          // which is ~2.5:1 on white at 11px — an axe `color-contrast` failure
          // (serious), and unreadable for exactly the readers who most need the
          // rail. Locked and unlocked labels therefore share one legible tone;
          // what separates them is the marker (a grey number in a plain circle
          // versus a dark one) plus `aria-disabled` and the `steps.locked`
          // tooltip, none of which depends on being able to see a 40 % grey.
          const text = (
            <span
              className={cn(
                "text-center text-[0.7rem] leading-tight sm:text-xs",
                isCurrent
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          );

          return (
            <li
              key={slug}
              className="flex flex-1 flex-col items-center gap-1.5"
              aria-current={isCurrent ? "step" : undefined}
            >
              <div className="flex w-full items-center gap-1">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px flex-1",
                    index === 0 ? "bg-transparent" : "bg-border",
                  )}
                />
                {isLink ? (
                  <Link
                    href={stepPath(slug)}
                    aria-label={`${stepNumber(slug)}. ${label}`}
                    className="rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {marker}
                  </Link>
                ) : (
                  <span
                    aria-disabled={isLocked ? true : undefined}
                    title={isLocked ? t("locked") : undefined}
                  >
                    {marker}
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px flex-1",
                    index === STEP_SLUGS.length - 1
                      ? "bg-transparent"
                      : "bg-border",
                  )}
                />
              </div>
              {isLink ? (
                <Link
                  href={stepPath(slug)}
                  tabIndex={-1}
                  className="rounded-sm px-0.5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {text}
                </Link>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
