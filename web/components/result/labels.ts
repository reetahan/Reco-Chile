"use client";

/**
 * Display labels for everything the simulation response names.
 *
 * Three rules are enforced here, in one place:
 *
 * - **Program labels always come from the API** (`program_label`); the frontend
 * never rebuilds one from an id. `tied_order` and `program_order` carry ids,
 * so this module maps them back through the response's own wishes.
 * - **Enumerated values stay English codes on the wire** and are translated
 * from `enums.*`: `Unmatched` and the four priority tiers. School names are
 * shown verbatim.
 * - **A program is never shown without its commune and region**.
 * `WishResult` carries neither, so the location is resolved client-side from
 * `/programs/{id}` through `usePrograms` — the same lookup the wish cards and
 * the finish page use, sharing one module-level cache, so step 3 asking for
 * the list it already asked for on step 2 costs no extra request.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { formatProgramLocation } from "@/components/list/program-location";
import type { SimulationResponse } from "@/lib/api/types";
import { usePrograms } from "@/lib/programs";

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
    }),
    [byId, programs, tOutcome, tTier, tResult],
  );
}
