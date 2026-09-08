"use client";

/**
 * The result step's forward choice: "Finish" opens the read-only summary at
 * `FINISH_PATH` (store kept), "improve" goes to step 4. Finish is a button so
 * Back from the summary returns here; improve stays a link so it is focusable
 * and works before hydration.
 */

import { ArrowRightIcon, CheckIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { FINISH_PATH, stepPath } from "@/components/wizard/steps";
import { Link, useRouter } from "@/i18n/navigation";

// Both destinations are locale-free paths — `Link` and `useRouter` from
// `@/i18n/navigation` add the `[locale]` segment.

export function ResultActions() {
  const t = useTranslations("result.next");
  const router = useRouter();

  function finish() {
    router.push(FINISH_PATH);
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
