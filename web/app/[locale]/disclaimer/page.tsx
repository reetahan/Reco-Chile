import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { DisclaimerScreen } from "@/components/wizard/disclaimer-screen";
import { routing } from "@/i18n/routing";

/**
 * The "Before we continue" consent page (`DISCLAIMER_PATH`) — reached from the
 * welcome page's Continue button, before step 1.
 
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
