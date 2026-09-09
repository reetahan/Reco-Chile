import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import es from "../messages/es";

/**
 * Step 4 — improve the preference list: from a simulated list, geocode with a
 * mocked `/geocode`, select two recommendations, and land on step 2 with two
 * new cards and a stale simulation.
 *
 * `/api/geocode` is ALWAYS intercepted in the browser, so no test in this file
 * can reach the Next.js proxy, FastAPI, or OpenStreetMap/Nominatim. That is not
 * only about speed: Nominatim's usage policy allows one request per second for
 * the whole process (`sae_app/geo.py`), and a test suite is not a family
 * looking up their home. `/recommend` and `/simulate`, by contrast, are the
 * real engine — the numbers on this step are the thing under test.
 *
 * The wish list is seeded into `sessionStorage` from the golden
 * recommendation fixture, so the list is exactly the frozen fixture. The
 * RUN/IPE is never seedable — it is memory-only — so it is typed into
 * step 1 the way a family would.
 */

// --- Fixture ---------------------------------------------------------------

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

/** Three wishes in the Santiago metropolitan area — the same list the
 * `recommend_*` fixtures were generated from. */
const LIST = golden("recommend_01_no_home");

// --- Store seeding ---------------------------------------------------------

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

// --- Geocoding stub --------------------------------------------------------

const TYPED_ADDRESS = "Av. Siempre Viva 742, Santiago";
const RESOLVED_ADDRESS = "Fake 123, Santiago";

type Precision = "address" | "city";

/** Exactly the `GeocodeResponse` shape of the contract, with `message`
 * already localized by the server — which for `city` is the precision warning
 * `geocoding_precision_warning_key` selects. */
function geocodeBody(precision: Precision) {
  return {
    ok: true,
    address: TYPED_ADDRESS,
    lat: -33.45,
    lon: -70.66,
    precision,
    display_name: RESOLVED_ADDRESS,
    warning_key:
      precision === "address"
        ? null
        : "The geocoder could only identify the city or municipality. Distances are approximate.",
    error_key: null,
    params: {},
    message: precision === "address" ? "" : es.improve.precision.city,
  };
}

type GeocodeCalls = { count: number; addresses: string[] };

async function stubGeocode(
  page: Page,
  precision: Precision,
): Promise<GeocodeCalls> {
  const calls: GeocodeCalls = { count: 0, addresses: [] };

  await page.route("**/api/geocode**", async (route) => {
    calls.count += 1;
    const body = route.request().postDataJSON() as { address?: string };
    calls.addresses.push(String(body.address ?? ""));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(geocodeBody(precision)),
    });
  });

  return calls;
}

// --- Navigation ------------------------------------------------------------

/** Type the RUN on step 1, run the simulation on step 3, continue to step 4.
 * All client-side: a reload would drop the memory-only identifier. */
async function openImprove(page: Page): Promise<void> {
  await seedList(page);
  await page.goto("/es/student");

  await page.getByLabel(es.student.idLabel).fill(LIST.inputs.student_id);
  await expect(page.getByTestId("student-id-feedback")).toHaveAttribute(
    "data-state",
    "valid",
  );

  await page
    .getByRole("navigation", { name: es.steps.navLabel })
    .getByRole("link", { name: `3. ${es.steps.result}` })
    .click();
  await page.waitForURL("**/es/result");
  // The simulation has to succeed before step 4 unlocks.
  await expect(page.getByTestId("result-outcome")).toBeVisible({
    timeout: 60_000,
  });

  // Step 3 has no generic Continue item 6 — the way to step 4 is the
  // explicit "not happy, help me improve my list" half of the result's choice.
  await page.getByTestId("result-improve").click();
  await page.waitForURL("**/es/improve");
}

/** `/recommend` runs the engine per candidate; give it room on a cold start. */
async function waitForRecommendations(page: Page): Promise<void> {
  await expect(page.getByTestId("recommendation-card").first()).toBeVisible({
    timeout: 90_000,
  });
}

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, value),
    template,
  );
}

