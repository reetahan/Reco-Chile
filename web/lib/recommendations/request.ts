/**
 * Turning the wizard store into a `POST /recommend` body.
 *
 * Kept pure and React-free so the mapping — which is the one place a wish's
 * five priority flags change spelling from camelCase to the wire's snake_case
 * — can be unit-tested without rendering anything.
 *
 * `home` is only ever sent for a *successful* geocode with usable coordinates
 * (the address itself never leaves the browser except through the
 * explicit `/geocode` click, and only the resulting point is reused here).
 */
import { filtersToQuery } from "@/lib/programs";
import type { GeocodeResult, ProgramFilters, Wish } from "@/lib/store/wizard";
import type {
  HomeLocation,
  RecommendationFilters,
  RecommendationRequest,
  WishItem,
} from "@/lib/api/types";

/** Chile's bounding box is well inside these, and the engine applies the real
 * check; this only stops `null`/`NaN` coordinates from reaching the wire. */
function isUsableCoordinate(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The store's geocode result as the contract's `HomeLocation`, or `null` when
 * the family has no confirmed home point. */
export function toHomeLocation(
  home: GeocodeResult | null | undefined,
): HomeLocation | null {
  if (!home || !home.ok) return null;
  if (!isUsableCoordinate(home.lat) || !isUsableCoordinate(home.lon)) {
    return null;
  }
  return {
    lat: home.lat,
    lon: home.lon,
    // The engine decides from this string whether the 40 km hard filter may be
    // applied at all (`home_geocoding_supports_hard_filter`), so it is passed
    // through verbatim rather than normalized here.
    precision: home.precision ?? "approximate",
  };
}

export function toWishItem(wish: Wish): WishItem {
  return {
    program_id: wish.programId,
    // `null` is the contract's "strict ranking": the server then treats each
    // wish as a singleton group equal to its position.
    equivalence_group: wish.equivalenceGroup,
    priority_sibling: wish.prioritySibling,
    priority_student: wish.priorityStudent,
    priority_parent_civil_servant: wish.priorityParentCivilServant,
    priority_ex_student: wish.priorityExStudent,
    priority_already_registered: wish.priorityAlreadyRegistered,
  };
}

export type RecommendationInputs = {
  studentId: string;
  wishes: readonly Wish[];
  maxRecommendations: number;
  home: GeocodeResult | null;
  /** The step-2 sidebar filters, reused on step 4 to restrict the candidates. */
  filters?: ProgramFilters | null;
};

/** `filtersToQuery` output as the contract's `RecommendationFilters`, or `null`
 * when nothing is set (the query object is `{}`). */
function toRecommendationFilters(
  filters: ProgramFilters | null | undefined,
): RecommendationFilters | null {
  if (!filters) return null;
  const query = filtersToQuery(filters) as RecommendationFilters;
  return Object.keys(query).length > 0 ? query : null;
}

/**
 * The request body, or `null` when there is nothing to ask for — no identifier
 * or an empty list. Returning `null` (rather than throwing) lets the hook skip
 * the call without a special-case branch at every call site.
 */
export function buildRecommendationRequest({
  studentId,
  wishes,
  maxRecommendations,
  home,
  filters,
}: RecommendationInputs): RecommendationRequest | null {
  const trimmedId = studentId.trim();
  if (trimmedId === "" || wishes.length === 0) return null;

  const request: RecommendationRequest = {
    student_id: trimmedId,
    wishes: wishes.map(toWishItem),
    max_recommendations: maxRecommendations,
    home: toHomeLocation(home),
  };
  const activeFilters = toRecommendationFilters(filters);
  if (activeFilters) request.filters = activeFilters;
  return request;
}
