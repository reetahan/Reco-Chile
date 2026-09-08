"use client";

import { ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * The standing privacy statement of step 1 — shown unprompted because its two
 * facts are what the family is asked to trust before typing an identifier: the
 * numbers are computed on the server, and the only outbound request (Nominatim
 * geocoding) happens on an explicit click in step 4 and nowhere else.
 */
export function PrivacyNote() {
  const t = useTranslations("student");

  return (
    <p
      className="flex items-start gap-2 text-xs text-muted-foreground"
      data-testid="student-privacy-note"
    >
      <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{t("privacyNote")}</span>
    </p>
  );
}
