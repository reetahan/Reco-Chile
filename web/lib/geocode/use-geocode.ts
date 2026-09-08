"use client";

/**
 * `POST /geocode` for the optional home address of step 4.
 *
 * "Address is sent to `/geocode` only on explicit
 * button click, never on change." `geocode()` is therefore returned as an
 * imperative function and this module contains no effect that could fire it —
 * typing in the field must never reach the network, and Nominatim's 1 req/s
 * budget (shared by every user of the API process) depends on it.
 *
 * What is remembered is the *attempt*: the normalized address that was sent and
 * whatever came back, success or failure. It compares the stored
 * result's address with the field's current content to decide between showing
 * feedback and showing "Address changed. Click the button to update the
 * coordinates."; `geocodeFeedback()` below is that comparison, extracted so it
 * can be unit-tested.
 *
 * Only a usable result reaches the store (`setHome`): `home` is the point the
 * recommendation request may cite, so a failed lookup clears it rather than
 * leaving a stale location attached to a new address.
 */

import * as React from "react";
import { useLocale } from "next-intl";

import { api, ApiError } from "@/lib/api";
import type { GeocodeResponse } from "@/lib/api/types";
import { useWizardStore } from "@/lib/store/wizard";

/** `" ".join(address.strip().split())` — the same normalization the API applies, which
 * is also what the stored result's `address` is compared against. */
export function normalizeAddress(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).join(" ");
}

/** A geocode is only usable as a distance origin with real coordinates. */
export function hasUsableCoordinates(result: GeocodeResponse): boolean {
  return (
    result.ok &&
    typeof result.lat === "number" &&
    Number.isFinite(result.lat) &&
    typeof result.lon === "number" &&
    Number.isFinite(result.lon)
  );
}

/**
 * What the address field should be saying right now.
 *
 * - `idle` — nothing has been looked up for this text yet.
 * - `changed` — an earlier lookup exists but the family has edited the field
 * since; the coordinates on file no longer describe what is written.
 * - `confirmed` — `precision === "address"`: the exact address was found.
 * - `approximate` — found, but at street/city/unknown precision; `message` is
 * the server-localized warning for that precision.
 * - `failed` — the lookup itself said no (`ok: false`), `message` localized by
 * the server; or the call never got there, in which case `message` is empty
 * and the caller supplies its own network wording.
 */
export type GeocodeFeedback =
  | { kind: "idle" }
  | { kind: "changed" }
  | { kind: "confirmed"; address: string }
  | { kind: "approximate"; address: string; message: string }
  | { kind: "failed"; message: string };

export type GeocodeAttempt = {
  /** Normalized address that was submitted. */
  address: string;
  /** Response body, or `null` when the request never completed. */
  result: GeocodeResponse | null;
  /** Transport/HTTP failure, or `null`. */
  error: ApiError | null;
};

export function geocodeFeedback(
  attempt: GeocodeAttempt | null,
  currentAddress: string,
): GeocodeFeedback {
  if (attempt === null) return { kind: "idle" };

  const normalized = normalizeAddress(currentAddress);
  if (normalized === "") return { kind: "idle" };
  if (normalized !== attempt.address) return { kind: "changed" };

  const { result, error } = attempt;
  if (result === null) {
    return { kind: "failed", message: error?.message ?? "" };
  }
  if (!hasUsableCoordinates(result)) {
    return { kind: "failed", message: result.message };
  }

  // `display_name` is Nominatim's own rendering of what it matched; falling
  // back to the typed address keeps the sentence complete when it is absent.
  const address = result.display_name?.trim() || attempt.address;
  if (result.precision === "address") return { kind: "confirmed", address };
  return { kind: "approximate", address, message: result.message };
}

export type UseGeocodeResult = {
  /** Send the address. Call from a click handler only — never from an effect
   * or an `onChange`. */
  geocode: (address: string) => Promise<void>;
  /** Forget the attempt and drop the stored home point. */
  clear: () => void;
  loading: boolean;
  attempt: GeocodeAttempt | null;
};

export function useGeocode(): UseGeocodeResult {
  const locale = useLocale();
  const setHome = useWizardStore((state) => state.setHome);

  const [loading, setLoading] = React.useState(false);
  const [attempt, setAttempt] = React.useState<GeocodeAttempt | null>(null);

  const geocode = React.useCallback(
    async (raw: string) => {
      const address = normalizeAddress(raw);
      // An empty field is not a lookup: the button is disabled for it, and a
      // stray call must not spend the shared Nominatim budget either.
      if (address === "") return;

      setLoading(true);
      try {
        const result = await api.withLang(locale).post("/geocode", { address });
        setAttempt({ address, result, error: null });
        setHome(hasUsableCoordinates(result) ? result : null);
      } catch (cause) {
        // Rate limit (429), proxy failure, offline. The response-derived
        // message is safe to show; the request body never appears in it.
        setAttempt({
          address,
          result: null,
          error: ApiError.is(cause)
            ? cause
            : new ApiError(0, "unexpected_error", ""),
        });
        setHome(null);
      } finally {
        setLoading(false);
      }
    },
    [locale, setHome],
  );

  const clear = React.useCallback(() => {
    setAttempt(null);
    setHome(null);
  }, [setHome]);

  return { geocode, clear, loading, attempt };
}
