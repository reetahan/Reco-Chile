"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * Two-link segmented control for the header.
 *
 * `usePathname` from `@/i18n/navigation` returns the path *without* the locale
 * prefix, so passing it straight back to `Link` with an explicit `locale`
 * re-renders the same wizard step in the other language — a family half-way
 * through the list does not lose their place by switching.
 *
 * The language names are deliberately identical in both catalogues: a switcher
 * is only useful if you can read the option you cannot currently read.
 */
export function LocaleSwitcher() {
  const pathname = usePathname();
  const activeLocale = useLocale();
  const t = useTranslations("app");

  return (
    <nav
      aria-label={t("languageLabel")}
      className="flex items-center gap-0.5 rounded-full bg-muted p-0.5"
    >
      {routing.locales.map((locale) => {
        const isActive = locale === activeLocale;
        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            hrefLang={locale}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`language.${locale}`)}
          </Link>
        );
      })}
    </nav>
  );
}
