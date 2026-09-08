"use client";

/**
 * Program lookup hooks for step 2.
 *
 * Two jobs, both of them thin:
 *
 * - `useProgramSearch` is the debounced server search behind the combobox and
 * behind the filter panel's matching count. Every filter decision is made by
 * FastAPI (`program_matches_filters`), so the browser can never disagree with
 * the engine about which programs exist.
 * - `useProgram` / `usePrograms` resolve a `program_id` to its display fields.
 * The store holds only ids (labels change when the data or the labelling
 * rules change, ids do not), so every card, details sheet and "kept outside
 * filters" count needs this lookup. Results are memoized in a module-level
 * map and concurrent callers share one in-flight request, so ten wish cards
 * asking for the same program issue one HTTP call.
 *
 * Privacy: nothing here ever sends or logs the RUN/IPE — these are
 * catalogue reads, and they go through the same-origin `/api` proxy like every
 * other browser call.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";

import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { ProgramListResponse, ProgramSummary } from "@/lib/api/types";
import type { ProgramFilters } from "@/lib/store/types";

import { filtersToQuery, type ProgramQuery } from "./filters";

export { filtersToQuery };
export type { ProgramQuery };

/** Keystroke-to-request delay of the combobox, in milliseconds. */
export const PROGRAM_SEARCH_DEBOUNCE_MS = 250;

/** Default page size. The API caps `limit` at 1000. */
export const PROGRAM_SEARCH_LIMIT = 50;

export type UseProgramSearchOptions = {
  /** Free text over school name, commune and program name. */
  q?: string;
  /** Overrides `filters.region` when given; `null` means "all regions". */
  region?: string | null;
  filters?: ProgramFilters | null;
  limit?: number;
  /** Set `false` to hold the request back (a closed combobox, say). */
  enabled?: boolean;
  /** Exposed for tests; production always uses the 250 ms default. */
  debounceMs?: number;
};

export type UseProgramSearchResult = {
  items: ProgramSummary[];
  /** Programs matching the filters *before* `limit` was applied. */
  totalMatched: number;
  /** True when more matches exist than were returned. */
  truncated: boolean;
  loading: boolean;
  error: ApiError | null;
};

const EMPTY_ITEMS: ProgramSummary[] = [];

function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

function asApiError(cause: unknown): ApiError {
  if (ApiError.is(cause)) return cause;
  return new ApiError(
    0,
    "unexpected_error",
    cause instanceof Error ? cause.message : "The program list is unavailable.",
  );
}

/** What one settled request produced, tagged with the query it answers. */
type SearchOutcome = {
  key: string;
  items: ProgramSummary[];
  totalMatched: number;
  truncated: boolean;
  error: ApiError | null;
};

/**
 * Debounced `GET /programs`.
 *
 * The whole query — text *and* filters — is debounced together and identified
 * by a stable serialization, so a re-render with equal inputs issues no
 * request, and a superseded request is aborted rather than allowed to land out
 * of order.
 *
 * "Loading" is *derived*, not stored: the hook is loading exactly while the
 * settled outcome does not answer the current query. That is what the combobox
 * needs — it says "searching…" from the first keystroke, through the debounce
 * window, and it never shows the previous query's rows under the new query.
 */
