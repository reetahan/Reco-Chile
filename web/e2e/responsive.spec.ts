import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import es from "../messages/es";

/**
 * Responsive pass at 360 / 768 / 1280 px, plus single-column layout at ≤ 640 px.
 *
 * Each viewport walks the whole wizard with a real list and a real simulation,
 * and at every step asserts the three things that actually break a phone:
 *
 * 1. **The page does not scroll sideways.** `documentElement.scrollWidth <=
 * clientWidth` is the whole rule. One over-wide element anywhere pushes the
 * entire layout, and a family on a 360 px screen then reads every sentence
 * twice.
 * 2. **Wide content scrolls inside its own container.** Result tables have more
 * columns than a phone has room for, so each `<table>` must sit in an
 * ancestor with `overflow-x: auto|scroll` that is itself no wider than the
 * viewport — otherwise rule 1 can only be met by truncating numbers.
 * 3. **The stepper and the Back/Continue bar stay usable.** Both are fixed
 * furniture: four markers on one row inside the viewport, and two buttons
 * with a real touch target in the sticky footer.
 *
 * Nothing here compares pixels — a font-rendering difference between machines
 * cannot fail the suite.
 */

// --- Viewports -------------------------------------------------------------

const VIEWPORTS = [
  // A small Android phone — the narrowest width the wizard targets.
  { name: "360x740", width: 360, height: 740 },
  // Portrait tablet: the width where the filter grid gains its second column.
  { name: "768x1024", width: 768, height: 1024 },
  // Laptop. The centred column stops at `max-w-3xl`, so this checks the
  // gutters, not the content.
  { name: "1280x800", width: 1280, height: 800 },
] as const;

// --- Fixture ---------------------------------------------------------------

type FixtureWish = {
  program_id: string;
  priority_sibling: boolean;
  priority_student: boolean;
  priority_parent_civil_servant: boolean;
  priority_ex_student: boolean;
  priority_already_registered: boolean;
};

type Fixture = {
  inputs: { student_id: string; wishes: FixtureWish[] };
};

function golden(name: string): Fixture {
  const path = resolve(
    process.cwd(),
    "../tests/fixtures/golden",
    `${name}.json`,
  );
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

/**
 * Eight scarce wishes: the widest realistic step 3 (eight rows in the detailed
 * calculation, its ten columns, and long school names in the family table) and
 * a list that `/recommend` has something to say about.
 */
const LIST = golden("strict_04_eight_wishes_scarce");

/** Mirrors `WIZARD_PERSIST_KEY` / `WIZARD_PERSIST_VERSION` in the store. */
const PERSIST_KEY = "reco-chile.wizard";
const PERSIST_VERSION = 1;

async function seedList(page: Page): Promise<void> {
  const state = {
    listExists: true,
    disclaimerAcknowledged: true,
    useEquivalenceClasses: false,
    wishes: LIST.inputs.wishes.map((wish) => ({
      programId: wish.program_id,
      equivalenceGroup: null,
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

// --- Assertions ------------------------------------------------------------

type TableReport = {
  /** Text of the first header cell, so a failure names the table. */
  head: string;
  tableWidth: number;
  /** `overflow-x` of the nearest scroll container, or null if there is none. */
  containerOverflow: string | null;
  containerWidth: number;
  containerFocusable: boolean;
};

/** No sideways scroll on the document itself. */
async function expectNoHorizontalScroll(
  page: Page,
  where: string,
): Promise<void> {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    // The first element wider than the viewport, if any — without it a failure
    // says only "something overflows".
    culprit: (() => {
      const limit = document.documentElement.clientWidth;
      for (const el of Array.from(
        document.body.querySelectorAll<HTMLElement>("*"),
      )) {
        const rect = el.getBoundingClientRect();
        if (rect.width > limit + 1 || rect.right > limit + 1) {
          return `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 80)}`;
        }
      }
      return null;
    })(),
  }));

  expect(
    box.scrollWidth,
    `${where}: the page scrolls sideways (${box.scrollWidth} > ${box.clientWidth}); widest element: ${box.culprit ?? "none found"}`,
  ).toBeLessThanOrEqual(box.clientWidth);
}

/** Every table sits in a scroll container that itself fits the viewport. */
async function expectTablesScrollThemselves(
  page: Page,
  where: string,
): Promise<void> {
  const tables: TableReport[] = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("table")).map((table) => {
      let node: HTMLElement | null = table.parentElement;
      let containerOverflow: string | null = null;
      let containerWidth = 0;
      let containerFocusable = false;
      while (node !== null && node !== document.body) {
        const overflow = getComputedStyle(node).overflowX;
        if (overflow === "auto" || overflow === "scroll") {
          containerOverflow = overflow;
          containerWidth = node.clientWidth;
          containerFocusable = node.tabIndex >= 0;
          break;
        }
        node = node.parentElement;
      }
      return {
        head: (table.querySelector("th")?.textContent ?? "?")
          .trim()
          .slice(0, 40),
        tableWidth: table.scrollWidth,
        containerOverflow,
        containerWidth,
        containerFocusable,
      };
    });
  });

  for (const table of tables) {
    expect(
      table.containerOverflow,
      `${where}: table "${table.head}" has no overflow-x container`,
    ).not.toBeNull();
    expect(
      table.containerWidth,
      `${where}: the scroll container of "${table.head}" is wider than the viewport`,
    ).toBeLessThanOrEqual(
      (await page.viewportSize())?.width ?? Number.MAX_SAFE_INTEGER,
    );
    // A container that scrolls but cannot take focus is unreachable with a
    // keyboard — the same rule axe enforces in `a11y.spec.ts`.
    expect(
      table.containerFocusable,
      `${where}: the scroll container of "${table.head}" is not focusable`,
    ).toBe(true);
  }
}

