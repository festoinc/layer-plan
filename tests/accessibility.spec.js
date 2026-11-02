import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} context
 */
async function expectNoViolations(page, context) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
  expect(summary, `${context} accessibility violations`).toEqual([]);
}

test("specifications, activity and coverage pages are accessible", async ({
  page,
}) => {
  await page.goto("/");
  await expectNoViolations(page, "specifications");

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No activity yet" }),
  ).toBeVisible();
  await expectNoViolations(page, "activity");

  await page
    .getByRole("button", { name: "Test coverage", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Test coverage", exact: true }),
  ).toBeVisible();
  await expectNoViolations(page, "test coverage");
});

test("skip link, chapter selection and the mobile drawer manage focus", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to document" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page
    .getByRole("button", { name: "SMTP requirements", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open chapters", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Close navigation", exact: true }),
  ).toBeFocused();

  for (let index = 0; index < 40; index += 1) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest(".sidebar")),
    ),
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open chapters", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
});

test("projects page, switcher and dialogs are accessible", async ({ page }) => {
  await page.goto("/#/projects");
  await expectNoViolations(page, "projects");

  await page.locator(".project-switcher-trigger").click();
  await expectNoViolations(page, "project switcher");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoViolations(page, "new project dialog");
  await page.keyboard.press("Escape");

  await page
    .getByRole("button", { name: "Actions for Website project", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectNoViolations(page, "delete project dialog");
});
