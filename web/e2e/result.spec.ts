import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { formatInt, formatPercent } from "../lib/format";
import es from "../messages/es";
import en from "../messages/en";

/**
 * Step 3 — the rendered percentages must equal the golden-fixture values for
 * the strict and equivalence scenarios.
 *
 * The fixtures under `tests/fixtures/golden/` are the engine's numerical
 * baseline. These tests drive the real wizard against the real FastAPI
 * (Playwright starts both, see `playwright.config.ts`), then compare every
 * rendered percentage with `formatPercent(<fixture value>)` — the same rule as
 * Python's `{:.1%}`. Nothing is hard-coded: change the data and the fixtures
 * change with it, and these tests follow.
 *
 * How the list is built: the wizard persists `wishes` to `sessionStorage`, so
 * the fixture's exact list — including its preference groups — is seeded there
 * before the first paint. Driving the step-2 combobox for a twelve-wish scarce
 * list would test the search box, not the result, and the RUN/IPE is
 * deliberately *not* seedable (it is memory-only), so it is always typed into
 * the step-1 field, exactly as a family would.
 *
 * Step 3 shows two figures — the overall chance of being assigned
 * (`1 − unmatched_risk`) and the most likely outcome. `assignment-chance` is
 * asserted as `formatPercent(1 − <fixture unmatched_risk>)` rather than against
 * a second, independently rendered number.
 */

// --- Fixtures --------------------------------------------------------------

type FixtureWish = {
  program_id: string;
  preference_group: number;
  priority_sibling: boolean;
  priority_student: boolean;
  priority_parent_civil_servant: boolean;
  priority_ex_student: boolean;
  priority_already_registered: boolean;
};

type Choice = {
  program: string;
  program_id: string;
  choice_assignment_probability: number;
  cumulative_unavailable_after_choice: number;
};

type Variant = {
  predicted_outcome: string;
  predicted_outcome_final_chance: number;
};

type Fixture = {
  name: string;
  inputs: {
    student_id: string;
    use_equivalence_classes: boolean;
    wishes: FixtureWish[];
  };
  expected: {
    unmatched_risk?: number;
    choices?: Choice[];
    reference_choices?: Choice[];
    variants?: Variant[];
    distinct_outcomes?: string[];
    total_orders?: number;
  };
};

function golden(name: string): Fixture {
  const path = resolve(
    process.cwd(),
    "../tests/fixtures/golden",
    `${name}.json`,
  );
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

const STRICT = golden("strict_04_eight_wishes_scarce");
const EQUIV_STABLE = golden("equiv_01_two_tied_stable_outcome");

/**
 * The band where "most likely outcome" and "the engine's unmatched alert"
 * disagree: `unmatched_risk` at or above `hard_unmatched_threshold` (2.7%) —
 * so `wish_list.predicted_outcome_from_choices` answers `Unmatched` — while a
 * school on the list is more likely than that.
 *
 * `strict_04` (54.8%) cannot tell the two apart: there `Unmatched` really is
 * the most likely outcome, so a card driven by `predicted_outcome` and a card
 * driven by `outcomes[0]` say the same thing. This fixture is the first ten
 * wishes of `strict_05`, which lands at 33.9% unmatched against a 42.4% school.
 *
 * Truncating a golden list is sound arithmetic, not a new baseline: a wish's
 * `choice_assignment_probability` and the cumulative unavailability after it
 * depend only on the wishes *above* it, so the first ten rows
 * of `strict_05` are exactly the engine's answer for a ten-wish list. The test
 * still asserts the band against `/meta` before it asserts anything else, so a
 * data change that moves these numbers fails loudly instead of passing
 * vacuously.
 */
const MID_BAND: Fixture = (() => {
  const base = golden("strict_05_twelve_wishes_already_registered");
  const choices = (base.expected.choices ?? []).slice(0, 10);
  return {
    name: "unmatched_below_the_top_school",
    inputs: { ...base.inputs, wishes: base.inputs.wishes.slice(0, 10) },
    expected: {
      choices,
      unmatched_risk:
        choices[choices.length - 1].cumulative_unavailable_after_choice,
    },
  };
})();

/**
 * `wish_list.predicted_outcome_from_choices`, restated from the fixture: the
 * hard threshold wins, otherwise the most likely program. Used to assert the
 * school the stable verdict names.
 */
function predictedOutcome(fixture: Fixture, hardThreshold: number): string {
  const choices = referenceChoices(fixture);
  if (unmatchedRisk(fixture) >= hardThreshold)
    return es.enums.outcome.Unmatched;
  const best = [...choices]
    .filter((choice) => choice.choice_assignment_probability > 0)
    .sort(
      (a, b) =>
        b.choice_assignment_probability - a.choice_assignment_probability,
    )[0];
  return best ? best.program : es.enums.outcome.Unmatched;
}

/** A catalogue sentence with its placeholders filled and its `<b>` dropped. */
function copy(message: string, values: Record<string, string>): string {
  return Object.entries(values)
    .reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), message)
    .replace(/<\/?b>/g, "");
}

