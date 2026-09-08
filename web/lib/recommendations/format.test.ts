import { describe, expect, it } from "vitest";

import { formatDistanceKm, formatRatio, isFiniteNumber } from "./format";

/**
 * `formatPercent` / `formatInt` are covered by `lib/format/number.test.ts`;
 * only the two step-4 shapes are asserted here. The expectations are what
 * CPython prints for the same double:
 *
 * .venv/bin/python -c "print(format(4.25, '.1f'), round(3.456, 2))"
 */
describe("formatDistanceKm — Python's {:.1f}", () => {
  it("keeps exactly one decimal", () => {
    expect(formatDistanceKm(12, "en")).toBe("12.0");
    expect(formatDistanceKm(3.14159, "en")).toBe("3.1");
  });

  it("rounds half to even, like CPython and unlike toFixed", () => {
    // `(4.25).toFixed(1)` is "4.3"; `format(4.25, '.1f')` is "4.2".
    expect(formatDistanceKm(4.25, "en")).toBe("4.2");
    expect(formatDistanceKm(0.125, "en")).toBe("0.1");
    // Not an exact tie once written out (2.350000000000000088…), so it rounds
    // up in both languages of the pair.
    expect(formatDistanceKm(2.35, "en")).toBe("2.4");
    // The mirror image, and the case an `Intl` "halfEven" formatter gets wrong:
    // 4.35 is really 4.34999…996, so it rounds DOWN. `format(4.35, '.1f')` is
    // "4.3"; `Intl` reads the shortest repr "4.35" as a tie and prints "4.4".
    expect(formatDistanceKm(4.35, "en")).toBe("4.3");
    // 0.05 is really 0.05000000000000000277, so it rounds up.
    expect(formatDistanceKm(0.05, "en")).toBe("0.1");
  });

  it("uses the Spanish decimal comma", () => {
    expect(formatDistanceKm(12.5, "es")).toBe("12,5");
  });

  it("has no rendering for a missing value, so the caption is dropped", () => {
    expect(formatDistanceKm(null, "es")).toBeNull();
    expect(formatDistanceKm(undefined, "es")).toBeNull();
    expect(formatDistanceKm(Number.NaN, "es")).toBeNull();
  });

  it("never prints a negative zero", () => {
    expect(formatDistanceKm(-0, "en")).toBe("0.0");
  });
});

describe("formatRatio — Python's str(round(x, 2))", () => {
  it("drops trailing zeros but keeps a whole number's single decimal", () => {
    expect(formatRatio(1.2, "en")).toBe("1.2");
    // `recommendations.py:769` stores a rounded *float*, and
    // The API interpolates it, so it arrives as
    // `str(3.0)` — "3.0", not "3".
    expect(formatRatio(3, "en")).toBe("3.0");
    expect(formatRatio(0, "en")).toBe("0.0");
    expect(formatRatio(12, "es")).toBe("12,0");
  });

  it("keeps at most two decimals", () => {
    expect(formatRatio(3.456, "en")).toBe("3.46");
    // 2.675 is really 2.67499…, so round(2.675, 2) is 2.67, not 2.68.
    expect(formatRatio(2.675, "en")).toBe("2.67");
    // round(1.005, 2) is 1.0 for the same reason, and prints with its decimal.
    expect(formatRatio(1.005, "en")).toBe("1.0");
  });

  it("uses the Spanish decimal comma", () => {
    expect(formatRatio(1.25, "es")).toBe("1,25");
  });

  it("has no rendering for a missing value", () => {
    expect(formatRatio(null, "es")).toBeNull();
    expect(formatRatio(Number.NaN, "en")).toBeNull();
  });
});

describe("isFiniteNumber", () => {
  it("guards the optional numeric fields of a recommendation item", () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
