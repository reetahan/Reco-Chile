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
 * One row of the starter-picks phase's suggestion list: a starter pick itself
 * (`isStarter`, always addable) or a candidate `/recommend` proposed. Unlike
 * {@link "../improve/recommendation-card"}'s checkbox-then-submit pattern, this
 * adds immediately — the family reviews a shorter, less familiar list here,
 * with no separate "submit" step to forget.
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
