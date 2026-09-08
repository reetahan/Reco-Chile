import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeocodeResult, SimulationResponse } from "@/lib/store/types";
import {
  canContinue,
  canEnterStep,
  hasAcknowledgedDisclaimer,
  hasListChoice,
  DEFAULT_RECOMMENDATION_COUNT,
  emptyFilters,
  equivalenceOrderCount,
  equivalenceOrderCountExceeds,
  hydrateWizardStore,
  initialWizardState,
  isWishListValid,
  lastAllowedStep,
  makeWish,
  nextEquivalenceGroup,
  selectCanContinue,
  selectCanEnterStep,
  useWizardStore,
  WIZARD_PERSIST_KEY,
  WIZARD_PERSIST_VERSION,
  wizardSessionStorage,
  type Wish,
  type WizardState,
} from "@/lib/store/wizard";

const VALID_RUN = "12345678-5";

/** A stand-in for the `/simulate` payload; the store never reads its fields. */
const SIMULATION = {
  unmatched_risk: 0.12,
  at_risk: false,
  attention_level: "low",
  thresholds: { hard: 0.5, soft: 0.25 },
  predicted_outcome: "School A",
  predicted_outcome_program_id: "1001:A",
  outcomes: [],
  wishes: [],
} satisfies SimulationResponse;

const HOME = {
  ok: true,
  address: "Av. Siempre Viva 742",
  lat: -33.45,
  lon: -70.66,
  precision: "address",
  display_name: "Av. Siempre Viva 742, Santiago",
  warning_key: null,
  error_key: null,
  params: {},
  message: "",
} satisfies GeocodeResult;

const store = () => useWizardStore.getState();

/** Put the store in "step 3 reachable, simulation fresh" shape. */
function seed(options: { ties?: boolean; programIds?: string[] } = {}) {
  const { ties = false, programIds = ["1001:A", "1002:B", "1003:C"] } = options;
  store().reset();
  // The welcome answer and the consent checkbox are what unlocks
  // step 1 now, so every "reachable" fixture has to include both.
  store().setListExists(true);
  store().setDisclaimerAcknowledged(true);
  store().setStudentId(VALID_RUN);
  store().setUseEquivalenceClasses(ties);
  for (const programId of programIds) store().addWish(programId);
  store().setSimulation(SIMULATION);
}

function expectInvalidated() {
  expect(store().simulation).toBeNull();
  expect(store().simulationStale).toBe(true);
}

beforeEach(() => {
  window.sessionStorage.clear();
  store().reset();
});

describe("initial state", () => {
  it("starts empty, with no simulation and nothing persisted", () => {
    expect(store()).toMatchObject(initialWizardState());
    expect(store().recommendationCount).toBe(DEFAULT_RECOMMENDATION_COUNT);
    expect(store().simulationStale).toBe(true);
  });
});

describe("invalidation table — studentId", () => {
  it("drops the simulation when the identifier changes", () => {
    seed();
    expect(store().simulation).not.toBeNull();
    store().setStudentId("11111111-1");
    expectInvalidated();
  });

  it("is a no-op when the identifier is unchanged", () => {
    seed();
    store().setStudentId(VALID_RUN);
    expect(store().simulation).toBe(SIMULATION);
    expect(store().simulationStale).toBe(false);
  });
});

describe("invalidation table — mode toggle", () => {
  it("keeps the wishes and numbers the groups by position in ties mode", () => {
    seed();
    expect(store().wishes.map((wish) => wish.equivalenceGroup)).toEqual([
      null,
      null,
      null,
    ]);

    store().setSimulation(SIMULATION);
    store().setUseEquivalenceClasses(true);

    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1002:B",
      "1003:C",
    ]);
    expect(store().wishes.map((wish) => wish.equivalenceGroup)).toEqual([
      1, 2, 3,
    ]);
    expectInvalidated();
  });

  it("keeps the wishes and clears the groups back in strict mode", () => {
    seed({ ties: true });
    store().setWishGroup("1002:B", 1);
    store().setSimulation(SIMULATION);

    store().setUseEquivalenceClasses(false);

    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1002:B",
      "1003:C",
    ]);
    expect(store().wishes.map((wish) => wish.equivalenceGroup)).toEqual([
      null,
      null,
      null,
    ]);
    expectInvalidated();
  });

  it("is a no-op when the mode does not actually change", () => {
    seed();
    store().setUseEquivalenceClasses(false);
    expect(store().simulation).toBe(SIMULATION);
  });

  it("keeps the priority flags across a toggle", () => {
    seed();
    store().setWishFlag("1002:B", "prioritySibling", true);
    store().setSimulation(SIMULATION);
    store().setUseEquivalenceClasses(true);
    expect(store().wishes[1]).toMatchObject({
      programId: "1002:B",
      prioritySibling: true,
      equivalenceGroup: 2,
    });
  });
});

