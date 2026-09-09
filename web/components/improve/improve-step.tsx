"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { FilterPanel } from "@/components/list/filters/filter-panel";
import { StepPage } from "@/components/wizard/step-page";
import { stepNumber, stepPath } from "@/components/wizard/steps";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useRouter } from "@/i18n/navigation";
import type { RecommendationItem } from "@/lib/api/types";
import { useMeta } from "@/lib/meta";
import { isFiniteNumber, useRecommendations } from "@/lib/recommendations";
import {
  MAX_RECOMMENDATION_COUNT,
  MIN_RECOMMENDATION_COUNT,
  useWizardStore,
} from "@/lib/store/wizard";

import { AddressSection } from "./address-section";
import { apiErrorMessage } from "./api-error";
import { RecommendationCard } from "./recommendation-card";
import { ToneAlert } from "./tone-alert";

/**
 * Step 4 — improve the preference list.
 *
 * The page, in order:
 *
 * 1. how many suggestions do you want (a slider, out in the open)
 * 2. improve distance estimates (the optional home address)
 * 3. restrict the suggestions (the step-2 filter panel, shared store slice)
 * 4. the suggestions themselves
 *
 * What went: the current-unmatched-risk card, the "adding at the end costs
 * nothing" note, the "How are these programs selected?" collapsible, and the
 * "Recommendation display settings" collapsible that used to hide the slider.
 * The warnings that report a *failure* stayed — an empty result or an
 * unscoreable candidate still has to say so.
 *
 * The slider is no longer behind a disclosure because it is now the page's
 * opening question, and its default dropped from 5 to 3.
 *
 * Nothing on this page computes a number: `/recommend` returns every figure
 * raw, including `final_chance_if_appended`, which is what each card
 * shows.
 */
