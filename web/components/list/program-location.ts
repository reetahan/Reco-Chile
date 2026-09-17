/**
 * "Comuna · Región" — the one place that line is built.
 *
 * Several hundred Chilean schools share a name across communes (and even
 * regions), and the server-side label only disambiguates by commune, never by
 * region. So wherever a program is named for a family to choose, both the
 * commune and region are shown with it — never one of the two.
 */

export const PROGRAM_LOCATION_SEPARATOR = " · ";

/** True for a value that carries no information — including the string
 * `"nan"`, which pandas produces for an absent calibration cell. */
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
