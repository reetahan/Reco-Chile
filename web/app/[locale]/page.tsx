import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { DisclaimerScreen } from "@/components/wizard/disclaimer-screen";
import { routing } from "@/i18n/routing";

/**
 * Locale index (`/es`, `/en`) — the wizard's front door: the "Before we
 * continue" consent screen. Its checkbox is what `canEnterStep(1)` requires,
 * so the step guard sends deep links here.
 *
 * Outside the `(wizard)` route group: no stepper, no Back/Continue bar, and no
 * `/meta` fetch, so it stays up even when FastAPI is down.
 */

export default async function LocaleIndex({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(
    hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  );

  return <DisclaimerScreen />;
}
