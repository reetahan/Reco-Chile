"use client";

/**
 * "Some selected programs use estimated historical calibration values." — the
 * The "What does this mean?" notice shown under the wish
 * list whenever a selected program carries `calibration_imputed`.
 *
 * Purely presentational: whether any selected program is imputed is decided by
 * the step, which already knows every program the cards resolved, so this
 * component never fetches and never re-counts.
 */

import * as React from "react";
import { ChevronDownIcon, InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function ImputedNotice({ imputed }: { imputed: boolean }) {
  const t = useTranslations("list.notices");
  const [open, setOpen] = React.useState(false);

  if (!imputed) return null;

  return (
    <Alert data-testid="imputed-notice">
      <InfoIcon aria-hidden="true" />
      <AlertTitle>{t("imputedTitle")}</AlertTitle>
      <AlertDescription>
        <Collapsible open={open} onOpenChange={setOpen} className="w-full">
          <CollapsibleTrigger className="flex items-center gap-1 rounded-md text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            {t("imputedWhat")}
            <ChevronDownIcon
              className="size-4 transition-transform data-open:rotate-180"
              data-open={open ? "" : undefined}
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {t("imputedBody")}
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  );
}
