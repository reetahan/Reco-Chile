"use client";

/**
 * Step 2's program-finding filters.
 *
 * The filter panel, in order: region select, the two
 * track checkboxes, then a collapsed "more filters" expander with nine
 * multi-selects — the specialty area only once *Specialized* is ticked, exactly
 * because a specialty selection is ignored for general academic
 * programs anyway (`program_matches_filters`).
 *
 * The panel is shown only when the family answered "No — help me build it";
 * that decision belongs to the page that composes step 2, not here.
 *
 * Two numbers appear underneath:
 * - how many programs match right now — `total_matched` of a `GET /programs`
 * with the same filters, so the count can never disagree with the combobox;
 * - how many already-selected programs the filters would hide. Those wishes are
 * *kept* (filters never edit the list), which is why the note exists at all.
 *
 * The caption only appears once the family actually narrowed something, again
 * i.e. a region is chosen or at least one filter is active.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMeta } from "@/lib/meta";
import {
  countPreservedOutsideFilters,
  filtersNarrowTheSearch,
  GENERAL_FILTER_FIELDS,
  SPECIALTY_FIELD,
  TRACK_GENERAL,
  TRACK_SPECIALIZED,
  useEnumLabel,
  usePrograms,
  useProgramSearch,
} from "@/lib/programs";
import { useWizardStore } from "@/lib/store/wizard";
import type { ProgramFilterListKey } from "@/lib/programs";
import type { ProgramFilters } from "@/lib/store/types";

import { MultiSelectFilter } from "./multi-select-filter";

/** `<Select>` has no empty value, so "all regions" needs a sentinel. */
const ALL_REGIONS = "__all_regions__";

/** The count query never needs the rows themselves, only `total_matched`. */
const COUNT_ONLY_LIMIT = 1;

const NO_IDS: string[] = [];

export type FilterPanelProps = {
  /**
   * Already-selected programs the current filters would hide. Omit it and the
   * panel works it out itself from the store; pass it when the caller already
   * resolved every wish's program and wants one shared answer.
   */
  preservedCount?: number;
  className?: string;
  /** Heading and lead copy; defaults to the step-2 wording. */
  title?: string;
  intro?: string;
  /**
   * The "N matching program option(s)" caption and the query behind it. It
   * counts the whole catalogue, so step 4 (where the filters narrow
   * recommendations, not a program search) turns it off.
   */
  showMatchCount?: boolean;
};

