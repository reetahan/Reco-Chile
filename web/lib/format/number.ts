/**
 * Number formatting that exactly matches Python's `{:.1%}` and `{:,}`, so a
 * rendered percentage equals its golden-fixture value digit for digit.
 *
 *   Python  f"{0.5484693677668459:.1%}"  ->  "54.8%"
 *   here    formatPercent(0.5484…, "en") ->  "54.8%"  /  "es" -> "54,8%"
 *
 * Three details make this exact rather than close:
 *
 * 1. **Scaling** happens in binary: `value * 100`, same as CPython's `%` type.
 * 2. **Rounding** is half-to-even on the *exact* binary value — {@link
 *    fixedHalfEven} does it by hand, because `toFixed` breaks ties upward and
 *    `Intl`'s `halfEven` rounds the shortest round-trip decimal, not the exact
 *    value (the two disagreed with CPython on ~1.3% of sampled probabilities).
 * 3. **Separators** come from the table below, not CLDR: `Intl` prints `es`
 *    percentages with a non-breaking space and drops grouping below 10,000.
 */

/** Punctuation per UI language. `es` is the default locale. */
type Separators = { decimal: string; group: string };

const SPANISH: Separators = { decimal: ",", group: "." };
const ENGLISH: Separators = { decimal: ".", group: "," };

/** Shown instead of a number when the value is missing or not finite. */
export const MISSING_NUMBER = "—";

function separators(locale: string): Separators {
  return locale.toLowerCase().startsWith("es") ? SPANISH : ENGLISH;
}

/**
 * Extra digits of the exact expansion to inspect before calling a tie.
 * `toFixed` is specified on the double's exact value, so `toFixed(digits +
 * GUARD_DIGITS)` shows the true expansion. 25 is far more than needed at any
 * magnitude this app prints.
 */
const GUARD_DIGITS = 25;

/**
 * `value` rounded to `digits` decimals, half-to-even on the exact binary value
 * — CPython's rule for `{:.Nf}`, `{:.N%}` and `round(x, N)`. Returns a plain
 * unlocalized string ("4.3", "1234"); callers add grouping and the decimal
 * separator. Negative zero never survives.
 */
export function fixedHalfEven(value: number, digits: number): string {
  const negative = value < 0;
  const abs = Math.abs(value);

  // Past 1e15 every double is already an integer, so there is no rounding to do
  // (and `toFixed` goes exponential past 1e21).
  if (abs >= 1e15) {
    const body = abs.toFixed(digits);
    return negative ? `-${body}` : body;
  }

  const expansion = abs.toFixed(digits + GUARD_DIGITS);
  const point = expansion.indexOf(".");
  const kept = (
    expansion.slice(0, point) + expansion.slice(point + 1, point + 1 + digits)
  ).split("");
  const rest = expansion.slice(point + 1 + digits);

  const first = rest.charCodeAt(0) - 48;
  let roundUp: boolean;
  if (first !== 5) {
    roundUp = first > 5;
  } else if (/[1-9]/.test(rest.slice(1))) {
    roundUp = true; // Above the boundary, so not a tie after all.
  } else {
    // A real tie: keep the last digit even.
    roundUp = (kept[kept.length - 1].charCodeAt(0) - 48) % 2 === 1;
  }

  if (roundUp) {
    let index = kept.length - 1;
    for (;;) {
      if (kept[index] !== "9") {
        kept[index] = String.fromCharCode(kept[index].charCodeAt(0) + 1);
        break;
      }
      kept[index] = "0";
      index -= 1;
      if (index < 0) {
        kept.unshift("1"); // 9.99 -> 10.0
        break;
      }
    }
  }

  const rounded = kept.join("");
  const integerLength = rounded.length - digits;
  const integerPart = rounded.slice(0, integerLength) || "0";
  const fraction = rounded.slice(integerLength);
  const body = digits > 0 ? `${integerPart}.${fraction}` : integerPart;
  return negative && /[1-9]/.test(rounded) ? `-${body}` : body;
}

/** Thousands separators over a run of digits — Python's `,` format option. */
function group(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * A probability (0–1) as a one-decimal percentage — the exact output of
 * Python's `f"{value:.1%}"`. `null` / non-finite render as {@link
 * MISSING_NUMBER}, not "NaN%".
 */
export function formatPercent(
  value: number | null | undefined,
  locale: string,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return MISSING_NUMBER;
  }
  const text = fixedHalfEven(value * 100, 1);
  return `${text.replace(".", separators(locale).decimal)}%`;
}

/**
 * An integer with thousands separators — Python's `f"{value:,}"` ("1,234" in
 * English, "1.234" in Spanish). Used for counts narrated in a sentence:
 * compatible strict orders, the permutation cap.
 */
export function formatInt(
  value: number | null | undefined,
  locale: string,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return MISSING_NUMBER;
  }
  const digits = fixedHalfEven(value, 0);
  const negative = digits.startsWith("-");
  const body = group(
    negative ? digits.slice(1) : digits,
    separators(locale).group,
  );
  return negative ? `-${body}` : body;
}

/**
 * An integer with **no** thousands separator — Python's plain `f"{value}"`.
 *
 * Counts narrated in a sentence are grouped ({@link formatInt}); numbers inside
 * a table — the MTB lottery rank, the seat count, the applicant count — are
 * not, because a grouped "1.234" reads as a different number in Spanish where
 * "." is the group separator. Rounding is the same half-to-even rule.
 */
export function formatBareInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return MISSING_NUMBER;
  }
  return fixedHalfEven(value, 0);
}
