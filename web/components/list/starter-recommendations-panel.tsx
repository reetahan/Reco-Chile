"use client";

/**
 * Guided branch, phase 2: `/recommend` fed by the starter picks (no home
 * address or existing list needed). Up to `STARTER_RECOMMENDATIONS_TOTAL`
 * rows — starter picks first, then the engine's suggestions — each with its
 * own "Add" button so an already-added program isn't offered twice.
 */

import * as React from "react";
import { useTranslations } from "next-intl";

import { useMeta } from "@/lib/meta";
import { usePrograms } from "@/lib/programs";
import { useRecommendations } from "@/lib/recommendations";
import {
  makeWish,
  STARTER_RECOMMENDATIONS_TOTAL,
  useWizardStore,
} from "@/lib/store/wizard";

import { apiErrorMessage } from "../improve/api-error";
import { ToneAlert } from "../improve/tone-alert";
import { formatProgramLocation } from "./program-location";
import { StarterRecommendationCard } from "./starter-recommendation-card";

const MIN_BACKEND_RECOMMENDATIONS = 2;
const MAX_BACKEND_RECOMMENDATIONS = 15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function StarterRecommendationsPanel() {
  const t = useTranslations();
  const meta = useMeta();

  const starterPicks = useWizardStore((state) => state.starterPicks);
  const wishes = useWizardStore((state) => state.wishes);
  const addWish = useWizardStore((state) => state.addWish);

  const starterWishes = React.useMemo(
    () => starterPicks.map((id) => makeWish(id)),
    [starterPicks],
  );
  const requestCount = clamp(
    STARTER_RECOMMENDATIONS_TOTAL - starterPicks.length,
    MIN_BACKEND_RECOMMENDATIONS,
    MAX_BACKEND_RECOMMENDATIONS,
  );

  const { data, loading, error } = useRecommendations({
    wishes: starterWishes,
    maxRecommendations: requestCount,
  });

  const { programs: starterPrograms } = usePrograms(starterPicks);
  const wishIds = React.useMemo(
    () => new Set(wishes.map((wish) => wish.programId)),
    [wishes],
  );
  const atMaxWishes = wishes.length >= meta.max_wishes;

  const items = data?.items ?? [];
  const hasResponse = data !== null;
  const showSkeleton = loading && !hasResponse;

  function handleAdd(programId: string) {
    addWish(programId);
  }

  return (
    <section
      className="flex flex-col gap-3"
      data-testid="starter-recommendations-panel"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">
          {t("list.starters.suggestionsTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("list.starters.suggestionsIntro")}
        </p>
      </div>

      {error !== null ? (
        <ToneAlert
          tone="destructive"
          data-testid="starter-recommendations-error"
        >
          {apiErrorMessage(t, error)}
        </ToneAlert>
      ) : null}

      {atMaxWishes ? (
        <p
          className="text-sm text-destructive"
          data-testid="starter-max-wishes"
        >
          {t("list.notices.maxWishes", { max: meta.max_wishes })}
        </p>
      ) : null}

      <div
        className="flex max-h-[36rem] flex-col gap-3 overflow-y-auto rounded-xl border border-border p-3"
        data-testid="starter-recommendations-list"
      >
        {starterPicks.map((id) => {
          const program = starterPrograms.get(id);
          return (
            <StarterRecommendationCard
              key={id}
              programId={id}
              schoolName={program?.school_name ?? program?.program_label ?? id}
              location={
                program
                  ? formatProgramLocation(
                      program.school_commune,
                      program.region,
                    )
                  : ""
              }
              programDisplayName={program?.program_display_name ?? ""}
              isStarter
              added={wishIds.has(id)}
              disabled={atMaxWishes}
              onAdd={() => handleAdd(id)}
            />
          );
        })}

        {items.map((item) => (
          <StarterRecommendationCard
            key={item.program_id ?? item.program_label}
            programId={item.program_id}
            schoolName={item.school_name}
            location={formatProgramLocation(item.school_commune, item.region)}
            programDisplayName={item.program_display_name}
            added={item.program_id !== null && wishIds.has(item.program_id)}
            disabled={atMaxWishes || item.program_id === null}
            onAdd={() => item.program_id && handleAdd(item.program_id)}
          />
        ))}

        {showSkeleton ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <div className="h-32 w-full animate-pulse rounded-lg bg-muted" />
            <div className="h-32 w-full animate-pulse rounded-lg bg-muted" />
          </div>
        ) : null}

        {hasResponse && items.length === 0 ? (
          <ToneAlert tone="warning" data-testid="starter-recommendations-empty">
            {t("improve.empty.noSimilar")}
          </ToneAlert>
        ) : null}
      </div>
    </section>
  );
}
