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
 * The `○────●────○────○` rail.
 *
 * Every step is a link only while its "can enter" condition holds; a locked
 * step renders as inert text with `aria-disabled` and a `steps.locked`
 * tooltip instead of a dead link — keyboard and screen-reader users meet the
 * same gate the route guard enforces.
 *
 * A named `navigation` landmark (`steps.navLabel`); `steps.progress` is
 * screen-reader-only text for "step 2 of 4", since that's otherwise only
 * conveyed by marker styling. The current step carries `aria-current="step"`.
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

          // Locked and unlocked labels share one legible tone; a dimmed label
          // fails color-contrast and is unreadable for the readers who most
          // need the rail. The marker, `aria-disabled`, and the `steps.locked`
          // tooltip are what mark a step locked instead.
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
