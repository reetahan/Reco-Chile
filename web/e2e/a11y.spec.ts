import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import en from "../messages/en";
import es from "../messages/es";

/**
 * Accessibility pass — axe in Playwright, plus focus order and labels.
 *
 * Every wizard step is scanned in both locales and in the state a family
 * actually meets it in, not on an empty page: a step whose only content is a
 * heading proves nothing about the wish cards, the result tables or the
 * recommendation cards, which is where the controls are.
 *
 * `serious` and `critical` violations fail the run. `minor` / `moderate`
 * findings are attached to the test as an `axe-moderate` annotation and printed,
 * so a regression there is visible in the report without turning every
 * best-practice rule into a merge blocker. The scan runs the WCAG 2.0/2.1 A and
 * AA rule sets plus axe's `best-practice` pack — the latter is what reports
 * heading order and landmark coverage at all.
 *
 * Two things are deliberately *not* scanned by axe: colour contrast of the
 * disabled Continue button (a disabled control is exempt) and the `sonner`
 * toast portal (transient; it lives outside the step and is covered by the
 * step-2 banner assertions in `improve.spec.ts`).
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

type Fixture = {
  inputs: {
    student_id: string;
    use_equivalence_classes: boolean;
    wishes: FixtureWish[];
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

/** Three wishes, strict order — the smallest list that still has a middle. */
const STRICT_SMALL = golden("strict_02_three_wishes");
/** Eight scarce wishes: the step-3 parity fixture, high attention level. */
const STRICT_RESULT = golden("strict_04_eight_wishes_scarce");
/** Two groups of three — step 2's ties mode with something actually tied. */
const TIED_GROUPS = golden("equiv_02_two_groups_of_three");
/** One group of four: 24 orders, grouped-by-outcome tables on step 3. */
const EQUIV_RESULT = golden("equiv_03_group_of_four_probability_shift");
/** The list the `recommend_*` fixtures were generated from. */
const RECOMMEND = golden("recommend_01_no_home");

// --- Locales ---------------------------------------------------------------

const LOCALES = ["es", "en"] as const;
type Locale = (typeof LOCALES)[number];
const MESSAGES = { es, en } as const;

// --- Store seeding ---------------------------------------------------------

/** Mirrors `WIZARD_PERSIST_KEY` / `WIZARD_PERSIST_VERSION` in the store. */
const PERSIST_KEY = "reco-chile.wizard";
const PERSIST_VERSION = 1;

/**
 * Put a golden list into `sessionStorage` before the first paint, the way
 * `result.spec.ts` does. The RUN/IPE is never seeded — it is memory-only
 * — so it is always typed into step 1.
 */
async function seedList(
  page: Page,
  fixture: Fixture,
  ties: boolean,
): Promise<void> {
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

/**
 * The welcome answer on its own, without a list.
 *
 * Since the welcome page replaced step 1's "list exists?" radio, `listExists`
 * is what `canEnterStep(1)` requires: a hard load of `/es/student` without it
 * is sent back to `/es`. Tests that are about a *page load* — the focus test
 * asserts that a fresh load steals no focus — seed the answer instead of
 * clicking through the front door, which would navigate client-side.
 */
async function seedListChoice(page: Page, listExists = true): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value);
    },
    [
      PERSIST_KEY,
      JSON.stringify({
        state: {
          listExists,
          disclaimerAcknowledged: true,
          useEquivalenceClasses: false,
          wishes: [],
        },
        version: PERSIST_VERSION,
      }),
    ] as const,
  );
}

/** Step 1 with a valid identifier typed in, which is what unlocks the rest. */
async function identify(
  page: Page,
  locale: Locale,
  studentId: string,
): Promise<void> {
  await page.goto(`/${locale}/student`);
  await page.getByLabel(MESSAGES[locale].student.idLabel).fill(studentId);
  await expect(page.getByTestId("student-id-feedback")).toHaveAttribute(
    "data-state",
    "valid",
  );
}

/** Walk the stepper to a step, client-side (a reload drops the RUN). */
async function goToStep(
  page: Page,
  locale: Locale,
  number: 2 | 3 | 4,
  slug: "list" | "result" | "improve",
): Promise<void> {
  const messages = MESSAGES[locale];
  await page
    .getByRole("navigation", { name: messages.steps.navLabel })
    .getByRole("link", { name: `${number}. ${messages.steps[slug]}` })
    .click();
  await page.waitForURL(`**/${locale}/${slug}`);
}

