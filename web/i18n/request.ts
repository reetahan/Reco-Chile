import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

/**
 * Per-request i18n configuration, resolved by the `next-intl` plugin wired up
 * in `next.config.ts`.
 *
 * `requestLocale` is the `[locale]` segment matched by `proxy.ts`. It can be
 * `undefined` (a request outside the `[locale]` tree) or invalid (the segment
 * acts as a catch-all for unknown paths), so it is validated here and falls
 * back to Spanish — the default locale — rather than throwing.
 *
 * Messages are loaded per locale from `messages/{locale}/index.ts`, which
 * merges one JSON file per namespace. Only the active
 * locale's catalogue is bundled into the response.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}/index`)).default,
  };
});