/**
 * No control's own label spills out of it.
 *
 * `documentElement.scrollWidth` misses this: a centred `whitespace-nowrap`
 * label overflows its button symmetrically, and the half that runs off to the
 * left is not part of the document's scroll width at all. The family still sees
 * a sentence with its first and last words cut off — which is exactly what the
 * one full-width button on step 4 did at 360 px. Elements that clip on purpose
 * (`truncate`, a scroll container) are excluded by their own `overflow-x`.
 */
async function expectNoClippedLabels(page: Page, where: string): Promise<void> {
  const spilling = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button, a, label"))
      .filter((el) => {
        // Only labelled controls: an icon-only button reports a scroll width
        // larger than its box because of the `after:-inset-*` hit-area overlay
        // the switch, radio and checkbox primitives paint outside themselves.
        if ((el.textContent ?? "").trim() === "") return false;
        if (el.offsetParent === null && el.getClientRects().length === 0) {
          return false;
        }
        const overflow = getComputedStyle(el).overflowX;
        if (overflow !== "visible") return false;
        return el.scrollWidth > el.clientWidth + 1;
      })
      .map(
        (el) =>
          `<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 50)}" (${el.scrollWidth} > ${el.clientWidth})`,
      ),
  );

  expect(spilling, `${where}: a control's label does not fit`).toEqual([]);
}

/** The stepper: one row of four markers, entirely inside the viewport. */
async function expectStepperUsable(
  page: Page,
  where: string,
  width: number,
): Promise<void> {
  const stepper = page.getByRole("navigation", { name: es.steps.navLabel });
  await expect(stepper).toBeVisible();

  const box = await stepper.boundingBox();
  expect(box, `${where}: the stepper has no box`).not.toBeNull();
  expect(
    box!.x,
    `${where}: the stepper starts off-screen`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    box!.x + box!.width,
    `${where}: the stepper runs past the viewport`,
  ).toBeLessThanOrEqual(width + 1);

  // Four markers, all on the same row: a wrapped rail no longer reads as
  // "step 2 of 4" at a glance, which is the only job it has.
  const markers = stepper.locator("li");
  await expect(markers).toHaveCount(4);
  const tops = await markers.evaluateAll((items) =>
    items.map((item) => Math.round(item.getBoundingClientRect().top)),
  );
  expect(
    new Set(tops).size,
    `${where}: the stepper wrapped onto two rows`,
  ).toBe(1);
}

