/**
 * Wizard state (zustand). The invalidation table below mirrors the one in
 * `docs/architecture.md`, "Wizard state".
 *
 * | Change | Effect |
 * | ---------------------------------------- | ------------------------------------------------------------- |
 * | `studentId` changes | `simulation = null`, `simulationStale = true` |
 * | `useEquivalenceClasses` toggles | wishes kept; groups → `null` (strict) or `1..n` (ties); invalid |
 * | any wish add/remove/reorder/group/flag | simulation invalidated |
 * | a `programId` disappears from the data | wish dropped (caller shows the toast); simulation invalidated |
 * | recommendations appended | singleton trailing groups (ties) / trailing ranks (strict); inv |
 * | | ...and never past `maxWishes` when the API's cap is known |
 *
 * Persistence: only `wishes`, `listExists`, `useEquivalenceClasses`, `filters`
 * go to `sessionStorage`. `studentId`, `simulation` and `home` are memory-only,
 * for privacy.
 *
 * No probability is ever computed here; the engine stays the only source of
 * numbers. The one number this module derives is the *count* of compatible
 * strict orders, which is combinatorics over the user's own grouping and is
 * re-checked server-side (422 `too_many_equivalence_orders`).
 */

import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

import { isValidStudentIdentifier } from "@/lib/validation/student-id";

import type {
  GeocodeResult,
  PriorityFlag,
  ProgramFilters,
  SimulationResponse,
  Wish,
} from "./types";

export type {
  GeocodeResult,
  PriorityFlag,
  ProgramFilters,
  SimulationResponse,
  Wish,
};
export { PRIORITY_FLAGS } from "./types";

/** Default of the "number of recommendations" slider (2–10). */
export const DEFAULT_RECOMMENDATION_COUNT = 3;
export const MIN_RECOMMENDATION_COUNT = 2;
export const MAX_RECOMMENDATION_COUNT = 10;

/** `sessionStorage` key. Bump `WIZARD_PERSIST_VERSION` on a breaking shape change. */
export const WIZARD_PERSIST_KEY = "reco-chile.wizard";
export const WIZARD_PERSIST_VERSION = 1;

export type WizardStep = 1 | 2 | 3 | 4;

export type MoveTarget = "up" | "down" | number;

export type WizardState = {
  /** RUN/IPE — memory only, never persisted, never logged. */
  studentId: string;
  /** The welcome page's answer; `null` = not asked yet, which locks step 1. */
  listExists: boolean | null;
  /** The "Before we continue" consent checkbox, shown after the welcome
   * answer and before step 1. `false` locks step 1 the same way an
   * unanswered `listExists` does. */
  disclaimerAcknowledged: boolean;
  useEquivalenceClasses: boolean;
  filters: ProgramFilters;
  wishes: Wish[];
  simulation: SimulationResponse | null;
  simulationStale: boolean;
  home: GeocodeResult | null;
  recommendationCount: number;
  /**
   * `/meta.max_wishes` — the server's cap on the length of a preference list
   * (`MAX_WISHES`). Memory-only and `null` until a component that has `/meta`
   * calls `setMaxWishes`, exactly like `maxOrders`: with no limit known, the
   * client simply does not pre-check and the server's 422 stays the only gate.
   */
  maxWishes: number | null;
  /**
   * How many recommendations the last `appendRecommendations` added, for the
   * success notice at the top of step 2. Transient: never persisted, and the
   * step that shows it clears it with `clearRecommendationsNotice()` — shown
   * once, then cleared.
   */
  recommendationsAddedNotice: number;
  /**
   * A navigation the wizard itself started, as the destination's step number —
   * memory-only, and the one thing that makes the step-4 → step-2 hand-off
   * possible.
   *
   * `appendRecommendations` invalidates the simulation, which instantly makes
   * step 4 unenterable. Without this flag the step guard in
   * `components/wizard/step-guard.tsx` reacts to that first and `router.replace`s
   * to step 3 — the furthest step still reachable — overriding the `router.push`
   * to step 2 the producer had just issued. While `pendingNavigation` is set the
   * guard stands down: the wizard is already moving somewhere legal, and the
   * destination clears the flag when it mounts.
   *
   * A step *number* rather than a slug so the store keeps no dependency on the
   * routing layer; `components/wizard/steps.ts` translates in both directions.
   */
  pendingNavigation: WizardStep | null;
  /**
   * The current step is waiting on a request it must finish before the family
   * can move on — the result step's `/simulate`. Memory-only, and
   * read by the shell to put `WizardNav` in its `pending` state.
   *
   * Contract for the owning step: call `setStepBusy(true)` when the request
   * starts and `setStepBusy(false)` when it settles *and* from the effect's
   * cleanup, so leaving the step can never strand the spinner. Nothing here
   * clears it on navigation: effects of the arriving page run before the
   * shell's, so a shell-side reset would race with the step that just set it.
   */
  stepBusy: boolean;
  /**
   * Has `hydrateWizardStore()` finished reading `sessionStorage` back?
   *
   * Memory-only, never persisted, and `false` on every fresh document. It
   * exists because the persisted slices arrive one effect *after* the tree
   * mounts, and the step guard now gates on one of them (`listExists`):
   * without this flag a reload of `/es/student` would see the empty default,
   * decide the welcome question was never answered, and bounce a family that
   * had answered it. Whoever redirects on store state must wait for this.
   */
  hydrated: boolean;
};

