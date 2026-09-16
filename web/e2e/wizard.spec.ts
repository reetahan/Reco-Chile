import { expect, test, type Page } from "@playwright/test";

import en from "../messages/en";
import es from "../messages/es";

/**
 * Shell smoke test: navigating `/es/student` → `/es/list` works with the guard,
 * and step 1 loads in both locales.
 *
 * The wizard opens on a welcome page instead of step 1, but it no longer asks
 * anything: `/es` is a single Continue button, then the disclaimer, then
 * step 1 (the RUN/IPE). "Do you already have your list?" is asked *after*
 * step 1 now, at `/es/list-choice`, so both paths start the same way — and
 * that answer is what unlocks step 2.
 *
 * Expected copy is read from `messages/{es,en}.json` rather than frozen here, so
 * these stay true when a sentence is reworded — what is under test is the
 * routing, the guard and the store, not the wording. `components/wizard/
 * steps.test.ts` is what fails if an id disappears from a catalogue.
 */

/** A valid RUN — body 12345678, modulo-11 check digit 5. */
const VALID_RUN = "12.345.678-5";
/** Same body, wrong verifier: right shape, rejected by the check digit. */
const BAD_CHECK_DIGIT = "12.345.678-4";

const MESSAGES = { es, en } as const;

type Locale = keyof typeof MESSAGES;

/** The string `messages/<locale>.json` holds for a dotted message id. */
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
    throw new Error(`messages/${locale}.json has no string at "${key}"`);
  }
  return value;
}

/**
 * The step title is the page's single `<h1>` (`components/wizard/step-page.tsx`);
 * the application title in the header is a `<p>` brand element, not a heading.
 * Asserting the level is what keeps that contract from silently regressing.
 */
function stepHeading(locale: Locale, key: string) {
  return { level: 1 as const, name: copy(locale, key) };
}

/**
 * Through the front door and into step 1: the welcome page's single Continue
 * button, then the "Before we continue" consent checkbox.
 */
async function enterWizard(
  page: Page,
  { locale = "es" }: { locale?: Locale } = {},
) {
  await page.goto(`/${locale}`);
  await page.getByTestId("welcome-continue").click();
  await page.waitForURL(`**/${locale}/disclaimer`);
  await page.getByTestId("disclaimer-checkbox").click();
  await page.getByTestId("disclaimer-continue").click();
  await page.waitForURL(`**/${locale}/student`);
}

/**
 * From step 1, through the list-choice question, into step 2. `answer: "yes"`
 * is "I already have my list", `"no"` asks for help building it.
 */
async function enterListStep(
  page: Page,
  {
    locale = "es",
    answer = "yes",
  }: { locale?: Locale; answer?: "yes" | "no" } = {},
) {
  await enterWizard(page, { locale });
  await page.getByLabel(copy(locale, "student.idLabel")).fill(VALID_RUN);
  await page.getByTestId("wizard-continue").click();
  await page.waitForURL(`**/${locale}/list-choice`);
  await page.getByTestId(`list-choice-${answer}`).click();
  await page.waitForURL(`**/${locale}/list`);
}

test.describe("welcome page", () => {
  test("opens the wizard with the positive framing and a single continue", async ({
    page,
  }) => {
    const response = await page.goto("/es");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/es$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: copy("es", "app.welcome.headline"),
      }),
    ).toBeVisible();
    await expect(page.getByTestId("welcome-continue")).toHaveText(
      copy("es", "steps.continue"),
    );

    // No stepper on the front door, and no step title either.
    await expect(
      page.getByRole("navigation", { name: copy("es", "steps.navLabel") }),
    ).toHaveCount(0);
  });

  test("loads in English too", async ({ page }) => {
    await page.goto("/en");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: copy("en", "app.welcome.headline"),
      }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(copy("en", "app.welcome.headline")).not.toBe(
      copy("es", "app.welcome.headline"),
    );
  });

  test("a deep link into the wizard without an answer lands here", async ({
    page,
  }) => {
    // The consent checkbox is the only gate step 1 has, and it is not set on
    // a cold load, so every wizard route redirects to the welcome page — the
    // same page `reset()` sends a "start over" to.
    for (const locked of ["student", "list", "result", "improve", "finish"]) {
      await page.goto(`/es/${locked}`);
      await page.waitForURL("**/es");
      await expect(page.getByTestId("welcome-continue")).toBeVisible();
    }
  });
});