describe("invalidation table — wish changes", () => {
  it("invalidates on add, and ignores duplicates", () => {
    seed();
    store().addWish("1004:D");
    expect(store().wishes).toHaveLength(4);
    expectInvalidated();

    store().setSimulation(SIMULATION);
    store().addWish("1004:D");
    expect(store().wishes).toHaveLength(4);
    expect(store().simulation).toBe(SIMULATION);
  });

  it("gives an added wish its own trailing group in ties mode", () => {
    seed({ ties: true });
    expect(store().wishes.map((wish) => wish.equivalenceGroup)).toEqual([
      1, 2, 3,
    ]);
    store().addWish("1004:D");
    expect(store().wishes[3].equivalenceGroup).toBe(4);

    // max(group) + 1, not len + 1.
    store().setWishGroup("1004:D", 9);
    store().addWish("1005:E");
    expect(store().wishes[4].equivalenceGroup).toBe(10);
  });

  it("invalidates on remove, and ignores unknown ids", () => {
    seed();
    store().removeWish("1002:B");
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1003:C",
    ]);
    expectInvalidated();

    store().setSimulation(SIMULATION);
    store().removeWish("nope");
    expect(store().simulation).toBe(SIMULATION);
  });

  it("invalidates on reorder by direction and by index", () => {
    seed();
    store().moveWish("1003:C", "up");
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1003:C",
      "1002:B",
    ]);
    expectInvalidated();

    store().setSimulation(SIMULATION);
    store().moveWish("1001:A", 2);
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1003:C",
      "1002:B",
      "1001:A",
    ]);
    expectInvalidated();
  });

  it("does not invalidate when a move changes nothing", () => {
    seed();
    store().moveWish("1001:A", "up"); // already first
    store().moveWish("1003:C", "down"); // already last
    store().moveWish("1002:B", 1); // same index
    store().moveWish("unknown", "down");
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1002:B",
      "1003:C",
    ]);
    expect(store().simulation).toBe(SIMULATION);
  });

  it("clamps an out-of-range move target", () => {
    seed();
    store().moveWish("1001:A", 99);
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1002:B",
      "1003:C",
      "1001:A",
    ]);
    store().moveWish("1001:A", -5);
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1002:B",
      "1003:C",
    ]);
  });

  it("invalidates on a group change and clips groups at 1", () => {
    seed({ ties: true });
    store().setWishGroup("1002:B", 1);
    expect(store().wishes[1].equivalenceGroup).toBe(1);
    expectInvalidated();

    store().setSimulation(SIMULATION);
    store().setWishGroup("1002:B", 1);
    expect(store().simulation).toBe(SIMULATION);

    store().setWishGroup("1003:C", 0);
    expect(store().wishes[2].equivalenceGroup).toBe(1);
    expectInvalidated();

    store().setSimulation(SIMULATION);
    store().setWishGroup("1003:C", null);
    expect(store().wishes[2].equivalenceGroup).toBeNull();
    expectInvalidated();
  });

  it("invalidates on a priority flag change only when the value moves", () => {
    seed();
    store().setWishFlag("1001:A", "priorityAlreadyRegistered", true);
    expect(store().wishes[0].priorityAlreadyRegistered).toBe(true);
    expectInvalidated();

    store().setSimulation(SIMULATION);
    store().setWishFlag("1001:A", "priorityAlreadyRegistered", true);
    expect(store().simulation).toBe(SIMULATION);
  });
});

describe("invalidation table — programs that vanished from the data", () => {
  it("drops them, reports them, and invalidates", () => {
    seed();
    const dropped = store().dropMissingPrograms(["1002:B", "9999:X"]);
    expect(dropped).toEqual(["1002:B"]);
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1003:C",
    ]);
    expectInvalidated();
  });

  it("is a no-op when every program is still there", () => {
    seed();
    expect(store().dropMissingPrograms(["9999:X"])).toEqual([]);
    expect(store().simulation).toBe(SIMULATION);
  });
});

