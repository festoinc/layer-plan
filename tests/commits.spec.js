import { expect, test } from "./fixtures";

const short = "4f2a9c1";
const full = "9d0be7a1c2f34d5e6f708192a3b4c5d6e7f80912";

function commitInput(page) {
  return page.getByLabel("Add commit hash for this document");
}

function addCommitButton(page) {
  return page.locator(".add-commit button");
}

test("documents link, validate, remove and show commits in coverage", async ({
  page,
}) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");

  await commitInput(page).fill("4F2A9C1");
  await addCommitButton(page).click();
  await expect(page.locator(".commit-chip code")).toHaveText("4f2a9c1");

  await commitInput(page).fill("not-a-hash");
  await addCommitButton(page).click();
  await expect(page.getByRole("alert")).toContainText("7–40");
  await expect(page.locator(".commit-chip")).toHaveCount(1);

  await commitInput(page).fill(short);
  await addCommitButton(page).click();
  await expect(page.getByRole("alert")).toContainText("already linked");
  await expect(page.locator(".commit-chip")).toHaveCount(1);

  await commitInput(page).fill(full);
  await addCommitButton(page).click();
  await expect(page.locator(".commit-chip code")).toHaveText([full, short]);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".commit-chip code")).toHaveText([full, short]);

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".activity-list")).toContainText(
    `Linked commit ${full}`,
  );
  await expect(page.locator(".activity-list")).toContainText(
    `Linked commit ${short}`,
  );

  await page
    .getByRole("button", { name: "Specifications", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Remove commit ${full}`, exact: true })
    .click();
  await expect(page.locator(".commit-chip code")).toHaveText([short]);
  await page.reload();
  await expect(page.locator(".commit-chip code")).toHaveText([short]);

  await page
    .getByRole("button", { name: "Test coverage", exact: true })
    .click();
  const row = page
    .locator(".coverage-row")
    .filter({ hasText: "Password reset" });
  await expect(row.locator(".coverage-commits code")).toHaveText(short);
});

test("commit add and remove work with the keyboard", async ({ page }) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  await commitInput(page).focus();
  await page.keyboard.type("4F2A9C1");
  await page.keyboard.press("Enter");
  await expect(page.locator(".commit-chip code")).toHaveText("4f2a9c1");

  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: `Remove commit ${short}`, exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".commit-chip")).toHaveCount(0);
});

test("final-level documents still accept commit references", async ({
  page,
}) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  await page.getByLabel("Final level", { exact: true }).check();
  await commitInput(page).fill(short);
  await addCommitButton(page).click();
  await page.reload();
  await expect(page.locator(".commit-chip code")).toHaveText(short);
});
