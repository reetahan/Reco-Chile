"use client";

/**
 * "Show me more info on my matching odds" — a disclosure attached to the
 * bottom of the main outcome card. Mini-cards for the #2 and #3 most likely
 * outcomes, plus (only in ties mode) the order used to compute the result and
 * how it compares to the other compatible orders.
 */

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { EstimatedOutcome, SimulationResponse } from "@/lib/api/types";
import { formatInt, formatPercent } from "@/lib/format";

import { EquivalenceOrderCard } from "./equivalence-order-card";
import { UNMATCHED, useResultLabels, type ResultLabels } from "./labels";
import { OutcomeBox } from "./outcome-box";
import { otherOutcomes } from "./outcome-shares";

export function MoreOdds({ simulation }: { simulation: SimulationResponse }) {
  const t = useTranslations("result.moreOdds");
  const [open, setOpen] = React.useState(false);
  const labels = useResultLabels(simulation);

  const others = otherOutcomes(simulation.outcomes);
  const hasTieInfo = simulation.equivalence_sensitivity != null;
  if (others.length === 0 && !hasTieInfo) {
    return <OutcomeBox simulation={simulation} />;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid="more-odds">
      <OutcomeBox
        simulation={simulation}
        moreOddsTrigger={
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              data-testid="more-odds-trigger"
              className="h-auto w-full justify-start gap-2 rounded-none border-t px-(--card-spacing) py-3 text-left font-normal whitespace-normal"
            >
              <ChevronDownIcon
                aria-hidden="true"
                className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              />
              <span>{t("trigger")}</span>
            </Button>
          </CollapsibleTrigger>
        }
      />
      <CollapsibleContent
        data-testid="more-odds-content"
        className="flex flex-col gap-4 pt-4"
      >
        {others.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {others.map((outcome, index) => (
              <OutcomeMiniCard
                key={outcome.program_id ?? outcome.label}
                outcome={outcome}
                slotRank={index + 2}
                labels={labels}
              />
            ))}
          </div>
        ) : null}

        {simulation.equivalence_sensitivity ? (
          <EquivalenceOrderCard
            simulation={simulation}
            sensitivity={simulation.equivalence_sensitivity}
            labels={labels}
          />
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One of the #2 / #3 cards — the same fields as the main outcome box, smaller. */
function OutcomeMiniCard({
  outcome,
  slotRank,
  labels,
}: {
  outcome: EstimatedOutcome;
  slotRank: number;
  labels: ResultLabels;
}) {
  const t = useTranslations("result");
  const locale = useLocale();
  const unmatched = outcome.label === UNMATCHED;
  const wish = unmatched ? undefined : labels.wishFor(outcome);
  const location = unmatched ? "" : labels.location(outcome.program_id);

  return (
    <Card data-testid="outcome-mini-card" data-rank={slotRank}>
      <CardContent className="flex flex-col gap-1 py-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("moreOdds.rankTitle", { rank: slotRank })}
        </p>
        <p
          className="text-sm font-semibold text-balance"
          data-testid="mini-card-school"
        >
          {labels.outcome(outcome.label)}
        </p>
        {location === "" ? null : (
          <p
            className="text-xs text-muted-foreground"
            data-testid="mini-card-location"
          >
            {location}
          </p>
        )}
        {wish ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="mini-card-rank"
          >
            {t("headline.preferenceRank", {
              rank: formatInt(wish.wish_rank, locale),
            })}
          </p>
        ) : null}
        <p className="text-sm font-medium" data-testid="mini-card-chance">
          {t("outcome.chance", {
            chance: formatPercent(outcome.probability, locale),
          })}
        </p>
      </CardContent>
    </Card>
  );
}
