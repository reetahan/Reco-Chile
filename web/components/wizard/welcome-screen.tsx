"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { hydrateWizardStore, useWizardStore } from "@/lib/store/wizard";

import { DISCLAIMER_PATH } from "./steps";

/**
 * The welcome page — the wizard's front door.
 *
 * Almost blank on purpose: the positive framing sentence as the headline, the
 * reassurance under it, and the one question that used to be asked with a
 * radio inside step 1. Answering it here is half of what unlocks step 1
 * (`canEnterStep(1)` → `hasListChoice` — the other half is the consent
 * checkbox on `DisclaimerScreen`, which is where both buttons send the
 * family next), so the two buttons are the step guard's redirect target
 * while the answer is missing.
 *
 * No stepper and no Back/Continue bar: this page sits outside the `(wizard)`
 * route group, so it never mounts `WizardShell` — and it never reads `/meta`
 * either, which keeps the front door up when the API is not.
 *
 * ## Why it rehydrates the store
 *
 * `WizardShell` is what normally calls `hydrateWizardStore()`, and it is not
 * mounted here. Without the call, a *cold* load of `/es` would leave the store
 * at its empty defaults while `sessionStorage` still holds a list, and the
 * first button press — every `set` writes through the persist middleware —
 * would overwrite that list with `[]`. Reading the session back first makes the
 * press a pure change of `listExists`. Storage is synchronous, so this settles
 * within the mount effect, long before anyone can click.
 */
export function WelcomeScreen() {
  const t = useTranslations("app.welcome");
  const router = useRouter();
  const setListExists = useWizardStore((state) => state.setListExists);

  React.useEffect(() => {
    void hydrateWizardStore();
  }, []);

  function choose(listExists: boolean) {
    setListExists(listExists);
    router.push(DISCLAIMER_PATH);
  }

  return (
    <section
      className="mx-auto flex max-w-xl flex-col gap-10 py-10 sm:py-16"
      data-testid="welcome"
    >
      <header className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t("headline")}
        </h1>
      </header>

      <div className="flex flex-col gap-4">
        {/* Names the pair of buttons for a screen reader: "Yes"/"No" only mean
            something together with the question. */}
        <p id="welcome-question" className="text-sm font-medium">
          {t("question")}
        </p>
        <div
          className="flex flex-col gap-3 sm:flex-row"
          role="group"
          aria-labelledby="welcome-question"
        >
          <Button
            size="lg"
            className="sm:flex-1"
            data-testid="welcome-yes"
            onClick={() => choose(true)}
          >
            {t("yes")}
          </Button>
          <Button
            size="lg"
            className="sm:flex-1"
            data-testid="welcome-no"
            onClick={() => choose(false)}
          >
            {t("no")}
          </Button>
        </div>
      </div>
    </section>
  );
}
