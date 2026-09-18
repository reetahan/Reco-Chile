"use client";

import { CircleQuestionMarkIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The "Why do we ask for this?" popover next to the RUN/IPE field. The panel
 * needs `aria-label` for its accessible name since Radix gives it
 * `role="dialog"`, which the trigger's own text doesn't satisfy.
 */
export function WhyWeAsk() {
  const t = useTranslations("student.why");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="student-why-trigger">
          <CircleQuestionMarkIcon aria-hidden="true" data-icon="inline-start" />
          {t("title")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80"
        aria-label={t("title")}
        data-testid="student-why-content"
      >
        <p>{t("body")}</p>
        {/* The same paragraph, one level quieter. */}
        <PopoverDescription className="text-xs">
          {t("privacy")}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
