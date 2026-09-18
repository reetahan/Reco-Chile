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
 * One suggested program: the school, where it is, the program, how far away
 * it is, and the chance of being assigned to it if appended
 * (`final_chance_if_appended`, computed by the engine — never recomputed here).
 *
 * The distance line only shows when measured from an actual home address
 * (`distanceReference === "home"`); without one it's measured from the
 * family's wishlist instead, a number with no plain-language meaning to show.
 *
 * The location line always renders, even with no other data: a school name
 * alone can't be told apart from schools sharing that name elsewhere.
 */
export function RecommendationCard({
  item,
  appendedWishRank,
  distanceReference,
  selected,
  onSelectedChange,
}: {
  item: RecommendationItem;
  /** `appended_wish_rank` of the same response — the position
   * `final_chance_if_appended` assumes. */
  appendedWishRank: number | null;
  /** `distance_reference` of the same response — "home" or "list" on the
   * wire, typed loosely there since it's a plain `str`, not a literal. */
  distanceReference: string | null;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();

  // Commune and region, always: dozens of Chilean schools share a name.
  const location =
    formatProgramLocation(item.school_commune, item.region) ||
    t("improve.card.noInformation");

  const distance =
    distanceReference === "home"
      ? formatDistanceKm(item.distance_km, locale)
      : null;
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
      // `shrink-0`: `Card`'s own `overflow-hidden` makes its flex min-height
      // resolve to 0, so without this the cards inside the scrolling list
      // below get squeezed to fit instead of scrolling.
      className="shrink-0"
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
