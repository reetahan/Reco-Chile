import { FinishScreen } from "@/components/wizard/finish-screen";

/**
 * The completion page — `/[locale]/finish`.
 *
 * Inside the `(wizard)` route group so it inherits `/meta`, the store and the
 * step guard, but it is **not** a step: `components/wizard/wizard-shell.tsx`
 * renders it without the stepper and without the Back/Continue bar, and gates
 * it on a fresh simulation (redirecting to the result step otherwise). It is
 * reached only from the result step's "Finish" button.
 */
export default function FinishPage() {
  return <FinishScreen />;
}
