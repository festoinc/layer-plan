import { expect, test } from "@playwright/test";

async function addCriterion(page, text) {
  await page.getByLabel("New success criterion").fill(text);
  await page.getByLabel("New success criterion").press("Enter");
  await page
    .locator(".chapter-navigation")
    .getByRole("button", { name: text, exact: true })
    .click();
}

test("deleting a chapter removes its descendants and the parent criterion", async ({
  page,
}) => {
  await page.goto("/#/projects/website/chapters/login");
  await addCriterion(page, "Enter password");
  await addCriterion(page, "Check 6 digits");

  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Check 6 digits");
  await page
    .locator(".chapter-navigation")
    .getByRole("button", { name: "Enter password", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Enter password");

  await page
    .getByRole("button", { name: "Delete chapter: Enter password" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("heading", { name: "Delete “Enter password”?" }),
  ).toBeVisible();
  await expect(dialog).toContainText("2 chapters in total");
  await expect(dialog).toContainText(
    "The success criterion “Enter password” in “Login form” will also be removed",
  );

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Enter password");

  await page
    .getByRole("button", { name: "Delete chapter: Enter password" })
    .click();
  await page
    .getByRole("button", { name: "Delete chapter", exact: true })
    .click();

  await expect(page).toHaveURL(/#\/projects\/website\/chapters\/login$/);
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Login form");
  await expect(
    page.getByRole("button", { name: "Enter password", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check 6 digits", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Complete: Enter password" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".activity-list")).toContainText(
    "Deleted chapter: Enter password",
  );
});

test("deleted chapters disappear from test coverage", async ({ page }) => {
  await page.goto("/#/projects/website/chapters/login");
  await addCriterion(page, "Enter password");

  await page.getByRole("radio", { name: "Auto-test verification" }).click();
  await page
    .getByLabel("Auto-test command for Enter password")
    .fill("npm test password");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");

  await page
    .getByRole("button", { name: "Test coverage", exact: true })
    .click();
  await expect(
    page
      .locator(".coverage-list")
      .getByRole("button", { name: "Enter password", exact: true }),
  ).toBeVisible();

  await page
    .locator(".coverage-list")
    .getByRole("button", { name: "Enter password", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete chapter: Enter password" })
    .click();
  await page
    .getByRole("button", { name: "Delete chapter", exact: true })
    .click();

  await expect(page).toHaveURL(/#\/projects\/website\/chapters\/login$/);
  await page
    .getByRole("button", { name: "Test coverage", exact: true })
    .click();
  await expect(
    page
      .locator(".coverage-list")
      .getByRole("button", { name: "Enter password", exact: true }),
  ).toHaveCount(0);
});
