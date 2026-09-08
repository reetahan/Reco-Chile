import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import es from "../messages/es";

/**
 * Step 2 — the program-finding half: filter panel, matching count,
 * "kept outside filters" note and the server-searched combobox.
 *
 * The assertions compare the UI against `GET /api/programs` with the *same*
 * parameters rather than against numbers frozen here. That is the property
 * that actually matters: the panel, the caption and the combobox must all be
 * showing what `program_matches_filters` says, not a client-side approximation
 * of it (the engine is the only source of truth). It also keeps the test
 * true when the calibration CSVs change.
 */

/** A valid RUN — body 12345678, modulo-11 check digit 5. */
const VALID_RUN = "12.345.678-5";

/** A region that actually has technical-vocational programs, so the specialty
 * filter has something to narrow. Verified against the API in the test. */
const REGION = "Región de Los Ríos";
/** Wire value; the UI shows the `enums.specialty` translation of it. */
const SPECIALTY = "Food services";
/** Any region other than {@link REGION} — used for the preserved-wish note. */
const OTHER_REGION = "Región de Arica y Parinacota";
/** Where {@link findSameNamePair} looks for a repeated school name first.
 * Nothing depends on this term matching — it is a shortcut, not a fixture. */
const SAME_NAME_SEED = "Carrera Pinto";

const filtersCopy = es.filters as unknown as {
  fields: Record<string, { label: string }>;
};
const enums = es.enums as unknown as Record<string, Record<string, string>>;
/** Owned by the wish-card half of step 2; read, never duplicated. */
const wishesCopy = es.wishes as unknown as {
  card: { detailsTrigger: string };
};

/** `total_matched` the API reports for a set of query parameters. */
async function apiTotal(
  request: APIRequestContext,
  params: Record<string, string | string[]>,
): Promise<number> {
  return (await apiPrograms(request, params)).total_matched;
}

/** The fields of `ProgramSummary` this spec reads back from the UI. */
type Program = {
  program_id: string;
  program_label: string;
  school_name: string;
  school_commune: string;
  region: string;
};

