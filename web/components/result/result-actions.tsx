"use client";

/**
 * "Finish" vs "improve my list", item 6.
 *
 * An earlier design let step 3 flow into step 4 through
 * one anonymous Continue, which reads as "you are not done yet" even for a list
 * the family is happy with. The step now makes the choice
 * explicit: a primary *I'm happy — finish*, and a secondary *not happy — help
 * me improve my list* that goes to step 4.
 *
 * "Finish" ends the session: it used to open the completion
 * page at `FINISH_PATH`; it now clears the wizard and returns to the welcome
 * page, the same thing that page's own "start over" did. `/finish` is
 * consequently unreachable from the UI.
 *
 * Finish is therefore a button, not a link — it has to clear the store before
 * it navigates. `router.replace`, not `push`: the wizard the family just
 * finished must not be one Back press away, and `reset()` clears `listExists`,
 * so the guard would bounce a Back into the wizard here anyway. Improve stays a
 * link: it is a plain navigation, so it is focusable, opens in a new tab and
 * works before hydration.
 */

import { ArrowRightIcon, CheckIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { stepPath, WELCOME_PATH } from "@/components/wizard/steps";
import { Link, useRouter } from "@/i18n/navigation";
import { useWizardStore } from "@/lib/store/wizard";

// Both destinations are locale-free paths — `Link` and `useRouter` from
// `@/i18n/navigation` add the `[locale]` segment.

export function ResultActions() {
  const t = useTranslations("result.next");
  const router = useRouter();
  const reset = useWizardStore((state) => state.reset);

  function finish() {
    reset();
    router.replace(WELCOME_PATH);
  }

  return (
    <section className="flex flex-col gap-3" data-testid="result-actions">
      <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-4">
          <Button
            size="lg"
            onClick={finish}
            // Long copy wraps instead of running past the card on a 360 px
            // phone: `Button` is `whitespace-nowrap` with a fixed height.
            className="h-auto min-h-11 py-2.5 text-left whitespace-normal"
            data-testid="result-finish"
          >
            <CheckIcon aria-hidden="true" data-icon="inline-start" />
            {t("finish")}
          </Button>
          <p className="text-sm text-muted-foreground">{t("finishHint")}</p>
        </div>

        <div className="flex flex-col items-start gap-2 rounded-lg border border-border p-4">
          <Button
            size="lg"
            variant="outline"
            asChild
            className="h-auto min-h-11 py-2.5 text-left whitespace-normal"
            data-testid="result-improve"
          >
            <Link href={stepPath("improve")}>
              <SparklesIcon aria-hidden="true" data-icon="inline-start" />
              {t("improve")}
              <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">{t("improveHint")}</p>
        </div>
      </div>
    </section>
  );
}