/** The unmatched risk of a fixture, wherever it keeps it. */
function unmatchedRisk(fixture: Fixture): number {
  if (typeof fixture.expected.unmatched_risk === "number") {
    return fixture.expected.unmatched_risk;
  }
  const choices = fixture.expected.reference_choices ?? [];
  return choices[choices.length - 1].cumulative_unavailable_after_choice;
}

function referenceChoices(fixture: Fixture): Choice[] {
  return fixture.expected.choices ?? fixture.expected.reference_choices ?? [];
}

/** The 1-based position of a program in the reference order — the `wish_rank`
 * the headline prints as "your preference #n". */
function wishRankOf(fixture: Fixture, program: string): number {
  const index = referenceChoices(fixture).findIndex(
    (choice) => choice.program === program,
  );
  expect(index, `${program} is not in ${fixture.name}`).toBeGreaterThanOrEqual(
    0,
  );
  return index + 1;
}

/** The most likely *program* of a fixture — `outcomes[0]` whenever a school is
 * more likely than staying unmatched. */
function topProgram(fixture: Fixture): Choice {
  const best = [...referenceChoices(fixture)].sort(
    (a, b) => b.choice_assignment_probability - a.choice_assignment_probability,
  )[0];
  expect(best, `${fixture.name} has no choices`).toBeDefined();
  return best;
}

/** One program's display fields, straight from the API the page reads. */
async function programOf(
  page: Page,
  programId: string,
): Promise<{ program_label: string; school_commune: string; region: string }> {
  const response = await page.request.get(
    `/api/programs/${encodeURIComponent(programId)}`,
  );
  expect(response.ok(), `GET /programs/${programId}`).toBeTruthy();
  return response.json();
}

/** Nothing on the page may reintroduce the attention levels. */
async function expectNoAttentionLevels(page: Page): Promise<void> {
  await expect(page.getByTestId("attention-alert")).toHaveCount(0);
  // The removed copy, in the words it used: the three alerts, the "How are the
  // attention levels defined?" disclosure and every threshold sentence.
  await expect(page.getByText(/nivel(es)? de atención/i)).toHaveCount(0);
  await expect(page.getByText(/umbral/i)).toHaveCount(0);
}

// --- Store seeding ---------------------------------------------------------

/** Mirrors `WIZARD_PERSIST_KEY` / `WIZARD_PERSIST_VERSION` in the store. */
const PERSIST_KEY = "reco-chile.wizard";
const PERSIST_VERSION = 1;

