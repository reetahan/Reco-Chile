/** Public surface of the API layer. Import from `@/lib/api`. */
export {
  api,
  createApiClient,
  fillPath,
  PROXY_BASE_PATH,
  serializeQuery,
} from "./client";
export type { ApiClient, ApiClientOptions, RequestOptions } from "./client";
export {
  ApiError,
  NETWORK_ERROR_KEY,
  NETWORK_ERROR_STATUS,
  parseErrorEnvelope,
  toApiError,
  UNEXPECTED_ERROR_KEY,
} from "./errors";
export type { ApiErrorEnvelope } from "./errors";
export * from "./types";
export type { components, operations, paths } from "./schema";
