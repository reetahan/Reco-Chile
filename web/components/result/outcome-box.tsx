"use client";

/**
 * The whole of step 3's result, in one box: the single question a family
 * arrives with — where am I most likely to end up, and how likely is that.
 * Numbers come straight from `/simulate`.
 *
 * **It reads `outcomes[0]`, not `predicted_outcome`.** `predicted_outcome`
 * flips to "Unmatched" once the unmatched risk hits `HARD_UNMATCHED_THRESHOLD`
 * (an alert trigger, not an argmax); `outcomes[]` is sorted by probability and
 * includes `Unmatched`, so its first entry is genuinely the most likely one.
 *
 * Two shapes, because the top outcome has two: a program (with commune and
 * region — many Chilean schools share a name) or `Unmatched`. The unmatched
 * shape is the sentence alone — no percentage, because "you receive none of
 * them" over "Estimated chance: 100.0%" reads as a 100% chance of a place.
 */

import { CircleCheckIcon, InfoIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import type { SimulationResponse } from "@/lib/api/types";
import { formatInt, formatPercent } from "@/lib/format";

import { useResultLabels } from "./labels";

/** The engine's outcome code for "none of the listed programs". */
const UNMATCHED = "Unmatched";

export function OutcomeBox({ simulation }: { simulation: SimulationResponse }) {
  const t = useTranslations("result");
  const locale = useLocale();
  const labels = useResultLabels(simulation);

  // The engine always appends `Unmatched`, so the list is never empty; the
  // guard is for a response shape that has drifted, not one the API produces.
  const top = simulation.outcomes.at(0);
  const unmatched = top === undefined || top.label === UNMATCHED;

  // The wish the top school sits at — matched by id, the wire's join key; the
  // label is only a fallback for a response that carries no id.
  const predictedWish = unmatched
    ? undefined
    : simulation.wishes.find((wish) =>
        top.program_id
          ? wish.program_id === top.program_id
          : wish.program_label === top.label,
      );
  // Only the program shape prints this; the fallback matters for the
  // impossible empty-outcomes case, which takes the unmatched branch anyway.
  const chance = top?.probability ?? simulation.unmatched_risk;
  const location = unmatched ? "" : labels.location(top.program_id);

  return (
    <Card data-testid="result-outcome">
      <CardContent className="flex flex-col gap-5 py-2">
        {unmatched ? (
          <p
            className="text-lg font-medium text-balance"
            data-testid="predicted-unmatched"
          >
            {t("headline.unmatchedBody")}
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2 font-medium">
              <CircleCheckIcon
                aria-hidden="true"
                className="size-5 shrink-0 text-primary"
              />
              {t("outcome.title")}
            </p>

            <div className="flex flex-col gap-1">
              <p
                className="text-xl font-semibold text-balance sm:text-2xl"
                data-testid="predicted-school"
              >
                {labels.outcome(top.label)}
              </p>
              {location === "" ? null : (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="predicted-location"
                >
                  {location}
                </p>
              )}
              {predictedWish ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="predicted-rank"
                >
                  {t("headline.preferenceRank", {
                    rank: formatInt(predictedWish.wish_rank, locale),
                  })}
                </p>
              ) : null}
            </div>

            <p className="text-base font-medium" data-testid="predicted-chance">
              {t("outcome.chance", {
                chance: formatPercent(chance, locale),
              })}
            </p>
          </>
        )}
      </CardContent>

      <CardFooter className="gap-2 text-sm text-muted-foreground">
        <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
        <span data-testid="estimate-note">{t("outcome.disclaimer")}</span>
      </CardFooter>
    </Card>
  );
}
