import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import es from "../messages/es";

/**
 * The guided branch's new opening phase: pick 1-3 schools of general
 * interest, then review up to 15 suggestions built from them before the
 * ordinary filter/search/list UI appears. `e2e/list.spec.ts` and
 * `e2e/filters.spec.ts` cover what comes after this phase; this file covers
 * the phase itself.
 *
 * The programs are not hard-coded: the ids come from `GET /api/programs` at
 * run time, same reasoning as the other step-2 specs.
 */

/** A valid RUN — body 12345678, modulo-11 check digit 5. */
const VALID_RUN = "12.345.678-5";

type Program = {
  program_id: string;
  program_label: string;
  school_name: string;
  school_commune: string;
  region: string;
};

async function fetchPrograms(
  request: APIRequestContext,
  limit: number,
): Promise<Program[]> {
  const response = await request.get(`/api/programs?limit=${limit}`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { items: Program[] };
  expect(body.items.length).toBeGreaterThanOrEqual(limit);
  return body.items;
}

/** Front door → step 1 → "No, help me build it" → the starter-picks phase. */
async function openStarterPicks(page: Page): Promise<void> {
  await page.goto("/es");
  await page.getByTestId("welcome-continue").click();
  await page.waitForURL("**/es/disclaimer");
  await page.getByTestId("disclaimer-checkbox").click();
  await page.getByTestId("disclaimer-continue").click();
  await page.waitForURL("**/es/student");
  await page.getByLabel(es.student.idLabel).fill(VALID_RUN);
  await page.getByTestId("wizard-continue").click();
  await page.waitForURL("**/es/list-choice");
  await page.getByTestId("list-choice-no").click();
  await page.waitForURL("**/es/list");
  await expect(page.getByTestId("starter-picks-panel")).toBeVisible();
}

/** Search for and add one program to the starter picks, by id. */
async function pickStarter(page: Page, programId: string): Promise<void> {
  await page.getByTestId("program-search-trigger").click();
  await page
    .locator(
      `[data-testid="program-search-option"][data-program-id="${programId}"]`,
    )
    .click();
  await page.getByTestId("program-search-add").click();
  await expect(
    page.locator(
      `[data-testid="starter-pick-card"][data-program-id="${programId}"]`,
    ),
  ).toBeVisible();
}

test.describe("step 2 — pick starter schools", () => {
  test("Continue stays disabled until at least one school is picked", async ({
    page,
    request,
  }) => {
    const [program] = await fetchPrograms(request, 1);
    await openStarterPicks(page);

    await expect(page.getByTestId("starter-picks-continue")).toBeDisabled();

    await pickStarter(page, program.program_id);
    await expect(page.getByTestId("starter-picks-continue")).toBeEnabled();
  });

  test("caps at 3 picks and disables the search past that", async ({
    page,
    request,
  }) => {
    const programs = await fetchPrograms(request, 4);
    await openStarterPicks(page);

    for (const program of programs.slice(0, 3)) {
      await pickStarter(page, program.program_id);
    }

    await expect(page.getByTestId("starter-pick-card")).toHaveCount(3);
    await expect(page.getByTestId("starter-picks-max")).toBeVisible();
    await expect(page.getByTestId("program-search-trigger")).toBeDisabled();
    await expect(page.getByTestId("starter-picks-continue")).toBeEnabled();
  });

  test("a pick can be removed before continuing", async ({ page, request }) => {
    const [program] = await fetchPrograms(request, 1);
    await openStarterPicks(page);
    await pickStarter(page, program.program_id);

    await page.getByTestId("starter-pick-card").getByRole("button").click();
    await expect(page.getByTestId("starter-pick-card")).toHaveCount(0);
    await expect(page.getByTestId("starter-picks-continue")).toBeDisabled();
  });

  test("continuing reveals suggestions and the ordinary list UI together", async ({
    page,
    request,
  }) => {
    const [program] = await fetchPrograms(request, 1);
    await openStarterPicks(page);
    await pickStarter(page, program.program_id);
    await page.getByTestId("starter-picks-continue").click();

    await expect(page.getByTestId("starter-picks-panel")).toHaveCount(0);
    await expect(
      page.getByTestId("starter-recommendations-panel"),
    ).toBeVisible();
    await expect(page.getByTestId("filter-panel")).toBeVisible();
    await expect(page.getByTestId("program-search")).toBeVisible();

    // Filters + search sit above the suggestions, both inside one bordered
    // element — "additional search filters/box -> scrollable recs box ->
    // existing list UI".
    const filtersBox = page.getByTestId("starter-search-filters");
    await expect(filtersBox).toBeVisible();
    await expect(filtersBox.getByTestId("filter-panel")).toBeVisible();
    await expect(filtersBox.getByTestId("program-search")).toBeVisible();
    const boxesTopToBottom = page.locator(
      '[data-testid="starter-search-filters"], [data-testid="starter-recommendations-panel"]',
    );
    await expect(boxesTopToBottom).toHaveCount(2);
    await expect(boxesTopToBottom.nth(0)).toHaveAttribute(
      "data-testid",
      "starter-search-filters",
    );

    // The starter pick is one of the suggested rows, not yet on the real list.
    const starterCard = page.locator(
      `[data-testid="starter-recommendation-card"][data-program-id="${program.program_id}"]`,
    );
    await expect(starterCard).toHaveAttribute("data-starter", "true");
    await expect(page.getByTestId("wish-card")).toHaveCount(0);

    // Every card shows its Add button (the scrolling box does not clip them).
    await expect(
      page.getByTestId("starter-recommendation-add").first(),
    ).toBeVisible();
  });

  test("adding a suggestion puts it straight on the reorderable list", async ({
    page,
    request,
  }) => {
    const [program] = await fetchPrograms(request, 1);
    await openStarterPicks(page);
    await pickStarter(page, program.program_id);
    await page.getByTestId("starter-picks-continue").click();

    const starterCard = page.locator(
      `[data-testid="starter-recommendation-card"][data-program-id="${program.program_id}"]`,
    );
    await starterCard.getByTestId("starter-recommendation-add").click();

    await expect(
      page.locator(
        `[data-testid="wish-card"][data-program-id="${program.program_id}"]`,
      ),
    ).toBeVisible();
    await expect(
      starterCard.getByTestId("starter-recommendation-add"),
    ).toBeDisabled();
    await expect(
      starterCard.getByTestId("starter-recommendation-add"),
    ).toHaveText(es.list.starters.added);
  });

  test("a family that already has wishes skips straight past the phase", async ({
    page,
    request,
  }) => {
    const programs = await fetchPrograms(request, 1);
    await openStarterPicks(page);
    await pickStarter(page, programs[0].program_id);
    await page.getByTestId("starter-picks-continue").click();
    await page
      .locator('[data-testid="starter-recommendation-card"]')
      .first()
      .getByTestId("starter-recommendation-add")
      .click();
    await expect(page.getByTestId("wish-card")).toHaveCount(1);

    // A reload keeps the RUN out of memory, so the guard sends the family back
    // to step 1 — the list itself, and the confirmed phase, survive it.
    await page.reload();
    await page.waitForURL("**/es/student");
    await page.getByLabel(es.student.idLabel).fill(VALID_RUN);
    await page.getByTestId("wizard-continue").click();
    await page.waitForURL("**/es/list-choice");
    await page.getByTestId("list-choice-no").click();
    await page.waitForURL("**/es/list");

    await expect(page.getByTestId("starter-picks-panel")).toHaveCount(0);
    await expect(page.getByTestId("wish-card")).toHaveCount(1);
  });
});
