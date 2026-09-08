"use client";

import { ArrowLeftIcon, ArrowRightIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";

import {
  nextSlug,
  ownsForwardChoice,
  previousSlug,
  stepPath,
  type StepSlug,
} from "./steps";

/**
 * The `[← Back] [Continue →]` bar
 *
 * Sticky to the bottom of the viewport so it stays reachable on a phone without
 * scrolling past a long wish list. `-mx-4 px-4` bleeds the rule and the backdrop
 * to the edges of the locale layout's padded column while the buttons stay
 * aligned with the step content.
 *
 * Continue is dropped entirely on a step that states its own way forward:
 * the terminal step 4, and — item 6 — step 3, whose result page ends
 * with the explicit finish / improve choice. Back stays on both.
 *
 * Continue is a button rather than a link because it has two disabled states: a
 * disabled link is not focusable and would simply drop out of the tab order
 * whenever the step's gate does not hold, and `pending` has to keep the same
 * element in place so focus survives the wait.
 */
export function WizardNav({
  slug,
  canContinue,
  pending = false,
}: {
  slug: StepSlug;
  /** `canContinue` for the live store state. */
  canContinue: boolean;
  /**
   * A request the step must finish before moving on is in flight. Continue
   * keeps its label and its place in the tab order, swaps the arrow for a
   * spinner and announces itself busy; it is disabled meanwhile so a second
   * press cannot queue a second run.
   *
   * No step sets it today: the one candidate was the result step's `/simulate`
   *, which announces itself through its own loading
   * skeleton instead and, item 6, has no Continue at all.
   */
  pending?: boolean;
}) {
  const t = useTranslations("steps");
  const router = useRouter();

  const back = previousSlug(slug);
  // `null` on the terminal step and on any step that offers its own onward
  // choice — step 3's explicit finish / improve pair.
  const forward = ownsForwardChoice(slug) ? null : nextSlug(slug);

  return (
    <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      {back ? (
        <Button variant="ghost" size="lg" asChild data-testid="wizard-back">
          <Link href={stepPath(back)}>
            <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
            {t("back")}
          </Link>
        </Button>
      ) : (
        // Keeps Continue flush right on the first step without a second row.
        <span />
      )}

      {forward ? (
        <Button
          size="lg"
          data-testid="wizard-continue"
          data-pending={pending ? "" : undefined}
          disabled={!canContinue || pending}
          aria-busy={pending || undefined}
          onClick={() => router.push(stepPath(forward))}
        >
          {t("continue")}
          {pending ? (
            <>
              <Loader2Icon
                aria-hidden="true"
                data-icon="inline-end"
                className="animate-spin"
              />
              {/* `aria-busy` alone is not announced by every screen reader. */}
              <span className="sr-only">{t("pending")}</span>
            </>
          ) : (
            <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
          )}
        </Button>
      ) : null}
    </div>
  );
}
