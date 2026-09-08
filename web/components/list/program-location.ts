/**
 * "Comuna · Región" — the one place that line is built.
 *
 * Several hundred Chilean schools share a name: "Liceo Ignacio Carrera Pinto"
 * exists in San Vicente *and* in Frutillar, "Colegio Alonso de Ercilla" in four
 * communes across four regions. The server-side label
 * (`make_program_option_label`) only appends the commune when the *school name*
 * collides, and it never appends the region — so a label alone is not enough to
 * tell two schools apart, and a family can silently rank the wrong one.
 *
 * The rule this module encodes: wherever a program is named for a family to
 * read or choose, the commune *and* the region are shown with it — never one of
 * the two, never conditionally. That is every listing in the wizard: the
 * combobox rows and its trigger, the wish cards, the recommendation cards, the
 * finish page's read-only list, and on step 3 the headline's most likely
 * school, the outcome podium, the family table and the detailed calculation
 * (`components/result/program-line.tsx` places the line there).
 *
 * One deliberate exception: the equivalence block's permutation tables put a
 * whole strict order on one row, so they name the programs of an *order*, not a
 * program to choose; a location under each would make the row unreadable, and
 * every school in it is disambiguated in the listings above.
 *
 * It lives under `components/list/` because that is where programs are picked;
 * `components/improve/recommendation-card.tsx` and
 * `components/result/labels.ts` import it so the suggested schools and the
 * result listings are disambiguated by exactly the same rule, from the same
 * code.
 */

/** The separator used in the program detail line. */
export const PROGRAM_LOCATION_SEPARATOR = " · ";

/**
 * True for a value that carries no information.
 *
 * The calibration CSVs come through pandas, so an absent cell can arrive as the
 * string `"nan"` rather than as an empty one — `_family_display_value` makes the
 * same check before printing a field.
 */
function isBlank(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  return text === "" || text.toLowerCase() === "nan";
}

/** Drop blank/`nan` parts, trim the rest, and join them with `·`. */
export function joinProgramParts(
  parts: readonly (string | null | undefined)[],
): string {
  return parts
    .filter((part) => !isBlank(part))
    .map((part) => (part as string).trim())
    .join(PROGRAM_LOCATION_SEPARATOR);
}

/**
 * The location line of a program: `"La Serena · Región de Coquimbo"`.
 *
 * Returns `""` when the data has neither — callers render their own
 * "no information" copy instead, so the line never collapses to nothing.
 */
export function formatProgramLocation(
  commune: string | null | undefined,
  region: string | null | undefined,
): string {
  return joinProgramParts([commune, region]);
}
