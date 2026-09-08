import { describe, expect, it } from "vitest";

import type { ProgramSummary } from "@/lib/api/types";
import { emptyFilters } from "@/lib/store/wizard";
import type { ProgramFilters } from "@/lib/store/types";

import {
  countPreservedOutsideFilters,
  filtersAreActive,
  filtersNarrowTheSearch,
  filtersToQuery,
  PROGRAM_FILTER_FIELDS,
  programMatchesFilters,
} from "./filters";

function filters(patch: Partial<ProgramFilters> = {}): ProgramFilters {
  return { ...emptyFilters(), ...patch };
}

function program(patch: Partial<ProgramSummary> = {}): ProgramSummary {
  return {
    program_id: "1:2",
    program_label: "Liceo Uno",
    school_name: "Liceo Uno",
    school_commune: "Arica",
    region: "Región de Arica y Parinacota",
    program_display_name: "General H-C · Mixed · Full day",
    program_track: "General",
    program_specialty_sector: "General academic",
    program_gender: "Mixed",
    program_school_day: "Full day",
    program_rurality: "Urban",
    program_pie: "With PIE",
    program_pace: "With PACE",
    program_enrollment_fee: "Free",
    program_monthly_fee: "Free",
    program_religious_orientation: "Secular",
    capacity: 100,
    true_applicants_last_year: 200,
    calibration_imputed: false,
    ...patch,
  };
}

