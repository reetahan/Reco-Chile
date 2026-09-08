import { defineRouting } from "next-intl/routing";

/**
 * Routing contract for the wizard.
 *
 * - `es` is the default and only ever implicit language, exactly as in the
 * engine (`sae_app.i18n.DEFAULT_LANGUAGE`).
 * - `localePrefix: "always"` keeps every URL self-describing, so `/` is a pure
 * redirect to `/es` and a shared link always reopens in the language it was
 * shared in.
 * - `localeDetection: false` disables `Accept-Language` sniffing *and* the
 * `NEXT_LOCALE` cookie. Two reasons: `/` must land on `/es` deterministically
 * (the app is for Chilean families whose browsers are often English), and
 * the app keeps no tracking state it does not need. The language
 * is therefore chosen only by the URL, i.e. by the header switcher.
 */
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "always",
  localeDetection: false,
  localeCookie: false,
});

export type AppLocale = (typeof routing.locales)[number];
