/**
 * The program-filter vocabulary, shared by the filter panel, the program
 * combobox and the `GET /programs` query string.
 *
 * Everything here is a *mirror* of the Python side and nothing else:
 *
 * - `ProgramFilters` (the store shape) → query parameters of `GET /programs`,
 * which FastAPI hands straight to `data_loading.program_matches_filters`.
 * - `programMatchesFilters` reproduces that same predicate over a
 * `ProgramSummary` so the UI can answer one question the server is never
 * asked: "is a program the family *already selected* outside the current
 * filters?" It is a display-only decision —
 * no wish is ever dropped because of it, and every list the family actually
 * sees is filtered by the server.
 *
 * Filter option *values* stay English wire codes ("With PIE", "Free"); the
 * `enums.*` catalogue owns their display strings.
 */

import type { Meta, ProgramSummary } from "@/lib/api/types";
import type { ProgramFilters } from "@/lib/store/types";

/** `constants.TRACK_GENERAL` / `TRACK_SPECIALIZED`. */
export const TRACK_GENERAL = "General";
export const TRACK_SPECIALIZED = "Specialized";

/** `constants.UNKNOWN_FILTER_VALUE` — what a blank column compares as. */
export const UNKNOWN_FILTER_VALUE = "Unknown";

/** Every list-valued key of `ProgramFilters` (i.e. all but `region`). */
export type ProgramFilterListKey = Exclude<keyof ProgramFilters, "region">;

/** One "more filters" multi-select: where its options, values and copy live. */
export type ProgramFilterField = {
  /** Key in the store's `ProgramFilters`. */
  key: ProgramFilterListKey;
  /** Repeatable query parameter of `GET /programs` (singular, as in a URL). */
  param: string;
  /** Field of `ProgramSummary` the value is compared against. */
  column: keyof ProgramSummary;
  /** List in `/meta.filter_options` holding the allowed values. */
  optionsKey: keyof Meta["filter_options"];
  /** Sub-group of the `enums` catalogue that translates the values. */
  enumGroup: string;
  /** Leaf id under `filters.fields.*` for the label and the help text. */
  messageKey: string;
};

/**
 * The nine multi-selects of the "more filters" section: the specialty area
 * spans the panel, the remaining eight fill a two-column grid row by row
 * (genders|school days, rurality|PACE, PIE|monthly fee, enrollment|religious).
 */
export const PROGRAM_FILTER_FIELDS: readonly ProgramFilterField[] = [
  {
    key: "specialtySectors",
    param: "specialty_sector",
    column: "program_specialty_sector",
    optionsKey: "specialty_sectors",
    enumGroup: "specialty",
    messageKey: "specialty",
  },
  {
    key: "genders",
    param: "gender",
    column: "program_gender",
    optionsKey: "genders",
    enumGroup: "gender",
    messageKey: "gender",
  },
  {
    key: "schoolDays",
    param: "school_day",
    column: "program_school_day",
    optionsKey: "school_days",
    enumGroup: "schoolDay",
    messageKey: "schoolDay",
  },
  {
    key: "rurality",
    param: "rurality",
    column: "program_rurality",
    optionsKey: "rurality",
    enumGroup: "rurality",
    messageKey: "rurality",
  },
  {
    key: "pace",
    param: "pace",
    column: "program_pace",
    optionsKey: "pace",
    enumGroup: "pace",
    messageKey: "pace",
  },
  {
    key: "pie",
    param: "pie",
    column: "program_pie",
    optionsKey: "pie",
    enumGroup: "pie",
    messageKey: "pie",
  },
  {
    key: "monthlyFee",
    param: "monthly_fee",
    column: "program_monthly_fee",
    optionsKey: "monthly_fee",
    enumGroup: "payment",
    messageKey: "monthlyFee",
  },
  {
    key: "enrollmentFee",
    param: "enrollment_fee",
    column: "program_enrollment_fee",
    optionsKey: "enrollment_fee",
    enumGroup: "payment",
    messageKey: "enrollmentFee",
  },
  {
    key: "religiousOrientation",
    param: "religious_orientation",
    column: "program_religious_orientation",
    optionsKey: "religious_orientation",
    enumGroup: "religious",
    messageKey: "religious",
  },
];

/** The specialty select is only offered once *Specialized* is ticked. */
export const SPECIALTY_FIELD = PROGRAM_FILTER_FIELDS[0];

/** The eight fields of the two-column grid, in reading order. */
export const GENERAL_FILTER_FIELDS = PROGRAM_FILTER_FIELDS.slice(1);