describe("filtersToQuery", () => {
  it("sends nothing for untouched filters", () => {
    expect(filtersToQuery(filters())).toEqual({});
    expect(filtersToQuery(null)).toEqual({});
  });

  it("omits empty lists rather than sending them empty", () => {
    // An absent parameter is "no restriction" server-side, which is exactly
    // what an empty multi-select means.
    const query = filtersToQuery(filters({ tracks: [], genders: [] }));
    expect(Object.keys(query)).toEqual([]);
  });

  it("maps every store key to its repeatable query parameter", () => {
    const query = filtersToQuery(
      filters({
        region: "Región de Los Ríos",
        tracks: ["Specialized"],
        specialtySectors: ["Electricity"],
        genders: ["Mixed"],
        schoolDays: ["Full day"],
        rurality: ["Urban"],
        pie: ["With PIE"],
        pace: ["Without PACE"],
        enrollmentFee: ["Free"],
        monthlyFee: ["More than $100,000"],
        religiousOrientation: ["Secular", "Catholic"],
      }),
    );

    expect(query).toEqual({
      region: "Región de Los Ríos",
      track: ["Specialized"],
      specialty_sector: ["Electricity"],
      gender: ["Mixed"],
      school_day: ["Full day"],
      rurality: ["Urban"],
      pie: ["With PIE"],
      pace: ["Without PACE"],
      enrollment_fee: ["Free"],
      monthly_fee: ["More than $100,000"],
      religious_orientation: ["Secular", "Catholic"],
    });
  });

  it("covers every list-valued filter key exactly once", () => {
    const storeKeys = Object.keys(emptyFilters()).filter((k) => k !== "region");
    const covered = ["tracks", ...PROGRAM_FILTER_FIELDS.map((f) => f.key)];
    expect([...covered].sort()).toEqual([...storeKeys].sort());
  });

  it("drops a blank region", () => {
    expect(filtersToQuery(filters({ region: " " }))).toEqual({});
  });

  it("copies the lists instead of aliasing the store", () => {
    const source = filters({ genders: ["Mixed"] });
    const query = filtersToQuery(source);
    query.gender?.push("Boys");
    expect(source.genders).toEqual(["Mixed"]);
  });

  it("serializes stably, so an unchanged query is one cache key", () => {
    const a = filtersToQuery(filters({ region: "X", genders: ["Mixed"] }));
    const b = filtersToQuery(filters({ genders: ["Mixed"], region: "X" }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("filtersAreActive / filtersNarrowTheSearch", () => {
  it("ignores the region for `filters_are_active`", () => {
    expect(filtersAreActive(filters({ region: "X" }))).toBe(false);
    expect(filtersNarrowTheSearch(filters({ region: "X" }))).toBe(true);
  });

  it("reacts to any list", () => {
    expect(filtersAreActive(filters({ pie: ["With PIE"] }))).toBe(true);
    expect(filtersAreActive(filters({ tracks: ["General"] }))).toBe(true);
    expect(filtersNarrowTheSearch(filters())).toBe(false);
  });
});

describe("programMatchesFilters", () => {
  it("accepts everything when nothing is selected", () => {
    expect(programMatchesFilters(program(), filters())).toBe(true);
  });

  it("applies the region", () => {
    expect(
      programMatchesFilters(
        program(),
        filters({ region: "Región de Los Ríos" }),
      ),
    ).toBe(false);
  });

  it("applies the track", () => {
    expect(
      programMatchesFilters(program(), filters({ tracks: ["Specialized"] })),
    ).toBe(false);
    expect(
      programMatchesFilters(program(), filters({ tracks: ["General"] })),
    ).toBe(true);
  });

  it("ignores a specialty selection for general programs", () => {
    // program_matches_filters only applies specialty_sectors when the track is
    // Specialized, so a family that ticked General keeps seeing its programs.
    expect(
      programMatchesFilters(
        program(),
        filters({ tracks: ["General"], specialtySectors: ["Electricity"] }),
      ),
    ).toBe(true);
  });

  it("applies a specialty selection to specialized programs", () => {
    const technical = program({
      program_track: "Specialized",
      program_specialty_sector: "Electricity",
    });
    expect(
      programMatchesFilters(
        technical,
        filters({ specialtySectors: ["Electricity"] }),
      ),
    ).toBe(true);
    expect(
      programMatchesFilters(
        technical,
        filters({ specialtySectors: ["Construction"] }),
      ),
    ).toBe(false);
  });

  it("treats a blank column as Unknown", () => {
    expect(
      programMatchesFilters(
        program({ program_pie: " " }),
        filters({ pie: ["With PIE"] }),
      ),
    ).toBe(false);
    expect(
      programMatchesFilters(
        program({ program_pie: " " }),
        filters({ pie: ["Unknown"] }),
      ),
    ).toBe(true);
  });

  it("requires every selected field to match", () => {
    expect(
      programMatchesFilters(
        program(),
        filters({ genders: ["Mixed"], rurality: ["Rural"] }),
      ),
    ).toBe(false);
  });
});

describe("countPreservedOutsideFilters", () => {
  const inside = program({ program_id: "1:1" });
  const outside = program({ program_id: "2:2", region: "Región de Los Ríos" });
  const programs = new Map([
    [inside.program_id, inside],
    [outside.program_id, outside],
  ]);
  const wishes = [{ programId: "1:1" }, { programId: "2:2" }];

  it("is zero while nothing narrows the search", () => {
    expect(countPreservedOutsideFilters(wishes, programs, filters())).toBe(0);
  });

  it("counts the wishes the filters would hide", () => {
    const active = filters({ region: "Región de Arica y Parinacota" });
    expect(countPreservedOutsideFilters(wishes, programs, active)).toBe(1);
  });

  it("accepts bare ids as well as wishes", () => {
    const active = filters({ region: "Región de Arica y Parinacota" });
    expect(countPreservedOutsideFilters(["1:1", "2:2"], programs, active)).toBe(
      1,
    );
  });

  it("never counts a program it knows nothing about yet", () => {
    const active = filters({ region: "Región de Arica y Parinacota" });
    expect(
      countPreservedOutsideFilters([{ programId: "9:9" }], programs, active),
    ).toBe(0);
  });

  it("counts each program once", () => {
    const active = filters({ region: "Región de Arica y Parinacota" });
    expect(
      countPreservedOutsideFilters(
        [{ programId: "2:2" }, { programId: "2:2" }],
        programs,
        active,
      ),
    ).toBe(1);
  });
});
