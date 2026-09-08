"use client";

/**
 * `/meta` as React context.
 *
 * The value is fetched once on the server by `fetchMeta()` and passed down as
 * a plain serializable object; this provider only makes it reachable from the
 * client wizard tree. It never fetches on its own — one source of truth, no
 * client/server drift in the thresholds that colour the risk badges.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Meta } from "@/lib/api/types";

const MetaContext = createContext<Meta | null>(null);
MetaContext.displayName = "MetaContext";

export function MetaProvider({
  meta,
  children,
}: {
  meta: Meta;
  children: ReactNode;
}) {
  return <MetaContext value={meta}>{children}</MetaContext>;
}

/**
 * Read `/meta`. Throws when used outside `<MetaProvider>` — a missing
 * provider is a wiring bug, not a state the UI should try to render around.
 */
export function useMeta(): Meta {
  const meta = useContext(MetaContext);
  if (meta === null) {
    throw new Error("useMeta() must be used inside <MetaProvider>.");
  }
  return meta;
}

/** Same, but `null` instead of throwing — for components that are optional
 * about it (e.g. a shell rendered above the provider). */
export function useMetaOptional(): Meta | null {
  return useContext(MetaContext);
}