/** The Back/Continue bar: visible, inside the viewport, tappable.
 *
 * `forward: false` is a step that states its own way onward instead of the
 * shell's Continue — step 3 item 6 — so the button must be absent
 * rather than merely disabled. `back: false` likewise asserts no Back button
 * where there is none to find (step 1, and the completion page, which is drawn
 * without the bar entirely). */
async function expectNavUsable(
  page: Page,
  where: string,
  { width, height }: { width: number; height: number },
  { back, forward = true }: { back: boolean; forward?: boolean },
): Promise<void> {
  if (!forward) {
    await expect(
      page.getByTestId("wizard-continue"),
      `${where}: the bar still offers a generic Continue`,
    ).toHaveCount(0);
  }

  if (!back) {
    await expect(
      page.getByTestId("wizard-back"),
      `${where}: the bar still offers Back`,
    ).toHaveCount(0);
  }

  const buttons = [
    ...(back ? [page.getByTestId("wizard-back")] : []),
    ...(forward ? [page.getByTestId("wizard-continue")] : []),
  ];

  for (const button of buttons) {
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(
      box.x,
      `${where}: a nav button starts off-screen`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      box.x + box.width,
      `${where}: a nav button runs past the viewport`,
    ).toBeLessThanOrEqual(width + 1);
    expect(
      box.y + box.height,
      `${where}: a nav button sits below the fold`,
    ).toBeLessThanOrEqual(height + 1);
    // `size="lg"` is `h-9` = 36 px. Below that the bar stops being a control
    // anybody can hit with a thumb.
    expect(
      box.height,
      `${where}: a nav button is too small to tap`,
    ).toBeGreaterThanOrEqual(32);
  }
}

/**
 * One step, fully checked.
 *
 * `stepper: false` is a page in the wizard's route group that is not a step and
 * carries neither rail nor Back/Continue bar — the completion page. Everything
 * else about it still has to fit a 360 px screen.
 */
async function checkStep(
  page: Page,
  slug: string,
  viewport: (typeof VIEWPORTS)[number],
  {
    back,
    forward = true,
    stepper = true,
  }: { back: boolean; forward?: boolean; stepper?: boolean },
): Promise<void> {
  const where = `${slug} @ ${viewport.name}`;
  await expectNoHorizontalScroll(page, where);
  await expectNoClippedLabels(page, where);
  await expectTablesScrollThemselves(page, where);
  if (stepper) await expectStepperUsable(page, where, viewport.width);
  await expectNavUsable(page, where, viewport, { back, forward });
}