async function apiPrograms(
  request: APIRequestContext,
  params: Record<string, string | string[]>,
): Promise<{ total_matched: number; items: Program[] }> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, item);
    }
  }
  const response = await request.get(`/api/programs?${search.toString()}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    total_matched: number;
    items: Program[];
  };
}

/**
 * Two programs whose schools share a name but sit in different communes.
 *
 * That is the disambiguation case: "Liceo Ignacio Carrera Pinto"
 * is a school in San Vicente and a *different* school in Frutillar, and 91
 * school names in the current data repeat across communes. The pair is looked
 * up at run time rather than frozen here, so the test keeps testing the same
 * property when the calibration CSVs change; the seed query only decides where
 * to look first. `null` means this data set has no such pair — then the test
 * falls back to asserting the line on an ordinary row.
 */
async function findSameNamePair(
  request: APIRequestContext,
): Promise<[Program, Program] | null> {
  const attempts: Record<string, string>[] = [
    { q: SAME_NAME_SEED, limit: "1000" },
    { limit: "1000" },
  ];
  for (const params of attempts) {
    const { items } = await apiPrograms(request, params);
    const bySchool = new Map<string, Program[]>();
    for (const item of items) {
      bySchool.set(item.school_name, [
        ...(bySchool.get(item.school_name) ?? []),
        item,
      ]);
    }
    for (const programs of bySchool.values()) {
      const first = programs[0];
      const other = programs.find(
        (candidate) => candidate.school_commune !== first.school_commune,
      );
      if (other) return [first, other];
    }
  }
  return null;
}

/**
 * Welcome → step 1 with a valid RUN → step 2, on the guided branch.
 *
 * "No — help me build it" is answered on the welcome page item 2; it
 * is what makes step 2 render the filter panel at all.
 */
async function openBuilder(page: Page) {
  await page.goto("/es");
  await page.getByTestId("welcome-no").click();
  await page.waitForURL("**/es/disclaimer");
  await page.getByTestId("disclaimer-checkbox").click();
  await page.getByTestId("disclaimer-continue").click();
  await page.waitForURL("**/es/student");
  await page.getByLabel(es.student.idLabel).fill(VALID_RUN);
  await page.getByTestId("wizard-continue").click();
  await page.waitForURL("**/es/list");
  await expect(page.getByTestId("filter-panel")).toBeVisible();
}

/** Radix `Select`: open the trigger, pick the option by its visible name. */
async function chooseRegion(page: Page, region: string) {
  await page.getByTestId("filter-region").click();
  await page.getByRole("option", { name: region, exact: true }).click();
}

/** The caption's machine-readable count; it only exists once something is
 * filtered. */
function matchCount(page: Page) {
  return page.getByTestId("filter-match-count");
}

async function expectCount(page: Page, expected: number) {
  await expect(matchCount(page)).toHaveAttribute(
    "data-count",
    String(expected),
  );
}

test.describe("step 2 — filters and program search", () => {
  test("the matching count follows the filters, and the combobox agrees", async ({
    page,
    request,
  }) => {
    const regionTotal = await apiTotal(request, { region: REGION });
    const specializedTotal = await apiTotal(request, {
      region: REGION,
      track: "Specialized",
    });
    const specialtyMatches = await apiPrograms(request, {
      region: REGION,
      track: "Specialized",
      specialty_sector: SPECIALTY,
      limit: "200",
    });

    // The scenario is only meaningful if each step actually narrows.
    expect(specialtyMatches.total_matched).toBeGreaterThan(0);
    expect(specialtyMatches.total_matched).toBeLessThan(specializedTotal);
    expect(specializedTotal).toBeLessThan(regionTotal);

    await openBuilder(page);

    // Nothing filtered yet: no caption at all.
    await expect(matchCount(page)).toHaveCount(0);

    await chooseRegion(page, REGION);
    await expect(matchCount(page)).toBeVisible();
    await expectCount(page, regionTotal);
    await expect(matchCount(page)).toContainText(REGION);

    await page.getByTestId("filter-track-specialized").click();
    await expectCount(page, specializedTotal);

    // The specialty select only exists once "Specialized" is ticked.
    await page.getByTestId("filter-more-trigger").click();
    const specialtySelect = page.getByTestId("filter-specialtySectors");
    await expect(specialtySelect).toBeVisible();
    await expect(specialtySelect).toHaveAttribute("data-selected-count", "0");

    await specialtySelect.click();
    await page
      .getByRole("option", { name: enums.specialty[SPECIALTY], exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(specialtySelect).toHaveAttribute("data-selected-count", "1");

    await expectCount(page, specialtyMatches.total_matched);

    // The combobox is fed by the same endpoint with the same parameters, so it
    // must list exactly the programs the API matched — no more, no fewer.
    await page.getByTestId("program-search-trigger").click();
    const options = page.getByTestId("program-search-option");
    await expect(options).toHaveCount(specialtyMatches.total_matched);

    const listed = await options.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-program-id")),
    );
    expect([...listed].sort()).toEqual(
      specialtyMatches.items.map((item) => item.program_id).sort(),
    );
  });

  test("unticking Specialized drops the specialty filter with it", async ({
    page,
    request,
  }) => {
    const regionTotal = await apiTotal(request, { region: REGION });

    await openBuilder(page);
    await chooseRegion(page, REGION);
    await page.getByTestId("filter-track-specialized").click();
    await page.getByTestId("filter-more-trigger").click();

    await page.getByTestId("filter-specialtySectors").click();
    await page
      .getByRole("option", { name: enums.specialty[SPECIALTY], exact: true })
      .click();
    await page.keyboard.press("Escape");

    // A specialty selection that survived its track would keep filtering
    // invisibly, because the select itself is gone.
    await page.getByTestId("filter-track-specialized").click();
    await expect(page.getByTestId("filter-specialtySectors")).toHaveCount(0);
    await expectCount(page, regionTotal);
  });

  test("an already-selected program outside the filters is kept and counted", async ({
    page,
    request,
  }) => {
    const other = await apiPrograms(request, {
      region: OTHER_REGION,
      limit: "1",
    });
    const kept = other.items[0].program_id;
    const regionTotal = await apiTotal(request, { region: REGION });

    await openBuilder(page);

    // Add a program from another region while nothing is filtered.
    await page.getByTestId("program-search-trigger").click();
    await page
      .locator(
        `[data-testid="program-search-option"][data-program-id="${kept}"]`,
      )
      .click();
    await page.getByTestId("program-search-add").click();
    await expect(page.getByTestId("wish-card")).toHaveCount(1);

    // Filtering to another region must not remove it — it is reported instead.
    await chooseRegion(page, REGION);
    await expectCount(page, regionTotal);
    await expect(matchCount(page)).toHaveAttribute("data-preserved", "1");
    await expect(page.getByTestId("wish-card")).toHaveCount(1);
  });

  test("every combobox row names its commune and region", async ({
    page,
    request,
  }) => {
    // A program has to be unambiguous wherever it is shown.
    // The server-side label appends the commune only when the school *name*
    // collides and never appends the region, so the second line is the only
    // thing that separates two same-named schools — and the only thing that
    // tells you which region a school is in at all.
    const pair = await findSameNamePair(request);

    await openBuilder(page);
    await page.getByTestId("program-search-trigger").click();
    if (pair)
      await page.getByTestId("program-search-input").fill(pair[0].school_name);

    const options = page.getByTestId("program-search-option");
    await expect(options.first()).toBeVisible();
    const locations = page.getByTestId("program-search-option-location");
    await expect(locations).toHaveCount(await options.count());

    // Not one row may be showing a bare label.
    for (const line of await locations.allInnerTexts()) {
      expect(line.trim()).not.toBe("");
    }

    if (pair) {
      for (const program of pair) {
        const option = page.locator(
          `[data-testid="program-search-option"][data-program-id="${program.program_id}"]`,
        );
        await expect(
          option.getByTestId("program-search-option-location"),
        ).toHaveText(`${program.school_commune} · ${program.region}`);
        // Screen-reader users get the same disambiguation by ear.
        await expect(option).toHaveAccessibleName(
          new RegExp(escapeRegExp(program.school_commune)),
        );
      }
      // The pair really is the ambiguous case: same school name, two communes.
      expect(pair[0].school_name).toBe(pair[1].school_name);
      expect(pair[0].school_commune).not.toBe(pair[1].school_commune);

      // The trigger reads the choice back with its location, so the program is
      // still identifiable at the moment Add is pressed.
      await page
        .locator(
          `[data-testid="program-search-option"][data-program-id="${pair[0].program_id}"]`,
        )
        .click();
      await expect(
        page.getByTestId("program-search-selected-location"),
      ).toHaveText(`${pair[0].school_commune} · ${pair[0].region}`);
    }
  });

  test("the program details list shows its ten rows", async ({
    page,
    request,
  }) => {
    const first = (await apiPrograms(request, { limit: "1" })).items[0];

    await openBuilder(page);

    await page.getByTestId("program-search-trigger").click();
    await page.getByTestId("program-search-option").first().click();
    await page.getByTestId("program-search-add").click();

    await page
      .getByTestId("wish-card")
      .first()
      .getByRole("button", {
        name: new RegExp(escapeRegExp(wishesCopy.card.detailsTrigger)),
      })
      .click();
    const details = page.getByTestId("program-details");
    await expect(details).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("program-details-row")).toHaveCount(10);
    // Enumerated values are shown in Spanish, never as the English wire code.
    await expect(
      page
        .getByTestId("program-details-row")
        .filter({ hasText: "PIE" })
        .first(),
    ).toContainText(/Con PIE|Sin PIE|Sin información/);

    // The sheet is the long form of the card's location line: commune
    // and region are rows of their own, with the values the API returned.
    await expect(details.locator('[data-field="commune"]')).toContainText(
      first.school_commune,
    );
    await expect(details.locator('[data-field="region"]')).toContainText(
      first.region,
    );
  });

  test("the filter panel is keyboard operable", async ({ page }) => {
    await openBuilder(page);
    await page.getByTestId("filter-more-trigger").click();

    const gender = page.getByTestId("filter-genders");
    await expect(gender).toHaveAccessibleName(
      new RegExp(escapeRegExp(filtersCopy.fields.gender.label)),
    );

    await gender.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(gender).toHaveAttribute("data-selected-count", "1");
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
