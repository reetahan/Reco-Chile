import { expect, test, type Page } from "@playwright/test";

import en from "../messages/en";
import es from "../messages/es";

/**
 * The Student step.
 *
 * `wizard.spec.ts` already covers the shell (routing, the welcome page, the
 * guard, the stepper, the locale switch). What is under test here is the step
 * itself: the live RUN/IPE pre-check, the jargon-free copy, and the welcome
 * answer — including that it survives a reload while the identifier does not.
 * The research-tool disclaimer lives on its own page now (`DisclaimerScreen`,
 * covered by `e2e/wizard.spec.ts`), the "about this estimate" caveat is gone
 * from this step, and the ties switch moved to step 2 (`e2e/list.spec.ts`).
 *
 * The step is only reachable through the welcome page, so every test
 * enters through `openStudent()` rather than deep-linking `/es/student`.
 *
 * Expected copy is read from `messages/{es,en}/*.json`, never frozen here, so a
 * reworded sentence does not fail a test that is about behaviour.
 */

/** `sessionStorage` key of the zustand store (`WIZARD_PERSIST_KEY`). Written
 * out rather than imported: the Playwright runner does not resolve the `@/`
 * alias the store module uses. */
const PERSIST_KEY = "reco-chile.wizard";

/** A valid RUN — body 12345678, modulo-11 check digit 5. */
const VALID_RUN = "12.345.678-5";
/** Same body, wrong verifier: right shape, rejected by the check digit. */
const BAD_CHECK_DIGIT = "12.345.678-4";
/** A valid IPE — nine-digit body plus its numeric verifier. */
const VALID_IPE = "100200300-4";

const MESSAGES = { es, en } as const;

type Locale = keyof typeof MESSAGES;

/** The string `messages/<locale>/*.json` holds for a dotted message id. */
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

/** `student.idValid` with its `{kind}` placeholder filled in. */
function validCopy(locale: Locale, kind: "RUN" | "IPE"): string {
  return copy(locale, "student.idValid").replace("{kind}", kind);
}

/**
 * Through the welcome page and the "Before we continue" consent page into
 * step 1.
 */
async function openStudent(
  page: Page,
  {
    locale = "es",
    answer = "yes",
  }: { locale?: Locale; answer?: "yes" | "no" } = {},
) {
  await page.goto(`/${locale}`);
  await page.getByTestId(`welcome-${answer}`).click();
  await page.waitForURL(`**/${locale}/disclaimer`);
  await page.getByTestId("disclaimer-checkbox").click();
  await page.getByTestId("disclaimer-continue").click();
  await page.waitForURL(`**/${locale}/student`);
}

function identifierInput(page: Page, locale: Locale = "es") {
  return page.getByLabel(copy(locale, "student.idLabel"));
}

function feedback(page: Page) {
  return page.getByTestId("student-id-feedback");
}

function continueButton(page: Page) {
  return page.getByTestId("wizard-continue");
}

/** Whatever the store has written to `sessionStorage`, as raw text. */
function persisted(page: Page): Promise<string | null> {
  return page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    PERSIST_KEY,
  );
}

test.describe("step 1 — identify the student", () => {
  test("a wrong check digit shows the red helper and keeps Continue disabled", async ({
    page,
  }) => {
    await openStudent(page);

    await expect(feedback(page)).not.toBeVisible();
    await expect(continueButton(page)).toBeDisabled();

    await identifierInput(page).fill(BAD_CHECK_DIGIT);

    // The shape is a RUN, so the message is the specific one about the
    // verifier — not the generic "neither a RUN nor an IPE".
    await expect(feedback(page)).toHaveAttribute("data-state", "invalid");
    await expect(feedback(page)).toHaveText(
      copy("es", "errors.invalidRunCheckDigit"),
    );
    await expect(feedback(page)).toHaveClass(/text-destructive/);
    await expect(identifierInput(page)).toHaveAttribute("aria-invalid", "true");
    await expect(continueButton(page)).toBeDisabled();

    // And the step guard still refuses the next route.
    await page.goto("/es/list");
    await page.waitForURL("**/es/student");
  });

  test("a valid IPE enables Continue", async ({ page }) => {
    await openStudent(page);

    await identifierInput(page).fill(VALID_IPE);

    await expect(feedback(page)).toHaveAttribute("data-state", "valid");
    await expect(feedback(page)).toHaveText(validCopy("es", "IPE"));
    await expect(continueButton(page)).toBeEnabled();

    // A RUN is recognised as the other kind, from the same field.
    await identifierInput(page).fill(VALID_RUN);
    await expect(feedback(page)).toHaveText(validCopy("es", "RUN"));
    await expect(continueButton(page)).toBeEnabled();
  });

  test("the why-do-we-ask popover explains the lottery without jargon", async ({
    page,
  }) => {
    await openStudent(page);

    await page.getByTestId("student-why-trigger").click();

    const content = page.getByTestId("student-why-content");
    await expect(content).toBeVisible();
    await expect(content).toContainText(copy("es", "student.why.body"));
    await expect(content).toContainText(copy("es", "student.why.privacy"));

    // no "MTB tie-break calculation", and the OpenStreetMap note
    // belongs to step 4, where the address is actually used.
    await expect(content).not.toContainText(/MTB/i);
    await expect(content).not.toContainText(/OpenStreetMap/i);
  });

  test("the privacy note is visible without any interaction", async ({
    page,
  }) => {
    await openStudent(page);

    await expect(page.getByTestId("student-privacy-note")).toHaveText(
      copy("es", "student.privacyNote"),
    );
  });
});

test.describe("step 1 — mode controls", () => {
  test("the welcome answer survives a reload; the RUN/IPE does not", async ({
    page,
  }) => {
    await openStudent(page, { answer: "no" });

    await identifierInput(page).fill(VALID_RUN);
    await expect(continueButton(page)).toBeEnabled();

    // Privacy: the welcome answer is persisted, the identifier is
    // never written anywhere.
    const stored = await persisted(page);
    expect(stored).toContain('"listExists":false');
    expect(stored).not.toContain("12345678");
    expect(stored).not.toContain(VALID_RUN);
    expect(page.url()).not.toContain("12");

    await page.reload();

    // The answer is what keeps the step reachable at all after a reload
    // — nothing on this step echoes it back any more.
    await expect(page).toHaveURL(/\/es\/student$/);

    await expect(identifierInput(page)).toHaveValue("");
    await expect(feedback(page)).not.toBeVisible();
    await expect(continueButton(page)).toBeDisabled();
  });
});

test.describe("step 1 — English", () => {
  test("renders the same controls in the second locale", async ({ page }) => {
    await openStudent(page, { locale: "en" });

    await identifierInput(page, "en").fill(VALID_IPE);
    await expect(feedback(page)).toHaveText(validCopy("en", "IPE"));
    await expect(continueButton(page)).toBeEnabled();

    // The locale switch is a real switch, not the same string twice.
    expect(validCopy("en", "IPE")).not.toBe(validCopy("es", "IPE"));
  });
});