// --- The scan itself -------------------------------------------------------

/** Rule packs: WCAG 2.0/2.1 A + AA, plus axe's own best-practice pack. */
const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "best-practice",
] as const;

/** `axe-core`'s `Result`, reached through the builder so the spec does not have
 * to resolve `axe-core` itself (pnpm keeps it out of `web/node_modules`). */
type AxeViolation = Awaited<
  ReturnType<AxeBuilder["analyze"]>
>["violations"][number];

function describeViolation(violation: AxeViolation): string {
  const where = violation.nodes
    .slice(0, 4)
    .map((node) => node.target.join(" "))
    .join(" | ");
  // axe's own one-line explanation of the first offending node — the contrast
  // ratio it measured, the attribute it wanted — so a CI failure can be read
  // without reproducing the state locally.
  const why = (violation.nodes[0]?.failureSummary ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("Fix"))
    .join("; ");
  return `[${violation.impact ?? "unknown"}] ${violation.id}: ${violation.help} — ${where}${why === "" ? "" : ` (${why})`}`;
}

/**
 * Run axe over the current page and fail on anything `serious` or worse.
 *
 * `label` names the state, because the same rule failing on step 2 and on step
 * 4 are two different bugs and the assertion message is the only place that
 * distinction survives into the CI log.
 */
/**
 * Wait for CSS transitions and enter/exit animations to finish.
 *
 * Not cosmetic: axe measures the *computed* colours of the moment it runs, so a
 * popover still fading in reports its text at 1.2:1 and a button still
 * transitioning out of `disabled:opacity-50` reports #2573EC instead of
 * #1F6FEB. Scanning mid-animation invents contrast failures and hides real
 * ones. Infinite animations (a spinner) are skipped — they never finish, and
 * they are never the thing under test.
 */
async function settle(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
          .every(
            (animation) =>
              animation.playState === "finished" ||
              animation.playState === "idle",
          ),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});
}

async function scan(page: Page, info: TestInfo, label: string): Promise<void> {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags([...AXE_TAGS])
    .analyze();

  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  const advisory = results.violations.filter(
    (violation) =>
      violation.impact !== "serious" && violation.impact !== "critical",
  );

  if (advisory.length > 0) {
    const lines = advisory.map(describeViolation);
    info.annotations.push({
      type: "axe-moderate",
      description: `${label}\n${lines.join("\n")}`,
    });
    // Visible in `--reporter=list` and in the GitHub log; not a failure.
    console.log(`axe (advisory) — ${label}\n ${lines.join("\n ")}`);
  }

  expect(blocking.map(describeViolation), `axe — ${label}`).toEqual([]);
}

// --- Step 1 ----------------------------------------------------------------

