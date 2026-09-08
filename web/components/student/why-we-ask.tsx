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
 * The "Why do we ask for this?" popover next to the RUN/IPE field.
 *
 * The question is the trigger's own label, so the panel does not repeat it as
 * a heading — it only needs `aria-label` for its accessible name (Radix gives
 * the panel `role="dialog"`, which the trigger's text does not satisfy on its
 * own). It carries two paragraphs, in the
 * order: what the identifier is used for, then the privacy caveat as a
 * caption. The copy is looked up from `student.why.*`, whose Spanish values
 * come verbatim from `messages/_source.es.json`.
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
