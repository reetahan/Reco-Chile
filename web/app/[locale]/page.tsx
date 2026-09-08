import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { WelcomeScreen } from "@/components/wizard/welcome-screen";
import { routing } from "@/i18n/routing";

/**
 * Locale index (`/es`, `/en`) — the wizard's welcome page and front door. The
 * "do you already have a list?" choice writes `listExists`, which
 * `canEnterStep(1)` requires, so the step guard sends deep links here.
 *
 * Outside the `(wizard)` route group: no stepper, no Back/Continue bar, and no
 * `/meta` fetch, so it stays up even when FastAPI is down.
 */

export default async function LocaleIndex({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(
    hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  );

  return <WelcomeScreen />;
}