export function useProgramSearch(
  options: UseProgramSearchOptions = {},
): UseProgramSearchResult {
  const {
    q = "",
    filters = null,
    limit = PROGRAM_SEARCH_LIMIT,
    enabled = true,
    debounceMs = PROGRAM_SEARCH_DEBOUNCE_MS,
  } = options;
  const region = "region" in options ? options.region : filters?.region;
  const locale = useLocale();

  // One stable string per distinct request. Key order is fixed by
  // `filtersToQuery`, so equal inputs always serialize identically.
  const queryKey = useMemo(() => {
    const query: ProgramQuery = { ...filtersToQuery(filters), limit };
    const trimmed = q.trim();
    if (trimmed) query.q = trimmed;
    if (region) query.region = region;
    else delete query.region;
    return JSON.stringify(query);
  }, [filters, limit, q, region]);

  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const query = JSON.parse(queryKey) as ProgramQuery;
    const controller = new AbortController();
    let cancelled = false;

    const timer = setTimeout(() => {
      api
        .get("/programs", { query, lang: locale, signal: controller.signal })
        .then((response: ProgramListResponse) => {
          if (cancelled) return;
          setOutcome({
            key: queryKey,
            items: response.items,
            totalMatched: response.total_matched,
            truncated: response.truncated,
            error: null,
          });
        })
        .catch((cause: unknown) => {
          if (cancelled || isAbortError(cause)) return;
          setOutcome({
            key: queryKey,
            items: EMPTY_ITEMS,
            totalMatched: 0,
            truncated: false,
            error: asApiError(cause),
          });
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [queryKey, enabled, locale, debounceMs]);

  return useMemo(() => {
    const answered = enabled && outcome !== null && outcome.key === queryKey;
    if (!answered) {
      return {
        items: EMPTY_ITEMS,
        totalMatched: 0,
        truncated: false,
        loading: enabled,
        error: null,
      };
    }
    return {
      items: outcome.items,
      totalMatched: outcome.totalMatched,
      truncated: outcome.truncated,
      loading: false,
      error: outcome.error,
    };
  }, [enabled, outcome, queryKey]);
}

// ---------------------------------------------------------------------------
// Single-program lookup
// ---------------------------------------------------------------------------

/** Resolved programs, by `program_id`. Module-level: the catalogue is
 * immutable for the lifetime of a page load (a data change bumps
 * `/meta.data_fingerprint` and the family reloads). */
const programCache = new Map<string, ProgramSummary>();
/** Ids the API answered 404 for — remembered so a dropped wish is not
 * re-requested on every render. */
const missingPrograms = new Set<string>();
/** In-flight requests, so N callers for one id share one round trip. */
const inFlight = new Map<string, Promise<ProgramSummary | null>>();

/** Test seam: forget everything resolved so far. */
export function clearProgramCache(): void {
  programCache.clear();
  missingPrograms.clear();
  inFlight.clear();
}

/** Synchronous peek at the cache — no request, no subscription. */
export function getCachedProgram(
  programId: string,
): ProgramSummary | undefined {
  return programCache.get(programId);
}

async function loadProgram(
  programId: string,
  lang: string,
): Promise<ProgramSummary | null> {
  const cached = programCache.get(programId);
  if (cached) return cached;
  if (missingPrograms.has(programId)) return null;

  const pending = inFlight.get(programId);
  if (pending) return pending;

  const request = api
    .get("/programs/{program_id}", {
      path: { program_id: programId },
      lang,
    })
    .then((program: ProgramSummary) => {
      programCache.set(programId, program);
      return program;
    })
    .catch((cause: unknown) => {
      // 404 is a fact about the data, not a transport failure: the program
      // disappeared from the calibration files.
      if (ApiError.is(cause) && cause.status === 404) {
        missingPrograms.add(programId);
        return null;
      }
      throw cause;
    })
    .finally(() => {
      inFlight.delete(programId);
    });

  inFlight.set(programId, request);
  return request;
}

export type UseProgramResult = {
  program: ProgramSummary | null;
  loading: boolean;
  /** The API answered 404 — the program is gone from the loaded data. */
  notFound: boolean;
  error: ApiError | null;
};

/**
 * One program by id.
 *
 * The three flags are *derived* from the shared cache on every render, so a
 * program that some other card already resolved renders on the first frame
 * with no skeleton and no second request. The state below exists only to wake
 * this component when its own lookup settles, and to carry a transport error
 * (which, unlike a program, is not worth caching).
 */
export function useProgram(
  programId: string | null | undefined,
): UseProgramResult {
  const locale = useLocale();
  const id = programId ?? "";
  const [settled, setSettled] = useState<{
    id: string;
    error: ApiError | null;
  } | null>(null);

  useEffect(() => {
    // A resolved id (or a known-missing one) is already answered by the cache
    // that render reads; there is nothing to synchronize.
    if (!id || programCache.has(id) || missingPrograms.has(id)) return;

    let cancelled = false;
    loadProgram(id, locale)
      .then(() => {
        if (!cancelled) setSettled({ id, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled || isAbortError(cause)) return;
        setSettled({ id, error: asApiError(cause) });
      });

    return () => {
      cancelled = true;
    };
  }, [id, locale]);

  const program = id ? (programCache.get(id) ?? null) : null;
  const notFound = id ? missingPrograms.has(id) : false;
  const error = settled !== null && settled.id === id ? settled.error : null;

  return {
    program,
    notFound,
    error,
    loading: Boolean(id) && program === null && !notFound && error === null,
  };
}

export type UseProgramsResult = {
  /** Resolved programs by id; ids still loading are simply absent. */
  programs: ReadonlyMap<string, ProgramSummary>;
  loading: boolean;
  /** Ids the API answered 404 for. */
  missing: string[];
};

/**
 * The same lookup for a list of ids — what the wish cards and the "kept
 * outside filters" count need. Requests are deduplicated through the shared
 * cache, so overlapping callers cost nothing extra.
 */
export function usePrograms(programIds: readonly string[]): UseProgramsResult {
  const locale = useLocale();
  const key = useMemo(() => JSON.stringify([...programIds]), [programIds]);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const ids = (JSON.parse(key) as string[]).filter(Boolean);
    const pending = ids.filter(
      (id) => !programCache.has(id) && !missingPrograms.has(id),
    );
    if (pending.length === 0) return;

    let cancelled = false;
    void Promise.all(
      pending.map((id) => loadProgram(id, locale).catch(() => null)),
    ).then(() => {
      if (!cancelled && mounted.current) bump();
    });

    return () => {
      cancelled = true;
    };
  }, [key, locale, bump]);

  return useMemo(() => {
    void version; // recomputed when a pending lookup resolves
    const ids = (JSON.parse(key) as string[]).filter(Boolean);
    const programs = new Map<string, ProgramSummary>();
    const missing: string[] = [];
    let loading = false;
    for (const id of ids) {
      const program = programCache.get(id);
      if (program) programs.set(id, program);
      else if (missingPrograms.has(id)) missing.push(id);
      else loading = true;
    }
    return { programs, loading, missing };
  }, [key, version]);
}