export type WizardActions = {
  setStudentId: (studentId: string) => void;
  setListExists: (listExists: boolean | null) => void;
  setDisclaimerAcknowledged: (acknowledged: boolean) => void;
  setUseEquivalenceClasses: (useEquivalenceClasses: boolean) => void;
  setFilters: (
    filters:
      | Partial<ProgramFilters>
      | ((current: ProgramFilters) => Partial<ProgramFilters>),
  ) => void;
  addWish: (programId: string) => void;
  removeWish: (programId: string) => void;
  moveWish: (programId: string, target: MoveTarget) => void;
  setWishGroup: (programId: string, group: number | null) => void;
  setWishFlag: (programId: string, flag: PriorityFlag, value: boolean) => void;
  /** Drops wishes whose program vanished from the data; returns the dropped ids
   * so the caller can raise the warning toast with the labels it still knows. */
  dropMissingPrograms: (programIds: readonly string[]) => string[];
  appendRecommendations: (programIds: readonly string[]) => void;
  setSimulation: (simulation: SimulationResponse | null) => void;
  setHome: (home: GeocodeResult | null) => void;
  setRecommendationCount: (count: number) => void;
  setMaxWishes: (maxWishes: number | null) => void;
  /** Acknowledge the "N recommendations added" notice (shown once, then cleared). */
  clearRecommendationsNotice: () => void;
  /** Announce a navigation the wizard itself is performing, so the step guard
   * does not redirect while it is in flight. `null` cancels/acknowledges it. */
  setPendingNavigation: (step: WizardStep | null) => void;
  /** Put the Continue button in its "request in flight" state. */
  setStepBusy: (busy: boolean) => void;
  reset: () => void;
};

export type WizardStore = WizardState & WizardActions;

/** The four persisted slices — everything else is memory-only. */
export type PersistedWizardState = Pick<
  WizardState,
  | "wishes"
  | "listExists"
  | "disclaimerAcknowledged"
  | "useEquivalenceClasses"
  | "filters"
>;

// ---------------------------------------------------------------------------
// Pure helpers (exported for the UI and the tests)
// ---------------------------------------------------------------------------

export function emptyFilters(): ProgramFilters {
  return {
    region: null,
    tracks: [],
    specialtySectors: [],
    genders: [],
    schoolDays: [],
    rurality: [],
    pie: [],
    pace: [],
    enrollmentFee: [],
    monthlyFee: [],
    religiousOrientation: [],
  };
}

export function makeWish(
  programId: string,
  equivalenceGroup: number | null = null,
): Wish {
  return {
    programId,
    equivalenceGroup,
    prioritySibling: false,
    priorityStudent: false,
    priorityParentCivilServant: false,
    priorityExStudent: false,
    priorityAlreadyRegistered: false,
  };
}

/**
 * Next free preference group, for a new wish or recommendation:
 * `max(existing groups) + 1`, falling back to `len(list) + 1` when no wish
 * carries a group yet.
 */
export function nextEquivalenceGroup(wishes: readonly Wish[]): number {
  const groups = wishes
    .map((wish) => wish.equivalenceGroup)
    .filter((group): group is number => typeof group === "number");
  if (groups.length === 0) return wishes.length + 1;
  return Math.max(...groups) + 1;
}

