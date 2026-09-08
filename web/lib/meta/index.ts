/**
 * `/meta` in the client tree: `<MetaProvider>` and `useMeta()`.
 *
 * The server helper `fetchMeta()` is intentionally not re-exported: it reads
 * `process.env.API_BASE_URL`, so it must not be pulled into a browser bundle.
 * Server components import it from `@/lib/meta/fetch-meta` directly.
 */
export { MetaProvider, useMeta, useMetaOptional } from "./meta-provider";
export type { Meta } from "@/lib/api/types";
