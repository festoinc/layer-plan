import { expect, test } from "@playwright/test";

test("production build boots and persists changes", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");

  await page
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("Production build title");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Production build title");
  expect(errors).toEqual([]);
});