test.describe("list-choice page", () => {
  test("each answer opens step 2 and is remembered there", async ({ page }) => {
    await enterListStep(page, { answer: "no" });

    await expect(
      page.getByRole("heading", stepHeading("es", "list.title")),
    ).toBeVisible();
    const stored = await page.evaluate(() =>
      window.sessionStorage.getItem("reco-chile.wizard"),
    );
    expect(stored).toContain('"listExists":false');

    // The other answer, from the same question — reached via the header's
    // brand link back to the welcome page. The consent checkbox and the RUN
    // are both still in memory from the way in, so neither needs re-entering.
    await page.getByRole("link", { name: copy("es", "app.title") }).click();
    await page.waitForURL("**/es");
    await page.getByTestId("welcome-continue").click();
    await page.waitForURL("**/es/disclaimer");
    await expect(page.getByTestId("disclaimer-checkbox")).toBeChecked();
    await page.getByTestId("disclaimer-continue").click();
    await page.waitForURL("**/es/student");
    await expect(page.getByTestId("wizard-continue")).toBeEnabled();
    await page.getByTestId("wizard-continue").click();
    await page.waitForURL("**/es/list-choice");
    await page.getByTestId("list-choice-yes").click();
    await page.waitForURL("**/es/list");
    const storedAfter = await page.evaluate(() =>
      window.sessionStorage.getItem("reco-chile.wizard"),
    );
    expect(storedAfter).toContain('"listExists":true');
  });
});

