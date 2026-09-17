"use client";

import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * One row of the starter-picks suggestion list: a starter pick (`isStarter`)
 * or a `/recommend` candidate. Adds immediately on click, unlike
 * `RecommendationCard`'s checkbox-then-submit pattern.
 */
export function StarterRecommendationCard({
  programId,
  schoolName,
  location,
  programDisplayName,
  isStarter = false,
  added,
  disabled,
  onAdd,
}: {
  programId: string | null;
  schoolName: string;
  location: string;
  programDisplayName: string;
  isStarter?: boolean;
  added: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  const t = useTranslations();

  return (
    <Card
      // `shrink-0`: `Card`'s own `overflow-hidden` makes its flex min-height
      // resolve to 0, so without this a tall stack of cards inside the
      // scrolling container below gets squeezed to fit instead of scrolling.
      className="shrink-0"
      data-testid="starter-recommendation-card"
      data-program-id={programId ?? ""}
      data-starter={isStarter ? "true" : "false"}
    >
      <CardHeader>
        <CardTitle className="text-base">{schoolName}</CardTitle>
        {location !== "" ? <CardDescription>{location}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {programDisplayName.trim() !== "" ? (
          <p className="text-sm">{programDisplayName}</p>
        ) : null}
        {isStarter ? (
          <p className="text-xs text-muted-foreground">
            {t("list.starters.yourPick")}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={disabled || added || programId === null}
          onClick={onAdd}
          data-testid="starter-recommendation-add"
        >
          {added ? t("list.starters.added") : t("list.starters.add")}
        </Button>
      </CardContent>
    </Card>
  );
}
