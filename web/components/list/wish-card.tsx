"use client";

/**
 * One card per wish — the port of the bordered container
 * One row of the wish list.
 * preference list.
 *
 * Anatomy, in order: the rank badge (strict) or
 * the group number input (ties), the compact program label, the
 * `program_display_name · commune · region` detail line, the program-details
 * popover — a `Sheet` here, because the detail table is too tall for a popover
 * on a phone — the declared-priorities caption, Remove, and (strict mode only)
 * the Move up / Move down buttons.
 *
 * The commune and the region are not optional: the label
 * alone repeats across communes — "Liceo Ignacio Carrera Pinto" is a school in
 * San Vicente and a different one in Frutillar — so the location is always
 * rendered, with or without a program display name in front of it. While the
 * program is still loading the line is a skeleton, never an empty gap that
 * later pushes the card open.
 *
 * The card holds no program data of its own: it only knows a `program_id` and
 * asks `useProgram()` for everything else, so a label rule that changes
 * server-side can never leave a stale name on screen. It
 * says so when the program has vanished from the data; dropping such a wish is
 * the step's job (`dropMissingPrograms` plus one toast), not the card's.
 */

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { ProgramDetails } from "@/components/list/program-details";
import {
  formatProgramLocation,
  joinProgramParts,
  PROGRAM_LOCATION_SEPARATOR,
} from "@/components/list/program-location";
import { WishPriorities } from "@/components/list/wish-priorities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useProgram } from "@/lib/programs/use-programs";
import {
  useWizardStore,
  type PriorityFlag,
  type Wish,
} from "@/lib/store/wizard";
import { cn } from "@/lib/utils";

import { PRIORITY_MESSAGE_KEY, SAE_PRIORITY_FLAGS } from "./wish-priorities";

export type WishCardProps = {
  wish: Wish;
  /** 0-based position in the store's list — the source of the `#n` badge. */
  index: number;
  total: number;
  /** Equivalence-class mode: a group input replaces rank and reordering. */
  ties: boolean;
};

