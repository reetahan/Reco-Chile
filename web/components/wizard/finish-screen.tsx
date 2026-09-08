"use client";

import * as React from "react";
import { ArrowLeftIcon, CheckCircle2Icon, RotateCcwIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatProgramLocation } from "@/components/list/program-location";
import { Link, useRouter } from "@/i18n/navigation";
import { formatPercent } from "@/lib/format";
import { usePrograms } from "@/lib/programs";
import { hasFreshSimulation, useWizardStore } from "@/lib/store/wizard";

import { stepPath, WELCOME_PATH } from "./steps";

/**
 * The completion page — "Finish" from the result step.
 *
 * It is an ending, not a fifth step: no stepper marker, no Continue, and the
 * only ways on from here are back to the result or a clean start. What it shows
 * is what a family needs to carry away — the list they settled on, the one
 * number that matters, and the reminder that nothing here was submitted.
 *
 * Read-only throughout: the wish list is rendered from the store's wishes with
 * labels resolved through `usePrograms` (the store holds only `program_id`s,
 *), and no control on this page can reorder or remove anything.
 *
 * The chance is `1 − unmatched_risk`, formatted by `@/lib/format` exactly like
 * the result step formats it — the engine stays the only source of the number
 *, and this page recomputes nothing but that one subtraction. It is shown
 * only while the stored simulation still matches the current inputs; a stale
 * one would print a number for a list the family has since changed.
 */
export function FinishScreen() {
  const t = useTranslations("app.finish");
  const locale = useLocale();
  const router = useRouter();

  const wishes = useWizardStore((state) => state.wishes);
  const simulation = useWizardStore((state) => state.simulation);
  const fresh = useWizardStore(hasFreshSimulation);
  const reset = useWizardStore((state) => state.reset);

  const programIds = React.useMemo(
    () => wishes.map((wish) => wish.programId),
    [wishes],
  );
  const { programs } = usePrograms(programIds);

  const chance = fresh && simulation ? 1 - simulation.unmatched_risk : null;

  function startOver() {
    reset();
    // `replace`, not `push`: the wizard the family just cleared must not be one
    // Back press away. The guard would send them here anyway — `reset()` clears
    // `listExists` — but doing it explicitly keeps the history clean.
    router.replace(WELCOME_PATH);
  }

  return (
    <section className="flex flex-col gap-8 py-4" data-testid="finish">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-balance">
          <CheckCircle2Icon
            className="size-6 shrink-0 text-primary"
            aria-hidden="true"
          />
          {t("title")}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">{t("lead")}</p>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{t("chanceLabel")}</p>
          {chance === null ? (
            <p className="text-sm" data-testid="finish-chance-stale">
              {t("staleNote")}
            </p>
          ) : (
            <p
              className="text-3xl font-semibold tracking-tight tabular-nums"
              data-testid="finish-chance"
            >
              {formatPercent(chance, locale)}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {wishes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("listEmpty")}</p>
          ) : (
            <ol className="flex flex-col gap-3" data-testid="finish-list">
              {wishes.map((wish, index) => {
                const program = programs.get(wish.programId);
                return (
                  <li
                    key={wish.programId}
                    className="flex items-start gap-3"
                    data-testid="finish-wish"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-muted-foreground"
                    >
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      {program ? (
                        <>
                          <span className="text-sm font-medium">
                            {program.program_label}
                          </span>
                          {/* Commune and region on every program listing —
                              two schools can share a name. Built by
                              the one helper that owns that line, so a blank or
                              `nan` column never prints as " · ". */}
                          <span className="text-xs text-muted-foreground">
                            {formatProgramLocation(
                              program.school_commune,
                              program.region,
                            ) || t("locationUnknown")}
                          </span>
                        </>
                      ) : (
                        <Skeleton className="h-4 w-56" />
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <Alert data-testid="finish-official">
        <AlertDescription>{t("official")}</AlertDescription>
      </Alert>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" asChild data-testid="finish-back">
          <Link href={stepPath("result")}>
            <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
            {t("backToResult")}
          </Link>
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={startOver}
          data-testid="finish-start-over"
        >
          <RotateCcwIcon aria-hidden="true" data-icon="inline-start" />
          {t("startOver")}
        </Button>
      </div>
    </section>
  );
}
