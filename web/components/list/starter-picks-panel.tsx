"use client";

/**
 * Guided branch, phase 1: pick 1-3 schools the family is generally interested
 * in, as raw material for `/recommend` — not yet an ordered list, so this
 * renders a plain remove-only list rather than {@link WishList}'s rank badges
 * and drag handles, which would misstate what these picks mean.
 *
 * Reuses the same {@link FilterPanel} and {@link ProgramSearch} step 2 already
 * uses to find a program; only the destination of "Add" differs
 * (`addStarterPick`, not `addWish`).
 */

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { usePrograms } from "@/lib/programs";
import {
  MAX_STARTER_PICKS,
  MIN_STARTER_PICKS,
  useWizardStore,
} from "@/lib/store/wizard";

import { FilterPanel } from "./filters/filter-panel";
import { formatProgramLocation } from "./program-location";
import { ProgramSearch } from "./program-search";

export function StarterPicksPanel() {
  const t = useTranslations();

  const starterPicks = useWizardStore((state) => state.starterPicks);
  const addStarterPick = useWizardStore((state) => state.addStarterPick);
  const removeStarterPick = useWizardStore((state) => state.removeStarterPick);
  const confirmStarterPicks = useWizardStore(
    (state) => state.confirmStarterPicks,
  );

  const { programs } = usePrograms(starterPicks);
  const atMax = starterPicks.length >= MAX_STARTER_PICKS;
  const canContinue =
    starterPicks.length >= MIN_STARTER_PICKS &&
    starterPicks.length <= MAX_STARTER_PICKS;

  return (
    <section className="flex flex-col gap-4" data-testid="starter-picks-panel">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t("list.starters.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("list.starters.intro")}
        </p>
      </div>

      <FilterPanel showMatchCount={false} />

      <div className="flex flex-col gap-3">
        <ProgramSearch
          onAdd={addStarterPick}
          excludeIds={starterPicks}
          disabled={atMax}
        />
        {atMax ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="starter-picks-max"
          >
            {t("list.starters.max")}
          </p>
        ) : null}
      </div>

      {starterPicks.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="starter-pick-list">
          {starterPicks.map((id) => {
            const program = programs.get(id);
            return (
              <li
                key={id}
                data-testid="starter-pick-card"
                data-program-id={id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {program?.program_label ?? id}
                  </span>
                  {program ? (
                    <span className="text-xs text-muted-foreground">
                      {formatProgramLocation(
                        program.school_commune,
                        program.region,
                      )}
                    </span>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("list.starters.remove")}
                  onClick={() => removeStarterPick(id)}
                >
                  <XIcon aria-hidden="true" className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Button
        type="button"
        size="lg"
        className="h-auto w-full py-2 whitespace-normal"
        disabled={!canContinue}
        onClick={confirmStarterPicks}
        data-testid="starter-picks-continue"
      >
        {t("steps.continue")}
      </Button>
    </section>
  );
}