export function FilterPanel({
  preservedCount,
  className,
  title,
  intro,
  showMatchCount = true,
}: FilterPanelProps) {
  const t = useTranslations("filters");
  const meta = useMeta();
  const enumLabel = useEnumLabel();

  const filters = useWizardStore((state) => state.filters);
  const setFilters = useWizardStore((state) => state.setFilters);
  const wishes = useWizardStore((state) => state.wishes);

  const [moreOpen, setMoreOpen] = useState(false);

  const generalChecked = filters.tracks.includes(TRACK_GENERAL);
  const specializedChecked = filters.tracks.includes(TRACK_SPECIALIZED);

  // One request, one number: whatever the server says matches these filters.
  const { totalMatched, loading } = useProgramSearch({
    filters,
    limit: COUNT_ONLY_LIMIT,
    enabled: showMatchCount,
  });

  // Only fetched when the caller did not already do the work.
  const wishIds = useMemo(
    () =>
      preservedCount === undefined ? wishes.map((w) => w.programId) : NO_IDS,
    [preservedCount, wishes],
  );
  const { programs } = usePrograms(wishIds);
  const preserved =
    preservedCount ?? countPreservedOutsideFilters(wishes, programs, filters);

  const narrowed = filtersNarrowTheSearch(filters);
  const regionText = filters.region ?? t("region.allInline");

  function setTracks(general: boolean, specialized: boolean) {
    const tracks: string[] = [];
    if (general) tracks.push(TRACK_GENERAL);
    if (specialized) tracks.push(TRACK_SPECIALIZED);
    setFilters(
      specialized
        ? { tracks }
        : // The specialty select disappears with the track it belongs to, so
          // its values must go with it or they would keep filtering invisibly.
          { tracks, specialtySectors: [] },
    );
  }

  function setListFilter(key: ProgramFilterListKey, values: string[]) {
    // A computed key over a union widens to an index signature, so the patch
    // is asserted back to the store's own shape; `key` is already constrained.
    setFilters({ [key]: values } as Partial<ProgramFilters>);
  }

  return (
    <section
      aria-labelledby="filter-panel-title"
      data-testid="filter-panel"
      className={className ?? "flex flex-col gap-5"}
    >
      <header className="flex flex-col gap-1">
        <h2 id="filter-panel-title" className="text-sm font-semibold">
          {title ?? t("title")}
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">
          {intro ?? t("intro")}
        </p>
      </header>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-region">{t("region.label")}</Label>
        <Select
          value={filters.region ?? ALL_REGIONS}
          onValueChange={(value) => {
            setFilters({ region: value === ALL_REGIONS ? null : value });
          }}
        >
          <SelectTrigger
            id="filter-region"
            data-testid="filter-region"
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_REGIONS}>{t("region.all")}</SelectItem>
            {meta.regions.map((region) => (
              <SelectItem key={region} value={region}>
                {region}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-pretty text-muted-foreground">
          {t("region.help")}
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          {t("track.legend")}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="filter-track-general"
              data-testid="filter-track-general"
              checked={generalChecked}
              onCheckedChange={(checked) => {
                setTracks(checked === true, specializedChecked);
              }}
            />
            <Label htmlFor="filter-track-general" className="font-normal">
              {t("track.general")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="filter-track-specialized"
              data-testid="filter-track-specialized"
              checked={specializedChecked}
              onCheckedChange={(checked) => {
                setTracks(generalChecked, checked === true);
              }}
            />
            <Label htmlFor="filter-track-specialized" className="font-normal">
              {t("track.specialized")}
            </Label>
          </div>
        </div>
      </fieldset>

      <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            data-testid="filter-more-trigger"
            className="h-auto w-full justify-start gap-2 px-2 py-2 text-left font-normal whitespace-normal"
          >
            <ChevronDownIcon
              aria-hidden
              className={`size-4 shrink-0 transition-transform ${moreOpen ? "rotate-180" : ""}`}
            />
            <span>{t("more.trigger")}</span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent
          data-testid="filter-more-content"
          className="flex flex-col gap-4 px-2 pt-3 pb-1"
        >
          <p className="text-xs text-pretty text-muted-foreground">
            {t("more.hint")}
          </p>

          {specializedChecked ? (
            <MultiSelectField
              field={SPECIALTY_FIELD}
              values={filters[SPECIALTY_FIELD.key]}
              options={meta.filter_options[SPECIALTY_FIELD.optionsKey]}
              onChange={setListFilter}
              label={t(`fields.${SPECIALTY_FIELD.messageKey}.label`)}
              help={t(`fields.${SPECIALTY_FIELD.messageKey}.help`)}
              optionLabel={(value) =>
                enumLabel(SPECIALTY_FIELD.enumGroup, value)
              }
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {GENERAL_FILTER_FIELDS.map((field) => (
              <MultiSelectField
                key={field.key}
                field={field}
                values={filters[field.key]}
                options={meta.filter_options[field.optionsKey]}
                onChange={setListFilter}
                label={t(`fields.${field.messageKey}.label`)}
                help={t(`fields.${field.messageKey}.help`)}
                optionLabel={(value) => enumLabel(field.enumGroup, value)}
              />
            ))}
          </div>

          <p className="text-xs text-pretty text-muted-foreground">
            {t("emptyHint")}
          </p>
        </CollapsibleContent>
      </Collapsible>

      {showMatchCount && narrowed ? (
        <p
          className="text-xs text-pretty text-muted-foreground"
          data-testid="filter-match-count"
          data-count={totalMatched}
          data-preserved={preserved}
          data-loading={loading ? "true" : "false"}
          aria-live="polite"
        >
          {t("matchCount", { n: totalMatched, region: regionText })}
          {preserved > 0 ? ` ${t("keptOutside", { n: preserved })}` : null}
        </p>
      ) : null}
    </section>
  );
}

/** Binds one `ProgramFilterField` to the store setter. */
function MultiSelectField({
  field,
  values,
  options,
  onChange,
  label,
  help,
  optionLabel,
}: {
  field: { key: ProgramFilterListKey };
  values: readonly string[];
  options: readonly string[];
  onChange: (key: ProgramFilterListKey, values: string[]) => void;
  label: string;
  help: string;
  optionLabel: (value: string) => string;
}) {
  return (
    <MultiSelectFilter
      id={`filter-${field.key}`}
      data-testid={`filter-${field.key}`}
      label={label}
      help={help}
      options={options}
      values={values}
      optionLabel={optionLabel}
      onChange={(next) => {
        onChange(field.key, next);
      }}
    />
  );
}
