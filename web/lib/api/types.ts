/**
 * Readable aliases for the generated schema types.
 *
 * Import these instead of reaching into `components["schemas"][...]` at every
 * call site; they are re-exported from `@/lib/api`. If an endpoint changes,
 * `pnpm api:types` regenerates `schema.d.ts` and these follow automatically.
 */
import type { components } from "./schema";

type Schemas = components["schemas"];

/** `GET /meta` — thresholds, limits, filter option lists, regions. */
export type Meta = Schemas["MetaResponse"];
export type FilterOptions = Schemas["FilterOptions"];
export type Thresholds = Schemas["Thresholds"];

/** Programs. `program_id` is always `"<rbd>:<program_code>"`. */
export type ProgramSummary = Schemas["ProgramSummary"];
export type ProgramListResponse = Schemas["ProgramListResponse"];

/** Simulation. */
export type WishItem = Schemas["WishItem"];
export type WishResult = Schemas["WishResult"];
export type EstimatedOutcome = Schemas["EstimatedOutcome"];
export type SimulationRequest = Schemas["SimulationRequest"];
export type SimulationResponse = Schemas["SimulationResponse"];
export type SimulationVariant = Schemas["SimulationVariant"];
export type EquivalenceSensitivity = Schemas["EquivalenceSensitivity"];

/** Recommendations. */
export type RecommendationRequest = Schemas["RecommendationRequest"];
export type RecommendationResponse = Schemas["RecommendationResponse"];
export type RecommendationItem = Schemas["RecommendationItem"];
export type RecommendationDiagnostics = Schemas["RecommendationDiagnostics"];
export type HomeLocation = Schemas["HomeLocation"];

/** Geocoding. */
export type GeocodeRequest = Schemas["GeocodeRequest"];
export type GeocodeResponse = Schemas["GeocodeResponse"];
