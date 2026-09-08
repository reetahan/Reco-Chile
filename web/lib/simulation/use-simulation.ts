"use client";

/**
 * Runs `POST /simulate` on entry to step 3 when the stored result is stale;
 * owns the loading and error states (422 messages, over-cap).
 *
 * Contract with the store: every input change already dropped the
 * cached result and set `simulationStale`, so "stale" is the only trigger this
 * hook needs. The response is written back verbatim with `setSimulation`,
 * which is what unlocks Continue and step 4.
 *
 * Privacy: the RUN/IPE is read from the memory-only store slice, goes
 * into the request body, and appears nowhere else — not in the URL, not in
 * `sessionStorage`, not in a log line, and never in the error state (an
 * `ApiError` carries only the response envelope).
 *
 * The engine remains the sole source of numbers: nothing here recomputes,
 * re-sorts or re-derives a probability.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { api, ApiError, NETWORK_ERROR_KEY } from "@/lib/api";
import type { SimulationResponse } from "@/lib/api/types";
import { formatInt } from "@/lib/format";
import { useWizardStore } from "@/lib/store/wizard";

import { buildSimulationRequest, canSimulate } from "./request";

export type SimulationError = {
  /** Stable machine code — `too_many_equivalence_orders`, `network_error`, … */
  key: string;
  /** Localized sentence to show. Never contains the request body. */
  message: string;
};

export type SimulationView = {
  simulation: SimulationResponse | null;
  loading: boolean;
  error: SimulationError | null;
  /** Re-run after a failure (the "retry" button of the error alert). */
  retry: () => void;
};

/**
 * Numeric params (`n`, `limit`) are pre-formatted to match Python's `{:,}`
 * rule before they reach ICU, so the over-cap sentence reads the same in both
 * apps instead of picking up CLDR's own grouping.
 */
function localizeParams(
  params: Record<string, unknown>,
  locale: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] =
      typeof value === "number"
        ? formatInt(value, locale)
        : String(value ?? "");
  }
  return out;
}

export function useSimulation(): SimulationView {
  const locale = useLocale();
  const t = useTranslations();

  const studentId = useWizardStore((state) => state.studentId);
  const wishes = useWizardStore((state) => state.wishes);
  const useEquivalenceClasses = useWizardStore(
    (state) => state.useEquivalenceClasses,
  );
  const simulation = useWizardStore((state) => state.simulation);
  const simulationStale = useWizardStore((state) => state.simulationStale);
  const setSimulation = useWizardStore((state) => state.setSimulation);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SimulationError | null>(null);
  /** Bumped by `retry()`; it is what re-runs the effect after a failure. */
  const [attempt, setAttempt] = useState(0);

  /**
   * Fingerprint of the inputs already sent, of the run whose answer may still
   * be written, and the request that is still open. All three are memory only,
   * like the RUN they describe — never logged, never persisted.
   */
  const attempted = useRef<string | null>(null);
  const latest = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const request = buildSimulationRequest({
    studentId,
    wishes,
    useEquivalenceClasses,
  });
  const ready = canSimulate({ studentId, wishes, useEquivalenceClasses });
  const token = JSON.stringify(request);
  const needsRun = ready && (simulation === null || simulationStale);

  /**
   * Turn a thrown error into the sentence the family sees. Order: the local
   * catalogue entry for a known `error_key` (so the wording matches the
   * Spanish), then the server's own localized `message`, then a
   * generic fallback.
   */
  const describe = useCallback(
    (cause: unknown): SimulationError => {
      if (ApiError.is(cause)) {
        const catalogueKey = `errors.${cause.errorKey}`;
        if (t.has(catalogueKey)) {
          return {
            key: cause.errorKey,
            message: t(catalogueKey, localizeParams(cause.params, locale)),
          };
        }
        if (cause.errorKey === NETWORK_ERROR_KEY) {
          return {
            key: cause.errorKey,
            message: t("errors.networkUnavailable"),
          };
        }
        // Already localized by the API from `?lang=`.
        return { key: cause.errorKey, message: cause.message };
      }
      return { key: "unexpected", message: t("errors.unexpected") };
    },
    [locale, t],
  );

  useEffect(() => {
    if (!needsRun) return;
    // Already sent for exactly these inputs: a failed attempt must not loop
    // (the result stays stale after an error) and React's development
    // double-effect must not fire a second POST.
    if (attempted.current === token) return;

    attempted.current = token;
    latest.current = token;
    // A run for older inputs is now irrelevant; free the connection.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setError(null);

    api
      .post("/simulate", request, { lang: locale, signal: controller.signal })
      .then((response) => {
        // Only the newest run may write; an older one lost the race.
        if (latest.current !== token) return;
        setSimulation(response);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (latest.current !== token) return;
        setError(describe(cause));
        setLoading(false);
      });

    // Deliberately no cleanup: unmounting must not abort the request. React
    // remounts this tree in development (StrictMode) and after a back/forward
    // navigation, and an abort there would either waste a second round trip or
    // leave the step spinning. The response lands in the zustand store, which
    // outlives the component, so a family that navigates away mid-calculation
    // comes back to a finished result.
    // `request` is rebuilt on every render but is fully described by `token`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRun, token, locale, attempt, setSimulation, describe]);

  const retry = useCallback(() => {
    attempted.current = null;
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  return {
    simulation: simulationStale ? null : simulation,
    loading,
    error,
    retry,
  };
}
