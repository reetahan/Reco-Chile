"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { hydrateWizardStore, useWizardStore } from "@/lib/store/wizard";

import { stepPath, WELCOME_PATH } from "./steps";

const CHECKBOX_ID = "disclaimer-acknowledge";

/**
 * The "Before we continue" consent page — screen 2 of the front door,
 * between the welcome page's Yes/No choice and step 1.
 *
 * The checkbox is a direct, controlled view of the store's
 * `disclaimerAcknowledged` flag rather than local state: checking it writes
 * the flag immediately, so a family who already agreed once (e.g. they used
 * "change answer" to flip the welcome choice and came back through here)
 * finds it pre-checked, and Continue only reads the flag it already wrote. The
 * flag, together with `listExists`, is what `canEnterStep(1)` requires — a
 * deep link here without the welcome answer bounces to the welcome page, the
 * same way a deep link to step 1 would.
 *
 * No stepper and no Back/Continue bar: like the welcome page, this sits
 * outside the `(wizard)` route group, so it never mounts `WizardShell` and
 * never reads `/meta`.
 */
export function DisclaimerScreen() {
  const t = useTranslations("app.disclaimer");
  // Reuses the wizard's own "Continue" label rather than a duplicate string.
  const tSteps = useTranslations("steps");
  const router = useRouter();

  const hydrated = useWizardStore((state) => state.hydrated);
  const listExists = useWizardStore((state) => state.listExists);
  const acknowledged = useWizardStore((state) => state.disclaimerAcknowledged);
  const setDisclaimerAcknowledged = useWizardStore(
    (state) => state.setDisclaimerAcknowledged,
  );

  React.useEffect(() => {
    void hydrateWizardStore();
  }, []);

  const blocked = hydrated && listExists === null;

  React.useEffect(() => {
    if (blocked) router.replace(WELCOME_PATH);
  }, [blocked, router]);

  if (blocked) return null;

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