export function WishCard({
  wish,
  index,
  total,
  ties,
  dragHandle,
  className,
  style,
  cardRef,
  dragging = false,
}: WishCardProps & {
  /** Drag handle rendered by {@link SortableWishCard}; absent in ties mode. */
  dragHandle?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  cardRef?: (node: HTMLElement | null) => void;
  dragging?: boolean;
}) {
  const t = useTranslations("wishes");
  const removeWish = useWizardStore((state) => state.removeWish);
  const moveWish = useWizardStore((state) => state.moveWish);
  const setWishGroup = useWizardStore((state) => state.setWishGroup);

  // A cache hit: the step already asked for every wish's program with
  // `usePrograms`, so this neither refetches nor waterfalls.
  const { program, loading, notFound } = useProgram(wish.programId);

  // Until the program resolves, the id is the only truthful name available.
  const name = program?.program_label ?? wish.programId;
  // Shown in front of the location when the data has one; a program without a
  // display name loses this half of the line and keeps the location.
  const detailPrefix = joinProgramParts([program?.program_display_name]);
  const location = program
    ? formatProgramLocation(program.school_commune, program.region) ||
      t("card.locationUnknown")
    : "";

  const declared = SAE_PRIORITY_FLAGS.filter(
    (flag: PriorityFlag) => wish[flag],
  ).map((flag) => t(`priorities.labels.${PRIORITY_MESSAGE_KEY[flag]}`));

  // `prepare_ordered_wishes`: a wish with no explicit group is its own class at
  // its 1-based position.
  const group = wish.equivalenceGroup ?? index + 1;
  const groupInputId = `wish-group-${wish.programId.replace(/[^\w-]/g, "-")}`;
  const [groupDraft, setGroupDraft] = React.useState(String(group));

  // Follow the store when the group changes elsewhere (mode toggle, appended
  // recommendations) but never fight the digits currently being typed. Adjusted
  // during render rather than in an effect — the pattern React documents for
  // state derived from props (no extra commit, no flash of the old number).
  const [lastGroup, setLastGroup] = React.useState(group);
  if (group !== lastGroup) {
    setLastGroup(group);
    if (Number(groupDraft) !== group) setGroupDraft(String(group));
  }

  return (
    <Card
      ref={cardRef}
      style={style}
      size="sm"
      data-testid="wish-card"
      data-program-id={wish.programId}
      data-rank={index + 1}
      data-group={ties ? group : undefined}
      className={cn(dragging && "z-10 opacity-80 shadow-lg", className)}
    >
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="flex shrink-0 items-center gap-1">
            {dragHandle}
            {ties ? (
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor={groupInputId}
                  className="text-xs text-muted-foreground"
                >
                  {t("group.short")}
                </Label>
                <Input
                  id={groupInputId}
                  data-testid="wish-group"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  className="w-16 tabular-nums"
                  aria-label={t("group.forProgram", { program: name })}
                  value={groupDraft}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setGroupDraft(raw);
                    const parsed = Number(raw);
                    // `normalize_builder_wishes` clips at 1; an empty or
                    // below-range draft is simply not committed yet.
                    if (raw !== "" && Number.isFinite(parsed) && parsed >= 1) {
                      setWishGroup(wish.programId, parsed);
                    }
                  }}
                  onBlur={() => setGroupDraft(String(group))}
                />
              </div>
            ) : (
              <Badge
                variant="secondary"
                data-testid="wish-rank"
                className="tabular-nums"
              >
                {t("rank.badge", { n: index + 1 })}
                <span className="sr-only">
                  {t("rank.position", { n: index + 1, total })}
                </span>
              </Badge>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-medium break-words" data-testid="wish-label">
              {name}
            </p>
            {program ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="wish-details"
              >
                {detailPrefix
                  ? `${detailPrefix}${PROGRAM_LOCATION_SEPARATOR}`
                  : null}
                {/* The half that disambiguates two same-named schools, in its
                    own element so it can be asserted on independently of the
                    display name the data may or may not carry. */}
                <span data-testid="wish-location">{location}</span>
              </p>
            ) : null}
            {loading ? (
              // A skeleton, not a blank line: the detail line is one of the two
              // things that make the card readable, so its space is reserved.
              <div role="status" data-testid="wish-details-loading">
                <span className="sr-only">{t("card.loading")}</span>
                <Skeleton aria-hidden className="h-3 w-48 max-w-full" />
              </div>
            ) : null}
            {notFound ? (
              <p className="text-xs text-destructive">
                {t("card.unavailable")}
              </p>
            ) : null}

            {program ? (
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto self-start px-0"
                    aria-label={`${t("card.detailsTrigger")} — ${name}`}
                  >
                    {t("card.detailsTrigger")}
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="overflow-y-auto"
                  data-testid="program-details-sheet"
                >
                  <SheetHeader>
                    <SheetTitle>{t("card.detailsTitle")}</SheetTitle>
                    <SheetDescription>
                      {t("card.detailsFor", { program: name })}
                    </SheetDescription>
                  </SheetHeader>
                  <div className="px-4 pb-4">
                    <ProgramDetails programId={wish.programId} />
                  </div>
                </SheetContent>
              </Sheet>
            ) : null}

            <p
              className="text-xs text-muted-foreground"
              data-testid="wish-declared-priorities"
            >
              {declared.length > 0
                ? t("priorities.declared", { priorities: declared.join(", ") })
                : t("priorities.none")}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              data-testid="wish-remove"
              aria-label={t("card.removeProgram", { program: name })}
              onClick={() => removeWish(wish.programId)}
            >
              <Trash2Icon aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{t("card.remove")}</span>
            </Button>
            {ties ? null : (
              // Keyboard and screen-reader path to the same reordering the drag
              // handle offers.
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="wish-move-up"
                  disabled={index === 0}
                  aria-label={t("card.moveUpProgram", { program: name })}
                  onClick={() => moveWish(wish.programId, "up")}
                >
                  <ArrowUpIcon aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">
                    {t("card.moveUp")}
                  </span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="wish-move-down"
                  disabled={index === total - 1}
                  aria-label={t("card.moveDownProgram", { program: name })}
                  onClick={() => moveWish(wish.programId, "down")}
                >
                  <ArrowDownIcon aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">
                    {t("card.moveDown")}
                  </span>
                </Button>
              </div>
            )}
          </div>
        </div>

        <WishPriorities wish={wish} programName={name} />
      </CardContent>
    </Card>
  );
}

/**
 * The strict-mode card: the same card plus a `@dnd-kit` drag handle.
 *
 * Only the handle carries the drag listeners, so the card's buttons, the group
 * input and the priority checkboxes keep working with a pointer; and because
 * `useSortable` needs a `DndContext` ancestor, ties mode renders the plain
 * {@link WishCard} instead of disabling the hook.
 */
export function SortableWishCard(props: WishCardProps) {
  const t = useTranslations("wishes");
  const { program } = useProgram(props.wish.programId);
  const name = program?.program_label ?? props.wish.programId;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.wish.programId });

  return (
    <WishCard
      {...props}
      cardRef={setNodeRef}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      dragHandle={
        <Button
          ref={setActivatorNodeRef}
          variant="ghost"
          size="icon-sm"
          className="cursor-grab touch-none text-muted-foreground"
          data-testid="wish-drag-handle"
          aria-label={t("dnd.handle", { program: name })}
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon aria-hidden="true" />
        </Button>
      }
    />
  );
}
