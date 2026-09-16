"use client";

/** The order used to break the tie, plus how often other orders agreed. */

import { useLocale, useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  EquivalenceSensitivity,
  SimulationResponse,
} from "@/lib/api/types";
import { formatInt, formatPercent } from "@/lib/format";

import type { ResultLabels } from "./labels";
import { topOutcomeShares } from "./outcome-shares";

/** Past this many rows the ordered list scrolls instead of growing the page. */
const SCROLL_AFTER_ROWS = 6;

export function EquivalenceOrderCard({
  simulation,
  sensitivity,
  labels,
}: {
  simulation: SimulationResponse;
  sensitivity: EquivalenceSensitivity;
  labels: ResultLabels;
}) {
  const t = useTranslations("result.moreOdds");
  const locale = useLocale();
  const shares = topOutcomeShares(sensitivity.variants);
  const scrolls = simulation.wishes.length > SCROLL_AFTER_ROWS;

  return (
    <Card data-testid="equivalence-order-card">
      <CardHeader>
        <CardTitle>{t("orderTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("orderNote")}</p>
        <ol
          className={`flex list-decimal flex-col gap-1.5 pl-5 text-sm ${
            scrolls ? "max-h-56 overflow-y-auto" : ""
          }`}
          data-testid="equivalence-order-list"
        >
          {simulation.wishes.map((wish) => (
            <li key={wish.program_id} data-testid="equivalence-order-item">
              <span className="font-medium">{wish.program_label}</span>{" "}
              <span className="text-muted-foreground">
                {labels.location(wish.program_id)}
              </span>
            </li>
          ))}
        </ol>

        <p className="text-sm text-muted-foreground">
          {t("ordersChecked", {
            n: formatInt(sensitivity.total_orders, locale),
          })}
        </p>

        <ul className="flex flex-col gap-1 text-sm">
          {shares.map((row) => (
            <li
              key={row.programId ?? row.label}
              data-testid="outcome-share-row"
            >
              {t("topChoiceShare", {
                outcome: labels.outcome(row.label),
                share: formatPercent(row.share, locale),
              })}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
