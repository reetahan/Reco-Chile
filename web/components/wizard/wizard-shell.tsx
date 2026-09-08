"use client";

import * as React from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta } from "@/lib/api/types";
import { MetaProvider } from "@/lib/meta";
import { hydrateWizardStore, useWizardStore } from "@/lib/store/wizard";

import { StepGuard } from "./step-guard";
import { Stepper } from "./stepper";
import { useWizardGating } from "./use-wizard-gating";
import { WizardNav } from "./wizard-nav";

/**
 * The wizard's `"use client"` boundary: stepper, step guard and Back/Continue
 * bar around whichever step page the router rendered. The completion page
 * (`/finish`) is in the same group but drawn bare.
 *
 * `TooltipProvider` is mounted once here, not per step, so Radix's shared
 * "skip the open delay" timer makes a row of info icons behave as one group.
 */
export function WizardShell({
  meta,
  children,
}: {
  meta: Meta;
  children: React.ReactNode;
}) {
  return (
    <MetaProvider meta={meta}>
      <TooltipProvider>
        <WizardShellInner>{children}</WizardShellInner>
      </TooltipProvider>
    </MetaProvider>
  );
}

/** Inside the provider, so the gating hook can read `/meta`. */
function WizardShellInner({ children }: { children: React.ReactNode }) {
  // The store persists `wishes` / `listExists` / `useEquivalenceClasses` /
  // `filters` to sessionStorage with `skipHydration`, so that the first client
  // render matches the server HTML; this is the one place that rehydrates it.
  React.useEffect(() => {
    void hydrateWizardStore();
  }, []);

  const { kind, slug, allowed, fallbackHref, canEnter, canContinue } =
    useWizardGating();

  // `WizardNav.pending` is owned by whichever step has a request in flight; the
  // shell only forwards it, and a step raises it through `setStepBusy` — see
  // the contract on `stepBusy` in the store. No step sets it today (the result
  // step's `/simulate` announces itself with its own skeleton, and // item 6 that step has no Continue), so the spinner never appears until one
  // does.
  const stepBusy = useWizardStore((state) => state.stepBusy);

  // The completion page shares the group's layout — `/meta`, the store, the
  // toaster — but it is not a step: no rail, no Back/Continue, and
  // its own gate (a fresh simulation). Everything above this line is a hook, so
  // the early return changes no hook order.
  if (kind === "finish") {
    return (
      <div className="flex min-h-full flex-col">
        <StepGuard slug={null} allowed={allowed} fallbackHref={fallbackHref}>
          {children}
        </StepGuard>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <Stepper current={slug} canEnter={canEnter} />
      <div className="flex-1 pt-8">
        <StepGuard slug={slug} allowed={allowed} fallbackHref={fallbackHref}>
          {children}
        </StepGuard>
      </div>
      <WizardNav slug={slug} canContinue={canContinue} pending={stepBusy} />
    </div>
  );
}