describe("invalidation table — appended recommendations", () => {
  it("appends trailing ranks in strict mode", () => {
    seed();
    store().appendRecommendations(["2001:R", "2002:S"]);
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1002:B",
      "1003:C",
      "2001:R",
      "2002:S",
    ]);
    expect(store().wishes.map((wish) => wish.equivalenceGroup)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expectInvalidated();
  });

  it("appends singleton groups in ties mode — never one shared group", () => {
    seed({ ties: true });
    store().setWishGroup("1002:B", 1); // A and B tied → groups 1, 1, 3
    store().setSimulation(SIMULATION);

    store().appendRecommendations(["2001:R", "2002:S"]);

    expect(store().wishes.map((wish) => wish.equivalenceGroup)).toEqual([
      1, 1, 3, 4, 5,
    ]);
    expectInvalidated();
  });

  it("never appends past /meta.max_wishes once the cap is known", () => {
    seed(); // three wishes
    store().setMaxWishes(4);

    store().appendRecommendations(["2001:R", "2002:S", "2003:T"]);
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1002:B",
      "1003:C",
      "2001:R",
    ]);
    // The notice counts what was actually added, not what was offered.
    expect(store().recommendationsAddedNotice).toBe(1);
    // The list is exactly at the cap, so it is still analysable.
    expect(isWishListValid(store())).toBe(true);

    // Full: a further append changes nothing at all, notice included.
    store().setSimulation(SIMULATION);
    store().appendRecommendations(["2002:S"]);
    expect(store().wishes).toHaveLength(4);
    expect(store().recommendationsAddedNotice).toBe(1);
    expect(store().simulation).toBe(SIMULATION);
  });

  it("appends without a ceiling while the cap is unknown", () => {
    seed();
    expect(store().maxWishes).toBeNull();
    store().appendRecommendations(["2001:R", "2002:S", "2003:T"]);
    expect(store().wishes).toHaveLength(6);
  });

  it("counts duplicates against nothing: only new ids use up the budget", () => {
    seed();
    store().setMaxWishes(4);
    // "1001:A" is already in the list, so it neither is appended nor consumes
    // the single remaining slot.
    store().appendRecommendations(["1001:A", "2001:R"]);
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1002:B",
      "1003:C",
      "2001:R",
    ]);
  });

  it("ignores duplicates and empty ids, and is a no-op when nothing is new", () => {
    seed({ ties: true });
    store().appendRecommendations(["1001:A", " ", "2001:R", "2001:R"]);
    expect(store().wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1002:B",
      "1003:C",
      "2001:R",
    ]);

    store().setSimulation(SIMULATION);
    store().appendRecommendations(["1001:A"]);
    expect(store().simulation).toBe(SIMULATION);
  });
});

describe("inputs that must NOT invalidate the simulation", () => {
  it("keeps the result for filters, list-exists, home and slider changes", () => {
    seed();
    store().setListExists(true);
    store().setFilters({ region: "Metropolitana", tracks: ["Scientific"] });
    store().setFilters((current) => ({
      genders: [...current.genders, "Mixed"],
    }));
    store().setHome(HOME);
    store().setRecommendationCount(7);

    expect(store().listExists).toBe(true);
    expect(store().filters).toEqual({
      ...emptyFilters(),
      region: "Metropolitana",
      tracks: ["Scientific"],
      genders: ["Mixed"],
    });
    expect(store().home).toBe(HOME);
    expect(store().recommendationCount).toBe(7);
    expect(store().simulation).toBe(SIMULATION);
    expect(store().simulationStale).toBe(false);
  });

  it("clamps the recommendation count to 2..10", () => {
    store().setRecommendationCount(1);
    expect(store().recommendationCount).toBe(2);
    store().setRecommendationCount(99);
    expect(store().recommendationCount).toBe(10);
    store().setRecommendationCount(Number.NaN);
    expect(store().recommendationCount).toBe(2);
  });

  it("marks the simulation stale again when it is cleared", () => {
    seed();
    store().setSimulation(null);
    expectInvalidated();
  });

  it("reset() returns the initial state", () => {
    seed({ ties: true });
    store().setHome(HOME);
    store().reset();
    expect(store()).toMatchObject(initialWizardState());
  });
});

