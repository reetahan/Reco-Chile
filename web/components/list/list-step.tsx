"use client";

/**
 * Step 2 — build and order the preference list.
 *
 * Section order, top to bottom, with the ties toggle added first: the
 * "I have not yet decided the exact order" ties toggle lives here because it
 * governs how *this* list gets built and ordered.
 *
 * heading + one caption that depends on the mode
 * the ties toggle (`EquivalenceSwitch`)
 * "N recommended programs were added…" (returning from step 4)
 * filter panel (only "No — help me build it")
 * program search + Add
 * the wish list itself
 * "some programs use imputed calibration" (+ "What does this mean?")
 * the over-cap order-count warning (ties mode, over the limit only)
 *
 * The step owns three things the individual components deliberately do not:
 * the `/meta.max_wishes` limit it hands to the store (so every gate — this
 * page's and the wizard nav's — uses one number), the one `usePrograms` lookup
 * over the whole list (which answers both "is any of them imputed?" and "did
 * any of them vanish?"), and the reaction to the latter — `dropMissingPrograms`
 * plus one warning toast.
 */

import * as React from "react";
import { CircleCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { EquivalenceSwitch } from "@/components/list/equivalence-switch";
import { FilterPanel } from "@/components/list/filters/filter-panel";
import { ImputedNotice } from "@/components/list/imputed-notice";
import { OrderCount } from "@/components/list/order-count";
import { ProgramSearch } from "@/components/list/program-search";
import { WishList } from "@/components/list/wish-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StepPage } from "@/components/wizard/step-page";
import { useMeta } from "@/lib/meta";
import { usePrograms } from "@/lib/programs";
import { useWizardStore } from "@/lib/store/wizard";

/** How many removed programs to name before printing an ellipsis. */
const MAX_NAMED_REMOVALS = 5;

export function ListStep() {
  const t = useTranslations();
  const meta = useMeta();

  const listExists = useWizardStore((state) => state.listExists);
  const ties = useWizardStore((state) => state.useEquivalenceClasses);
  const wishes = useWizardStore((state) => state.wishes);
  const addWish = useWizardStore((state) => state.addWish);
  const setMaxWishes = useWizardStore((state) => state.setMaxWishes);
  const dropMissingPrograms = useWizardStore(
    (state) => state.dropMissingPrograms,
  );
  const recommendationsAdded = useWizardStore(
    (state) => state.recommendationsAddedNotice,
  );
  const clearRecommendationsNotice = useWizardStore(
    (state) => state.clearRecommendationsNotice,
  );
  const setPendingNavigation = useWizardStore(
    (state) => state.setPendingNavigation,
  );

  // Arriving here ends the hand-off step 4 started: it set `pendingNavigation`
  // to this step so the step guard would not `router.replace` away while the
  // append was invalidating the simulation (see `components/wizard/step-guard.tsx`).
  // Clearing it on mount hands the guard back its normal authority.
  React.useEffect(() => {
    setPendingNavigation(null);
  }, [setPendingNavigation]);

  // One source for the length gate: the store applies it to `isWishListValid`,
  // which is what both the Continue button and the stepper read.
  React.useEffect(() => {
    setMaxWishes(meta.max_wishes);
  }, [meta.max_wishes, setMaxWishes]);

  // --- what the whole list looks like in the data --------------------------
  const wishIds = React.useMemo(
    () => wishes.map((wish) => wish.programId),
    [wishes],
  );
  const { programs, missing } = usePrograms(wishIds);

  // Any selected program with `calibration_imputed` triggers the
  // notice, whatever its position.
  const anyImputed = wishes.some(
    (wish) => programs.get(wish.programId)?.calibration_imputed === true,
  );

  // --- programs that disappeared from the data ----------------------
  // `missing` is a fresh array on every render, so the effect keys on its
  // content; dropping the wishes shortens the list and ends the cycle.
  const missingKey = missing.join(",");
  React.useEffect(() => {
    if (missingKey === "") return;
    const dropped = dropMissingPrograms(missingKey.split(","));
    if (dropped.length === 0) return;

    const named = dropped.slice(0, MAX_NAMED_REMOVALS);
    if (dropped.length > named.length) named.push("…");
    // A 404 leaves no label to print, so the id is what the family sees — the
    // same identity the API refused.
    toast.warning(t("list.notices.removed", { programs: named.join(", ") }));
  }, [missingKey, dropMissingPrograms, t]);

  // --- "N recommendations were added" ---------
  // Shown once, then cleared, so the
  // message cannot reappear on a later visit. It is mirrored into local state —
  // adjusted during render, never in an effect — because clearing the store
  // must not take the notice off the screen again. Step 4 appends *before* it
  // navigates, so the count is already in the store at mount; latching any
  // later change too costs one comparison and keeps the banner correct if a
  // second producer ever appears.
  const [addedNotice, setAddedNotice] = React.useState(recommendationsAdded);
  const [seenNotice, setSeenNotice] = React.useState(recommendationsAdded);
  if (recommendationsAdded !== seenNotice) {
    setSeenNotice(recommendationsAdded);
    if (recommendationsAdded > 0) setAddedNotice(recommendationsAdded);
  }
  React.useEffect(() => {
    if (addedNotice > 0) clearRecommendationsNotice();
  }, [addedNotice, clearRecommendationsNotice]);

  // --- adding a program ----------------------------------------------------
  const atMaxWishes = wishes.length >= meta.max_wishes;

  const handleAdd = React.useCallback(
    (programId: string) => {
      // `MAX_WISHES` is enforced by `/simulate`; refusing here keeps the family
      // from building a list the engine would reject.
      if (useWizardStore.getState().wishes.length >= meta.max_wishes) {
        toast.warning(t("list.notices.maxWishes", { max: meta.max_wishes }));
        return;
      }
      addWish(programId);
    },
    [addWish, meta.max_wishes, t],
  );

  const needsBuilder = listExists === false;

  return (
    // A different caption per branch: the filter intro
    // when it is helping to build the list, the preference-order reminder when
    // the family already has one. That is the whole reason `StepPage` takes a
    // `lead` — this step used to duplicate the frame to say it, and then did
    // not get the heading focus every other step has.
    <StepPage
      slug="list"
      leadTestId="list-caption"
      lead={needsBuilder ? t("filters.intro") : t("list.order.preferenceHint")}
    >
      <EquivalenceSwitch />

      {addedNotice > 0 ? (
        // `role="status"` (polite) rather than the `Alert` default of
        // `role="alert"`: this confirms what the family just asked for, and it
        // lands together with the heading focus, which an assertive live region
        // would cut short.
        <Alert role="status" data-testid="recommendations-added">
          <CircleCheckIcon aria-hidden="true" />
          <AlertDescription>
            {t("list.notices.recommendationsAdded", { n: addedNotice })}
          </AlertDescription>
        </Alert>
      ) : null}

      {needsBuilder ? <FilterPanel /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("filters.search.title")}</h2>
        <ProgramSearch
          onAdd={handleAdd}
          excludeIds={wishIds}
          disabled={atMaxWishes}
        />
        {atMaxWishes ? (
          <p className="text-sm text-destructive" data-testid="max-wishes">
            {t("list.notices.maxWishes", { max: meta.max_wishes })}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{t("list.current.title")}</h2>
        {wishes.length > 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="wish-count">
            {t("list.current.count", { n: wishes.length })}
          </p>
        ) : null}
        {wishes.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {ties ? t("wishes.group.hint") : t("list.order.reorderHint")}
          </p>
        ) : null}

        <WishList />
      </section>

      <ImputedNotice imputed={anyImputed} />
      <OrderCount />
    </StepPage>
  );
}
