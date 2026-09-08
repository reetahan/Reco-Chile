/** Recommendation data layer for wizard step 4. Import from `@/lib/recommendations`. */
export {
  formatDistanceKm,
  formatInt,
  formatPercent,
  formatRatio,
  isFiniteNumber,
  MISSING_NUMBER,
} from "./format";
export {
  buildRecommendationRequest,
  toHomeLocation,
  toWishItem,
} from "./request";
export type { RecommendationInputs } from "./request";
export {
  RECOMMENDATION_DEBOUNCE_MS,
  useRecommendations,
} from "./use-recommendations";
export type { UseRecommendationsResult } from "./use-recommendations";