describe("equivalenceOrderCount", () => {
  const wishes = (groups: (number | null)[]): Wish[] =>
    groups.map((group, index) => makeWish(`p${index}`, group));

  it("is 0 for an empty list, mirroring count_equivalence_orders", () => {
    expect(equivalenceOrderCount([])).toBe(BigInt(0));
  });

  it("is 1 when nothing is tied", () => {
    expect(equivalenceOrderCount(wishes([1, 2, 3]))).toBe(BigInt(1));
    expect(equivalenceOrderCount(wishes([null, null, null]))).toBe(BigInt(1));
  });

  it("is the product of the factorials of the group sizes", () => {
    expect(equivalenceOrderCount(wishes([1, 1]))).toBe(BigInt(2));
    expect(equivalenceOrderCount(wishes([1, 1, 1]))).toBe(BigInt(6));
    expect(equivalenceOrderCount(wishes([1, 1, 1, 2, 2, 2]))).toBe(BigInt(36));
    expect(equivalenceOrderCount(wishes([1, 1, 1, 1]))).toBe(BigInt(24));
    expect(equivalenceOrderCount(wishes([1, 1, 2, 2, 3]))).toBe(BigInt(4));
  });

  it("treats a missing group as the wish's own 1-based position", () => {
    // Same fallback as `prepare_ordered_wishes` (EQUIV_GROUP ← WISH_RANK):
    // positions 1..3 → groups 1, 2, 3, so nothing is tied.
    expect(equivalenceOrderCount(wishes([1, null, null]))).toBe(BigInt(1));
    // …and an explicit group may collide with a fallback one: groups 2, 2, 3.
    expect(equivalenceOrderCount(wishes([2, null, null]))).toBe(BigInt(2));
  });

  it("stays exact past Number.MAX_SAFE_INTEGER", () => {
    const twenty = wishes(Array.from({ length: 20 }, () => 1));
    expect(equivalenceOrderCount(twenty)).toBe(BigInt("2432902008176640000"));
    const thirty = wishes(Array.from({ length: 30 }, () => 1));
    expect(equivalenceOrderCount(thirty)).toBe(
      BigInt("265252859812191058636308480000000"),
    );
  });

  it("compares against the cap without building the full product", () => {
    const cap = 10000;
    expect(equivalenceOrderCountExceeds(wishes([1, 1, 1, 1]), cap)).toBe(false);
    // 7! = 5040 ≤ 10000; 8! = 40320 > 10000.
    expect(equivalenceOrderCountExceeds(wishes(Array(7).fill(1)), cap)).toBe(
      false,
    );
    expect(equivalenceOrderCountExceeds(wishes(Array(8).fill(1)), cap)).toBe(
      true,
    );
    // 30 tied wishes would be 30! — the comparison short-circuits.
    expect(equivalenceOrderCountExceeds(wishes(Array(30).fill(1)), cap)).toBe(
      true,
    );
    expect(equivalenceOrderCountExceeds([], cap)).toBe(false);
    expect(equivalenceOrderCountExceeds(wishes([1, 1]), BigInt(2))).toBe(false);
    expect(equivalenceOrderCountExceeds(wishes([1, 1, 1]), BigInt(2))).toBe(
      true,
    );
  });
});

describe("nextEquivalenceGroup", () => {
  it("falls back to len + 1 when no wish carries a group", () => {
    expect(nextEquivalenceGroup([])).toBe(1);
    expect(nextEquivalenceGroup([makeWish("a"), makeWish("b")])).toBe(3);
  });

  it("is max(group) + 1 otherwise", () => {
    expect(nextEquivalenceGroup([makeWish("a", 1), makeWish("b", 7)])).toBe(8);
  });
});