async function seedList(page: Page, fixture: Fixture): Promise<void> {
  const ties = fixture.inputs.use_equivalence_classes;
  const state = {
    listExists: true,
    disclaimerAcknowledged: true,
    useEquivalenceClasses: ties,
    wishes: fixture.inputs.wishes.map((wish) => ({
      programId: wish.program_id,
      equivalenceGroup: ties ? wish.preference_group : null,
      prioritySibling: wish.priority_sibling,
      priorityStudent: wish.priority_student,
      priorityParentCivilServant: wish.priority_parent_civil_servant,
      priorityExStudent: wish.priority_ex_student,
      priorityAlreadyRegistered: wish.priority_already_registered,
    })),
  };

  await page.addInitScript(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value);
    },
    [PERSIST_KEY, JSON.stringify({ state, version: PERSIST_VERSION })] as const,
  );
}

/** Type the RUN on step 1, then walk the stepper to step 3 — a client-side
 * navigation, because a reload would drop the memory-only identifier. */
async function openResult(
  page: Page,
  fixture: Fixture,
  locale: "es" | "en" = "es",
): Promise<void> {
  const messages = locale === "es" ? es : en;
  await seedList(page, fixture);
  await page.goto(`/${locale}/student`);

  await page
    .getByLabel(messages.student.idLabel)
    .fill(fixture.inputs.student_id);
  await expect(page.getByTestId("student-id-feedback")).toHaveAttribute(
    "data-state",
    "valid",
  );

  await page
    .getByRole("navigation", { name: messages.steps.navLabel })
    .getByRole("link", { name: `3. ${messages.steps.result}` })
    .click();
  await page.waitForURL(`**/${locale}/result`);
}

/** `/meta` through the same-origin proxy the browser uses. */
async function meta(page: Page): Promise<{
  equiv_probability_change_warning_threshold: number;
  soft_unmatched_threshold: number;
  hard_unmatched_threshold: number;
}> {
  const response = await page.request.get("/api/meta");
  expect(response.ok()).toBeTruthy();
  return response.json();
}
// --- Tests -----------------------------------------------------------------

