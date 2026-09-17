"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import {
  hydrateWizardStore,
  selectCanContinue,
  selectCanEnterStep,
  useWizardStore,
} from "@/lib/store/wizard";

import { stepPath } from "./steps";

/**
 * "Do you already have your preference list?" — asked after step 1 (the
 * RUN/IPE) instead of before it, so both paths start the same way.
 *
 * Guards on step 1 being complete (disclaimer + a valid identifier); a family
 * that lands here without it is sent back to step 1.
 *
 * No stepper and no Back/Continue bar: outside the `(wizard)` route group,
 * like the front door.
 */
export function ListChoiceScreen() {
  const t = useTranslations("app.listChoice");
  const router = useRouter();

  const hydrated = useWizardStore((state) => state.hydrated);
  const canEnterStudent = useWizardStore(selectCanEnterStep(1));
  const canContinueStudent = useWizardStore(selectCanContinue(1));
  const setListExists = useWizardStore((state) => state.setListExists);

  React.useEffect(() => {
    void hydrateWizardStore();
  }, []);

  const blocked = hydrated && !(canEnterStudent && canContinueStudent);

  React.useEffect(() => {
    if (blocked) router.replace(stepPath("student"));
  }, [blocked, router]);

  if (blocked) return null;

  function choose(listExists: boolean) {
    setListExists(listExists);
    router.push(stepPath("list"));
  }

  return (
    <section
      className="mx-auto flex max-w-xl flex-col gap-10 py-10 sm:py-16"
      data-testid="list-choice"
    >
      <header className="flex flex-col gap-4">
        <h1
          id="list-choice-headline"
          className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
        >
          {t("headline")}
        </h1>
      </header>

      <div
        className="flex flex-col gap-3 sm:flex-row"
        role="group"
        aria-labelledby="list-choice-headline"
      >
        <Button
          size="lg"
          className="sm:flex-1"
          data-testid="list-choice-yes"
          onClick={() => choose(true)}
        >
          {t("yes")}
        </Button>
        <Button
          size="lg"
          className="sm:flex-1"
          data-testid="list-choice-no"
          onClick={() => choose(false)}
        >
          {t("no")}
        </Button>
      </div>
    </section>
  );
}