async function maxHomeDistanceKm(page: Page): Promise<number> {
  const response = await page.request.get("/api/meta");
  expect(response.ok()).toBeTruthy();
  const meta = (await response.json()) as {
    recommendation_max_home_distance_km: number;
  };
  return Math.round(meta.recommendation_max_home_distance_km);
}

// --- Tests -----------------------------------------------------------------

test.describe("improve step — the home address", () => {
  test("nothing is geocoded until the button is pressed", async ({ page }) => {
    const calls = await stubGeocode(page, "address");
    await openImprove(page);

    const input = page.getByTestId("home-address-input");
    const submit = page.getByTestId("geocode-submit");

    // Empty field: the button is disabled.
    await expect(submit).toBeDisabled();

    await input.fill(TYPED_ADDRESS);
    await expect(submit).toBeEnabled();
    // The privacy rule , asserted rather than assumed: typing a home
    // address must never reach the network.
    expect(calls.count).toBe(0);
    await expect(page.getByTestId("geocode-feedback")).toHaveAttribute(
      "data-kind",
      "idle",
    );

    await submit.click();
    await expect(page.getByTestId("geocode-feedback")).toHaveAttribute(
      "data-kind",
      "confirmed",
    );
    expect(calls.count).toBe(1);
    // Whitespace is collapsed before sending, matching the API's
    // `" ".join(address.strip().split())`.
    expect(calls.addresses).toEqual([TYPED_ADDRESS]);
  });

  test("an exact match is confirmed and the hard distance limit applies", async ({
    page,
  }) => {
    await stubGeocode(page, "address");
    await openImprove(page);

    await page.getByTestId("home-address-input").fill(TYPED_ADDRESS);
    await page.getByTestId("geocode-submit").click();

    const feedback = page.getByTestId("geocode-feedback");
    await expect(feedback).toHaveAttribute("data-kind", "confirmed");
    await expect(feedback).toHaveText(
      fill(es.improve.address.confirmed, { address: RESOLVED_ADDRESS }),
    );
    // Green, not amber: `precision === "address"` is the one case with no caveat.
    await expect(feedback.locator("[data-tone]")).toHaveAttribute(
      "data-tone",
      "success",
    );

    await waitForRecommendations(page);
    await expect(page.getByTestId("hard-filter-caption")).toHaveText(
      fill(es.improve.distance.hardLimit, {
        maxDistance: String(await maxHomeDistanceKm(page)),
      }),
    );

    // Editing the field invalidates the coordinates on file until the family
    // asks again — the same check the API makes.
    await page.getByTestId("home-address-input").fill("Otra calle 1, Santiago");
    await expect(feedback).toHaveAttribute("data-kind", "changed");
    await expect(feedback).toHaveText(es.improve.address.changed);

    await page.getByTestId("geocode-clear").click();
    await expect(page.getByTestId("home-address-input")).toHaveValue("");
    await expect(feedback).toHaveAttribute("data-kind", "idle");
  });

  test("a city-level match warns with the server's own message and drops the hard limit", async ({
    page,
  }) => {
    await stubGeocode(page, "city");
    await openImprove(page);

    await page.getByTestId("home-address-input").fill(TYPED_ADDRESS);
    await page.getByTestId("geocode-submit").click();

    const feedback = page.getByTestId("geocode-feedback");
    await expect(feedback).toHaveAttribute("data-kind", "approximate");
    await expect(feedback).toHaveText(
      fill(es.improve.address.usedLocation, {
        // Shown verbatim: the API already localized it.
        warning: es.improve.precision.city,
        address: RESOLVED_ADDRESS,
      }),
    );
    await expect(feedback.locator("[data-tone]")).toHaveAttribute(
      "data-tone",
      "warning",
    );

    await waitForRecommendations(page);
    // `home_geocoding_supports_hard_filter` is false for city precision, so the
    // engine reports no hard filter and the caption says why.
    await expect(page.getByTestId("hard-filter-caption")).toHaveText(
      es.improve.distance.noHardFilter,
    );
  });
});

