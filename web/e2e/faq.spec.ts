import { expect, test } from "@playwright/test";

import en from "../messages/en";
import es from "../messages/es";

/**
 * The FAQ dialog, next to the language toggle in the header — reachable from
 * any page, not just the wizard. `responsive.spec.ts` covers that it still
 * fits the header at 360 px.
 */

test.describe("FAQ dialog", () => {
  test("opens from the header and lists every question", async ({ page }) => {
    await page.goto("/es");

    const trigger = page.getByTestId("faq-trigger");
    await expect(trigger).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await trigger.click();
    const dialog = page.getByRole("dialog", { name: es.app.faq.title });
    await expect(dialog).toBeVisible();

    const list = page.getByTestId("faq-list");
    for (const item of es.app.faq.items) {
      await expect(list).toContainText(item.question);
      await expect(list).toContainText(item.answer);
    }
    // Set up to scroll internally once more questions are added, rather than
    // growing the dialog without bound.
    await expect(list).toHaveCSS("overflow-y", "auto");

    // The priority question links out to the ministry's own criteria page.
    const priorityItem = es.app.faq.items.find(
      (item) => item.link !== undefined,
    );
    if (!priorityItem?.link) throw new Error("no FAQ item has a link");
    const priorityLink = list.getByRole("link", {
      name: priorityItem.link.label,
    });
    await expect(priorityLink).toHaveAttribute("href", priorityItem.link.url);
    await expect(priorityLink).toHaveAttribute("target", "_blank");

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("loads in English too", async ({ page }) => {
    await page.goto("/en");
    await page.getByTestId("faq-trigger").click();

    const dialog = page.getByRole("dialog", { name: en.app.faq.title });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("faq-list")).toContainText(
      en.app.faq.items[0].question,
    );
  });
});