/** Query shape of `GET /programs` (the repeatable parameters ). */
export type ProgramQuery = {
  region?: string;
  q?: string;
  limit?: number;
  offset?: number;
  track?: string[];
  specialty_sector?: string[];
  gender?: string[];
  school_day?: string[];
  rurality?: string[];
  pie?: string[];
  pace?: string[];
  enrollment_fee?: string[];
  monthly_fee?: string[];
  religious_orientation?: string[];
};

function nonEmpty(values: readonly string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  return [...values];
}

/**
 * `ProgramFilters` → the query object handed to `api.get("/programs", …)`.
 *
 * Empty lists and a null region are *omitted* rather than sent empty: on the
 * wire an absent parameter is "no restriction", which is exactly what an empty
 * multi-select means ("leave empty to include …"). The key
 * order is fixed so the serialized query is a stable cache key.
 */
export function filtersToQuery(
  filters: ProgramFilters | null | undefined,
): ProgramQuery {
  if (!filters) return {};
  const query: ProgramQuery = {};
  const region = filters.region?.trim();
  if (region) query.region = region;

  const tracks = nonEmpty(filters.tracks);
  if (tracks) query.track = tracks;

  for (const field of PROGRAM_FILTER_FIELDS) {
    const values = nonEmpty(filters[field.key]);
    if (values) {
      (query as Record<string, string[]>)[field.param] = values;
    }
  }
  return query;
}

/** `data_loading.filters_are_active` — is any list-valued filter set? */
export function filtersAreActive(
  filters: ProgramFilters | null | undefined,
): boolean {
  if (!filters) return false;
  if (filters.tracks.length > 0) return true;
  return PROGRAM_FILTER_FIELDS.some((field) => filters[field.key].length > 0);
}

/** True when the family narrowed the search at all (region counts too). */
export function filtersNarrowTheSearch(
  filters: ProgramFilters | null | undefined,
): boolean {
  return Boolean(filters?.region) || filtersAreActive(filters);
}

function fieldValue(program: ProgramSummary, column: keyof ProgramSummary) {
  const value = program[column];
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? UNKNOWN_FILTER_VALUE : text;
}

/**
 * Client mirror of `data_loading.program_matches_filters`, plus a region test.
 * Used **only** to count already-selected
 * programs that fall outside the current filters; the authoritative filtering
 * always happens server-side.
 *
 * The one subtlety is carried over verbatim: a specialty-area selection is
 * ignored for general academic programs, so ticking *General* and an area does
 * not hide the general programs the family explicitly asked for.
 */
export function programMatchesFilters(
  program: ProgramSummary,
  filters: ProgramFilters | null | undefined,
): boolean {
  if (!filters) return true;

  if (filters.region && program.region !== filters.region) return false;

  const track = fieldValue(program, "program_track");
  if (filters.tracks.length > 0 && !filters.tracks.includes(track)) {
    return false;
  }

  if (filters.specialtySectors.length > 0 && track === TRACK_SPECIALIZED) {
    const sector = fieldValue(program, "program_specialty_sector");
    if (!filters.specialtySectors.includes(sector)) return false;
  }

  for (const field of GENERAL_FILTER_FIELDS) {
    const selected = filters[field.key];
    if (selected.length === 0) continue;
    if (!selected.includes(fieldValue(program, field.column))) return false;
  }
  return true;
}

/** Anything with a `programId` — the store's `Wish`, or a bare id list. */
type WishLike = { programId: string } | string;

function wishId(wish: WishLike): string {
  return typeof wish === "string" ? wish : wish.programId;
}

/**
 * How many already-selected programs the current filters would hide — this
 * drives the "kept outside filters" note.
 *
 * `programs` maps `program_id` → summary (what `usePrograms` returns). A wish
 * whose program is not in the map yet (still loading, or gone from the data)
 * is not counted: the note may only ever *undercount* while data is in flight,
 * never claim a program is filtered out when nothing is known about it.
 */
export function countPreservedOutsideFilters(
  wishes: readonly WishLike[],
  programs: ReadonlyMap<string, ProgramSummary>,
  filters: ProgramFilters | null | undefined,
): number {
  if (!filtersNarrowTheSearch(filters)) return 0;
  let preserved = 0;
  const seen = new Set<string>();
  for (const wish of wishes) {
    const id = wishId(wish);
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    const program = programs.get(id);
    if (program && !programMatchesFilters(program, filters)) preserved += 1;
  }
  return preserved;
}
