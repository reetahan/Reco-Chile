import createMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";

/**
 * Locale routing (Next.js 16's `proxy.ts` is the renamed Middleware
 * convention). It rewrites/redirects so that every rendered page lives under
 * `/[locale]`, which is what makes `/` land on `/es`.
 *
 * The matcher deliberately skips `/api/*`: `app/api/[...path]/route.ts` is the
 * forwarder to FastAPI (logic in `lib/api/upstream.ts`) and must not be
 * locale-prefixed, rewritten, or otherwise inspected here — the request body
 * carries the student's RUN/IPE.
 */
export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next.js internals, and files with an
  // extension (favicon.ico, images, …).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