test.describe("result step — the outcome box", () => {
  test("the unmatched shape is the sentence alone, with no percentage", async ({
    page,
  }) => {
    // strict_04's unmatched risk is 54.8%, which is also the highest of all
    // outcomes, so the box takes its unmatched shape.
    await openResult(page, STRICT);

    await expect(page.getByTestId("predicted-unmatched")).toHaveText(
      es.result.headline.unmatchedBody,
    );
    // No percentage here: the number that belongs to this
    // outcome is its own probability, and "you receive none of the programs" +
    // "Estimated chance: 100.0%" read as a 100% chance of a place.
    await expect(page.getByTestId("predicted-chance")).toHaveCount(0);
    await expect(page.getByTestId("result-outcome")).not.toContainText(
      formatPercent(unmatchedRisk(STRICT), "es"),
    );
    await expect(page.getByTestId("predicted-school")).toHaveCount(0);
    await expect(page.getByTestId("predicted-rank")).toHaveCount(0);

    await expect(page.getByTestId("estimate-note")).toHaveText(
      es.result.outcome.disclaimer,
    );
    await expectNoAttentionLevels(page);
  });

  test("names the most likely outcome, not the unmatched alert", async ({
    page,
  }) => {
    // The box must answer "what is most likely", which is `outcomes[0]`.
    // `predicted_outcome` answers a different question — it flips to
    // `Unmatched` at the 2.7% hard threshold, as a warning — and driving the
    // box from it would make this fixture report "you get none of them" for a
    // list whose top school is more likely than that.
    await openResult(page, MID_BAND);
    const thresholds = await meta(page);
    const risk = unmatchedRisk(MID_BAND);
    const top = topProgram(MID_BAND);

    // The band itself — without it this test proves nothing.
    expect(risk).toBeGreaterThanOrEqual(thresholds.hard_unmatched_threshold);
    expect(risk).toBeLessThan(top.choice_assignment_probability);
    expect(
      predictedOutcome(MID_BAND, thresholds.hard_unmatched_threshold),
    ).toBe(es.enums.outcome.Unmatched);

    await expect(page.getByTestId("predicted-unmatched")).toHaveCount(0);
    await expect(page.getByTestId("predicted-school")).toHaveText(top.program);
    await expect(page.getByTestId("predicted-rank")).toHaveText(
      copy(es.result.headline.preferenceRank, {
        rank: formatInt(wishRankOf(MID_BAND, top.program), "es"),
      }),
    );
    await expect(page.getByTestId("predicted-chance")).toHaveText(
      copy(es.result.outcome.chance, {
        chance: formatPercent(top.choice_assignment_probability, "es"),
      }),
    );
  });

  test("names commune and region with the school", async ({ page }) => {
    await openResult(page, MID_BAND);
    const top = topProgram(MID_BAND);
    const program = await programOf(page, top.program_id);

    await expect(page.getByTestId("predicted-location")).toHaveText(
      `${program.school_commune} · ${program.region}`,
    );
  });

  test("is the whole page: the page is only the outcome box", async ({
    page,
  }) => {
    // The page no longer shows the overall assignment figure and unmatched risk, the
    // outcome podium, the per-preference family table, the equivalence block
    // and the detailed calculation. The box and the finish/improve choice are
    // all that remain — assert their absence so none of them creeps back.
    await openResult(page, STRICT);
    await expect(page.getByTestId("result-outcome")).toBeVisible();

    for (const testId of [
      "assignment-chance",
      "unmatched-risk",
      "outcome-item",
      "family-table",
      "family-table-section",
      "final-chance",
      "detail-table",
      "equivalence-block",
      "equivalence-verdict",
      "tied-order-view",
      "order-card",
    ]) {
      await expect(page.getByTestId(testId)).toHaveCount(0);
    }

    // The lead sentence under the heading went with them: the box carries the
    // caveat now, next to the number it qualifies.
    await expect(page.getByTestId("step-result")).not.toContainText(
      es.app.aboutEstimate.body,
    );
  });

  test("offers the finish / improve choice instead of a bare Continue", async ({
    page,
  }) => {
    await openResult(page, STRICT);

    await expect(page.getByTestId("result-finish")).toContainText(
      es.result.next.finish,
    );
    const improve = page.getByTestId("result-improve");
    await expect(improve).toContainText(es.result.next.improve);
    await expect(improve).toHaveAttribute("href", "/es/improve");

    // …and *instead of*: the shell's unlabelled Continue used to sit below the
    // choice and silently take the improve branch. Back stays.
    await expect(page.getByTestId("wizard-continue")).toHaveCount(0);
    await expect(page.getByTestId("wizard-back")).toBeVisible();

    await improve.click();
    await page.waitForURL("**/es/improve");
  });

  test("finish clears the wizard and returns to the welcome page", async ({
    page,
  }) => {
    // "I'm happy — finish" no longer opens the completion
    // page, it ends the session where it began.
    await openResult(page, STRICT);
    await expect(page.getByTestId("result-outcome")).toBeVisible();

    await page.getByTestId("result-finish").click();
    await page.waitForURL(/\/es$/);
    await expect(
      page.getByRole("heading", { level: 1, name: es.app.welcome.headline }),
    ).toBeVisible();

    // `reset()` ran: the seeded list is out of storage, so pressing "Yes"
    // again starts a new one rather than resuming the finished session.
    const stored = await page.evaluate(() =>
      JSON.stringify(window.sessionStorage),
    );
    expect(stored).not.toContain(STRICT.inputs.wishes[0].program_id);

    // `replace`, not `push`: Back does not lead into the finished wizard.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/es\/result$/);
  });

  test("formats the same number in English", async ({ page }) => {
    await openResult(page, STRICT, "en");

    expect(formatPercent(unmatchedRisk(STRICT), "en")).toBe("54.8%");
    expect(formatPercent(unmatchedRisk(STRICT), "es")).toBe("54,8%");
    await expect(page.getByTestId("predicted-unmatched")).toHaveText(
      en.result.headline.unmatchedBody,
    );
    await expect(page.getByTestId("estimate-note")).toHaveText(
      en.result.outcome.disclaimer,
    );
    // The English formatting assertion moves to the fixture whose top outcome
    // *is* a school — the unmatched shape prints no percentage at all.
    await openResult(page, MID_BAND, "en");
    await expect(page.getByTestId("predicted-chance")).toHaveText(
      copy(en.result.outcome.chance, {
        chance: formatPercent(
          topProgram(MID_BAND).choice_assignment_probability,
          "en",
        ),
      }),
    );
  });

  test("ties mode shows the same single box", async ({ page }) => {
    // The mode used to decide the branch: ties drew the equivalence
    // sensitivity block, strict drew the family table. Both are gone, so the
    // mode no longer changes what step 3 renders — only what `/simulate` is
    // asked. `equiv_01` is stable, so its top outcome is the fixture's own.
    await openResult(page, EQUIV_STABLE);

    await expect(page.getByTestId("result-outcome")).toBeVisible();
    await expect(page.getByTestId("equivalence-block")).toHaveCount(0);
    await expect(page.getByTestId("equivalence-verdict")).toHaveCount(0);

    const top = topProgram(EQUIV_STABLE);
    await expect(page.getByTestId("predicted-school")).toHaveText(top.program);
    await expect(page.getByTestId("predicted-chance")).toHaveText(
      copy(es.result.outcome.chance, {
        chance: formatPercent(top.choice_assignment_probability, "es"),
      }),
    );
  });

  test("keeps the RUN out of storage and out of the URL ()", async ({
    page,
  }) => {
    await openResult(page, STRICT);
    await expect(page.getByTestId("result-outcome")).toBeVisible();

    const stored = await page.evaluate(() => ({
      session: JSON.stringify(window.sessionStorage),
      local: JSON.stringify(window.localStorage),
    }));
    const run = STRICT.inputs.student_id;
    const bareRun = run.replace(/[.-]/g, "");
    for (const blob of [stored.session, stored.local, page.url()]) {
      expect(blob).not.toContain(run);
      expect(blob).not.toContain(bareRun);
    }
  });
});