describe("step gates", () => {
  const MAX_ORDERS = 10000;
  const state = (): WizardState => store();

  it("step 1 continues only with a valid RUN/IPE", () => {
    expect(canContinue(state(), 1)).toBe(false);
    store().setStudentId("12345678-9"); // wrong check digit
    expect(canContinue(state(), 1)).toBe(false);
    store().setStudentId(VALID_RUN);
    expect(canContinue(state(), 1)).toBe(true);
    store().setStudentId("100200300-4"); // IPE
    expect(canContinue(state(), 1)).toBe(true);
  });

  it("step 1 needs the welcome answer; step 2 needs step 1", () => {
    // Nothing answered: the guard's target is the welcome page, not step 1.
    expect(hasListChoice(state())).toBe(false);
    expect(canEnterStep(state(), 1)).toBe(false);
    expect(canEnterStep(state(), 2)).toBe(false);

    store().setStudentId(VALID_RUN);
    // A valid identifier does not substitute for the choice.
    expect(canEnterStep(state(), 1)).toBe(false);
    expect(canEnterStep(state(), 2)).toBe(false);

    store().setListExists(false);
    // The welcome answer alone is not enough: the consent checkbox still gates.
    expect(hasAcknowledgedDisclaimer(state())).toBe(false);
    expect(canEnterStep(state(), 1)).toBe(false);
    expect(canEnterStep(state(), 2)).toBe(false);

    store().setDisclaimerAcknowledged(true);
    expect(canEnterStep(state(), 1)).toBe(true);
    expect(canEnterStep(state(), 2)).toBe(true);

    // Either welcome answer counts; only `null` locks the step.
    store().setListExists(true);
    expect(canEnterStep(state(), 1)).toBe(true);
    store().setListExists(null);
    expect(canEnterStep(state(), 1)).toBe(false);
    expect(canEnterStep(state(), 2)).toBe(false);
  });

  it("step 2 needs at least one wish", () => {
    store().setListExists(true);
    store().setDisclaimerAcknowledged(true);
    store().setStudentId(VALID_RUN);
    expect(canContinue(state(), 2)).toBe(false);
    store().addWish("1001:A");
    expect(canContinue(state(), 2)).toBe(true);
  });

  it("step 2 blocks an over-cap tied list, and only in ties mode", () => {
    store().setListExists(true);
    store().setStudentId(VALID_RUN);
    store().setUseEquivalenceClasses(true);
    for (let i = 0; i < 8; i += 1) store().addWish(`10${i}:P`);
    for (const wish of store().wishes) store().setWishGroup(wish.programId, 1);

    // 8! = 40320 > 10000
    expect(canContinue(state(), 2, { maxOrders: MAX_ORDERS })).toBe(false);
    // Without /meta the client cannot pre-check; the server still 422s.
    expect(canContinue(state(), 2)).toBe(true);

    store().setWishGroup("107:P", 2);
    // 7! = 5040 ≤ 10000
    expect(canContinue(state(), 2, { maxOrders: MAX_ORDERS })).toBe(true);

    store().setUseEquivalenceClasses(false);
    expect(canContinue(state(), 2, { maxOrders: MAX_ORDERS })).toBe(true);
  });

  it("steps 3 and 4 need a fresh simulation", () => {
    seed();
    expect(canContinue(state(), 3)).toBe(true);
    expect(canEnterStep(state(), 3, { maxOrders: MAX_ORDERS })).toBe(true);
    expect(canEnterStep(state(), 4, { maxOrders: MAX_ORDERS })).toBe(true);

    store().addWish("1004:D"); // invalidates
    expect(canContinue(state(), 3)).toBe(false);
    expect(canEnterStep(state(), 4)).toBe(false);
    // Step 3 stays reachable so it can re-run /simulate on entry.
    expect(canEnterStep(state(), 3)).toBe(true);
  });

  it("step 4 is terminal — it has no forward action", () => {
    seed();
    expect(canContinue(state(), 4)).toBe(false);
  });

  it("lastAllowedStep is the redirect target of the step guard", () => {
    // `null` = not even step 1: the welcome page is where the guard sends them.
    expect(lastAllowedStep(state())).toBeNull();
    store().setListExists(false);
    store().setDisclaimerAcknowledged(true);
    expect(lastAllowedStep(state())).toBe(1);
    store().setStudentId(VALID_RUN);
    expect(lastAllowedStep(state())).toBe(2);
    store().addWish("1001:A");
    expect(lastAllowedStep(state())).toBe(3);
    store().setSimulation(SIMULATION);
    expect(lastAllowedStep(state())).toBe(4);
  });

  it("exposes curried selectors for useWizardStore(selector)", () => {
    store().setListExists(true);
    store().setDisclaimerAcknowledged(true);
    store().setStudentId(VALID_RUN);
    // Called directly here; in a component this is `useWizardStore(selector)`.
    expect(selectCanContinue(1)(store())).toBe(true);
    expect(selectCanContinue(2)(store())).toBe(false);
    expect(selectCanEnterStep(2)(store())).toBe(true);
  });
});

