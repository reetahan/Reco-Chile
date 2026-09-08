"use client";

import * as React from "react";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  PrinterIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatProgramLocation } from "@/components/list/program-location";
import { OutcomeBox } from "@/components/result/outcome-box";
import { Link, useRouter } from "@/i18n/navigation";
import { maskStudentId } from "@/lib/format";
import { useMetaOptional } from "@/lib/meta";
import { usePrograms } from "@/lib/programs";
import { hasFreshSimulation, useWizardStore } from "@/lib/store/wizard";

import { stepPath, WELCOME_PATH } from "./steps";

/**
 * The read-only takeaway reached from the result step's "Finish": the same
 * outcome box shown on step 3, then the final ordered list. "Save as PDF" is
 * `window.print()` against the `@media print` block in globals.css; the wizard
 * is cleared only here, by "back to the start". Guarded on a fresh simulation,
 * so a stale result shows the prompt instead of the box.
 *
 * The RUN/IPE is shown masked so a printout never carries the full identifier.
 */
export function FinishScreen() {
  const t = useTranslations("app.finish");
  const locale = useLocale();
  const router = useRouter();
  const meta = useMetaOptional();

  const wishes = useWizardStore((state) => state.wishes);
  const studentId = useWizardStore((state) => state.studentId);
  const simulation = useWizardStore((state) => state.simulation);
  const fresh = useWizardStore(hasFreshSimulation);
  const reset = useWizardStore((state) => state.reset);

  const programIds = React.useMemo(
    () => wishes.map((wish) => wish.programId),
    [wishes],
  );
  const { programs } = usePrograms(programIds);

  const maskedId = maskStudentId(studentId);

  // Differs between the server render and the reader's clock, hence suppressed.
  const generatedOn = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
  }).format(new Date());
  const dataVersion = meta?.data_fingerprint.slice(0, 8) ?? null;

  function startOver() {
    reset();
    // `replace` so the cleared wizard is not one Back press away.
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
        {maskedId === "" ? null : (
          <p
            className="text-sm text-muted-foreground"
            data-testid="finish-student-id"
          >
            {t("studentIdLabel")}:{" "}
            <span className="tabular-nums">{maskedId}</span>
          </p>
        )}
      </header>

      <div className="flex flex-wrap gap-3 print:hidden">
        <Button
          size="lg"
          onClick={() => {
            window.print();
          }}
          data-testid="finish-print"
        >
          <PrinterIcon aria-hidden="true" data-icon="inline-start" />
          {t("print")}
        </Button>
      </div>

      {fresh && simulation ? (
        <OutcomeBox simulation={simulation} />
      ) : (
        <Card>
          <CardContent>
            <p className="text-sm" data-testid="finish-result-stale">
              {t("staleNote")}
            </p>
          </CardContent>
        </Card>
      )}

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

      <p
        className="text-xs text-muted-foreground"
        data-testid="finish-generated"
        suppressHydrationWarning
      >
        {dataVersion === null
          ? t("generatedOn", { date: generatedOn })
          : t("generatedOnWithVersion", {
              date: generatedOn,
              version: dataVersion,
            })}
      </p>

      <div className="flex flex-col gap-3 sm:flex-row print:hidden">
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
          {t("backToStart")}
        </Button>
      </div>
    </section>
  );
}
