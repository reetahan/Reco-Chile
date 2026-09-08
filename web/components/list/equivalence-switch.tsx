"use client";

import { CircleQuestionMarkIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useWizardStore } from "@/lib/store/wizard";

const SWITCH_ID = "use-equivalence-classes";

/**
 * The "I have not yet decided the exact order between some programs" toggle
 * plus the explanatory note it reveals.
 *
 * Moved here from step 1 to step 2: it is a fact about how
 * the *list* gets built and ordered, not about the student, so it now sits
 * alongside the wish list it governs.
 *
 * The planning caveat ("choose the order it genuinely prefers before
 * submitting") and the grouping explanation are behind a "What does this
 * mean?" popover next to the label, on demand — the same pattern as the RUN/IPE
 * field's "Why do we ask for this?" (`components/student/why-we-ask.tsx`) —
 * rather than a permanently visible line, so the control reads as one sentence
 * plus a switch until someone actually needs the detail.
 *
 * No mode badge: naming the two states ("Strict ranking" / "Equivalence
 * classes") made the control read as jargon. The switch's own on/off state is
 * the readout, and the popover explains what turning it on is for.
 *
 * Flipping the switch triggers the invalidation rule "useEquivalenceClasses
 * toggles → wishes kept, groups reset, simulation invalidated"; the store owns
 * it, this component only calls the action.
 */
export function EquivalenceSwitch() {
  const t = useTranslations("list.ties");

  const useEquivalenceClasses = useWizardStore(
    (state) => state.useEquivalenceClasses,
  );
  const setUseEquivalenceClasses = useWizardStore(
    (state) => state.setUseEquivalenceClasses,
  );

  return (
    <div className="flex items-start gap-3">
      <Switch
        id={SWITCH_ID}
        checked={useEquivalenceClasses}
        onCheckedChange={setUseEquivalenceClasses}
        data-testid="equivalence-switch"
        className="mt-0.5"
      />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={SWITCH_ID} className="font-medium">
            {t("label")}
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="ms-auto"
                data-testid="equivalence-help-trigger"
              >
                <CircleQuestionMarkIcon
                  aria-hidden="true"
                  data-icon="inline-start"
                />
                {t("helpTrigger")}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80"
              aria-label={t("helpTrigger")}
              data-testid="equivalence-help-content"
            >
              <p>{t("help")}</p>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
