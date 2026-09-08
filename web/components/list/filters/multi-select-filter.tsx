"use client";

/**
 * One of the nine "more filters" multi-selects.
 *
 * A `Popover` + `Command` combobox rather than a plain list of checkboxes: the
 * payment and specialty lists are long enough that a plain
 * multiselect had a search box, and this keeps that. The trigger always reports
 * the current state in words ("Any", a single value, or "n selected"), because
 * a collapsed filter that silently restricts the results is the one thing that
 * makes the matching count look wrong.
 *
 * Values are the API's English wire codes; `optionLabel` is what translates
 * them through `enums.*`. Nothing here filters anything — it only edits
 * the store, and the server does the filtering.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronsUpDownIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type MultiSelectFilterProps = {
  /** DOM id of the trigger; also the base for the label and testid. */
  id: string;
  label: string;
  help: string;
  options: readonly string[];
  /** Selected wire values. */
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** Wire value → display string (usually an `enums.*` lookup). */
  optionLabel: (value: string) => string;
  disabled?: boolean;
  "data-testid"?: string;
};

export function MultiSelectFilter({
  id,
  label,
  help,
  options,
  values,
  onChange,
  optionLabel,
  disabled = false,
  "data-testid": testId,
}: MultiSelectFilterProps) {
  const t = useTranslations("filters");
  const [open, setOpen] = useState(false);

  const selected = new Set(values);
  const summary =
    values.length === 0
      ? t("multi.any")
      : values.length === 1
        ? optionLabel(values[0])
        : t("multi.selected", { n: values.length });

  function toggle(value: string) {
    // Keep the order of `options`, not the click order: the query string and
    // the trigger summary then read the same way for everyone.
    const next = options.filter((option) =>
      option === value ? !selected.has(option) : selected.has(option),
    );
    onChange(next);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label id={`${id}-label`} htmlFor={id}>
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={`${id}-label ${id}-value`}
            disabled={disabled}
            data-testid={testId}
            data-selected-count={values.length}
            className="w-full justify-between font-normal"
          >
            <span
              id={`${id}-value`}
              className="truncate"
              data-empty={values.length === 0 || undefined}
            >
              {summary}
            </span>
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-56 p-0"
          aria-label={label}
        >
          <Command>
            <CommandInput placeholder={t("multi.search")} />
            <CommandList>
              <CommandEmpty>{t("multi.empty")}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option}
                    value={`${optionLabel(option)} ${option}`}
                    data-checked={selected.has(option)}
                    data-value={option}
                    onSelect={() => {
                      toggle(option);
                    }}
                  >
                    {optionLabel(option)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          {values.length > 0 ? (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start font-normal"
                onClick={() => {
                  onChange([]);
                }}
              >
                <XIcon className="size-4" />
                {t("multi.clear")}
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      <p className="text-xs text-pretty text-muted-foreground">{help}</p>
    </div>
  );
}