/**
 * Effective group of every wish, mirroring `prepare_ordered_wishes`: a missing
 * group falls back to the wish's 1-based position, so an ungrouped wish is its
 * own singleton class unless an explicit group happens to carry that number.
 */
function effectiveGroups(wishes: readonly Wish[]): number[] {
  return wishes.map((wish, index) => wish.equivalenceGroup ?? index + 1);
}

function groupSizes(wishes: readonly Wish[]): number[] {
  const sizes = new Map<number, number>();
  for (const group of effectiveGroups(wishes)) {
    sizes.set(group, (sizes.get(group) ?? 0) + 1);
  }
  return [...sizes.values()];
}

// `1n` literals need `target: ES2020`; the project targets ES2017, so the
// BigInt constructor is used instead. The values are identical at runtime.
const ZERO = BigInt(0);
const ONE = BigInt(1);

function factorial(n: number): bigint {
  let out = ONE;
  for (let i = 2; i <= n; i += 1) out *= BigInt(i);
  return out;
}

/**
 * Number of strict orders compatible with the current equivalence classes —
 * the product of the factorials of the group sizes, exactly like
 * `count_equivalence_orders`. Returns a `bigint` because a 19-wish single class
 * already overflows `Number.MAX_SAFE_INTEGER`; an empty list yields `0`, again
 * mirroring the engine.
 */
export function equivalenceOrderCount(wishes: readonly Wish[]): bigint {
  if (wishes.length === 0) return ZERO;
  let total = ONE;
  for (const size of groupSizes(wishes)) total *= factorial(size);
  return total;
}

/**
 * Capped comparison: `true` as soon as the running product passes `max`, so a
 * pathological list never builds a giant factorial just to be rejected. `max`
 * is `/meta.max_exact_equiv_permutations` (`MAX_EXACT_EQUIV_PERMUTATIONS`).
 */
