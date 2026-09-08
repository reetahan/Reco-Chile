import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import en from "../messages/en";
import es from "../messages/es";

/**
 * Step 2: build a 3-wish strict list; build a tied list and see the order
 * count; toggle mode and confirm the list survives; remove and reorder; both
 * locales.
 *
 * The programs are not hard-coded: the ids come from `GET /api/programs` at run
 * time, so the scenarios stay true when the calibration data changes — and
 * driving the real proxy is itself part of what is under test. Expected copy is
 * read from `messages/{es,en}/*.json` for the same reason.
 */

/** A valid RUN — body 12345678, modulo-11 check digit 5. */
const VALID_RUN = "12.345.678-5";

const MESSAGES = { es, en } as const;
type Locale = keyof typeof MESSAGES;

/** The string `messages/<locale>/` holds for a dotted message id. */
function copy(locale: Locale, key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      MESSAGES[locale],
    );

  if (typeof value !== "string") {
    throw new Error(`messages/${locale} has no string at "${key}"`);
  }
  return value;
}

/** Fill one ICU placeholder, the way next-intl renders it. */
function fill(text: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (out, [key, value]) => out.replaceAll(`{${key}}`, value),
    text,
  );
}

type Program = {
  program_id: string;
  program_label: string;
  school_name: string;
  school_commune: string;
  region: string;
  calibration_imputed: boolean;
};

/** Three real programs, through the same same-origin proxy the app uses. */
async function fetchPrograms(request: APIRequestContext): Promise<Program[]> {
  const response = await request.get("/api/programs?limit=3");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { items: Program[] };
  expect(body.items).toHaveLength(3);
  return body.items;
}

/** The `commune · region` line a wish card must always carry. */
function locationOf(program: Program): string {
  return `${program.school_commune} · ${program.region}`;
}

/**
 * Two programs whose schools share a name but sit in different communes.
 *
 * 91 school names in the current calibration data repeat across communes —
 * "Liceo Ignacio Carrera Pinto" is one school in San Vicente and another in
 * Frutillar. Two cards for those two schools must not read alike, which is what
 * the disambiguation rule requires. The pair is discovered at run time so the test
 * survives a data change; `null` (no such pair) skips the paired assertions.
 */
async function findSameNamePair(
  request: APIRequestContext,
): Promise<[Program, Program] | null> {
  for (const query of ["q=Carrera+Pinto&limit=1000", "limit=1000"]) {
    const response = await request.get(`/api/programs?${query}`);
    expect(response.ok()).toBeTruthy();
    const { items } = (await response.json()) as { items: Program[] };
    const bySchool = new Map<string, Program[]>();
    for (const item of items) {
      bySchool.set(item.school_name, [
        ...(bySchool.get(item.school_name) ?? []),
        item,
      ]);
    }
    for (const programs of bySchool.values()) {
      const other = programs.find(
        (candidate) => candidate.school_commune !== programs[0].school_commune,
      );
      if (other) return [programs[0], other];
    }
  }
  return null;
}

/**
 * Welcome → step 1 → step 2. The RUN is never persisted, so every test starts
 * at the front door.
 *
 * The "do you already have a list?" question is the welcome
 * page's pair of buttons, and answering it is what unlocks step 1. `"yes"` is
 * the default here because most of these scenarios are about ordering a list
 * that exists; `"no"` is the branch that adds the filter panel to step 2.
 */
async function openListStep(
  page: Page,
  locale: Locale = "es",
  branch: "yes" | "no" = "yes",
) {
  await page.goto(`/${locale}`);
  await page.getByTestId(`welcome-${branch}`).click();
  await page.waitForURL(`**/${locale}/disclaimer`);
  await page.getByTestId("disclaimer-checkbox").click();
  await page.getByTestId("disclaimer-continue").click();
  await page.waitForURL(`**/${locale}/student`);
  await page.getByLabel(copy(locale, "student.idLabel")).fill(VALID_RUN);
  await page.getByTestId("wizard-continue").click();
  await page.waitForURL(`**/${locale}/list`);
}

async function addProgram(page: Page, program: Program) {
  await page.getByTestId("program-search-trigger").click();
  await page.getByTestId("program-search-input").fill(program.school_name);
  await page
    .locator(
      `[data-testid="program-search-option"][data-program-id="${program.program_id}"]`,
    )
    .click();
  await page.getByTestId("program-search-add").click();
  await expect(
    page.locator(
      `[data-testid="wish-card"][data-program-id="${program.program_id}"]`,
    ),
  ).toBeVisible();
}

