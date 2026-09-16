"use client";

import { CircleHelpIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type FaqItem = { question: string; answer: string };

/**
 * FAQ button next to the language toggle. Content comes from `app.faq.items`
 * (`messages/{es,en}/app.json`) via `t.raw` — add more entries there, no
 * component change needed.
 *
 * `max-h-64 overflow-y-auto` caps the list at roughly two questions before it
 * scrolls internally, so the dialog itself stays a fixed size as more are
 * added; re-tune the height once real content replaces the one sample entry.
 *
 * Icon-only: the header has to keep the brand and the language toggle on one
 * row down to 360px (`e2e/responsive.spec.ts`), which does not leave room for
 * a text label too.
 */
export function FaqDialog() {
  const t = useTranslations("app.faq");
  const items = t.raw("items") as FaqItem[];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("trigger")}
          data-testid="faq-trigger"
        >
          <CircleHelpIcon aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" data-testid="faq-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div
          className="flex max-h-64 flex-col gap-4 overflow-y-auto"
          data-testid="faq-list"
        >
          {items.map((item) => (
            <div key={item.question} className="flex flex-col gap-1 text-sm">
              <p className="font-medium">{item.question}</p>
              <p className="text-muted-foreground">{item.answer}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
