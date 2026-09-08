"use client";

import * as React from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Four callout tones, shared with the recommendation risk badges:
 * success / warning / error / info.
 *
 * shadcn's `Alert` only ships `default` and `destructive`, and the theme
 * (`app/globals.css`) defines no
 * success or warning token — the palette is deliberately near-monochrome. The
 * green and amber are therefore raw Tailwind palette colours, used here and in
 * `student-step.tsx` for the same reason. Red is the theme's `--destructive`.
 *
 * The tone is *not* decided here: `risk_level` comes from the engine
 * (`_risk_color`, thresholded server-side against `/meta`), so the mapping in
 * `RISK_LEVEL_TONE` is the only place a colour name is interpreted.
 */
export type AlertTone = "success" | "warning" | "destructive" | "info";

/** `risk_level` on the wire → tone. `gray` is the engine's "no estimate". */
export const RISK_LEVEL_TONE: Record<string, AlertTone> = {
  green: "success",
  orange: "warning",
  red: "destructive",
  gray: "info",
};

export function riskLevelTone(riskLevel: string | null | undefined): AlertTone {
  return RISK_LEVEL_TONE[String(riskLevel ?? "").trim()] ?? "info";
}

const TONE_CLASS: Record<AlertTone, string> = {
  success:
    "border-emerald-300/70 bg-emerald-50 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-50",
  warning:
    "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-50",
  destructive: "border-destructive/40 bg-destructive/8 text-foreground",
  info: "border-border bg-muted text-foreground",
};

const TONE_ICON: Record<
  AlertTone,
  React.ComponentType<{ className?: string }>
> = {
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  destructive: CircleAlertIcon,
  info: InfoIcon,
};

const TONE_ICON_CLASS: Record<AlertTone, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  destructive: "text-destructive",
  info: "text-muted-foreground",
};

export function ToneAlert({
  tone,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { tone: AlertTone }) {
  const Icon = TONE_ICON[tone];

  return (
    <Alert
      // The colour is the message here, so it is also exposed as data for the
      // parity assertions ("badge colour boundaries
      // identical") — a class-name assertion would break on a restyle.
      data-tone={tone}
      className={cn("px-3 py-2.5", TONE_CLASS[tone], className)}
      {...props}
    >
      <Icon
        className={cn("size-4", TONE_ICON_CLASS[tone])}
        aria-hidden="true"
      />
      <AlertDescription className="[text-wrap:pretty] text-current">
        {children}
      </AlertDescription>
    </Alert>
  );
}