for (const locale of LOCALES) {
  test.describe(`a11y — ${locale}`, () => {
    test("the welcome page", async ({ page }, info) => {
      await page.goto(`/${locale}`);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: MESSAGES[locale].app.welcome.headline,
        }),
      ).toBeVisible();
      // The two buttons are one labelled group, and they are the only way in
      // — a scan of the wizard's front door is not optional.
      await scan(page, info, `welcome (${locale})`);
    });

    test("the disclaimer page", async ({ page }, info) => {
      // Screen 2 of the front door, reached from either welcome answer.
      await page.goto(`/${locale}`);
      await page.getByTestId("welcome-no").click();
      await page.waitForURL(`**/${locale}/disclaimer`);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: MESSAGES[locale].app.disclaimer.headline,
        }),
      ).toBeVisible();
      await scan(page, info, `disclaimer (${locale})`);
    });

    test("step 1, empty and filled", async ({ page }, info) => {
      // Through the front door: the welcome answer is what unlocks step 1, and
      // "No — help me build it" is the branch that also opens step 2's filter
      // panel later on.
      await page.goto(`/${locale}`);
      await page.getByTestId("welcome-no").click();
      await page.waitForURL(`**/${locale}/disclaimer`);
      await page.getByTestId("disclaimer-checkbox").click();
      await page.getByTestId("disclaimer-continue").click();
      await page.waitForURL(`**/${locale}/student`);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: MESSAGES[locale].student.title,
        }),
      ).toBeVisible();
      await scan(page, info, `step 1 (${locale}) — empty`);

      // Filled: the identifier feedback carries state now. The ties switch and
      // the welcome-answer note both moved off this step — the ties
      // switch is scanned on step 2 instead, via the seeded "strict list" /
      // "two tied groups" fixtures below.
      await page
        .getByLabel(MESSAGES[locale].student.idLabel)
        .fill(STRICT_SMALL.inputs.student_id);
      await expect(page.getByTestId("student-id-feedback")).toHaveAttribute(
        "data-state",
        "valid",
      );
      await scan(page, info, `step 1 (${locale}) — filled`);
    });

    test("step 2, a strict list of three", async ({ page }, info) => {
      await seedList(page, STRICT_SMALL, false);
      await identify(page, locale, STRICT_SMALL.inputs.student_id);
      await goToStep(page, locale, 2, "list");

      await expect(page.getByTestId("wish-card")).toHaveCount(
        STRICT_SMALL.inputs.wishes.length,
      );
      await scan(page, info, `step 2 (${locale}) — strict, collapsed`);

      // The controls that only exist once they are opened: the priority
      // collapsible of every card, and the program-details sheet of the first.
      for (const trigger of await page.getByTestId("wish-priorities").all()) {
        await trigger.getByRole("button").first().click();
      }
      await expect(page.getByRole("checkbox")).toHaveCount(
        5 * STRICT_SMALL.inputs.wishes.length,
      );
      await scan(page, info, `step 2 (${locale}) — priorities open`);

      await page
        .getByTestId("wish-card")
        .first()
        .getByRole("button", { name: /—/ })
        .first()
        .click();
      const sheet = page.getByTestId("program-details-sheet");
      await expect(sheet).toBeVisible();
      await scan(page, info, `step 2 (${locale}) — details sheet`);
    });

    test("step 2, two tied groups", async ({ page }, info) => {
      await seedList(page, TIED_GROUPS, true);
      await identify(page, locale, TIED_GROUPS.inputs.student_id);
      await goToStep(page, locale, 2, "list");

      await expect(page.getByTestId("wish-group")).toHaveCount(
        TIED_GROUPS.inputs.wishes.length,
      );
      await scan(page, info, `step 2 (${locale}) — ties`);
    });

    test("step 3, a strict result", async ({ page }, info) => {
      await seedList(page, STRICT_RESULT, false);
      await identify(page, locale, STRICT_RESULT.inputs.student_id);
      await goToStep(page, locale, 3, "result");

      await expect(page.getByTestId("result-outcome")).toBeVisible({
        timeout: 60_000,
      });
      // Step 3 is one box and the finish/improve
      // choice: there is no disclosure to open, so this is the whole step.
      await scan(page, info, `step 3 (${locale}) — strict`);
    });

    test("step 3, an equivalence result", async ({ page }, info) => {
      await seedList(page, EQUIV_RESULT, true);
      await identify(page, locale, EQUIV_RESULT.inputs.student_id);
      await goToStep(page, locale, 3, "result");

      // The mode no longer changes what step 3 draws —
      // the box is the same — but the /simulate call behind it is not, so the
      // ties path still gets its own scan.
      await expect(page.getByTestId("result-outcome")).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId("equivalence-verdict")).toHaveCount(0);
      await scan(page, info, `step 3 (${locale}) — ties`);
    });

    test("step 4, recommendations and a geocoded home", async ({
      page,
    }, info) => {
      // Nominatim is never reached from a test (`improve.spec.ts` explains why);
      // `/recommend` and `/simulate` are the real engine.
      await stubGeocode(page);
      await seedList(page, RECOMMEND, false);
      await identify(page, locale, RECOMMEND.inputs.student_id);
      await goToStep(page, locale, 3, "result");
      await expect(page.getByTestId("result-outcome")).toBeVisible({
        timeout: 60_000,
      });
      // the result step's own finish / improve choice replaces the generic Continue.
      await page.getByTestId("result-improve").click();
      await page.waitForURL(`**/${locale}/improve`);

      await expect(page.getByTestId("recommendation-card").first()).toBeVisible(
        { timeout: 90_000 },
      );
      await scan(page, info, `step 4 (${locale}) — recommendations`);

      await openEveryDisclosure(page);
      await scan(page, info, `step 4 (${locale}) — recommendations, expanded`);

      // With a home on file the address block gains its confirmation, the
      // distance caption and a "clear" button, and the cards gain a distance.
      await page.getByTestId("home-address-input").fill(GEOCODED_ADDRESS);
      await page.getByTestId("geocode-submit").click();
      await expect(page.getByTestId("geocode-feedback")).toHaveAttribute(
        "data-kind",
        "confirmed",
      );
      await expect(page.getByTestId("recommendation-card").first()).toBeVisible(
        { timeout: 90_000 },
      );
      await scan(page, info, `step 4 (${locale}) — geocoded home`);
    });
  });
}

