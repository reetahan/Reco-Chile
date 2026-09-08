"use client";

import * as React from "react";
import { InfoIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { geocodeFeedback, normalizeAddress, useGeocode } from "@/lib/geocode";
import { useMeta } from "@/lib/meta";
import { useWizardStore } from "@/lib/store/wizard";

import { apiErrorMessage } from "./api-error";
import { ToneAlert } from "./tone-alert";

/**
 * "Improve distance estimates — optional".
 *
 * The address is local component state, not store state: it is the rawest form
 * of the family's home location and is kept out of storage and out of the
 * URL. Only the geocoded *point* is kept, in the store's
 * memory-only `home` slice, and only after the family presses the button —
 * there is deliberately no effect here that could turn typing into a request.
 */
export function AddressSection({
  hardDistanceFilterApplied,
}: {
  /** `/recommend`'s own answer for the point currently on file. `null` while
   * the first response is still in flight. */
  hardDistanceFilterApplied: boolean | null;
}) {
  const t = useTranslations();
  const meta = useMeta();
  const home = useWizardStore((state) => state.home);
  const { geocode, clear, loading, attempt } = useGeocode();

  const [address, setAddress] = React.useState("");
  const canSubmit = normalizeAddress(address) !== "" && !loading;
  const feedback = geocodeFeedback(attempt, address);

  function handleClear() {
    setAddress("");
    clear();
  }

  return (
    <section className="flex flex-col gap-3" data-testid="improve-address">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {t("improve.address.sectionTitle")}
        </h2>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm">
              <InfoIcon aria-hidden="true" data-icon="inline-start" />
              {t("improve.address.privacyTitle")}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80"
            aria-label={t("improve.address.privacyTitle")}
          >
            <PopoverHeader>
              <PopoverTitle>{t("improve.address.privacyTitle")}</PopoverTitle>
              <PopoverDescription>
                {t("improve.address.privacyBody")}
              </PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="home-address">{t("improve.address.label")}</Label>
        <Input
          id="home-address"
          name="home-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          // No `onKeyDown`-to-submit either: every path to the network is the
          // button, so "explicit click only" stays literally true.
          autoComplete="off"
          spellCheck={false}
          aria-describedby="home-address-help"
          data-testid="home-address-input"
        />
        <p id="home-address-help" className="text-xs text-muted-foreground">
          {t("improve.address.help")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!canSubmit}
          onClick={() => void geocode(address)}
          data-testid="geocode-submit"
        >
          {loading ? (
            <Loader2Icon
              className="animate-spin"
              aria-hidden="true"
              data-icon="inline-start"
            />
          ) : null}
          {t("improve.address.use")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleClear}
          data-testid="geocode-clear"
        >
          {t("improve.address.clear")}
        </Button>
      </div>

      <div
        role="status"
        data-testid="geocode-feedback"
        data-kind={feedback.kind}
        className="empty:hidden"
      >
        {feedback.kind === "confirmed" ? (
          <ToneAlert tone="success">
            {t("improve.address.confirmed", { address: feedback.address })}
          </ToneAlert>
        ) : null}

        {feedback.kind === "approximate" ? (
          <ToneAlert tone="warning">
            {t("improve.address.usedLocation", {
              // Server-localized precision warning (`warning_key` → `message`).
              warning: feedback.message,
              address: feedback.address,
            })}
          </ToneAlert>
        ) : null}

        {feedback.kind === "failed" ? (
          <ToneAlert tone="destructive">
            {t("errors.geocodeFailed", {
              error:
                feedback.message.trim() !== ""
                  ? feedback.message
                  : attempt?.error
                    ? apiErrorMessage(t, attempt.error)
                    : t("errors.unexpected"),
            })}
          </ToneAlert>
        ) : null}

        {feedback.kind === "changed" ? (
          <ToneAlert tone="info">{t("improve.address.changed")}</ToneAlert>
        ) : null}
      </div>

      {home !== null && hardDistanceFilterApplied !== null ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="hard-filter-caption"
        >
          {hardDistanceFilterApplied
            ? t("improve.distance.hardLimit", {
                // Matches the API's `{max_distance:.0f}` formatting.
                maxDistance: Math.round(
                  meta.recommendation_max_home_distance_km,
                ),
              })
            : t("improve.distance.noHardFilter")}
        </p>
      ) : null}
    </section>
  );
}