// --- The walk --------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  test.describe(`responsive — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("every step fits, and its tables scroll on their own", async ({
      page,
    }) => {
      // Step 3 runs the real engine over an eight-wish scarce list and step 4
      // scores every candidate; on a cold start that is the slow part here.
      test.slow();
      await seedList(page);

      // --- step 1 --------------------------------------------------------
      await page.goto("/es/student");
      await expect(
        page.getByRole("heading", { level: 1, name: es.student.title }),
      ).toBeVisible();
      await checkStep(page, "1-student", viewport, { back: false });

      await page.getByLabel(es.student.idLabel).fill(LIST.inputs.student_id);
      await expect(page.getByTestId("student-id-feedback")).toHaveAttribute(
        "data-state",
        "valid",
      );

      // --- step 2 --------------------------------------------------------
      await page.getByTestId("wizard-continue").click();
      await page.waitForURL("**/es/list");
      await expect(page.getByTestId("wish-card")).toHaveCount(
        LIST.inputs.wishes.length,
      );
      // The cards show the `program_id` until `/programs/{id}` answers; the
      // school names are what has to fit, so wait for them before measuring.
      await expect(page.getByTestId("wish-details")).toHaveCount(
        LIST.inputs.wishes.length,
      );
      await checkStep(page, "2-list", viewport, { back: true });

      // The program-details sheet is the widest thing step 2 can open: a
      // definition list of every calibration field, in a side panel.
      await page
        .getByTestId("wish-card")
        .first()
        .getByRole("button", { name: /—/ })
        .first()
        .click();
      await expect(page.getByTestId("program-details-sheet")).toBeVisible();
      await expectNoHorizontalScroll(page, `2-list sheet @ ${viewport.name}`);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("program-details-sheet")).toBeHidden();

      // --- step 3 --------------------------------------------------------
      await page.getByTestId("wizard-continue").click();
      await page.waitForURL("**/es/result");
      await expect(page.getByTestId("result-outcome")).toBeVisible({
        timeout: 60_000,
      });
      await checkStep(page, "3-result", viewport, {
        back: true,
        forward: false,
      });
      // The two halves of the choice are the way onward now, so they
      // are what has to fit and be tappable at this width.
      for (const testId of ["result-finish", "result-improve"]) {
        const choice = page.getByTestId(testId);
        await expect(choice).toBeVisible();
        const box = (await choice.boundingBox())!;
        expect(
          box.x + box.width,
          `3-result @ ${viewport.name}: ${testId} runs past the viewport`,
        ).toBeLessThanOrEqual(viewport.width + 1);
        expect(
          box.height,
          `3-result @ ${viewport.name}: ${testId} is too small to tap`,
        ).toBeGreaterThanOrEqual(32);
      }

      // Step 3 has no tables: the outcome box is the widest thing here. "finish"
      // opens the completion page (covered in result.spec.ts); this walkthrough
      // follows the "improve" branch to step 4.

      // --- step 4 --------------------------------------------------------
      await page.getByTestId("result-improve").click();
      await page.waitForURL("**/es/improve");
      await expect(page.getByTestId("recommendation-card").first()).toBeVisible(
        { timeout: 90_000 },
      );
      // Step 4 is terminal: the bar has Back and no Continue.
      const where = `4-improve @ ${viewport.name}`;
      await expectNoHorizontalScroll(page, where);
      await expectNoClippedLabels(page, where);
      await expectTablesScrollThemselves(page, where);
      await expectStepperUsable(page, where, viewport.width);
      await expect(page.getByTestId("wizard-back")).toBeVisible();
      await expect(page.getByTestId("wizard-continue")).toHaveCount(0);
    });
  });
}

/**
 * The narrowest viewport, checked against the one layout that is not a step:
 * the header. It is `sticky` and holds the brand plus the locale switcher, so
 * it is the first thing to wrap when a translation grows.
 */
test.describe("responsive — 360 px furniture", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("the header keeps the brand and the locale switcher on one row", async ({
    page,
  }) => {
    // Seeded so step 1 is actually reachable: without the welcome answer the
    // guard bounces to `/es` and the header would be measured
    // mid-redirect.
    await seedList(page);
    await page.goto("/es/student");
    await expect(
      page.getByRole("heading", { level: 1, name: es.student.title }),
    ).toBeVisible();

    const header = page.locator("header").first();
    const brand = header.getByRole("link", { name: es.app.title });
    const switcher = page.getByRole("navigation", {
      name: es.app.languageLabel,
    });
    await expect(switcher).toBeVisible();

    const switcherBox = (await switcher.boundingBox())!;
    const brandBox = (await brand.boundingBox())!;
    expect(switcherBox.x + switcherBox.width).toBeLessThanOrEqual(361);

    // On one row: the brand and the switcher overlap vertically. If the header
    // wrapped to two lines they would not — and the exact pixel height varies
    // with the platform's font metrics, so it is not a reliable proxy.
    const rowTop = Math.max(brandBox.y, switcherBox.y);
    const rowBottom = Math.min(
      brandBox.y + brandBox.height,
      switcherBox.y + switcherBox.height,
    );
    expect(rowBottom).toBeGreaterThan(rowTop);

    await expectNoHorizontalScroll(page, "header @ 360x740");
  });
});
