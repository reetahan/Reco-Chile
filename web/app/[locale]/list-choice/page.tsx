import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { ListChoiceScreen } from "@/components/wizard/list-choice-screen";
import { routing } from "@/i18n/routing";

/**
 * "Do you already have your preference list?" (`LIST_CHOICE_PATH`) — reached
 * from step 1's Continue button, before step 2.
 *
 * Deliberately outside the `(wizard)` route group, like the welcome and
 * disclaimer pages: no stepper, no Back/Continue bar, and no `/meta` fetch.
 */
export default async function ListChoicePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(
    hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
  );

  return <ListChoiceScreen />;
}
