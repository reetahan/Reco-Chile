/**
 * The two number shapes step 4 prints that `@/lib/format` does not cover:
 * `f"{d:.1f} km"` and `str(round(ratio, 2))`. Both round through the shared
 * `fixedHalfEven` core (re-exported here alongside them), and both return
 * `null` — not a dash — when the value is missing, so the caller drops the
 * whole optional sentence.
 */

import { fixedHalfEven } from "@/lib/format";

export { formatInt, formatPercent, MISSING_NUMBER } from "@/lib/format";

/** `es` is the default UI language; everything else prints like English. */
function decimalSeparator(locale: string): string {
  return locale.toLowerCase().startsWith("es") ? "," : ".";
}

export function isFiniteNumber(
  value: number | null | undefined,
): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `{:.1f}` — the straight-line distance caption, or `null` to omit it. */
export function formatDistanceKm(
  value: number | null | undefined,
  locale: string,
): string | null {
  if (!isFiniteNumber(value)) return null;
  return fixedHalfEven(value, 1).replace(".", decimalSeparator(locale));
}

/**
 * `str(round(ratio, 2))` — applicants per seat. The API sends Python's
 * `str(float)`: trailing zeros dropped, but a whole number keeps one decimal
 * ("3.0", never "3").
 */
export function formatRatio(
  value: number | null | undefined,
  locale: string,
): string | null {
  if (!isFiniteNumber(value)) return null;
  const rounded = fixedHalfEven(value, 2)
    .replace(/(\.\d*?)0+$/, "$1") // 1.20 -> 1.2, 3.00 -> 3.
    .replace(/\.$/, ".0"); // 3. -> 3.0, the way Python prints a whole float
  return rounded.replace(".", decimalSeparator(locale));
}