test.describe("result step — failures", () => {
  test("shows the over-cap 422 in Spanish and recovers on retry", async ({
    page,
  }) => {
    // Flipped by the test itself rather than counted, so the assertion holds
    // however many times the client asks while the failure is in place.
    let failing = true;
    await page.route("**/api/simulate*", async (route) => {
      if (!failing) {
        // The retry reaches the real engine.
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 422,
        json: {
          error_key: "too_many_equivalence_orders",
          // Localized by the API; the UI prefers its own catalogue entry.
          message: "ignored",
          params: { n: 40320, limit: 10000 },
        },
      });
    });

    await openResult(page, STRICT);

    const error = page.getByTestId("result-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute(
      "data-error-key",
      "too_many_equivalence_orders",
    );
    await expect(error).toContainText(
      es.errors.too_many_equivalence_orders
        .replace("{n}", formatInt(40320, "es"))
        .replace("{limit}", formatInt(10000, "es")),
    );
    // No way onward while the step has no fresh result: the finish /
    // improve choice is rendered only beside a result, and step 3 has no
    // generic Continue to fall back on item 6.
    await expect(page.getByTestId("result-actions")).toHaveCount(0);
    await expect(page.getByTestId("wizard-continue")).toHaveCount(0);

    failing = false;
    await page.getByTestId("result-retry").click();
    await expect(page.getByTestId("predicted-unmatched")).toHaveText(
      es.result.headline.unmatchedBody,
    );
    await expect(page.getByTestId("result-error")).toHaveCount(0);
    await expect(page.getByTestId("result-actions")).toBeVisible();
  });
});
