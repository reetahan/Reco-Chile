"use client";

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/i18n/navigation";
import { useWizardStore } from "@/lib/store/wizard";

import { stepNumber, type StepSlug } from "./steps";

/**
 * Deep-link guard for the wizard routes: a locked step (or the completion page)
 * redirects to `fallbackHref` — the last allowed step, or the welcome page when
 * its question is unanswered. It gates on client-only state (`studentId`,
 * `simulation` are never persisted), so this can't be a middleware redirect;
 * `router.replace` keeps the locked URL out of history.
 *
 * A skeleton replaces `children` while a redirect is in flight (rendering the
 * step would flash it and fire its data hooks) and for the one frame before
 * `hydrateWizardStore()` runs — see `hydrated` below.
 *
 * `pendingNavigation` handles the one flow that locks the current step on
 * purpose: step 4's "Add selected and review" invalidates the simulation (which
 * locks step 4) and then pushes to step 2. The producer sets that flag before
 * mutating the store; the guard stands down while it is set, and the
 * destination clears it on mount.
 */
export function StepGuard({
  slug,
  allowed,
  fallbackHref,
  children,
}: {
  /** The step the URL is on; `null` on the completion page. */
  slug: StepSlug | null;
  allowed: boolean;
  /** Locale-free redirect target — a step, or `WELCOME_PATH`. */
  fallbackHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  // Persisted slices land one effect after mount; redirecting before `hydrated`
  // would bounce every reload of a reachable step back to the welcome page.
  const hydrated = useWizardStore((state) => state.hydrated);
  const pendingNavigation = useWizardStore((state) => state.pendingNavigation);
  const setPendingNavigation = useWizardStore(
    (state) => state.setPendingNavigation,
  );

  // Arrived at the pending destination: the hand-off is over. `ListStep` clears
  // the flag on mount too; both are idempotent, so no destination can leave the
  // guard switched off.
  const arrived = slug !== null && pendingNavigation === stepNumber(slug);
  React.useEffect(() => {
    if (arrived) setPendingNavigation(null);
  }, [arrived, setPendingNavigation]);

  const suppressed = pendingNavigation !== null && !arrived;

  React.useEffect(() => {
    if (hydrated && !allowed && !suppressed) router.replace(fallbackHref);
  }, [hydrated, allowed, suppressed, router, fallbackHref]);

  if (allowed || suppressed) return <>{children}</>;

  return (
    <div
      className="flex flex-col gap-3"
      // Transient redirect state, not content: nothing to announce.
      aria-hidden="true"
      data-testid="wizard-step-guard-redirect"
    >
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}