test.describe("wizard shell", () => {
  test("step 1 loads in Spanish", async ({ page }) => {
    await enterWizard(page, {});

    await expect(page).toHaveURL(/\/es\/student$/);
    await expect(
      page.getByRole("heading", stepHeading("es", "student.title")),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
  });

  test("step 1 loads in English", async ({ page }) => {
    await enterWizard(page, { locale: "en" });

    await expect(
      page.getByRole("heading", stepHeading("en", "student.title")),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // The locale switch is a real switch, not the same string twice.
    expect(copy("en", "student.title")).not.toBe(copy("es", "student.title"));
  });

  test("the locale switcher keeps the current step", async ({ page }) => {
    await enterWizard(page, {});

    const switcher = page.getByRole("navigation", {
      name: copy("es", "app.languageLabel"),
    });
    await switcher
      .getByRole("link", { name: copy("es", "app.language.en") })
      .click();

    // Same step, other language: `usePathname` from `@/i18n/navigation` is
    // locale-free, so switching must not send the family back to the start.
    await page.waitForURL("**/en/student");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", stepHeading("en", "student.title")),
    ).toBeVisible();

    await page
      .getByRole("navigation", { name: copy("en", "app.languageLabel") })
      .getByRole("link", { name: copy("en", "app.language.es") })
      .click();
    await page.waitForURL("**/es/student");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
  });

  test("the guard sends a locked step back to step 1", async ({ page }) => {
    await enterWizard(page, {});

    // The RUN/IPE is never persisted, so with the disclaimer
    // acknowledged and nothing else, steps 2-4 stay locked however the URL was
    // reached — and the fallback is now step 1, not the front door. `finish`
    // is locked by the same chain: it needs a fresh simulation,
    // and a simulation is memory-only, so a fresh page load never has one.
    for (const locked of ["list", "result", "improve", "finish"]) {
      await page.goto(`/es/${locked}`);
      await page.waitForURL("**/es/student");
      await expect(
        page.getByRole("heading", stepHeading("es", "student.title")),
      ).toBeVisible();
    }
  });

  test("a hard load of step 1 keeps the disclaimer instead of bouncing", async ({
    page,
  }) => {
    await enterWizard(page, {});

    // The consent flag lives in `sessionStorage` and only reaches the store
    // one effect after the tree mounts. The guard has to wait for that
    // hydration (`hydrated` in the store) — redirecting on the empty default
    // would send a family that *did* acknowledge it back to the disclaimer on
    // every reload or shared link.
    await page.goto("/es/student");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/es\/student$/);

    await page.reload();
    await expect(page).toHaveURL(/\/es\/student$/);
  });

  test("a valid RUN enables Continue and opens the list-choice question", async ({
    page,
  }) => {
    await enterWizard(page, {});

    const continueButton = page.getByTestId("wizard-continue");
    const feedback = page.getByTestId("student-id-feedback");
    await expect(continueButton).toBeDisabled();
    await expect(feedback).not.toBeVisible();

    const input = page.getByLabel(copy("es", "student.idLabel"));

    await input.fill("no es un RUN");
    await expect(feedback).toHaveAttribute("data-state", "invalid");
    await expect(feedback).toHaveText(copy("es", "errors.invalidStudentId"));
    await expect(continueButton).toBeDisabled();

    await input.fill(BAD_CHECK_DIGIT);
    await expect(feedback).toHaveText(
      copy("es", "errors.invalidRunCheckDigit"),
    );
    await expect(continueButton).toBeDisabled();

    await input.fill(VALID_RUN);
    await expect(feedback).toHaveAttribute("data-state", "valid");
    await expect(continueButton).toBeEnabled();

    await continueButton.click();
    await page.waitForURL("**/es/list-choice");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: copy("es", "app.listChoice.headline"),
      }),
    ).toBeVisible();
  });

  test("the list-choice question opens step 2", async ({ page }) => {
    await enterListStep(page);
    await expect(
      page.getByRole("heading", stepHeading("es", "list.title")),
    ).toBeVisible();
  });

  test("step 2 renders live data from /meta", async ({ page }) => {
    // The region select only exists in the guided branch, and it is the step's
    // one control filled straight from `/meta` (an earlier build printed
    // the region count instead; the filter panel replaced it).
    await enterListStep(page, { answer: "no" });

    // Proves the whole data path: FastAPI -> fetchMeta() on the server ->
    // MetaProvider -> useMeta() in the client tree. Chile has 16 regions, so a
    // correctly loaded calibration file offers "all regions" plus many more.
    await page.getByTestId("filter-region").click();
    expect(await page.getByRole("option").count()).toBeGreaterThan(1);
  });

  test("step 2 keeps its own gate closed while the list is empty", async ({
    page,
  }) => {
    await enterListStep(page);

    // Entering step 2 does not unlock step 3: that needs at least one wish.
    await expect(page.getByTestId("wizard-continue")).toBeDisabled();
    await expect(
      page.getByRole("navigation").getByRole("link", {
        name: new RegExp(escapeRegExp(copy("es", "steps.result"))),
      }),
    ).toHaveCount(0);
  });

  test("the stepper unlocks step 2 only once step 1 and the list choice are done", async ({
    page,
  }) => {
    await enterWizard(page, {});

    const stepTwoLink = page.getByRole("navigation").getByRole("link", {
      name: new RegExp(escapeRegExp(copy("es", "steps.list"))),
    });
    await expect(stepTwoLink).toHaveCount(0);

    await page.getByLabel(copy("es", "student.idLabel")).fill(VALID_RUN);
    // A valid RUN alone does not unlock it: the list-choice question is next.
    await expect(stepTwoLink).toHaveCount(0);

    await page.getByTestId("wizard-continue").click();
    await page.waitForURL("**/es/list-choice");
    await page.getByTestId("list-choice-yes").click();
    await page.waitForURL("**/es/list");

    // Back to step 1: now that the list choice is answered too, the rail
    // link is live.
    await page.getByTestId("wizard-back").click();
    await page.waitForURL("**/es/student");
    await expect(stepTwoLink.first()).toBeVisible();
    await stepTwoLink.first().click();
    await page.waitForURL("**/es/list");
  });

  test("the stepper still has exactly four steps", async ({ page }) => {
    // the completion page is reached from the result step, not
    // from the rail.
    await enterWizard(page, {});

    const rail = page.getByRole("navigation", {
      name: copy("es", "steps.navLabel"),
    });
    await expect(rail.getByRole("listitem")).toHaveCount(4);
    await expect(rail).not.toContainText(copy("es", "app.finish.title"));
  });

  test("Back returns from step 2 to step 1, skipping the list choice", async ({
    page,
  }) => {
    await enterListStep(page);

    await page.getByTestId("wizard-back").click();
    await page.waitForURL("**/es/student");
    await expect(
      page.getByRole("heading", stepHeading("es", "student.title")),
    ).toBeVisible();
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