/** The program ids of the wish cards, in the order they are rendered. */
async function listedIds(page: Page): Promise<string[]> {
  return page
    .getByTestId("wish-card")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-program-id") ?? ""),
    );
}

/** Flip the equivalence-class switch, which lives on this step. */
async function setTiesMode(page: Page, on: boolean, locale: Locale = "es") {
  const toggle = page.getByRole("switch", {
    name: copy(locale, "list.ties.label"),
  });
  await expect(toggle).toHaveAttribute("aria-checked", String(!on));
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
}

test.describe("step 2 — build and order the list", () => {
  test("adds three programs and unlocks Continue", async ({
    page,
    request,
  }) => {
    const programs = await fetchPrograms(request);
    await openListStep(page);

    const continueButton = page.getByTestId("wizard-continue");
    await expect(continueButton).toBeDisabled();
    await expect(page.getByTestId("wish-list-empty")).toBeVisible();

    for (const program of programs) await addProgram(page, program);

    await expect(page.getByTestId("wish-card")).toHaveCount(3);
    expect(await listedIds(page)).toEqual(programs.map((p) => p.program_id));
    // Strict mode: a rank badge per card, in order, and no group input.
    await expect(page.getByTestId("wish-rank")).toHaveCount(3);
    await expect(page.getByTestId("wish-group")).toHaveCount(0);
    for (const [index, program] of programs.entries()) {
      const card = page.locator(
        `[data-testid="wish-card"][data-program-id="${program.program_id}"]`,
      );
      await expect(card).toHaveAttribute("data-rank", String(index + 1));
      await expect(card.getByTestId("wish-label")).toHaveText(
        program.program_label,
      );
      // The label alone repeats across communes, so every card states where
      // the school is — commune *and* region, never one of the two.
      await expect(card.getByTestId("wish-location")).toHaveText(
        locationOf(program),
      );
      await expect(card.getByTestId("wish-details")).toContainText(
        locationOf(program),
      );
    }
    await expect(page.getByTestId("wish-count")).toHaveText(
      fill(copy("es", "list.current.count"), { n: "3" }),
    );
    await expect(continueButton).toBeEnabled();

    // The imputed-calibration notice follows the data, not a fixed program:
    // it is shown exactly when a selected program carries the flag.
    const imputed = programs.some((program) => program.calibration_imputed);
    await expect(page.getByTestId("imputed-notice")).toHaveCount(
      imputed ? 1 : 0,
    );
    if (imputed) {
      await page
        .getByTestId("imputed-notice")
        .getByRole("button", { name: copy("es", "list.notices.imputedWhat") })
        .click();
      await expect(page.getByTestId("imputed-notice")).toContainText(
        copy("es", "list.notices.imputedBody"),
      );
    }

    // A program already on the list cannot be added twice.
    await page.getByTestId("program-search-trigger").click();
    await page
      .getByTestId("program-search-input")
      .fill(programs[0].school_name);
    await expect(
      page.locator(
        `[data-testid="program-search-option"][data-program-id="${programs[0].program_id}"]`,
      ),
    ).toHaveAttribute("data-excluded", "true");
  });

  test("tells two same-named schools apart on the wish cards", async ({
    page,
    request,
  }) => {
    const pair = await findSameNamePair(request);
    test.skip(pair === null, "no school name repeats across communes here");
    const [first, second] = pair as [Program, Program];

    await openListStep(page);
    await addProgram(page, first);
    await addProgram(page, second);

    const cards = page.getByTestId("wish-card");
    await expect(cards).toHaveCount(2);

    for (const program of [first, second]) {
      await expect(
        page
          .locator(
            `[data-testid="wish-card"][data-program-id="${program.program_id}"]`,
          )
          .getByTestId("wish-location"),
      ).toHaveText(locationOf(program));
    }

    // The point of the line: the two cards are for schools with one name, and
    // the location is what distinguishes them.
    expect(first.school_name).toBe(second.school_name);
    const locations = await page.getByTestId("wish-location").allInnerTexts();
    expect(new Set(locations.map((line) => line.trim())).size).toBe(2);
  });

  test("reorders with the Move up and Move down buttons", async ({
    page,
    request,
  }) => {
    const programs = await fetchPrograms(request);
    await openListStep(page);
    for (const program of programs) await addProgram(page, program);

    const cards = page.getByTestId("wish-card");
    // The first card cannot move up, the last cannot move down.
    await expect(cards.first().getByTestId("wish-move-up")).toBeDisabled();
    await expect(cards.last().getByTestId("wish-move-down")).toBeDisabled();

    await cards.last().getByTestId("wish-move-up").click();
    expect(await listedIds(page)).toEqual([
      programs[0].program_id,
      programs[2].program_id,
      programs[1].program_id,
    ]);

    await cards.first().getByTestId("wish-move-down").click();
    expect(await listedIds(page)).toEqual([
      programs[2].program_id,
      programs[0].program_id,
      programs[1].program_id,
    ]);
    // The badges follow the new positions.
    await expect(
      page.locator(
        `[data-testid="wish-card"][data-program-id="${programs[2].program_id}"]`,
      ),
    ).toHaveAttribute("data-rank", "1");
  });

  test("reorders with the keyboard on the drag handle", async ({
    page,
    request,
  }) => {
    const programs = await fetchPrograms(request);
    await openListStep(page);
    for (const program of programs) await addProgram(page, program);

    // @dnd-kit's keyboard sensor: space lifts, an arrow moves, space drops.
    // Each step is a separate frame for the sensor, hence the short waits.
    const handle = page.getByTestId("wish-drag-handle").first();
    await handle.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    await page.keyboard.press("Space");

    await expect
      .poll(() => listedIds(page))
      .toEqual([
        programs[1].program_id,
        programs[0].program_id,
        programs[2].program_id,
      ]);
  });

  test("declares a priority and removes a program", async ({
    page,
    request,
  }) => {
    const programs = await fetchPrograms(request);
    await openListStep(page);
    for (const program of programs) await addProgram(page, program);

    const first = page.locator(
      `[data-testid="wish-card"][data-program-id="${programs[0].program_id}"]`,
    );
    await expect(first.getByTestId("wish-declared-priorities")).toHaveText(
      copy("es", "wishes.priorities.none"),
    );

    await first.getByTestId("wish-priorities").getByRole("button").click();
    await first
      .getByLabel(copy("es", "wishes.priorities.descriptions.sibling"))
      .click();

    await expect(first.getByTestId("wish-declared-priorities")).toHaveText(
      fill(copy("es", "wishes.priorities.declared"), {
        priorities: copy("es", "wishes.priorities.labels.sibling"),
      }),
    );

    // The details sheet carries the program-details table for the program the
    // card is about.
    await first
      .getByRole("button", {
        name: new RegExp(
          escapeRegExp(copy("es", "wishes.card.detailsTrigger")),
        ),
      })
      .click();
    const sheet = page.getByTestId("program-details-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(programs[0].program_label);
    await expect(sheet.getByTestId("program-details")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page
      .locator(
        `[data-testid="wish-card"][data-program-id="${programs[1].program_id}"]`,
      )
      .getByTestId("wish-remove")
      .click();

    await expect(page.getByTestId("wish-card")).toHaveCount(2);
    expect(await listedIds(page)).toEqual([
      programs[0].program_id,
      programs[2].program_id,
    ]);
  });

  // The mode badge that used to name "Orden estricto" / "Clases de
  // equivalencia" is gone: the switch's own state is the
  // readout, so that is what this asserts.
  test("the ties switch reflects its state", async ({ page }) => {
    await openListStep(page);

    const toggle = page.getByRole("switch", {
      name: copy("es", "list.ties.label"),
    });
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("the ties switch is operable from the keyboard, and its explanation is behind a popover", async ({
    page,
  }) => {
    await openListStep(page);

    const toggle = page.getByRole("switch", {
      name: copy("es", "list.ties.label"),
    });
    await toggle.focus();
    await page.keyboard.press("Space");

    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // The planning caveat is not permanently visible — it opens on demand,
    // the same pattern as step 1's "Why do we ask for this?".
    await expect(page.getByTestId("equivalence-help-content")).toHaveCount(0);
    await page.getByTestId("equivalence-help-trigger").click();
    await expect(page.getByTestId("equivalence-help-content")).toHaveText(
      copy("es", "list.ties.help"),
    );
  });

  test("ties mode counts the compatible orders and strict mode keeps the list", async ({
    page,
    request,
  }) => {
    const programs = await fetchPrograms(request);
    await openListStep(page);
    for (const program of programs) await addProgram(page, program);

    await setTiesMode(page, true);

    // Groups start at the current positions: one class per program, one order.
    await expect(page.getByTestId("wish-group")).toHaveCount(3);
    await expect(page.getByTestId("wish-rank")).toHaveCount(0);
    // Well within the limit, so no over-cap warning either.
    await expect(page.getByTestId("order-count-over-cap")).toHaveCount(0);

    // Tie the second program with the first: 2! × 1! = 2 compatible orders.
    const second = page.locator(
      `[data-testid="wish-card"][data-program-id="${programs[1].program_id}"]`,
    );
    await second.getByTestId("wish-group").fill("1");
    await expect(page.getByTestId("wizard-continue")).toBeEnabled();

    await setTiesMode(page, false);

    // The list survives the mode change and ranks come back.
    await expect(page.getByTestId("wish-card")).toHaveCount(3);
    expect(await listedIds(page)).toEqual(programs.map((p) => p.program_id));
    await expect(page.getByTestId("wish-rank")).toHaveCount(3);
  });

  test("keeps the wishes across a reload, but not the RUN", async ({
    page,
    request,
  }) => {
    const programs = await fetchPrograms(request);
    await openListStep(page);
    for (const program of programs) await addProgram(page, program);

    await page.reload();
    // The identifier is memory-only, so the guard sends the family back.
    await page.waitForURL("**/es/student");
    await expect(page.getByLabel(copy("es", "student.idLabel"))).toHaveValue(
      "",
    );

    await page.getByLabel(copy("es", "student.idLabel")).fill(VALID_RUN);
    await page.getByTestId("wizard-continue").click();
    await page.waitForURL("**/es/list");

    // The list itself is persisted to sessionStorage.
    await expect(page.getByTestId("wish-card")).toHaveCount(3);
    expect(await listedIds(page)).toEqual(programs.map((p) => p.program_id));
  });

  test("shows the filter panel only for the guided branch", async ({
    page,
  }) => {
    // "No — help me build it": filters, and the caption that introduces them.
    await openListStep(page, "es", "no");
    await expect(page.getByTestId("filter-panel")).toBeVisible();
    await expect(page.getByTestId("list-caption")).toHaveText(
      copy("es", "filters.intro"),
    );

    // "Yes — review my list", changed via the header's brand link back to the
    // welcome page (step 1 no longer echoes the answer): no filter panel, and
    // the order reminder instead.
    await page.getByTestId("wizard-back").click();
    await page.waitForURL("**/es/student");
    await page.getByRole("link", { name: copy("es", "app.title") }).click();
    await page.waitForURL("**/es");
    await page.getByTestId("welcome-yes").click();
    // The consent checkbox was already ticked on the way in and is a direct
    // view of that flag, so it comes back pre-checked here.
    await page.waitForURL("**/es/disclaimer");
    await page.getByTestId("disclaimer-continue").click();
    await page.waitForURL("**/es/student");
    await page.getByTestId("wizard-continue").click();
    await page.waitForURL("**/es/list");
    await expect(page.getByTestId("filter-panel")).toHaveCount(0);
    await expect(page.getByTestId("list-caption")).toHaveText(
      copy("es", "list.order.preferenceHint"),
    );
  });

  test("builds the list in English too", async ({ page, request }) => {
    const programs = await fetchPrograms(request);
    await openListStep(page, "en");

    await expect(
      page.getByRole("heading", { level: 1, name: copy("en", "list.title") }),
    ).toBeVisible();
    await expect(page.getByTestId("list-caption")).toHaveText(
      copy("en", "list.order.preferenceHint"),
    );

    await addProgram(page, programs[0]);
    await expect(page.getByTestId("wish-count")).toHaveText(
      fill(copy("en", "list.current.count"), { n: "1" }),
    );
    await expect(
      page.getByTestId("wish-card").getByTestId("wish-declared-priorities"),
    ).toHaveText(copy("en", "wishes.priorities.none"));
    await expect(page.getByTestId("wizard-continue")).toBeEnabled();
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
