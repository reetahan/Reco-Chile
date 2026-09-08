"use client";

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

/**
 * Error boundary for the wizard route group. Next wraps a segment's *children*,
 * so this covers the four step pages and their API calls but not the
 * `fetchMeta()` in `(wizard)/layout.tsx` — an unreachable FastAPI at layout
 * time bubbles past here.
 *
 * PRIVACY: `error.message` can carry an upstream URL or a serialized request
 * body (RUN/IPE, home address), so the error is never rendered or logged. Only
 * a fixed sentence is shown, plus `error.digest` for correlating a server log
 * line.
 *
 * The locale layout above stays mounted, so `NextIntlClientProvider`, the
 * header and the language switcher are still there and the copy is localized.
 */
export default function WizardError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  /** Re-renders the boundary's children from the client's existing data. */
  reset: () => void;
  /**
   * Next 16's preferred recovery: re-fetches the segment before re-rendering,
   * which is what a failed `/simulate` or `/programs` actually needs. It is typed
   * optional so the component still satisfies the older `reset`-only contract.
   */
  retry?: () => void;
}) {
  const t = useTranslations("app.error");
  const recover = retry ?? reset;

  return (
    <Alert variant="destructive" data-testid="wizard-error">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription>
        <p>{t("body")}</p>
        {error.digest ? (
          <p
            className="mt-2 font-mono text-xs"
            data-testid="wizard-error-digest"
          >
            {t("digest", { digest: error.digest })}
          </p>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <Button
          size="sm"
          variant="outline"
          onClick={() => recover()}
          data-testid="wizard-error-retry"
        >
          <RotateCcwIcon aria-hidden="true" data-icon="inline-start" />
          {t("retry")}
        </Button>
      </AlertAction>
    </Alert>
  );
}
