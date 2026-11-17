import { expect, test } from "./fixtures";

test("search finds chapters and opens the matched result", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/#\/projects\/website\/search$/);
  await expect(
    page.getByRole("heading", { name: "Search", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Search this project" }),
  ).toBeVisible();

  const input = page.getByRole("searchbox", { name: "Search this project" });
  await input.fill("reset email");
  await expect(page).toHaveURL(
    /#\/projects\/website\/search\?q=reset(\+|%20)email$/,
  );
  await expect(page.locator(".search-result").first()).toBeVisible();
  await expect(page.locator(".search-result").first()).toContainText(
    "Password reset",
  );
  await expect(
    page.locator(".search-result").first().locator("mark").first(),
  ).toBeVisible();

  await page.locator(".search-result").first().getByRole("button").click();
  await expect(page).toHaveURL(
    /#\/projects\/website\/chapters\/password-reset$/,
  );
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");
});

test("search deep links, empty states and project switching work", async ({
  page,
}) => {
  await page.goto("/#/projects/website/search?q=smtp");
  const input = page.getByRole("searchbox", { name: "Search this project" });
  await expect(input).toHaveValue("smtp");
  await expect(page.locator(".search-result").first()).toContainText(
    "SMTP requirements",
  );

  await input.fill("x");
  await expect(
    page.getByRole("heading", { name: "Search this project" }),
  ).toBeVisible();

  await input.fill("no-such-phrase-in-the-project");
  await expect(page.getByRole("heading", { name: "No matches" })).toBeVisible();

  await page.locator(".project-switcher-trigger").click();
  await page.getByRole("menuitem", { name: /Mobile app/ }).click();
  await expect(page).toHaveURL(/#\/projects\/mobile\/search$/);
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Search this project" }),
  ).toBeVisible();
});
