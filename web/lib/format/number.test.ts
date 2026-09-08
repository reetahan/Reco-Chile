import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  fixedHalfEven,
  formatBareInt,
  formatInt,
  formatPercent,
  MISSING_NUMBER,
} from "./number";

/**
 * Tests for the two Python format specs the API's numbers must match:
 * `{:.1%}` and `{:,}`.
 *
 * Every expectation below was produced by CPython 3.12 from the same double:
 *
 * .venv/bin/python -c "print(format(0.5484693677668459, '.1%'))" -> 54.8%
 */

/** `f"{value:.1%}"` for a spread of golden-fixture probabilities. */
const PERCENT_CASES: ReadonlyArray<[number, string]> = [
  // strict_04 unmatched risk — the value the e2e parity test asserts.
  [0.5484693677668459, "54.8%"],
  // strict_04 wish 1: tiny but non-zero, rounds to a flat 0.0%.
  [9.573377083170576e-5, "0.0%"],
  // equiv_02 variant 1 predicted-outcome chance.
  [0.9918730650154799, "99.2%"],
  // equiv_01 variant 1 predicted-outcome chance / unmatched risk.
  [0.805624836936367, "80.6%"],
  [0.0081329962113743, "0.8%"],
  // The two /meta thresholds.
  [0.027, "2.7%"],
  [0.004, "0.4%"],
  // Never rounded up to 100.0% by accident, and never short of it.
  [0.9999042662291683, "100.0%"],
  [1, "100.0%"],
  [0, "0.0%"],
  [0.12345, "12.3%"],
  // Exact binary ties: Python rounds half to EVEN, `toFixed` rounds half up
  // (it would print "6.3%" and "18.7%" here).
  [0.0625, "6.2%"],
  [0.1875, "18.8%"],
  [0.4375, "43.8%"],
  [0.03125, "3.1%"],
  // Not a tie once the double is written out (6.875000000000000888…).
  [0.06875, "6.9%"],
  // *False* ties — the trap `Intl.NumberFormat({roundingMode: "halfEven"})`
  // falls into. Its shortest round-trip repr ends in 5, so it rounds to even
  // and prints the commented value; the exact double is just short of (or just
  // past) the boundary, and CPython prints what is asserted. This class of
  // divergence hit 1.3% of sampled probabilities, so these are the cases that
  // keep the rendered percentages equal to the fixtures.
  [0.0435, "4.3%"], // Intl: 4.4%
  [0.0005, "0.1%"], // Intl: 0.0%
  [0.6245, "62.5%"], // Intl: 62.4%
  [0.7735, "77.3%"], // Intl: 77.4%
  [0.1905, "19.1%"], // Intl: 19.0%
  [0.3345, "33.5%"], // Intl: 33.4%
  [0.4915, "49.1%"], // Intl: 49.2%
  [0.9745, "97.5%"], // Intl: 97.4%
  [0.0215, "2.1%"], // Intl: 2.2%
  [0.2195, "21.9%"], // Intl: 22.0%
  [0.1195, "11.9%"], // Intl: 12.0%
];

