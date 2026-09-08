import { describe, expect, it } from "vitest";

import { runCheckDigit } from "@/lib/validation/student-id";

import { maskStudentId } from "./mask-student-id";

/** A RUN body with its correct modulo-11 verifier appended. */
function run(body: string): string {
  return `${body}-${runCheckDigit(body)}`;
}

describe("maskStudentId", () => {
  it("keeps the last five body digits and the verifier of a RUN", () => {
    expect(maskStudentId("12.345.678-5")).toBe("…45678-5");
    // Dots and hyphen are optional on the way in; the mask is the same.
    expect(maskStudentId("123456785")).toBe("…45678-5");
  });

  it("keeps the last five body digits and the verifier of an IPE", () => {
    // Ten compact digits parse as an IPE, not a RUN.
    expect(maskStudentId("100200304-7")).toBe("…00304-7");
  });

  it("shows a short body whole rather than redacting all of it", () => {
    expect(maskStudentId(run("1"))).toBe(run("1"));
    expect(maskStudentId(run("1234"))).toBe(run("1234"));
  });

  it("returns an empty string for anything that is not a valid RUN or IPE", () => {
    expect(maskStudentId("")).toBe("");
    expect(maskStudentId("not-an-id")).toBe("");
    // Right shape, wrong check digit.
    expect(maskStudentId("12345678-1")).toBe("");
  });
});
