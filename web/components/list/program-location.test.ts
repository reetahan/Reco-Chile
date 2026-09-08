import { describe, expect, it } from "vitest";

import {
  formatProgramLocation,
  joinProgramParts,
  PROGRAM_LOCATION_SEPARATOR,
} from "./program-location";

describe("formatProgramLocation", () => {
  it("joins commune and region", () => {
    expect(formatProgramLocation("La Serena", "Región de Coquimbo")).toBe(
      `La Serena${PROGRAM_LOCATION_SEPARATOR}Región de Coquimbo`,
    );
  });

  it("never leaves a dangling separator when one half is missing", () => {
    expect(formatProgramLocation("Frutillar", "")).toBe("Frutillar");
    expect(formatProgramLocation("", "Región de Los Lagos")).toBe(
      "Región de Los Lagos",
    );
  });

  it("treats pandas' 'nan' and whitespace as no information", () => {
    expect(formatProgramLocation("nan", "NaN")).toBe("");
    expect(formatProgramLocation(" ", null)).toBe("");
    expect(formatProgramLocation(undefined, undefined)).toBe("");
  });

  it("trims the parts it keeps", () => {
    expect(formatProgramLocation(" Recoleta ", " RM ")).toBe(
      `Recoleta${PROGRAM_LOCATION_SEPARATOR}RM`,
    );
  });

  it("drops a missing program display name without losing the location", () => {
    expect(joinProgramParts(["", "Olmué", "Región de Valparaíso"])).toBe(
      `Olmué${PROGRAM_LOCATION_SEPARATOR}Región de Valparaíso`,
    );
    expect(
      joinProgramParts(["Ciencias", "Olmué", "Región de Valparaíso"]),
    ).toBe(
      ["Ciencias", "Olmué", "Región de Valparaíso"].join(
        PROGRAM_LOCATION_SEPARATOR,
      ),
    );
  });
});