describe("the recommendations-added notice", () => {
  it("starts at zero and counts what was actually appended", () => {
    seed();
    expect(store().recommendationsAddedNotice).toBe(0);

    store().appendRecommendations(["2001:R", "2002:S"]);
    expect(store().recommendationsAddedNotice).toBe(2);
  });

  it("counts only the new ids, and stays put when nothing was added", () => {
    seed();
    // "1001:A" is already in the list, the blank id is not an id at all.
    store().appendRecommendations(["1001:A", " ", "2001:R"]);
    expect(store().recommendationsAddedNotice).toBe(1);

    store().appendRecommendations(["1001:A"]);
    expect(store().recommendationsAddedNotice).toBe(1);
  });

  it("is cleared by the step that showed it", () => {
    seed();
    store().appendRecommendations(["2001:R"]);
    store().clearRecommendationsNotice();
    expect(store().recommendationsAddedNotice).toBe(0);

    // Idempotent: a second render must not fight the store.
    const before = store();
    store().clearRecommendationsNotice();
    expect(store().recommendationsAddedNotice).toBe(0);
    expect(store()).toBe(before);
  });

  it("does not survive a reset", () => {
    seed();
    store().appendRecommendations(["2001:R"]);
    store().reset();
    expect(store().recommendationsAddedNotice).toBe(0);
  });
});

describe("the wizard's own navigations and the busy flag", () => {
  it("starts idle and survives nothing but a reset", () => {
    expect(store().pendingNavigation).toBeNull();
    expect(store().stepBusy).toBe(false);

    store().setPendingNavigation(2);
    store().setStepBusy(true);
    expect(store().pendingNavigation).toBe(2);
    expect(store().stepBusy).toBe(true);

    store().reset();
    expect(store().pendingNavigation).toBeNull();
    expect(store().stepBusy).toBe(false);
  });

  it("is idempotent, so a re-render cannot loop against it", () => {
    store().setPendingNavigation(2);
    const before = store();
    store().setPendingNavigation(2);
    expect(store()).toBe(before);

    store().setStepBusy(false);
    const idle = store();
    store().setStepBusy(false);
    expect(store()).toBe(idle);
  });

  it("survives the append it exists to protect", () => {
    // The step-4 hand-off: announce the destination, THEN invalidate. The flag
    // must still be set afterwards or the guard redirects mid-navigation.
    seed();
    store().setPendingNavigation(2);
    store().appendRecommendations(["2001:R"]);
    expect(store().pendingNavigation).toBe(2);
    expectInvalidated();

    // The destination acknowledges it on mount.
    store().setPendingNavigation(null);
    expect(store().pendingNavigation).toBeNull();
  });
});

describe("the /meta.max_wishes gate on step 2", () => {
  const fill = (n: number) => {
    store().setListExists(true);
    store().setStudentId(VALID_RUN);
    for (let i = 0; i < n; i += 1) store().addWish(`10${i}:P`);
  };

  it("is not applied while the limit is unknown", () => {
    fill(4);
    expect(store().maxWishes).toBeNull();
    expect(isWishListValid(store())).toBe(true);
    expect(canContinue(store(), 2)).toBe(true);
  });

  it("allows a list exactly at the limit and blocks one program more", () => {
    fill(3);
    store().setMaxWishes(3);
    expect(isWishListValid(store())).toBe(true);
    expect(canContinue(store(), 2)).toBe(true);

    store().addWish("999:P");
    expect(isWishListValid(store())).toBe(false);
    expect(canContinue(store(), 2)).toBe(false);
    // An over-long list also closes the steps behind it.
    expect(canEnterStep(store(), 3)).toBe(false);

    store().removeWish("999:P");
    expect(canContinue(store(), 2)).toBe(true);
  });

  it("takes the limit from the options over the stored one", () => {
    fill(3);
    store().setMaxWishes(30);
    expect(isWishListValid(store(), { maxWishes: 2 })).toBe(false);
    expect(canContinue(store(), 2, { maxWishes: 2 })).toBe(false);
    expect(canContinue(store(), 2, { maxWishes: 3 })).toBe(true);
  });

  it("still needs at least one program, and keeps the order-count gate", () => {
    store().setListExists(true);
    store().setStudentId(VALID_RUN);
    store().setMaxWishes(30);
    expect(isWishListValid(store())).toBe(false);

    store().setUseEquivalenceClasses(true);
    for (let i = 0; i < 8; i += 1) store().addWish(`10${i}:P`);
    for (const wish of store().wishes) store().setWishGroup(wish.programId, 1);
    // 8 wishes is within max_wishes, but 8! = 40320 orders is not.
    expect(isWishListValid(store(), { maxOrders: 10000 })).toBe(false);
  });

  it("normalizes and forgets the limit like the transient it is", () => {
    fill(1);
    store().setMaxWishes(30.7);
    expect(store().maxWishes).toBe(30);
    store().setMaxWishes(Number.NaN);
    expect(store().maxWishes).toBeNull();

    store().setMaxWishes(30);
    // A limit is not an input: it cannot invalidate an accepted simulation.
    store().setSimulation(SIMULATION);
    store().setMaxWishes(30);
    expect(store().simulation).toBe(SIMULATION);

    store().reset();
    expect(store().maxWishes).toBeNull();
  });
});

