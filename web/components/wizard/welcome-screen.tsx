"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

import { DISCLAIMER_PATH } from "./steps";

/**
 * The welcome page — the wizard's front door. Just the headline and a single
 * Continue button; the "do you already have your list?" question is asked
 * later, after step 1 (`ListChoiceScreen`), so both paths start the same way.
 *
 * No stepper and no Back/Continue bar: this sits outside the `(wizard)` route
 * group, so it never mounts `WizardShell` and never reads `/meta`.
 */
export function WelcomeScreen() {
  const t = useTranslations("app.welcome");
  const tSteps = useTranslations("steps");
  const router = useRouter();

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

      <Button
        size="lg"
        data-testid="welcome-continue"
        onClick={() => router.push(DISCLAIMER_PATH)}
      >
        {tSteps("continue")}
      </Button>
    </section>
  );
}
