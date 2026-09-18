"use client";

/**
 * The equivalence-class order-count warning under the list (ties mode only).
 * Only the over-cap state renders — the same message the API returns as 422
 * `too_many_equivalence_orders`, checked client-side against `/meta` so the
 * family can split a group before pressing Continue. The count is pure
 * combinatorics over the family's own grouping, not a probability, and is
 * re-checked server-side either way.
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