describe("fixedHalfEven", () => {
  /** The shared core: every other helper here and in
   * `lib/recommendations/format.ts` rounds through it, so CPython's rule is
   * asserted once. Expectations from `format(<value>, '.<n>f')`. */
  it("rounds the exact double, breaking real ties to even", () => {
    expect(fixedHalfEven(6.25, 1)).toBe("6.2");
    expect(fixedHalfEven(6.35, 1)).toBe("6.3"); // 6.34999…, not a tie
    expect(fixedHalfEven(2.35, 1)).toBe("2.4"); // 2.35000…088, not a tie
    expect(fixedHalfEven(0.5, 0)).toBe("0");
    expect(fixedHalfEven(1.5, 0)).toBe("2");
    expect(fixedHalfEven(2.5, 0)).toBe("2");
  });

  it("carries through a run of nines", () => {
    expect(fixedHalfEven(9.99, 1)).toBe("10.0");
    expect(fixedHalfEven(99.999999, 1)).toBe("100.0");
    expect(fixedHalfEven(0.99, 0)).toBe("1");
  });

  it("never returns a negative zero", () => {
    expect(fixedHalfEven(-0, 1)).toBe("0.0");
    expect(fixedHalfEven(-0.001, 1)).toBe("0.0");
    expect(fixedHalfEven(-1.25, 1)).toBe("-1.2");
  });

  it("keeps the sign above the 1e15 short circuit", () => {
    // Past 1e15 there is no rounding decision left, but the sign still has to
    // survive — the branch used to return the absolute value.
    // .venv/bin/python -c "print(format(-1e15, '.0f'))" -> -1000000000000000
    expect(fixedHalfEven(-1e15, 0)).toBe("-1000000000000000");
    expect(fixedHalfEven(-2.5e15, 1)).toBe("-2500000000000000.0");
    expect(fixedHalfEven(1e15, 0)).toBe("1000000000000000");
  });
});

describe("formatPercent", () => {
  it.each(PERCENT_CASES)(
    "formats %f like Python's {:.1%%} in English",
    (value, expected) => {
      expect(formatPercent(value, "en")).toBe(expected);
    },
  );

  it.each(PERCENT_CASES)(
    "formats %f with a comma decimal separator in Spanish",
    (value, expected) => {
      expect(formatPercent(value, "es")).toBe(expected.replace(".", ","));
    },
  );

  it("renders a missing value as a dash instead of NaN", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY])
      expect(formatPercent(value, "es")).toBe(MISSING_NUMBER);
  });

  it("never prints a negative zero", () => {
    expect(formatPercent(-0, "en")).toBe("0.0%");
  });
});

describe("formatInt", () => {
  it("groups thousands like Python's {:,}", () => {
    expect(formatInt(1234, "en")).toBe("1,234");
    expect(formatInt(10000, "en")).toBe("10,000");
    // 12! — the kind of order count the equivalence cap talks about.
    expect(formatInt(479001600, "en")).toBe("479,001,600");
    expect(formatInt(24, "en")).toBe("24");
  });

  it("uses the Spanish group separator", () => {
    expect(formatInt(1234, "es")).toBe("1.234");
    expect(formatInt(10000, "es")).toBe("10.000");
    expect(formatInt(479001600, "es")).toBe("479.001.600");
    expect(formatInt(24, "es")).toBe("24");
  });

  it("renders a missing value as a dash", () => {
    expect(formatInt(null, "en")).toBe(MISSING_NUMBER);
    expect(formatInt(Number.NaN, "es")).toBe(MISSING_NUMBER);
  });
});

