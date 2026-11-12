import { expect, test } from "./fixtures";

test("deep links, reload and browser history keep the chapter", async ({
  page,
}) => {
  await page.goto("/#/chapters/smtp");
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("SMTP requirements");
  await expect(page.locator(".breadcrumbs")).toContainText("Password reset");

  await page
    .getByRole("button", { name: "Test coverage", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/projects\/website\/coverage$/);

  await page.goBack();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("SMTP requirements");

  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Test coverage", exact: true }),
  ).toBeVisible();
});

test("unknown chapter links fall back to the first chapter", async ({
  page,
}) => {
  await page.goto("/#/chapters/does-not-exist");
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");
  await expect(page).toHaveURL(
    /#\/projects\/website\/chapters\/password-reset$/,
  );
});

test("creating a chapter updates the URL and survives reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New chapter title", exact: true })
    .fill("Deep link chapter");
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();

  await expect(page).toHaveURL(/#\/projects\/website\/chapters\/[0-9a-f-]+$/);
  const url = page.url();
  await page.reload();
  expect(page.url()).toBe(url);
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Deep link chapter");
});

test("activity links navigate back to the affected chapter", async ({
  page,
}) => {
  await page.goto("/#/activity");
  await expect(
    page.getByRole("heading", { name: "No activity yet" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Specifications", exact: true })
    .click();
  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New chapter title", exact: true })
    .fill("Tracker");
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page
    .locator(".activity-list")
    .getByRole("button", { name: "Tracker", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/projects\/website\/chapters\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Tracker");
});
