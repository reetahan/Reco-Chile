import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkIpe,
  checkRun,
  checkStudentIdentifier,
  isValidStudentIdentifier,
  runCheckDigit,
  type StudentIdFailureReason,
} from "@/lib/validation/student-id";

/**
 * The golden fixtures are the contract with the Python engine
 * (`tests/fixtures/golden/identifier_*.json`, from
 * `normalize_student_identifier`). They are read at test time — never copied —
 * so a change on either side breaks this test instead of drifting silently.
 */
// Vitest runs with `web/` as its root, so the repo root is one level up.
const GOLDEN_DIR = resolve(process.cwd(), "../tests/fixtures/golden");

type IdentifierFixture = {
  name: string;
  kind: string;
  description: string;
  inputs: { raw_identifier: string };
  expected: {
    normalized: string | null;
    error_class: string | null;
    message_key: string | null;
  };
};

function loadIdentifierFixtures(): IdentifierFixture[] {
  if (!existsSync(GOLDEN_DIR)) {
    throw new Error(
      `Golden fixtures not found at ${GOLDEN_DIR} — run tests from web/ (pnpm test).`,
    );
  }
  const files = readdirSync(GOLDEN_DIR)
    .filter((name) => name.startsWith("identifier_") && name.endsWith(".json"))
    .sort();
  return files.map(
    (name) =>
      JSON.parse(
        readFileSync(resolve(GOLDEN_DIR, name), "utf8"),
      ) as IdentifierFixture,
  );
}

/** Map the engine's error message key onto this mirror's `reason` code. */
function expectedReason(messageKey: string): StudentIdFailureReason {
  if (messageKey.startsWith("Enter the student RUN/IPE")) return "empty";
  if (messageKey.includes("check digit is invalid")) return "check_digit";
  return "format";
}

const fixtures = loadIdentifierFixtures();

describe("golden identifier fixtures", () => {
  it("finds the five identifier fixtures", () => {
    expect(fixtures.map((fixture) => fixture.name)).toEqual([
      "identifier_01_valid_run",
      "identifier_02_dotted_run",
      "identifier_03_invalid_check_digit",
      "identifier_04_valid_ipe",
      "identifier_05_garbage",
    ]);
  });

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    "%s",
    (_name, fixture) => {
      const result = checkStudentIdentifier(fixture.inputs.raw_identifier);

      if (fixture.expected.normalized !== null) {
        expect(result).toEqual({
          ok: true,
          // Ten compact digits mean IPE, everything else is a RUN — the same
          // dispatch as `normalize_student_identifier`.
          kind:
            fixture.inputs.raw_identifier.replace(/[.\-\s]/g, "").length === 10
              ? "ipe"
              : "run",
          normalized: fixture.expected.normalized,
        });
        return;
      }

      expect(fixture.expected.error_class).toBe("InvalidStudentIdentifier");
      expect(result).toEqual({
        ok: false,
        reason: expectedReason(fixture.expected.message_key ?? ""),
      });
    },
  );
});

describe("checkStudentIdentifier", () => {
  it("accepts a RUN with a correct check digit", () => {
    expect(checkStudentIdentifier("12345678-5")).toEqual({
      ok: true,
      kind: "run",
      normalized: "12345678-5",
    });
    expect(isValidStudentIdentifier("12345678-5")).toBe(true);
  });

  it("rejects the same RUN body with a wrong check digit", () => {
    expect(checkStudentIdentifier("12345678-9")).toEqual({
      ok: false,
      reason: "check_digit",
    });
    expect(isValidStudentIdentifier("12345678-9")).toBe(false);
  });

  it("accepts an IPE (ten compact digits)", () => {
    expect(checkStudentIdentifier("100200300-4")).toEqual({
      ok: true,
      kind: "ipe",
      normalized: "100200300-4",
    });
  });

  it("accepts the optional dots, hyphen, spaces and lower-case K", () => {
    expect(checkStudentIdentifier(" 12.345.678-5 ")).toEqual({
      ok: true,
      kind: "run",
      normalized: "12345678-5",
    });
    expect(checkStudentIdentifier("123456785")).toEqual({
      ok: true,
      kind: "run",
      normalized: "12345678-5",
    });
    // 20.347.878-k → the modulo-11 digit is K; case and hyphen are optional.
    expect(checkStudentIdentifier("20347878k")).toEqual({
      ok: true,
      kind: "run",
      normalized: "20347878-K",
    });
    expect(checkStudentIdentifier("100.200.300-4")).toEqual({
      ok: true,
      kind: "ipe",
      normalized: "100200300-4",
    });
  });

  it("drops leading zeros from the RUN body, like int(body)", () => {
    expect(checkStudentIdentifier("01234567-4")).toEqual({
      ok: true,
      kind: "run",
      normalized: "1234567-4",
    });
  });

  it("reports empty input separately from a format error", () => {
    expect(checkStudentIdentifier("")).toEqual({ ok: false, reason: "empty" });
    expect(checkStudentIdentifier(" ")).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(checkStudentIdentifier("not-an-identifier")).toEqual({
      ok: false,
      reason: "format",
    });
  });

  it("rejects an all-zero body and an over-long RUN", () => {
    expect(checkStudentIdentifier("0-0")).toEqual({
      ok: false,
      reason: "format",
    });
    // Nine body digits + check digit is 10 compact chars, so it is read as an
    // IPE — and a body starting a valid IPE shape passes only as an IPE.
    expect(checkStudentIdentifier("123456789-5")).toEqual({
      ok: true,
      kind: "ipe",
      normalized: "123456789-5",
    });
    // Eleven compact chars is neither shape.
    expect(checkStudentIdentifier("1234567890-5")).toEqual({
      ok: false,
      reason: "format",
    });
  });
});

describe("runCheckDigit", () => {
  it("mirrors the modulo-11 rule, including 0 and K", () => {
    expect(runCheckDigit("12345678")).toBe("5");
    expect(runCheckDigit("20347878")).toBe("K");
    expect(runCheckDigit("11111111")).toBe("1");
  });
});

describe("checkRun / checkIpe used directly", () => {
  it("does not accept an IPE as a RUN", () => {
    expect(checkRun("100200300-4")).toEqual({ ok: false, reason: "format" });
  });

  it("does not accept a RUN as an IPE", () => {
    expect(checkIpe("12345678-5")).toEqual({ ok: false, reason: "format" });
  });

  it("does not invent a check-digit rule for the IPE verifier", () => {
    // The engine only validates the IPE shape, so every verifier digit passes.
    for (const digit of "0123456789") {
      expect(checkIpe(`100200300-${digit}`).ok).toBe(true);
    }
  });
});