describe("sessionStorage persistence", () => {
  const persisted = () => {
    const raw = window.sessionStorage.getItem(WIZARD_PERSIST_KEY);
    expect(raw).not.toBeNull();
    return JSON.parse(raw as string) as {
      version: number;
      state: Record<string, unknown>;
    };
  };

  it("stores exactly the five allowed slices", () => {
    seed({ ties: true });
    store().setListExists(false);
    store().setFilters({ region: "Metropolitana" });

    const snapshot = persisted();
    expect(snapshot.version).toBe(WIZARD_PERSIST_VERSION);
    expect(Object.keys(snapshot.state).sort()).toEqual([
      "disclaimerAcknowledged",
      "filters",
      "listExists",
      "useEquivalenceClasses",
      "wishes",
    ]);
  });

  it("never writes the RUN/IPE, the simulation or the home location", () => {
    seed();
    store().setHome(HOME);
    store().setSimulation(SIMULATION);

    const raw = window.sessionStorage.getItem(WIZARD_PERSIST_KEY) as string;
    expect(raw).not.toContain(VALID_RUN);
    expect(raw).not.toContain("12345678");
    expect(raw).not.toContain("unmatched_risk");
    expect(raw).not.toContain("Siempre Viva");
    const snapshot = persisted();
    expect(snapshot.state).not.toHaveProperty("studentId");
    expect(snapshot.state).not.toHaveProperty("simulation");
    expect(snapshot.state).not.toHaveProperty("home");
    expect(snapshot.state).not.toHaveProperty("recommendationCount");
  });

  it("never writes the API limit, the one-shot notice or the in-flight UI state", () => {
    seed();
    store().setMaxWishes(30);
    store().appendRecommendations(["2001:R"]);
    store().setPendingNavigation(2);
    store().setStepBusy(true);

    const snapshot = persisted();
    expect(snapshot.state).not.toHaveProperty("maxWishes");
    expect(snapshot.state).not.toHaveProperty("recommendationsAddedNotice");
    // A persisted `pendingNavigation` would silently switch the step guard off
    // for the whole of the next tab session.
    expect(snapshot.state).not.toHaveProperty("pendingNavigation");
    expect(snapshot.state).not.toHaveProperty("stepBusy");
  });

  it("rehydrates the list into a fresh module instance, without the secrets", async () => {
    seed({ ties: true });
    store().setListExists(true);
    const raw = window.sessionStorage.getItem(WIZARD_PERSIST_KEY) as string;

    vi.resetModules();
    window.sessionStorage.setItem(WIZARD_PERSIST_KEY, raw);
    const fresh = await import("@/lib/store/wizard");

    // Nothing is read before the explicit hydration call.
    expect(fresh.useWizardStore.getState().wishes).toEqual([]);

    await fresh.hydrateWizardStore();

    const state = fresh.useWizardStore.getState();
    expect(state.wishes.map((wish) => wish.programId)).toEqual([
      "1001:A",
      "1002:B",
      "1003:C",
    ]);
    expect(state.useEquivalenceClasses).toBe(true);
    expect(state.listExists).toBe(true);
    expect(state.disclaimerAcknowledged).toBe(true);
    expect(state.studentId).toBe("");
    expect(state.simulation).toBeNull();
    expect(state.simulationStale).toBe(true);
    expect(state.home).toBeNull();
  });

  it("flags the store as hydrated, and keeps that flag across a reset", async () => {
    // The step guard waits for this before it redirects: without
    // it, a reload of a legitimately reachable step would bounce to the welcome
    // page because the persisted `listExists` had not landed yet.
    expect(store().hydrated).toBe(false);

    await hydrateWizardStore();
    expect(store().hydrated).toBe(true);

    // It describes the document, not the wizard, so starting over keeps it.
    store().reset();
    expect(store().hydrated).toBe(true);
    expect(store().listExists).toBeNull();

    // And it is never written to the session.
    store().setListExists(true);
    const raw = window.sessionStorage.getItem(WIZARD_PERSIST_KEY) as string;
    expect(raw).not.toContain("hydrated");
  });

  it("hydrateWizardStore() reads the session back into the live store", async () => {
    window.sessionStorage.setItem(
      WIZARD_PERSIST_KEY,
      JSON.stringify({
        version: WIZARD_PERSIST_VERSION,
        state: {
          wishes: [makeWish("1001:A", 1)],
          listExists: false,
          useEquivalenceClasses: true,
          filters: { ...emptyFilters(), region: "Metropolitana" },
        },
      }),
    );

    await hydrateWizardStore();

    expect(store().wishes.map((wish) => wish.programId)).toEqual(["1001:A"]);
    expect(store().useEquivalenceClasses).toBe(true);
    expect(store().filters.region).toBe("Metropolitana");
    expect(store().studentId).toBe("");
  });

  it("hydrating a stale payload does not resurrect a simulation", async () => {
    window.sessionStorage.setItem(
      WIZARD_PERSIST_KEY,
      JSON.stringify({
        version: WIZARD_PERSIST_VERSION,
        state: { wishes: [makeWish("1001:A")] },
      }),
    );
    vi.resetModules();
    const fresh = await import("@/lib/store/wizard");
    await fresh.hydrateWizardStore();
    expect(fresh.useWizardStore.getState().wishes).toHaveLength(1);
    expect(fresh.useWizardStore.getState().simulation).toBeNull();
    expect(fresh.useWizardStore.getState().simulationStale).toBe(true);
  });
});

