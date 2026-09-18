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
 * The "I have not yet decided the exact order between some programs" toggle.
 * The grouping explanation is behind a "What does this mean?" popover rather
 * than a permanently visible line.
 *
 * Flipping it triggers the store's invalidation rule: wishes kept, groups
 * reset, simulation invalidated.
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
