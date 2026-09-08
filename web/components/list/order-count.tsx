"use client";

/**
 * The equivalence-class order-count warning under the list (ties mode only).
 *
 * Only the over-cap state renders: above `/meta.max_exact_equiv_permutations`,
 * this is the *same* message the API returns as 422
 * `too_many_equivalence_orders`, shown here so the family can split a group
 * before pressing Continue instead of after (pre-checked client-side from
 * `/meta`). Within the limit, the informational
 * count ("The current equivalence classes generate N compatible strict
 * order(s)…") used to print here too, but it added detail nobody acts on
 * without also explaining the concept, so it was dropped.
 *
 * The count itself is combinatorics over the family's own grouping — a product
 * of factorials, not a probability — so computing it in the browser does not
 * breach the rule that the engine owns every number. It is re-checked
 * server-side either way.
 */

import { useFormatter, useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { TriangleAlertIcon } from "lucide-react";
import { equivalenceOrderCount, useWizardStore } from "@/lib/store/wizard";
import { useMeta } from "@/lib/meta";

export function OrderCount() {
  const t = useTranslations();
  const format = useFormatter();
  const meta = useMeta();
  const wishes = useWizardStore((state) => state.wishes);
  const ties = useWizardStore((state) => state.useEquivalenceClasses);

  if (!ties || wishes.length === 0) return null;

  // A single 19-wish class already overflows `Number.MAX_SAFE_INTEGER`, so the
  // count stays a bigint and is formatted, never converted.
  const orders = equivalenceOrderCount(wishes);
  const limit = BigInt(meta.max_exact_equiv_permutations);
  const n = format.number(orders);

  if (orders <= limit) return null;

  return (
    <Alert variant="destructive" data-testid="order-count-over-cap">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertDescription>
        {t("errors.too_many_equivalence_orders", {
          n,
          limit: format.number(meta.max_exact_equiv_permutations),
        })}
      </AlertDescription>
    </Alert>
  );
}
