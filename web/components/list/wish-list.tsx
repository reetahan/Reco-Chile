"use client";

/**
 * The family's preference list: one {@link WishCard} per wish, in the order the
 * store holds them.
 *
 * Strict mode offers two equivalent ways to reorder: drag-and-drop with `@dnd-kit`, plus Move up /
 * Move down buttons for keyboard and screen-reader users. `@dnd-kit`'s own
 * keyboard sensor makes the drag handle operable too (space to lift, arrows to
 * move, space to drop), with localized announcements.
 *
 * Ties mode has no ordering at all — a group number replaces it — so the cards
 * are rendered without a `DndContext` and are shown sorted by group, mirroring
 * `display_rows = current_non_empty.sort_values([EQUIV_GROUP, WISH_RANK])` in
 * buttons for keyboard users. That sort is display-only: the store keeps the insertion
 * order, and `/simulate` compacts the groups server-side.
 */

import * as React from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";

import {
  formatProgramLocation,
  joinProgramParts,
} from "@/components/list/program-location";
import { usePrograms } from "@/lib/programs";
import { useWizardStore, type Wish } from "@/lib/store/wizard";

import { SortableWishCard, WishCard } from "./wish-card";

export function WishList() {
  const t = useTranslations();
  const wishes = useWizardStore((state) => state.wishes);
  const ties = useWizardStore((state) => state.useEquivalenceClasses);
  const moveWish = useWizardStore((state) => state.moveWish);

  const ids = React.useMemo(
    () => wishes.map((wish) => wish.programId),
    [wishes],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A few pixels of slop so a tap on the handle is not read as a drag.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Labels for the drag announcements: a screen reader has to hear the school
  // name, not the raw `rbd:program_code`. Served from the same cache the step
  // and the cards already filled, so this costs no extra request.
  //
  // The commune and region ride along: reordering two
  // schools that share a name is exactly when "moved X to preference 2" has to
  // say *which* X, and the announcement is all a screen-reader user hears.
  const { programs } = usePrograms(ids);
  const nameOf = React.useCallback(
    (id: string | number) => {
      const program = programs.get(String(id));
      if (!program) return String(id);
      return joinProgramParts([
        program.program_label,
        formatProgramLocation(program.school_commune, program.region),
      ]);
    },
    [programs],
  );

  const positionOf = React.useCallback(
    (id: string | number | undefined) =>
      id === undefined ? 0 : ids.indexOf(String(id)) + 1,
    [ids],
  );

  const screenReaderInstructions: ScreenReaderInstructions = {
    draggable: t("wishes.dnd.instructions"),
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("wishes.dnd.onDragStart", {
        program: nameOf(active.id),
        position: positionOf(active.id),
        total: ids.length,
      }),
    onDragOver: ({ active, over }) =>
      over
        ? t("wishes.dnd.onDragOver", {
            program: nameOf(active.id),
            position: positionOf(over.id),
            total: ids.length,
          })
        : undefined,
    onDragEnd: ({ active, over }) =>
      t("wishes.dnd.onDragEnd", {
        program: nameOf(active.id),
        position: positionOf(over?.id ?? active.id),
        total: ids.length,
      }),
    onDragCancel: ({ active }) =>
      t("wishes.dnd.onDragCancel", {
        program: nameOf(active.id),
        position: positionOf(active.id),
        total: ids.length,
      }),
  };

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const to = ids.indexOf(String(over.id));
    if (to === -1) return;
    moveWish(String(active.id), to);
  }

  if (wishes.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="wish-list-empty"
      >
        {t("list.current.empty")}
      </p>
    );
  }

  // Store index, not display index: `moveWish` and the group fallback both read
  // the position the store holds.
  const entries: { wish: Wish; index: number }[] = wishes.map(
    (wish, index) => ({
      wish,
      index,
    }),
  );

  if (ties) {
    const sorted = [...entries].sort(
      (a, b) =>
        (a.wish.equivalenceGroup ?? a.index + 1) -
          (b.wish.equivalenceGroup ?? b.index + 1) || a.index - b.index,
    );

    return (
      <ol className="flex list-none flex-col gap-3" data-testid="wish-list">
        {sorted.map(({ wish, index }) => (
          <li key={wish.programId}>
            <WishCard wish={wish} index={index} total={wishes.length} ties />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements, screenReaderInstructions }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="flex list-none flex-col gap-3" data-testid="wish-list">
          {entries.map(({ wish, index }) => (
            <li key={wish.programId}>
              <SortableWishCard
                wish={wish}
                index={index}
                total={wishes.length}
                ties={false}
              />
            </li>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