describe("storage guard (SSR / blocked site data)", () => {
  const realDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "sessionStorage",
  );

  function withSessionStorage(get: () => Storage, run: () => void) {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get,
    });
    try {
      run();
    } finally {
      if (realDescriptor) {
        Object.defineProperty(window, "sessionStorage", realDescriptor);
      }
    }
  }

  it("degrades to no persistence when every storage call throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;

    withSessionStorage(
      () => blocked,
      () => {
        expect(wizardSessionStorage.getItem(WIZARD_PERSIST_KEY)).toBeNull();
        expect(() =>
          wizardSessionStorage.setItem(WIZARD_PERSIST_KEY, "{}"),
        ).not.toThrow();
        expect(() =>
          wizardSessionStorage.removeItem(WIZARD_PERSIST_KEY),
        ).not.toThrow();

        // The store itself keeps working entirely in memory.
        expect(() => store().addWish("1001:A")).not.toThrow();
        expect(store().wishes).toHaveLength(1);
      },
    );
  });

  it("survives a browser that throws on the sessionStorage property itself", () => {
    withSessionStorage(
      () => {
        throw new Error("site data blocked");
      },
      () => {
        expect(wizardSessionStorage.getItem(WIZARD_PERSIST_KEY)).toBeNull();
        expect(() =>
          wizardSessionStorage.setItem(WIZARD_PERSIST_KEY, "{}"),
        ).not.toThrow();
      },
    );
  });

  it("returns null when there is no window (SSR)", () => {
    const original = globalThis.window;
    // @ts-expect-error — simulating a server render
    delete globalThis.window;
    try {
      expect(wizardSessionStorage.getItem(WIZARD_PERSIST_KEY)).toBeNull();
      expect(() =>
        wizardSessionStorage.setItem(WIZARD_PERSIST_KEY, "{}"),
      ).not.toThrow();
    } finally {
      globalThis.window = original;
    }
  });
});