describe("formatBareInt", () => {
  /**
   * The counterpart of `formatInt`: Python's plain `f"{value}"`, which the
   * used for every integer printed inside a table (seats, applicants,
   * the MTB lottery rank, and `format_display_table`'s Capacity / Estimated MTB
   * rank). No separator, and therefore no locale.
   */
  it("never groups thousands, in either language", () => {
    expect(formatBareInt(1234)).toBe("1234");
    expect(formatBareInt(10000)).toBe("10000");
    // The exact trap in Spanish: `formatInt` prints "1.234", which a family
    // reads as 1.234 — a different lottery rank.
    expect(formatInt(1234, "es")).toBe("1.234");
    expect(formatBareInt(45)).toBe("45");
    expect(formatBareInt(0)).toBe("0");
    expect(formatBareInt(-7)).toBe("-7");
  });

  it("rounds a float half to even, like `int(round(x))`", () => {
    expect(formatBareInt(1.5)).toBe("2");
    expect(formatBareInt(2.5)).toBe("2");
    expect(formatBareInt(0.5)).toBe("0");
    expect(formatBareInt(-1.5)).toBe("-2");
    expect(formatBareInt(12.4)).toBe("12");
  });

  it("renders a missing value as a dash", () => {
    for (const value of [
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(formatBareInt(value)).toBe(MISSING_NUMBER);
    }
  });
});

describe("golden fixtures", () => {
  /** Read straight from the committed baseline, so a regenerated fixture with
   * different numbers fails here instead of silently passing. */
  function golden(name: string): Record<string, unknown> {
    // Relative to the Vitest root (`web/`), not to this file: Vite rewrites
    // `new URL(<literal>, import.meta.url)` into an asset import.
    const path = resolve(
      process.cwd(),
      "../tests/fixtures/golden",
      `${name}.json`,
    );
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  }

  it("renders the strict_04 unmatched risk to the fixture value", () => {
    const fixture = golden("strict_04_eight_wishes_scarce");
    const expected = fixture.expected as { unmatched_risk: number };

    expect(formatPercent(expected.unmatched_risk, "en")).toBe("54.8%");
    expect(formatPercent(expected.unmatched_risk, "es")).toBe("54,8%");
  });

  it("renders the equiv_03 probability-shift bounds", () => {
    const fixture = golden("equiv_03_group_of_four_probability_shift");
    const expected = fixture.expected as {
      variants: { predicted_outcome_final_chance: number }[];
    };
    const chances = expected.variants.map(
      (variant) => variant.predicted_outcome_final_chance,
    );

    // The two bounds the result step prints for the probability-shift verdict.
    // .venv/bin/python -c "print(format(0.7193793134178188, '.1%'),
    // format(0.9900056308153562, '.1%'))"
    expect(formatPercent(Math.min(...chances), "es")).toBe("71,9%");
    expect(formatPercent(Math.max(...chances), "es")).toBe("99,0%");
    expect(formatPercent(Math.max(...chances), "en")).toBe("99.0%");
  });

  it("renders every probability in every fixture the way CPython does", () => {
    /**
     * The e2e parity specs build their expectations with `formatPercent`
     * itself, so they cannot catch a formatter that is uniformly wrong. This
     * closes that loop from the other side: every probability the baseline
     * contains is rounded here, and any value whose exact double sits within a
     * whisker of a `.05` boundary — the class where a shortest-repr rounder
     * silently disagrees with CPython — is asserted against the digits CPython
     * would print, derived from the exact decimal expansion rather than from
     * the same code path under test.
     */
    const files = [
      "strict_01_single_wish",
      "strict_02_three_wishes",
      "strict_03_four_wishes_priority_tiers",
      "strict_04_eight_wishes_scarce",
      "strict_05_twelve_wishes_already_registered",
      "strict_06_imputed_and_zero_capacity",
      "equiv_01_two_tied_stable_outcome",
      "equiv_02_two_groups_of_three",
      "equiv_03_group_of_four_probability_shift",
    ];

    const probabilities: number[] = [];
    const collect = (node: unknown): void => {
      if (typeof node === "number") {
        if (node >= 0 && node <= 1) probabilities.push(node);
      } else if (Array.isArray(node)) {
        node.forEach(collect);
      } else if (node && typeof node === "object") {
        Object.values(node).forEach(collect);
      }
    };
    files.forEach((name) => collect(golden(name)));
    expect(probabilities.length).toBeGreaterThan(100);

    for (const value of probabilities) {
      // CPython's `{:.1%}`, spelled out independently: scale in binary (as
      // CPython does), then round the exact decimal expansion half to even.
      const exact = (value * 100).toFixed(30);
      const [whole, decimals] = exact.split(".");
      const keep = `${whole}${decimals[0]}`;
      const rest = decimals.slice(1);
      const tie = /^5(0*)$/.test(rest);
      const up = tie
        ? Number(keep[keep.length - 1]) % 2 === 1
        : Number(rest[0]) >= 5;
      // `keep` is at most four digits here (a percentage of 0–100 with one
      // decimal), so plain integer arithmetic is exact.
      const digits = String(Number(keep) + (up ? 1 : 0)).padStart(2, "0");
      const expected = `${digits.slice(0, -1)}.${digits.slice(-1)}%`;

      expect(formatPercent(value, "en")).toBe(expected);
    }
  });
});
