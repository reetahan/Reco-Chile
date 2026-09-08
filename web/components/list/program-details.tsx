"use client";

/**
 * The program-details list of a wish card — a port of
 * The program-details table — ten rows, in order:
 * program details, commune, region, program type, school day, PIE, PACE,
 * enrollment fee, monthly fee, religious orientation.
 *
 * These are the characteristics families ask about before committing a
 * preference, which is why the set is deliberately *not* everything the API
 * returns: capacity, applicant counts and MTB internals belong to the result
 * step, not to a decision about whether a school suits the child.
 *
 * The component renders bare content, no chrome — the caller puts it inside a
 * `Sheet` or a `Popover` and owns the trigger. The store holds only
 * `program_id`s, so the row values are fetched here through the shared
 * program cache; a program that has vanished from the calibration data says so
 * instead of rendering ten blanks.
 *
 * Enumerated values are translated through `enums.*`; school, commune and
 * program names are shown verbatim. A blank or `nan` column reads
 * "No information", exactly like `_family_display_value`.
 */

import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import type { ProgramSummary } from "@/lib/api/types";
import { useEnumLabel, useProgram } from "@/lib/programs";

type DetailRow = {
  /** Leaf id under `filters.details.fields.*`. */
  field: string;
  column: keyof ProgramSummary;
  /** Sub-group of `enums`; absent for values shown verbatim. */
  enumGroup?: string;
};

/** `_render_program_details`'s `detail_rows`, in order. */
export const PROGRAM_DETAIL_ROWS: readonly DetailRow[] = [
  { field: "programDisplayName", column: "program_display_name" },
  { field: "commune", column: "school_commune" },
  { field: "region", column: "region" },
  { field: "programTrack", column: "program_track", enumGroup: "track" },
  { field: "schoolDay", column: "program_school_day", enumGroup: "schoolDay" },
  { field: "pie", column: "program_pie", enumGroup: "pie" },
  { field: "pace", column: "program_pace", enumGroup: "pace" },
  {
    field: "enrollmentFee",
    column: "program_enrollment_fee",
    enumGroup: "payment",
  },
  { field: "monthlyFee", column: "program_monthly_fee", enumGroup: "payment" },
  {
    field: "religious",
    column: "program_religious_orientation",
    enumGroup: "religious",
  },
];

export type ProgramDetailsProps = {
  programId: string;
  className?: string;
};

export function ProgramDetails({ programId, className }: ProgramDetailsProps) {
  const t = useTranslations("filters");
  const enumLabel = useEnumLabel();
  const { program, loading, notFound, error } = useProgram(programId);

  if (loading) {
    return (
      <div
        className={className ?? "flex flex-col gap-2"}
        data-testid="program-details"
        data-state="loading"
        role="status"
      >
        <span className="sr-only">{t("details.loading")}</span>
        {PROGRAM_DETAIL_ROWS.map((row) => (
          <Skeleton key={row.field} className="h-4 w-full" aria-hidden />
        ))}
      </div>
    );
  }

  if (notFound || program === null) {
    return (
      <p
        className={className ?? "text-sm text-muted-foreground"}
        data-testid="program-details"
        data-state={notFound ? "not-found" : "error"}
        role="status"
      >
        {notFound ? t("details.notFound") : t("details.error")}
        {error !== null ? ` ${error.message}` : ""}
      </p>
    );
  }

  return (
    <dl
      className={className ?? "grid grid-cols-1 gap-x-4 gap-y-2 text-sm"}
      data-testid="program-details"
      data-state="ready"
      data-program-id={program.program_id}
    >
      {PROGRAM_DETAIL_ROWS.map((row) => {
        const raw = program[row.column];
        const text = typeof raw === "string" ? raw.trim() : "";
        const value = row.enumGroup
          ? enumLabel(row.enumGroup, text)
          : text === "" || text.toLowerCase() === "nan"
            ? t("details.noInformation")
            : text;
        return (
          <div
            key={row.field}
            data-testid="program-details-row"
            data-field={row.field}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
          >
            <dt className="font-medium">{t(`details.fields.${row.field}`)}:</dt>
            <dd className="min-w-0 text-muted-foreground">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
