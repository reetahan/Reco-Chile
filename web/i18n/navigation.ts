import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Locale-aware replacements for `next/link` and `next/navigation`.
 *
 * Always import `Link`, `redirect`, `usePathname` and `useRouter` from here
 * rather than from `next/*`: these variants add the `/[locale]` prefix on the
 * way out and strip it on the way in, so callers work with wizard paths like
 * `/student` and never hand-build `/es/student`.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
