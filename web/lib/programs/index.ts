/** Public surface of the program lookup layer. Import from `@/lib/programs`. */
export {
  countPreservedOutsideFilters,
  filtersAreActive,
  filtersNarrowTheSearch,
  filtersToQuery,
  GENERAL_FILTER_FIELDS,
  PROGRAM_FILTER_FIELDS,
  programMatchesFilters,
  SPECIALTY_FIELD,
  TRACK_GENERAL,
  TRACK_SPECIALIZED,
  UNKNOWN_FILTER_VALUE,
} from "./filters";
export type {
  ProgramFilterField,
  ProgramFilterListKey,
  ProgramQuery,
} from "./filters";
export {
  clearProgramCache,
  getCachedProgram,
  PROGRAM_SEARCH_DEBOUNCE_MS,
  PROGRAM_SEARCH_LIMIT,
  useProgram,
  usePrograms,
  useProgramSearch,
} from "./use-programs";
export { useEnumLabel } from "./use-enum-label";
export type { EnumLabel } from "./use-enum-label";
export type {
  UseProgramResult,
  UseProgramSearchOptions,
  UseProgramSearchResult,
  UseProgramsResult,
} from "./use-programs";