export function ImproveStep() {
  const t = useTranslations();
  const router = useRouter();
  const meta = useMeta();

  const wishes = useWizardStore((state) => state.wishes);
  const recommendationCount = useWizardStore(
    (state) => state.recommendationCount,
  );
  const setRecommendationCount = useWizardStore(
    (state) => state.setRecommendationCount,
  );
  const appendRecommendations = useWizardStore(
    (state) => state.appendRecommendations,
  );
  const setPendingNavigation = useWizardStore(
    (state) => state.setPendingNavigation,
  );

  const { data, loading, error } = useRecommendations();

  // Program ids, not positions: the item list is replaced on every refetch, and
  // a family that nudged the slider must not lose what they already ticked.
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const items: RecommendationItem[] = data?.items ?? [];
  // Only what is on screen can be submitted; a tick left over from a wider
  // slider setting is remembered but does not count while it is hidden.
  const selectedVisible = items
    .map((item) => item.program_id)
    .filter((id): id is string => typeof id === "string" && id !== "")
    .filter((id) => selectedIds.has(id));

  function toggle(programId: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(programId);
      else next.delete(programId);
      return next;
    });
  }

  function handleAdd() {
    const existing = new Set(wishes.map((wish) => wish.programId));
    // `selectedVisible` is already in recommendation order, which is the ranking
    // the engine produced — a checkbox records *which* programs were chosen, not
    // an order the family stated (preserved the same
    // way).
    const newIds = selectedVisible.filter((id) => !existing.has(id));

    if (newIds.length === 0) {
      toast.info(t("improve.empty.allAlreadyAdded"));
      return;
    }

    // `MAX_WISHES` is a hard server cap: a longer list is refused by
    // `/simulate`, so the ones that do not fit are dropped here — with the same
    // sentence step 2 shows when the family adds one program too many — instead
    // of being appended into a list that can no longer be analysed. The store
    // enforces the same ceiling, so this only decides what the family is *told*.
    const room = Math.max(0, meta.max_wishes - wishes.length);
    const accepted = newIds.slice(0, room);
    if (accepted.length < newIds.length) {
      toast.warning(t("list.notices.maxWishes", { max: meta.max_wishes }));
    }
    if (accepted.length === 0) return;

    // Append, invalidate, navigate to step 2. The order matters: the
    // append invalidates the simulation and instantly locks this step, so the
    // guard is told where the wizard is going *before* the state that would
    // make it redirect elsewhere. `ListStep` clears the flag when it mounts and
    // shows the "N recommended program(s) were added…" banner — the one message
    // for this event, which is why nothing is toasted here.
    setPendingNavigation(stepNumber("list"));
    appendRecommendations(accepted);
    setSelectedIds(new Set());
    router.push(stepPath("list"));
  }

  const hasResponse = data !== null;
  const showSkeleton = loading && !hasResponse;
  // Portfolio-risk values missing: the candidates were
  // scored, but not one of them came back with a conditional chance, which is
  // i.e. "the portfolio-risk pass did not run". Same
  // condition (every value blank, over a non-empty table) and the same warning.
  const riskValuesMissing =
    items.length > 0 &&
    items.every((item) => !isFiniteNumber(item.chance_if_considered));

  return (
    // No lead sentence: it was `improve.methodBody`, the "how are these
    // programs selected" paragraph, and the page should not open
    // on a block of text. The slider is the first thing now.
    <StepPage slug="improve" lead={null}>
      {/* 1. How many suggestions? The page's opening question, so it is not
          behind a disclosure any more. */}
      <section
        role="group"
        aria-label={t("improve.count.question")}
        className="flex flex-col gap-2"
        data-testid="improve-count"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold">
            {t("improve.count.question")}
          </h2>
          <span
            className="text-2xl font-semibold tabular-nums"
            data-testid="recommendation-count"
          >
            {recommendationCount}
          </span>
        </div>
        <Slider
          // The thumb is the control with `role="slider"`; the group label
          // above names the row, not the input (axe `aria-input-field-name`).
          aria-label={t("improve.count.question")}
          value={[recommendationCount]}
          min={MIN_RECOMMENDATION_COUNT}
          max={MAX_RECOMMENDATION_COUNT}
          step={1}
          onValueChange={([value]) => setRecommendationCount(value)}
          data-testid="recommendation-count-slider"
        />
      </section>

      <Separator />

      {/* 2. Improve distance estimates. */}
      <AddressSection
        hardDistanceFilterApplied={data?.hard_distance_filter_applied ?? null}
      />

      <Separator />

      {/* 3. Restrict the suggestions — the same filters as step 2, sharing the
          same store slice, so a family that narrowed the search there sees
          narrowed recommendations here. */}
      <FilterPanel
        title={t("improve.filters.title")}
        intro={t("improve.filters.intro")}
        showMatchCount={false}
      />

      <Separator />

      {error !== null ? (
        <ToneAlert tone="destructive" data-testid="recommendation-error">
          {apiErrorMessage(t, error)}
        </ToneAlert>
      ) : null}

      {wishes.length === 0 ? (
        <ToneAlert tone="info">{t("improve.empty.needWishes")}</ToneAlert>
      ) : null}

      {data?.similarity_fallback_mode ? (
        <ToneAlert tone="info" data-testid="similarity-fallback">
          {t("improve.warning.similarityFallback")}
        </ToneAlert>
      ) : null}

      {riskValuesMissing ? (
        <ToneAlert tone="warning" data-testid="portfolio-risk-failed">
          {t("errors.portfolioRiskFailed")}
        </ToneAlert>
      ) : null}

      {data?.limited_by_filters ? (
        <ToneAlert tone="info" data-testid="recommendation-limited-by-filters">
          {t("improve.warning.limitedByFilters")}
        </ToneAlert>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("improve.subtitle")}</h2>

        {showSkeleton ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : null}

        {hasResponse && items.length === 0 ? (
          <ToneAlert tone="warning" data-testid="recommendation-empty">
            {emptyMessage(t, data)}
          </ToneAlert>
        ) : null}

        {items.map((item) => (
          <RecommendationCard
            key={item.program_id ?? item.program_label}
            item={item}
            appendedWishRank={data?.appended_wish_rank ?? null}
            selected={
              item.program_id !== null && selectedIds.has(item.program_id)
            }
            onSelectedChange={(selected) => {
              if (item.program_id) toggle(item.program_id, selected);
            }}
          />
        ))}
      </section>

      <Button
        type="button"
        size="lg"
        // The base button style is `whitespace-nowrap`, which is right for a
        // pill and wrong for the one full-width button in the wizard: at 360 px
        // "Agregar los programas seleccionados y revisar mi lista" is wider
        // than the screen, and nowrap spilled it past both edges. Wrapping (and
        // the auto height that lets it) keeps the label readable instead.
        className="h-auto w-full py-2 whitespace-normal"
        disabled={selectedVisible.length === 0}
        onClick={handleAdd}
        data-testid="add-recommendations"
      >
        {t("improve.submit")}
      </Button>
    </StepPage>
  );
}

/**
 * The three "nothing to suggest" cases, in order:
 * candidates that could not be evaluated at all beat the distance explanation,
 * which in turn beats the generic scoring message.
 */
function emptyMessage(
  t: (key: string) => string,
  data: {
    diagnostics: { failed_candidates: number };
    hard_distance_filter_applied: boolean;
  },
): string {
  if (data.diagnostics.failed_candidates > 0) {
    return t("improve.warning.failedCandidates");
  }
  if (data.hard_distance_filter_applied) {
    return t("improve.empty.noneMatched");
  }
  return t("improve.empty.noSimilar");
}
