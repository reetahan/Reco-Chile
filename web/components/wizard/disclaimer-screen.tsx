"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { hydrateWizardStore, useWizardStore } from "@/lib/store/wizard";

import { stepPath } from "./steps";

const CHECKBOX_ID = "disclaimer-acknowledge";

/**
 * The wizard's front door (`FRONT_DOOR_PATH`) — a consent checkbox required
 * before step 1. The checkbox reads and writes `disclaimerAcknowledged`
 * directly, so a family who already agreed finds it pre-checked.
 */
export function DisclaimerScreen() {
  const t = useTranslations("app.disclaimer");
  const tSteps = useTranslations("steps");
  const router = useRouter();

  const acknowledged = useWizardStore((state) => state.disclaimerAcknowledged);
  const setDisclaimerAcknowledged = useWizardStore(
    (state) => state.setDisclaimerAcknowledged,
  );

  React.useEffect(() => {
    void hydrateWizardStore();
  }, []);

  return (
    <section
      className="mx-auto flex max-w-xl flex-col gap-8 py-10 sm:py-16"
      data-testid="disclaimer"
    >
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
          {t("headline")}
        </h1>
      </header>

      <ol className="flex list-none flex-col gap-4 text-base text-pretty text-muted-foreground">
        <li className="flex gap-3">
          <span
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground"
            aria-hidden="true"
          >
            1
          </span>
          <span>
            <strong className="font-semibold text-foreground">
              {t("item1Title")}
            </strong>{" "}
            {t("item1Body")}
          </span>
        </li>
        <li className="flex gap-3">
          <span
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground"
            aria-hidden="true"
          >
            2
          </span>
          <span>
            <strong className="font-semibold text-foreground">
              {t("item2Title")}
            </strong>{" "}
            {t("item2Body")}
          </span>
        </li>
      </ol>

      <div className="flex items-start gap-2">
        <Checkbox
          id={CHECKBOX_ID}
          checked={acknowledged}
          onCheckedChange={(value) => setDisclaimerAcknowledged(value === true)}
          data-testid="disclaimer-checkbox"
        />
        <Label
          htmlFor={CHECKBOX_ID}
          className="text-sm leading-snug font-normal"
        >
          {t("checkbox")}
        </Label>
      </div>

      <Button
        size="lg"
        disabled={!acknowledged}
        onClick={() => router.push(stepPath("student"))}
        data-testid="disclaimer-continue"
      >
        {tSteps("continue")}
      </Button>
    </section>
  );
}