/** Open every collapsed disclosure on the page, in document order. */
async function openEveryDisclosure(page: Page): Promise<void> {
  const closed = page.locator('button[aria-expanded="false"]');
  // Opening one can reveal another (the equivalence block nests none today, but
  // the loop costs nothing and keeps this true if one is ever added).
  for (let round = 0; round < 3; round += 1) {
    const triggers: Locator[] = await closed.all();
    if (triggers.length === 0) return;
    for (const trigger of triggers) {
      // A trigger inside a section that another toggle just closed can vanish.
      if (await trigger.isVisible().catch(() => false)) {
        await trigger.click({ timeout: 5_000 }).catch(() => {});
      }
    }
  }
}

// --- Geocoding stub --------------------------------------------------------

const GEOCODED_ADDRESS = "Av. Siempre Viva 742, Santiago";

async function stubGeocode(page: Page): Promise<void> {
  await page.route("**/api/geocode**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        address: GEOCODED_ADDRESS,
        lat: -33.45,
        lon: -70.66,
        precision: "address",
        display_name: "Fake 123, Santiago",
        warning_key: null,
        error_key: null,
        params: {},
        message: "",
      }),
    });
  });
  // No `lang` branch: an exact-precision match carries no warning, so there is
  // nothing for the server to localize and nothing for the locale to change.
}

// --- Focus management and the keyboard path --------------------------------

/**
 * Focus order: moving between steps must land focus
 * on the new step's `<h1>`, not leave it on a button that no longer exists.
 * Without this a screen-reader user pressing Continue hears nothing at all and
 * a keyboard user's next Tab starts from the top of the document.
 */
test.describe("focus management", () => {
  test("Continue and Back move focus to the step heading", async ({ page }) => {
    // Seeded rather than clicked through the welcome page: the first assertion
    // is about a *fresh load*, which a client-side push from `/es` would not be.
    await seedListChoice(page);
    await page.goto("/es/student");
    // A fresh page load does *not* steal focus: the family has not navigated.
    expect(await focusedTagName(page)).toBe("BODY");

    await page.getByLabel(es.student.idLabel).fill("12.345.678-5");
    await page.getByTestId("wizard-continue").click();
    await page.waitForURL("**/es/list");
    await expect(headingIsFocused(page)).resolves.toBe(es.list.title);

    await page.getByTestId("wizard-back").click();
    await page.waitForURL("**/es/student");
    await expect(headingIsFocused(page)).resolves.toBe(es.student.title);

    // The stepper is a navigation too, and lands the same way.
    await page
      .getByRole("navigation", { name: es.steps.navLabel })
      .getByRole("link", { name: `2. ${es.steps.list}` })
      .click();
    await page.waitForURL("**/es/list");
    await expect(headingIsFocused(page)).resolves.toBe(es.list.title);
  });

  test("the added-recommendations banner is a status region", async ({
    page,
  }) => {
    await stubGeocode(page);
    await seedList(page, RECOMMEND, false);
    await identify(page, "es", RECOMMEND.inputs.student_id);
    await goToStep(page, "es", 3, "result");
    await expect(page.getByTestId("result-outcome")).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId("result-improve").click();
    await page.waitForURL("**/es/improve");
    await expect(page.getByTestId("recommendation-card").first()).toBeVisible({
      timeout: 90_000,
    });

    await page
      .getByTestId("recommendation-card")
      .first()
      .getByTestId("recommendation-select")
      .click();
    await page.getByTestId("add-recommendations").click();
    await page.waitForURL("**/es/list");

    // `role="status"` (polite), not `role="alert"`: the family asked for this,
    // so it is confirmation, not an interruption — and it arrives together with
    // the heading focus, which would cut an assertive announcement short.
    const banner = page.getByTestId("recommendations-added");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "status");
  });
});

