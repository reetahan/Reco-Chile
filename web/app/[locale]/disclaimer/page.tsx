import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { DisclaimerScreen } from "@/components/wizard/disclaimer-screen";
import { routing } from "@/i18n/routing";

/**
 * The "Before we continue" consent page (`DISCLAIMER_PATH`), screen 2 of the
 * front door — reached from the welcome page's Yes/No buttons, before step 1.
 *
 * Deliberately outside the `(wizard)` route group, like the welcome page: no
 * stepper, no Back/Continue bar, and no `/meta` fetch.
 */
export default async function DisclaimerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(
    hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  );

  return <DisclaimerScreen />;
}
