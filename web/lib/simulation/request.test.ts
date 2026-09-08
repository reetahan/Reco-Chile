import { describe, expect, it } from "vitest";

import { makeWish } from "@/lib/store/wizard";

import { buildSimulationRequest, canSimulate } from "./request";

/**
 * The store -> `/simulate` mapping. The important part
 * is the strict/ties asymmetry: `equivalence_group` must be absent in strict
 * mode, because the contract then treats each wish as its own group equal to
 * its position — the one code path that covers both modes.
 */

const wishes = [
  { ...makeWish("1184:131000000133"), prioritySibling: true },
  { ...makeWish("1371:131000000233"), priorityAlreadyRegistered: true },
];

describe("buildSimulationRequest", () => {
  it("omits the equivalence group in strict mode", () => {
    const request = buildSimulationRequest({
      studentId: " 12.345.678-5 ",
      wishes,
      useEquivalenceClasses: false,
    });

    expect(request.student_id).toBe("12.345.678-5");
    expect(request.wishes).toEqual([
      {
        program_id: "1184:131000000133",
        priority_sibling: true,
        priority_student: false,
        priority_parent_civil_servant: false,
        priority_ex_student: false,
        priority_already_registered: false,
      },
      {
        program_id: "1371:131000000233",
        priority_sibling: false,
        priority_student: false,
        priority_parent_civil_servant: false,
        priority_ex_student: false,
        priority_already_registered: true,
      },
    ]);
    for (const wish of request.wishes) {
      expect(wish).not.toHaveProperty("equivalence_group");
    }
  });

  it("sends the preference group in ties mode", () => {
    const request = buildSimulationRequest({
      studentId: "12345678-5",
      wishes: [
        { ...makeWish("a:1", 1) },
        { ...makeWish("b:2", 1) },
        // Never numbered: falls back to its position, like the engine's
        // `prepare_ordered_wishes`.
        { ...makeWish("c:3", null) },
      ],
      useEquivalenceClasses: true,
    });

    expect(request.wishes.map((wish) => wish.equivalence_group)).toEqual([
      1, 1, 3,
    ]);
  });

  it("keeps the list in its current order", () => {
    const request = buildSimulationRequest({
      studentId: "12345678-5",
      wishes,
      useEquivalenceClasses: false,
    });
    expect(request.wishes.map((wish) => wish.program_id)).toEqual([
      "1184:131000000133",
      "1371:131000000233",
    ]);
  });
});

describe("canSimulate", () => {
  it("needs both an identifier and at least one wish", () => {
    expect(
      canSimulate({ studentId: "", wishes, useEquivalenceClasses: false }),
    ).toBe(false);
    expect(
      canSimulate({ studentId: " ", wishes, useEquivalenceClasses: false }),
    ).toBe(false);
    expect(
      canSimulate({
        studentId: "12345678-5",
        wishes: [],
        useEquivalenceClasses: false,
      }),
    ).toBe(false);
    expect(
      canSimulate({
        studentId: "12345678-5",
        wishes,
        useEquivalenceClasses: false,
      }),
    ).toBe(true);
  });
});
