import AxeBuilder from "@axe-core/playwright";
import { anonymousTest as test, expect, superAdmin } from "./fixtures";

test("first load shows sign-in and wrong passwords stay on the form", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);

  await page.getByLabel("Email").fill(superAdmin.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("sign-in restores a protected deep link", async ({ page }) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Email").fill(superAdmin.email);
  await page.getByLabel("Password").fill(superAdmin.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(
    /#\/projects\/website\/chapters\/password-reset$/,
  );
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");
});

test("sign-out returns to sign-in and clears the workspace", async ({
  page,
}) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  await page.getByLabel("Email").fill(superAdmin.email);
  await page.getByLabel("Password").fill(superAdmin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();

  await page.locator(".user-menu summary").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("You have signed out.")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("the sign-in page is accessible", async ({ page }) => {
  await page.goto("/#/sign-in");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
