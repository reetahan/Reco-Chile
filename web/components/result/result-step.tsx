"use client";

/**
 * Step 3 — review the result.
 *
 * The step runs `/simulate` on entry whenever the stored result is stale, then
 * renders exactly two things:
 *
 * the outcome box (most likely school, its location, which preference it is,
 * the estimated chance, and the historical-data caveat)
 * -> the finish / improve choice
 *
 * Earlier designs showed attention-level alerts and, below the headline, the overall assignment figure and unmatched
 * risk, the outcome list, the per-preference family table, the equivalence
 * sensitivity block and the detailed calculation. The page now answers one
 * question — where am I most likely to end up, and how likely is that.
 *
 * Note that the branch on `useEquivalenceClasses` is gone with it: the box is
 * the same in both modes, so the store flag no longer changes what step 3
 * draws. `ResultSummary`, `FamilyChanceTable`, `EquivalenceBlock`,
 * `DetailTable`, `PagedRows`, `ProgramLine` and `tied-order.ts` are unrendered
 * as of this change and kept only so the decision can be reversed cheaply.
 */

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { StepPage } from "@/components/wizard/step-page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSimulation } from "@/lib/simulation";
import type { SimulationError } from "@/lib/simulation/use-simulation";
import { useWizardStore } from "@/lib/store/wizard";

import { OutcomeBox } from "./outcome-box";
import { ResultActions } from "./result-actions";

export function ResultStep() {
  const { simulation, loading, error, retry } = useSimulation();

  const hasStudentId = useWizardStore((state) => state.studentId.trim() !== "");
  const hasWishes = useWizardStore((state) => state.wishes.length > 0);

  return (
    // No lead sentence: "the model uses historical 2024 calibration data…"
    // said the same thing as the box's own caveat, one line above it. The
    // caveat now lives in the box, where the number it qualifies is.
    <StepPage slug="result" lead={null}>
      {error ? (
        <SimulationErrorAlert error={error} onRetry={retry} />
      ) : loading ? (
        <ResultSkeleton />
      ) : simulation ? (
        <div className="flex flex-col gap-8">
          <OutcomeBox simulation={simulation} />
          <ResultActions />
        </div>
      ) : (
        // The step guard normally keeps this state unreachable; it is what the
        // family sees if they land here with an incomplete list anyway.
        <MissingInputNotice hasStudentId={hasStudentId} hasWishes={hasWishes} />
      )}
    </StepPage>
  );
}

/** The shape of the result, while `/simulate` is running. */
function ResultSkeleton() {
  const t = useTranslations("result");

  return (
    <div className="flex flex-col gap-6" data-testid="result-loading">
      <span className="sr-only" role="status">
        {t("running")}
      </span>
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

/**
 * A failed `/simulate`. The message is already localized — either from the
 * local catalogue for a known `error_key` (the over-cap 422 among them) or
 * from the API's own `message` — and never contains the request body.
 */
function SimulationErrorAlert({
  error,
  onRetry,
}: {
  error: SimulationError;
  onRetry: () => void;
}) {
  const t = useTranslations();

  return (
    <Alert
      variant="destructive"
      data-testid="result-error"
      data-error-key={error.key}
    >
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>{t("result.errors.title")}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{error.message}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          data-testid="result-retry"
        >
          <RotateCcwIcon aria-hidden="true" data-icon="inline-start" />
          {t("app.error.retry")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** The two "unlock the analysis" captions. */
function MissingInputNotice({
  hasStudentId,
  hasWishes,
}: {
  hasStudentId: boolean;
  hasWishes: boolean;
}) {
  const t = useTranslations();

  return (
    <Alert data-testid="result-missing-input">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertDescription>
        {!hasStudentId
          ? t("errors.studentIdRequired")
          : !hasWishes
            ? t("errors.addValidProgram")
            : t("errors.unexpected")}
      </AlertDescription>
    </Alert>
  );
}
