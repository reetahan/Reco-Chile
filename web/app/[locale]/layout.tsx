import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { Toaster } from "@/components/ui/sonner";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

import "../globals.css";

import type { Metadata } from "next";

/**
 * Root layout of the application.
 *
 * `[locale]` sits *above* this layout, which is what makes `<html lang>` — and
 * every string below it — follow the URL. There is deliberately no
 * `app/layout.tsx`: a second root layout would have to hard-code one language.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "app",
  });

  return { title: t("title"), description: t("tagline") };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Pins the locale for every server component below, so `getTranslations()`
  // resolves without re-reading the segment. There is deliberately no
  // `generateStaticParams` here: the wizard layout awaits `/meta` on every
  // render, so prerendering `/es/*` at build time would require the FastAPI
  // service to be up during `pnpm build`.
  setRequestLocale(locale);
  const t = await getTranslations("app");

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <header className="sticky top-0 z-10 border-b border-border bg-background">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
              {/* A brand element, not a heading: `components/wizard/
                  step-page.tsx` renders the step title as the page's single
                  <h1>, and a second level-1 heading repeated on every route
                  would make that title ambiguous to a screen reader. */}
              <p className="text-sm leading-tight font-semibold tracking-tight sm:text-base">
                <Link href="/" className="hover:underline">
                  {t("title")}
                </Link>
              </p>
              <LocaleSwitcher />
            </div>
          </header>
          <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
            {children}
          </main>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
