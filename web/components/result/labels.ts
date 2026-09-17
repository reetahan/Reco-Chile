"use client";

/**
 * Display labels for everything the simulation response names.
 *
 * Program labels always come from the API, never rebuilt from an id.
 * Enumerated values (`Unmatched`, priority tiers) are translated from
 * `enums.*`. A program is never shown without commune and region — `WishResult`
 * carries neither, so the location is resolved client-side via `usePrograms`,
 * the same lookup step 2's wish cards use, sharing one cache.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { formatProgramLocation } from "@/components/list/program-location";
import type { SimulationResponse, WishResult } from "@/lib/api/types";
import { usePrograms } from "@/lib/programs";

/** The engine's outcome code for "none of the listed programs". */
export const UNMATCHED = "Unmatched";

export type ResultLabels = {
  /** An outcome label as the engine names it: a program label, or `Unmatched`. */
  outcome: (label: string) => string;
  /** The program label for a `program_id` (falls back to the id itself). */
  program: (programId: string) => string;
  /** A `priority_tier` code, e.g. `priority_sibling` / `no_priority`. */
  tier: (tier: string) => string;
  /**
   * `"Comuna · Región"` for a program id.
   *
   * `""` while the lookup is in flight and for `Unmatched` (a null id), so a
   * caller renders nothing rather than a placeholder that flashes; once the
   * program has resolved without either field, the "no information" copy is
   * returned instead — the same fallback the wish card shows.
   */
  location: (programId: string | null | undefined) => string;
  /** The wish an outcome corresponds to (matched by id, falling back to the
   * label) — `undefined` for `Unmatched` or a response carrying no id. */
  wishFor: (outcome: {
    label: string;
    program_id: string | null;
  }) => WishResult | undefined;
  schoolName: (programId: string) => string;
};

export function useResultLabels(simulation: SimulationResponse): ResultLabels {
  const tOutcome = useTranslations("enums.outcome");
  const tTier = useTranslations("enums.priorityTier");
  const tResult = useTranslations("result");

  const byId = useMemo(() => {
    const map = new Map<string, string>();
    for (const wish of simulation.wishes) {
      map.set(wish.program_id, wish.program_label);
    }
    return map;
  }, [simulation]);

  const programIds = useMemo(
    () => simulation.wishes.map((wish) => wish.program_id),
    [simulation],
  );
  const { programs } = usePrograms(programIds);

  return useMemo(
    () => ({
      // Only `Unmatched` is a translatable outcome; a school name is data.
      outcome: (label) => (tOutcome.has(label) ? tOutcome(label) : label),
      program: (programId) => byId.get(programId) ?? programId,
      tier: (tier) => (tTier.has(tier) ? tTier(tier) : tier),
      location: (programId) => {
        if (!programId) return "";
        const program = programs.get(programId);
        if (!program) return "";
        return (
          formatProgramLocation(program.school_commune, program.region) ||
          tResult("locationUnknown")
        );
      },
      wishFor: (outcome) =>
        simulation.wishes.find((wish) =>
          outcome.program_id
            ? wish.program_id === outcome.program_id
            : wish.program_label === outcome.label,
        ),
      schoolName: (programId) =>
        programs.get(programId)?.school_name ??
        byId.get(programId) ??
        programId,
    }),
    [byId, programs, simulation, tOutcome, tTier, tResult],
  );
}
