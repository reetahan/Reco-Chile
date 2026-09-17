"use client";

import { ArrowLeftIcon, ArrowRightIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";

import { forwardPath, previousSlug, stepPath, type StepSlug } from "./steps";

/**
 * The `[← Back] [Continue →]` bar, sticky to the bottom of the viewport.
 *
 * Continue is dropped on a step that states its own way forward: the terminal
 * step 4, and step 3, whose result page ends with an explicit finish/improve
 * choice instead. Back stays on both.
 *
 * Continue is a button, not a link: a disabled link drops out of the tab
 * order, and `pending` needs to keep the same element in place so focus
 * survives the wait.
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
   * keeps its label and place in the tab order, swaps the arrow for a spinner,
   * and disables itself so a second press can't queue a second run.
   */
  pending?: boolean;
}) {
  const t = useTranslations("steps");
  const router = useRouter();

  const back = previousSlug(slug);
  // `null` on the terminal step and on any step that offers its own onward
  // choice — step 3's explicit finish / improve pair.
  const forward = forwardPath(slug);

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
          onClick={() => router.push(forward)}
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
