"use client";

import { useLocale, useTranslations } from "next-intl";

import { formatProgramLocation } from "@/components/list/program-location";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { RecommendationItem } from "@/lib/api/types";
import {
  formatDistanceKm,
  formatPercent,
  isFiniteNumber,
} from "@/lib/recommendations";

/**
 * One suggested program.
 *
 * The card shows what a family decides on: the school, where
 * it is, the program, how far away it is, and *the one number that answers
 * "should I add this"* — the chance of actually being assigned to it if it goes
 * on the end of the list. Gone with the text: the before→after unmatched-risk
 * sentence, the conditional "chance if you reach this preference", the "why it
 * appears" line and the "View calculation details" popover (capacity,
 * applicants per seat, estimated lottery rank).
 *
 * The chance is `final_chance_if_appended` — computed by the engine as
 * `current_unmatched_risk * chance_if_considered` and put on the wire for this
 * (the frontend never multiplies two probabilities). `appended_wish_rank`
 * names the position it assumes, so the card can say *which* preference the
 * number belongs to instead of leaving the family to infer it.
 *
 * `risk_level` no longer colours an alert, but it stays on the element as a
 * data attribute: it is the engine's own banding, and dropping it from the DOM
 * would take the parity hook with it.
 *
 * The optional lines are dropped rather than dashed when their value is
 * missing. The location line is the one deliberate exception: it always
 * renders, because a school name without its commune and
 * region cannot be looked up or told apart from its namesakes.
 */
export function RecommendationCard({
  item,
  appendedWishRank,
  selected,
  onSelectedChange,
}: {
  item: RecommendationItem;
  /** `appended_wish_rank` of the same response — the position
   * `final_chance_if_appended` assumes. */
  appendedWishRank: number | null;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();

  // Commune *and* region, always. A suggestion is a school
  // you have never heard of by definition, and dozens of Chilean schools share
  // a name across communes — the card title alone cannot identify one. Built by
  // the same helper the step-2 rows use, so both steps disambiguate alike.
  const location =
    formatProgramLocation(item.school_commune, item.region) ||
    t("improve.card.noInformation");

  const distance = formatDistanceKm(item.distance_km, locale);
  const showChance =
    isFiniteNumber(item.final_chance_if_appended) && appendedWishRank !== null;

  // A candidate the API could not map back to a `program_id` cannot be appended
  // to the list, which stores ids only. It is still shown — it is a real
  // suggestion the family may add by hand — but its checkbox is inert.
  const selectable =
    typeof item.program_id === "string" && item.program_id !== "";
  const checkboxId = `recommendation-${item.program_id ?? item.program_label}`;

  return (
    <Card
      data-testid="recommendation-card"
      data-program-id={item.program_id ?? ""}
      data-risk-level={item.risk_level}
    >
      <CardHeader>
        <CardTitle className="text-base">{item.school_name}</CardTitle>
        <CardDescription data-testid="recommendation-location">
          {location}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {item.program_display_name.trim() !== "" ? (
          <p className="text-sm">{item.program_display_name}</p>
        ) : null}

        {distance !== null ? (
          <p className="text-xs text-muted-foreground">
            {t("improve.distance.approx", { distance })}
          </p>
        ) : null}

        {showChance ? (
          <div
            className="flex flex-col gap-0.5 rounded-lg bg-muted/60 p-3"
            data-testid="recommendation-chance"
          >
            <span className="text-sm text-muted-foreground">
              {t("improve.card.chanceAppended", { rank: appendedWishRank })}
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {formatPercent(item.final_chance_if_appended, locale)}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("improve.card.chanceNote")}
            </span>
          </div>
        ) : null}

        <div className="flex items-start gap-2 border-t border-border pt-3">
          <Checkbox
            id={checkboxId}
            checked={selected}
            disabled={!selectable}
            onCheckedChange={(value) => onSelectedChange(value === true)}
            data-testid="recommendation-select"
          />
          <Label
            htmlFor={checkboxId}
            className="text-sm leading-snug font-normal"
          >
            {t("improve.card.add")}
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