test.describe("keyboard operability", () => {
  test("step 2 reorders and declares a priority without a mouse", async ({
    page,
  }) => {
    await seedList(page, STRICT_SMALL, false);
    await identify(page, "es", STRICT_SMALL.inputs.student_id);
    await goToStep(page, "es", 2, "list");
    await expect(page.getByTestId("wish-card")).toHaveCount(3);

    const order = () =>
      page
        .getByTestId("wish-card")
        .evaluateAll((cards) =>
          cards.map((card) => card.getAttribute("data-program-id") ?? ""),
        );
    const before = await order();

    // Focus starts on the step heading (the navigation put it there), so a
    // plain Tab walk is exactly what a keyboard user does next.
    await expect(headingIsFocused(page)).resolves.toBe(es.list.title);

    // Reorder: the first card's "Move down" swaps wishes 1 and 2. The drag
    // handle is not the only path.
    const moveDown = await tabUntil(
      page,
      (node) =>
        node.testId === "wish-move-down" && node.programId === before[0],
    );
    expect(moveDown.disabled).toBe(false);
    await page.keyboard.press("Enter");
    await expect
      .poll(order)
      .toEqual([before[1], before[0], before[2]] as string[]);

    // Declare a priority: open the collapsible with the keyboard, tab into it,
    // tick the first checkbox with Space, and read the card's summary back.
    const card = page.locator(
      `[data-testid="wish-card"][data-program-id="${before[0]}"]`,
    );
    await tabUntil(
      page,
      (node) =>
        node.expanded === "false" &&
        node.closestTestId === "wish-priorities" &&
        node.programId === before[0],
    );
    await page.keyboard.press("Enter");
    await expect(
      card.getByTestId("wish-priorities").getByRole("button").first(),
    ).toHaveAttribute("aria-expanded", "true");

    await tabUntil(
      page,
      (node) => node.role === "checkbox" && node.programId === before[0],
    );
    await page.keyboard.press("Space");

    await expect(card.getByTestId("wish-declared-priorities")).toHaveText(
      es.wishes.priorities.declared.replace(
        "{priorities}",
        es.wishes.priorities.labels.sibling,
      ),
    );
  });
});

// --- Focus helpers ---------------------------------------------------------

type FocusedNode = {
  tagName: string;
  testId: string | null;
  role: string | null;
  expanded: string | null;
  disabled: boolean;
  /** `data-testid` of the nearest ancestor that has one. */
  closestTestId: string | null;
  /** `data-program-id` of the wish card the focused element sits in. */
  programId: string | null;
  text: string;
};

function focusedNode(page: Page): Promise<FocusedNode | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null || el === document.body) return null;
    const closest = el.parentElement?.closest("[data-testid]") ?? null;
    return {
      tagName: el.tagName,
      testId: el.getAttribute("data-testid"),
      role:
        el.getAttribute("role") ??
        (el.tagName === "BUTTON" ? "button" : null) ??
        (el.tagName === "INPUT" ? el.getAttribute("type") : null),
      expanded: el.getAttribute("aria-expanded"),
      disabled:
        el.hasAttribute("disabled") ||
        el.getAttribute("aria-disabled") === "true",
      closestTestId: closest?.getAttribute("data-testid") ?? null,
      programId:
        el
          .closest("[data-testid='wish-card']")
          ?.getAttribute("data-program-id") ?? null,
      text: (el.textContent ?? "").trim().slice(0, 60),
    };
  });
}

async function focusedTagName(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.tagName ?? "");
}

/** The text of the focused element when it is the page's `<h1>`. */
async function headingIsFocused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null || el.tagName !== "H1") {
      return `not the heading: <${el?.tagName.toLowerCase() ?? "none"}>`;
    }
    return (el.textContent ?? "").trim();
  });
}

/** Press Tab until the focused element matches, at most `max` presses. */
async function tabUntil(
  page: Page,
  match: (node: FocusedNode) => boolean,
  max = 120,
): Promise<FocusedNode> {
  const seen: string[] = [];
  for (let step = 0; step < max; step += 1) {
    await page.keyboard.press("Tab");
    const node = await focusedNode(page);
    if (node === null) continue;
    seen.push(`${node.tagName}${node.testId ? `[${node.testId}]` : ""}`);
    if (match(node)) return node;
  }
  throw new Error(
    `Tab never reached the expected control. Visited: ${seen.join(" → ")}`,
  );
}