test.describe("improve step — feeding recommendations back into the list", () => {
  test("two selected programs land on step 2 as new cards with a stale result", async ({
    page,
  }) => {
    // Installed but never used: this test does not geocode, and the route keeps
    // the guarantee that nothing in this file can reach Nominatim.
    const calls = await stubGeocode(page, "address");
    await openImprove(page);
    await waitForRecommendations(page);

    const cards = page.getByTestId("recommendation-card");
    expect(await cards.count()).toBeGreaterThanOrEqual(2);

    const chosen = [
      await cards.nth(0).getAttribute("data-program-id"),
      await cards.nth(1).getAttribute("data-program-id"),
    ];
    expect(chosen.every((id) => typeof id === "string" && id !== "")).toBe(
      true,
    );

    const submit = page.getByTestId("add-recommendations");
    await expect(submit).toBeDisabled();

    await cards.nth(0).getByTestId("recommendation-select").click();
    await cards.nth(1).getByTestId("recommendation-select").click();
    await expect(submit).toBeEnabled();

    await submit.click();
    await page.waitForURL("**/es/list");

    // Appended, invalidated, and landed on step 2 with the success
    // notice. The banner is the message — one message, not a banner and a toast
    // — and it renders because the improve step announces the navigation
    // through the store's `pendingNavigation` before it invalidates the
    // simulation, so the step guard no longer redirects to step 3 mid-push.
    const added = page.getByTestId("recommendations-added");
    await expect(added).toBeVisible();
    await expect(added).toHaveText(
      fill(es.list.notices.recommendationsAdded, { n: "2" }),
    );

    const wishCards = page.getByTestId("wish-card");
    await expect(wishCards).toHaveCount(LIST.inputs.wishes.length + 2);
    for (const programId of chosen) {
      await expect(
        page.locator(
          `[data-testid="wish-card"][data-program-id="${programId}"]`,
        ),
      ).toHaveCount(1);
    }
    // Appended at the end, in recommendation order — a checkbox records which
    // programs were picked, not an order the family stated.
    await expect(wishCards.nth(LIST.inputs.wishes.length)).toHaveAttribute(
      "data-program-id",
      chosen[0]!,
    );
    await expect(wishCards.nth(LIST.inputs.wishes.length + 1)).toHaveAttribute(
      "data-program-id",
      chosen[1]!,
    );

    // The list is still valid, so Continue works again...
    await expect(page.getByTestId("wizard-continue")).toBeEnabled();
    // ...but the simulation was invalidated, so step 4 — the only gate that
    // requires a *fresh* result — is locked until the family analyses again.
    await expect(
      page
        .getByRole("navigation", { name: es.steps.navLabel })
        .getByRole("link", { name: `4. ${es.steps.improve}` }),
    ).toHaveCount(0);

    expect(calls.count).toBe(0);

    // The notice is shown once. Leaving step 2 and coming
    // back must not resurface it.
    await page.getByTestId("wizard-back").click();
    await page.waitForURL("**/es/student");
    await page.getByTestId("wizard-continue").click();
    await page.waitForURL("**/es/list");
    await expect(page.getByTestId("wish-card")).toHaveCount(
      LIST.inputs.wishes.length + 2,
    );
    await expect(page.getByTestId("recommendations-added")).toHaveCount(0);
  });
});

test.describe("improve step — filtering the suggestions", () => {
  test("the sidebar filters restrict the suggestions and flag a short result", async ({
    page,
  }) => {
    await openImprove(page);
    await waitForRecommendations(page);

    const cards = page.getByTestId("recommendation-card");
    const before = await cards.count();
    expect(before).toBeGreaterThanOrEqual(2);

    // The shared step-2 filter panel. The rarest enrollment-fee band nationally
    // holds only a couple of programs — far fewer than the default three.
    await page.getByTestId("filter-more-trigger").click();
    await page.getByTestId("filter-enrollmentFee").click();
    const payment = es.enums.payment as Record<string, string>;
    await page
      .getByRole("option", { name: payment["$25,001–$50,000"], exact: true })
      .click();
    await page.keyboard.press("Escape");

    const limited = page.getByTestId("recommendation-limited-by-filters");
    await expect(limited).toBeVisible({ timeout: 30_000 });
    await expect(limited).toHaveText(es.improve.warning.limitedByFilters);
    await expect.poll(() => cards.count()).toBeLessThan(before);
  });
});
