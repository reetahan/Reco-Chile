"use client";

/**
 * The per-wish priority editor (the "Does the student have priority
 * at this establishment?" collapsible inside every wish card).
 *
 * Two deliberate details:
 *
 * 1. The visible label of each checkbox is the *situation* ("Has a sibling
 * enrolled at the establishment"), not the name of the criterion. Families
 * tick what is true of them; the criterion name only appears in the
 * "Declared priorities: …" summary on the card.
 * 2. "Already enrolled" sits below a separator with its own caption, because it
 * is not one of the four SAE priority criteria — it is the safety flag the
 * engine reads as `SAFETY`.
 *
 * Every checkbox writes straight through `setWishFlag`, which invalidates the
 * simulation: a priority changes the student's tier, so a
 * result computed without it is no longer valid.
 */

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  useWizardStore,
  type PriorityFlag,
  type Wish,
} from "@/lib/store/wizard";

/** The four SAE criteria, in order. */
export const SAE_PRIORITY_FLAGS = [
  "prioritySibling",
  "priorityStudent",
  "priorityParentCivilServant",
  "priorityExStudent",
] as const satisfies readonly PriorityFlag[];

/** Message-id suffix under `wishes.priorities.*` for every flag. */
export const PRIORITY_MESSAGE_KEY = {
  prioritySibling: "sibling",
  priorityStudent: "student",
  priorityParentCivilServant: "parentCivilServant",
  priorityExStudent: "exStudent",
  priorityAlreadyRegistered: "alreadyRegistered",
} as const satisfies Record<PriorityFlag, string>;

export function WishPriorities({
  wish,
  programName,
}: {
  wish: Wish;
  /** Program label, for the accessible name of the section. */
  programName: string;
}) {
  const t = useTranslations("wishes.priorities");
  const setWishFlag = useWizardStore((state) => state.setWishFlag);
  const [open, setOpen] = React.useState(false);

  const rowId = React.useId();
  const checkboxId = (flag: PriorityFlag) => `${rowId}-${flag}`;

  const renderCheckbox = (flag: PriorityFlag) => (
    <div key={flag} className="flex items-start gap-2">
      <Checkbox
        id={checkboxId(flag)}
        className="mt-0.5"
        checked={wish[flag]}
        onCheckedChange={(checked) =>
          setWishFlag(wish.programId, flag, checked === true)
        }
      />
      <Label
        htmlFor={checkboxId(flag)}
        className="text-sm leading-snug font-normal"
      >
        {t(`descriptions.${PRIORITY_MESSAGE_KEY[flag]}`)}
      </Label>
    </div>
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-testid="wish-priorities"
    >
      <CollapsibleTrigger
        className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        // Many identical triggers share the page, so the accessible name has to
        // name the program; the visible text stays the question.
        aria-label={`${t("title")} — ${t("forProgram", { program: programName })}`}
      >
        <span>{t("title")}</span>
        <ChevronDownIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform data-open:rotate-180"
          data-open={open ? "" : undefined}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pt-2">
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        <div className="flex flex-col gap-2">
          {SAE_PRIORITY_FLAGS.map(renderCheckbox)}
        </div>
        <Separator />
        <p className="text-xs text-muted-foreground">
          {t("alreadyRegisteredNote")}
        </p>
        {renderCheckbox("priorityAlreadyRegistered")}
      </CollapsibleContent>
    </Collapsible>
  );
}
