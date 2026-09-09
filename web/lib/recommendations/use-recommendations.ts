"use client";

/**
 * `POST /recommend` for step 4.
 *
 * The engine is the only place a probability is computed: this hook sends
 * the current list and hands back the response untouched. It never derives a
 * risk, never re-ranks, and never caches across students — the server re-runs
 * the simulation itself to obtain `current_unmatched_risk`, precisely so a
 * client-supplied risk cannot steer the ranking.
 *
 * Re-fetches when the wishes, the home point, the count slider, the student
 * identifier or the locale change, debounced by 300 ms so dragging the slider
 * from 2 to 10 issues one request instead of nine. The in-flight request is
 * aborted on every change, so a slow early answer can never overwrite a newer
 * one, and `loading` is *derived* from "the settled answer is not the one the
 * current inputs ask for" rather than being a third piece of state that could
 * disagree with the other two.
 *
 * Privacy: the RUN/IPE travels in the request body to the same-origin
 * proxy and is never logged, never put in the URL, and never attached to an
 * error — `ApiError` carries the response only.
 */

import * as React from "react";
import { useLocale } from "next-intl";

import { api, ApiError } from "@/lib/api";
import type {
  RecommendationRequest,
  RecommendationResponse,
} from "@/lib/api/types";
import { useWizardStore } from "@/lib/store/wizard";

import { buildRecommendationRequest } from "./request";

/** One coalescing window for slider drags and rapid list edits. */
export const RECOMMENDATION_DEBOUNCE_MS = 300;

export type UseRecommendationsResult = {
  data: RecommendationResponse | null;
  loading: boolean;
  /** `null` when the last attempt succeeded or none was made. */
  error: ApiError | null;
};

/** What a settled answer belongs to: the exact body plus the language it was
 * asked in (only `message` fields are language-dependent, but they are shown). */
type Settled = {
  key: string | null;
  data: RecommendationResponse | null;
  error: ApiError | null;
};

/** `<locale> <json body>` — one string that identifies a request completely. */
function requestKey(locale: string, request: RecommendationRequest): string {
  return `${locale} ${JSON.stringify(request)}`;
}

function requestFromKey(key: string): RecommendationRequest {
  return JSON.parse(key.slice(key.indexOf(" ") + 1)) as RecommendationRequest;
}

export function useRecommendations(): UseRecommendationsResult {
  const locale = useLocale();

  const studentId = useWizardStore((state) => state.studentId);
  const wishes = useWizardStore((state) => state.wishes);
  const home = useWizardStore((state) => state.home);
  const filters = useWizardStore((state) => state.filters);
  const maxRecommendations = useWizardStore(
    (state) => state.recommendationCount,
  );

  const request = React.useMemo(
    () =>
      buildRecommendationRequest({
        studentId,
        wishes,
        maxRecommendations,
        home,
        filters,
      }),
    [studentId, wishes, maxRecommendations, home, filters],
  );

  // The effect keys off the *serialized* body, not the object: the store hands
  // out a fresh `wishes` array on every edit, so an object-identity dependency
  // would re-request after changes that do not alter the payload at all. The
  // effect parses the same string back, which keeps the request it sends
  // provably identical to the one the dependency describes.
  const key = request === null ? null : requestKey(locale, request);

  const [settled, setSettled] = React.useState<Settled>({
    key: null,
    data: null,
    error: null,
  });

  React.useEffect(() => {
    // Nothing to ask for (no identifier, empty list). The derived values below
    // already read as "idle"; there is no state to push.
    if (key === null) return;

    let cancelled = false;
    const controller = new AbortController();
    const body = requestFromKey(key);

    const timer = setTimeout(() => {
      api
        .withLang(locale)
        .post("/recommend", body, { signal: controller.signal })
        .then((data) => {
          if (cancelled) return;
          setSettled({ key, data, error: null });
        })
        .catch((cause: unknown) => {
          // An abort is this hook's own cleanup; the superseding request owns
          // the state from here on.
          if (cancelled || controller.signal.aborted) return;
          setSettled({
            key,
            data: null,
            error: ApiError.is(cause)
              ? cause
              : new ApiError(0, "unexpected_error", ""),
          });
        });
    }, RECOMMENDATION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, locale]);

  const isCurrent = settled.key === key;

  return {
    // The previous answer stays on screen while a new one is in flight, so
    // nudging the slider does not blank the card list.
    data: key === null ? null : settled.data,
    loading: key !== null && !isCurrent,
    // A stale error belongs to inputs the family has already changed.
    error: isCurrent ? settled.error : null,
  };
}
