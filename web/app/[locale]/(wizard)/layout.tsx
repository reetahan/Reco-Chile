import type { ReactNode } from "react";

import { WizardShell } from "@/components/wizard/wizard-shell";
import { fetchMeta } from "@/lib/meta/fetch-meta";

/**
 * Wizard layout. A server component so it can `await fetchMeta()` once per
 * render and hand the result to `WizardShell` (the `"use client"` boundary that
 * owns the stepper, step guard and Back/Continue bar). The `(wizard)` group
 * keeps it out of the URL; `<html lang>` and the intl provider are one level up.
 */

// Per request, not at build time: `/meta` carries live thresholds and a data
// fingerprint, so a prerendered shell could drift from a redeployed engine (and
// `pnpm build` would need a reachable FastAPI).
export const dynamic = "force-dynamic";

export default async function WizardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const meta = await fetchMeta(locale);

  return <WizardShell meta={meta}>{children}</WizardShell>;
}
