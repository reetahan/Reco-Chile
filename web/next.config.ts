import createNextIntlPlugin from "next-intl/plugin";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit `.next/standalone/server.js` with only the traced runtime files, so
  // `web/Dockerfile` can ship a small image that runs `node server.js` without
  // `node_modules` or a package manager. Harmless outside Docker: `pnpm dev`,
  // `pnpm start` and `pnpm e2e` are unaffected by the extra output.
  output: "standalone",
};

// Wires `i18n/request.ts` (the default path) into the build so that server
// components can resolve messages for the active `[locale]` segment.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