export function equivalenceOrderCountExceeds(
  wishes: readonly Wish[],
  max: number | bigint,
): boolean {
  if (wishes.length === 0) return false;
  const cap = typeof max === "bigint" ? max : BigInt(Math.trunc(max));
  let total = ONE;
  for (const size of groupSizes(wishes)) {
    // Multiply factor by factor so an enormous group is rejected on the way up
    // instead of after computing its factorial.
    for (let i = 2; i <= size; i += 1) {
      total *= BigInt(i);
      if (total > cap) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Storage (SSR-safe)
// ---------------------------------------------------------------------------

function sessionStorageOrNull(): Storage | null {
  try {
    // `window` is undefined during SSR; access to `sessionStorage` itself
    // throws in browsers configured to block site data.
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Exported for tests. Every access is guarded; a failure degrades to "no
 * persistence", never to a crash. */
export const wizardSessionStorage: StateStorage = {
  getItem: (name) => {
    try {
      return sessionStorageOrNull()?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      sessionStorageOrNull()?.setItem(name, value);
    } catch {
      /* storage full or blocked — the wizard still works in memory */
    }
  },
  removeItem: (name) => {
    try {
      sessionStorageOrNull()?.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export function initialWizardState(): WizardState {
  return {
    studentId: "",
    listExists: null,
    disclaimerAcknowledged: false,
    useEquivalenceClasses: false,
    filters: emptyFilters(),
    wishes: [],
    simulation: null,
    simulationStale: true,
    home: null,
    recommendationCount: DEFAULT_RECOMMENDATION_COUNT,
    maxWishes: null,
    recommendationsAddedNotice: 0,
    pendingNavigation: null,
    stepBusy: false,
    hydrated: false,
  };
}

/** What "the simulation is invalidated" means everywhere: the cached result is
 * dropped, not merely flagged. */
const INVALIDATED = {
  simulation: null,
  simulationStale: true,
} satisfies Pick<WizardState, "simulation" | "simulationStale">;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

export const useWizardStore = create<WizardStore>()(
  persist(
    (set, get) => ({
      ...initialWizardState(),

      setStudentId: (studentId) => {
        if (get().studentId === studentId) return;
        // Recommendations are re-fetched by the caller; the server keeps no
        // per-student cache to clear.
        set({ studentId, ...INVALIDATED });
      },

      setListExists: (listExists) => {
        // The welcome page's answer. It selects a UI branch — step
        // 2 shows the filter panel only for "No, help me build it" — so the
        // list itself and the simulation survive a change of mind. `null` puts
        // the family back in front of the welcome question (`canEnterStep(1)`).
        set({ listExists });
      },

      setDisclaimerAcknowledged: (disclaimerAcknowledged) => {
        set({ disclaimerAcknowledged });
      },

      setUseEquivalenceClasses: (useEquivalenceClasses) => {
        const state = get();
        if (state.useEquivalenceClasses === useEquivalenceClasses) return;
        // The wishes are kept — switching interpretation must never silently
        // reset the family's list.
        const wishes = state.wishes.map((wish, index) => ({
          ...wish,
          equivalenceGroup: useEquivalenceClasses ? index + 1 : null,
        }));
        set({ useEquivalenceClasses, wishes, ...INVALIDATED });
      },

      setFilters: (filters) => {
        const current = get().filters;
        const patch =
          typeof filters === "function" ? filters(current) : filters;
        // Filters only drive the program search; results are untouched.
        set({ filters: { ...current, ...patch } });
      },

      addWish: (programId) => {
        const state = get();
        const id = programId.trim();
        if (id === "") return;
        // Duplicates are dropped, keeping the first (`drop_duplicates(keep="first")`).
        if (state.wishes.some((wish) => wish.programId === id)) return;
        const group = state.useEquivalenceClasses
          ? nextEquivalenceGroup(state.wishes)
          : null;
        set({ wishes: [...state.wishes, makeWish(id, group)], ...INVALIDATED });
      },

      removeWish: (programId) => {
        const state = get();
        const wishes = state.wishes.filter(
          (wish) => wish.programId !== programId,
        );
        if (wishes.length === state.wishes.length) return;
        set({ wishes, ...INVALIDATED });
      },

      moveWish: (programId, target) => {
        const state = get();
        const from = state.wishes.findIndex(
          (wish) => wish.programId === programId,
        );
        if (from === -1) return;

        const last = state.wishes.length - 1;
        const requested =
          target === "up" ? from - 1 : target === "down" ? from + 1 : target;
        const to = clamp(requested, 0, last);
        if (to === from) return;

        const wishes = [...state.wishes];
        const [moved] = wishes.splice(from, 1);
        wishes.splice(to, 0, moved);
        set({ wishes, ...INVALIDATED });
      },

      setWishGroup: (programId, group) => {
        const state = get();
        // `normalize_builder_wishes` clips group numbers at 1.
        const next =
          group === null || !Number.isFinite(group)
            ? null
            : Math.max(1, Math.round(group));
        let changed = false;
        const wishes = state.wishes.map((wish) => {
          if (wish.programId !== programId || wish.equivalenceGroup === next) {
            return wish;
          }
          changed = true;
          return { ...wish, equivalenceGroup: next };
        });
        if (!changed) return;
        set({ wishes, ...INVALIDATED });
      },

      setWishFlag: (programId, flag, value) => {
        const state = get();
        let changed = false;
        const wishes = state.wishes.map((wish) => {
          if (wish.programId !== programId || wish[flag] === value) return wish;
          changed = true;
          return { ...wish, [flag]: value };
        });
        if (!changed) return;
        set({ wishes, ...INVALIDATED });
      },

      dropMissingPrograms: (programIds) => {
        const state = get();
        const missing = new Set(programIds);
        const dropped = state.wishes
          .filter((wish) => missing.has(wish.programId))
          .map((wish) => wish.programId);
        if (dropped.length === 0) return [];
        set({
          wishes: state.wishes.filter((wish) => !missing.has(wish.programId)),
          ...INVALIDATED,
        });
        return dropped;
      },

      appendRecommendations: (programIds) => {
        const state = get();
        const seen = new Set(state.wishes.map((wish) => wish.programId));
        const added: Wish[] = [];
        // `/meta.max_wishes` is a hard server cap (`MAX_WISHES`,): a list
        // built past it is rejected by `/simulate`, so appending past it would
        // hand the family a list they cannot analyse. When the limit is unknown
        // there is nothing to enforce and the server's 422 stays the only gate.
        const room =
          state.maxWishes === null
            ? Number.POSITIVE_INFINITY
            : Math.max(0, state.maxWishes - state.wishes.length);
        // Each appended recommendation gets its OWN group in ties mode: a
        // multi-select is not a statement that the programs are tied
        // (`make_appended_recommendation_rows`).
        let group = nextEquivalenceGroup(state.wishes);
        for (const programId of programIds) {
          if (added.length >= room) break;
          const id = programId.trim();
          if (id === "" || seen.has(id)) continue;
          seen.add(id);
          added.push(makeWish(id, state.useEquivalenceClasses ? group : null));
          group += 1;
        }
        if (added.length === 0) return;
        set({
          wishes: [...state.wishes, ...added],
          recommendationsAddedNotice: added.length,
          ...INVALIDATED,
        });
      },

      setSimulation: (simulation) => {
        set({ simulation, simulationStale: simulation === null });
      },

      setHome: (home) => {
        // The home location only feeds `/recommend`; the simulation is unaffected.
        set({ home });
      },

      setRecommendationCount: (count) => {
        set({
          recommendationCount: clamp(
            count,
            MIN_RECOMMENDATION_COUNT,
            MAX_RECOMMENDATION_COUNT,
          ),
        });
      },

      setMaxWishes: (maxWishes) => {
        const next =
          maxWishes === null || !Number.isFinite(maxWishes)
            ? null
            : Math.max(0, Math.trunc(maxWishes));
        if (get().maxWishes === next) return;
        // A limit is a display/gating fact, not an input: it never invalidates
        // a simulation the server already accepted.
        set({ maxWishes: next });
      },

      clearRecommendationsNotice: () => {
        if (get().recommendationsAddedNotice === 0) return;
        set({ recommendationsAddedNotice: 0 });
      },

      setPendingNavigation: (step) => {
        if (get().pendingNavigation === step) return;
        set({ pendingNavigation: step });
      },

      setStepBusy: (busy) => {
        if (get().stepBusy === busy) return;
        set({ stepBusy: busy });
      },

      reset: () => {
        // `hydrated` is a fact about this document, not about the wizard: the
        // session has been read whatever the family does next, and resetting it
        // to `false` would put the step guard back in its waiting state for
        // good.
        set({ ...initialWizardState(), hydrated: get().hydrated });
      },
    }),
    {
      name: WIZARD_PERSIST_KEY,
      version: WIZARD_PERSIST_VERSION,
      storage: createJSONStorage(() => wizardSessionStorage),
      // NEVER add studentId, simulation or home here. `maxWishes`,
      // `recommendationsAddedNotice`, `pendingNavigation` and `stepBusy` stay
      // out too: the first is a fact about the live API, the others are
      // in-flight UI state that must not survive a reload — a persisted
      // `pendingNavigation` would silently disable the step guard, and a
      // persisted `hydrated` would claim the session was read before it was.
      partialize: (state): PersistedWizardState => ({
        wishes: state.wishes,
        listExists: state.listExists,
        disclaimerAcknowledged: state.disclaimerAcknowledged,
        useEquivalenceClasses: state.useEquivalenceClasses,
        filters: state.filters,
      }),
      // Hydration is explicit so the server-rendered HTML and the first client
      // render always agree; call `hydrateWizardStore()` from a client effect.
      skipHydration: true,
    },
  ),
);

/**
 * Read the persisted slices back into the store. Call once from a client
 * component effect (`useEffect(() => { void hydrateWizardStore(); }, [])`)
 * inside the wizard layout — never during render.
 */
export function hydrateWizardStore(): Promise<void> {
  return Promise.resolve(useWizardStore.persist.rehydrate()).then(() => {
    // After the merge, never before: `hydrated` is the signal that the store
    // now reflects the session, which is what the step guard waits for.
    if (!useWizardStore.getState().hydrated) {
      useWizardStore.setState({ hydrated: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export type StepGateOptions = {
  /** `/meta.max_exact_equiv_permutations`. When unknown, the order-count gate
   * is not applied client-side and the server's 422 is the only check. */
  maxOrders?: number | bigint | null;
  /** `/meta.max_wishes`. Overrides `state.maxWishes`; when neither is known the
   * length gate is not applied client-side and `/simulate` rejects instead. */
  maxWishes?: number | null;
};

/** Step 1: the RUN/IPE passes the client pre-check (display only — the server
 * re-validates it). */
export function isStudentIdValid(
  state: Pick<WizardState, "studentId">,
): boolean {
  return isValidStudentIdentifier(state.studentId);
}

/**
 * Has the welcome page's question been answered?
 *
 * `listExists === null` means "not asked yet", and since the two welcome
 * buttons are the only way to answer it, an unanswered choice means the family
 * has not come through the front door at all — a deep link straight to
 * `/es/student`, or a `reset()`. That is what makes it the *entry* condition of
 * step 1 rather than a Continue condition: the guard sends them to
 * `WELCOME_PATH` instead of showing a step whose question was skipped.
 *
 * The answer is persisted, so a reload keeps the family where they were.
 */
export function hasListChoice(state: Pick<WizardState, "listExists">): boolean {
  return state.listExists !== null;
}

/**
 * Has the "Before we continue" consent checkbox been checked? Shown right
 * after the welcome answer and before step 1 — like `listExists`, this is an
 * *entry* condition for step 1, not a step 1 field, so a deep link past it
 * (with the welcome answer given but the checkbox unmarked) sends the family
 * to the consent page instead of into the step.
 */
export function hasAcknowledgedDisclaimer(
  state: Pick<WizardState, "disclaimerAcknowledged">,
): boolean {
  return state.disclaimerAcknowledged;
}

/**
 * Step 2: at least one program, no more than `/meta.max_wishes` of them, and —
 * in ties mode — an order count within the server's exact-evaluation limit.
 *
 * Both caps are server-enforced (`MAX_WISHES`, `MAX_EXACT_EQUIV_PERMUTATIONS`);
 * checking them here only lets Continue disable itself with the same message
 * instead of sending a request that is certain to 422.
 */
export function isWishListValid(
  state: Pick<WizardState, "wishes" | "useEquivalenceClasses" | "maxWishes">,
  options: StepGateOptions = {},
): boolean {
  if (state.wishes.length === 0) return false;
  const maxWishes = options.maxWishes ?? state.maxWishes;
  if (maxWishes != null && state.wishes.length > maxWishes) return false;
  const { maxOrders } = options;
  if (!state.useEquivalenceClasses || maxOrders == null) return true;
  return !equivalenceOrderCountExceeds(state.wishes, maxOrders);
}

/** Step 3/4: a simulation result that still matches the current inputs. */
export function hasFreshSimulation(
  state: Pick<WizardState, "simulation" | "simulationStale">,
): boolean {
  return state.simulation !== null && !state.simulationStale;
}

/** Is the "Continue" button of `step` enabled? Step 4 is terminal (the table
 * shows "—"), so it has no forward action. */
export function canContinue(
  state: WizardState,
  step: WizardStep,
  options: StepGateOptions = {},
): boolean {
  switch (step) {
    case 1:
      return isStudentIdValid(state);
    case 2:
      return isWishListValid(state, options);
    case 3:
      return hasFreshSimulation(state);
    case 4:
      return false;
  }
}

/** May the user open `step`? Cumulative: every earlier gate must hold too, so
 * a deep link to a locked step can be redirected. Step 1 is no longer
 * unconditional — it needs the welcome page's answer (`hasListChoice`). */
export function canEnterStep(
  state: WizardState,
  step: WizardStep,
  options: StepGateOptions = {},
): boolean {
  switch (step) {
    case 1:
      // The welcome choice and the consent checkbox, not "always": step 1 no
      // longer asks the question, so entering it without an answer would strand
      // the family in a wizard branch nobody chose.
      return hasListChoice(state) && hasAcknowledgedDisclaimer(state);
    case 2:
      return canEnterStep(state, 1, options) && canContinue(state, 1, options);
    case 3:
      return canEnterStep(state, 2, options) && canContinue(state, 2, options);
    case 4:
      return canEnterStep(state, 3, options) && canContinue(state, 3, options);
  }
}

/** Highest step the current state allows — the redirect target of the step
 * guard in `(wizard)/layout.tsx`. */
export function lastAllowedStep(
  state: WizardState,
  options: StepGateOptions = {},
): WizardStep | null {
  const steps: WizardStep[] = [4, 3, 2, 1];
  for (const step of steps) {
    if (canEnterStep(state, step, options)) return step;
  }
  // Not even step 1: the welcome question is unanswered, so the redirect target
  // is the welcome page (`WELCOME_PATH`), which is not a step.
  return null;
}

/** Curried forms for `useWizardStore(selectCanContinue(2, { maxOrders }))`. */
export const selectCanContinue =
  (step: WizardStep, options: StepGateOptions = {}) =>
  (state: WizardState): boolean =>
    canContinue(state, step, options);

export const selectCanEnterStep =
  (step: WizardStep, options: StepGateOptions = {}) =>
  (state: WizardState): boolean =>
    canEnterStep(state, step, options);
