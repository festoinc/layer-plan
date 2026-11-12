import { expect, test } from "./fixtures";

test("verification rules appear only on nested chapters and persist modes", async ({
  page,
}) => {
  await page.goto("/#/projects/website/chapters/authentication");
  await expect(
    page.getByRole("heading", { name: "Verification Rules", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Success criteria", exact: true }),
  ).toBeVisible();

  await page.goto("/#/projects/website/chapters/login");
  await expect(
    page.getByRole("heading", { name: "Verification Rules", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "Verification mode for Login form" }),
  ).toHaveCount(1);

  await expect(
    page.getByRole("radio", { name: "Auto-test verification" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Auto-test command for Login form")).toHaveValue(
    "npm test login:test-ok",
  );

  await page.getByRole("radio", { name: "Human verification" }).click();
  const human = page.getByLabel("Human verification for Login form");
  await expect(human).toBeVisible();
  await human.fill("Manual login check with the test account");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");

  await page.getByRole("radio", { name: "AI verification" }).click();
  const ai = page.getByLabel("AI verification for Login form");
  await expect(ai).toBeVisible();
  await ai.fill("Inspect the login screen and report validation messages");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");

  await page.getByRole("radio", { name: "Human verification" }).click();
  await expect(human).toHaveValue("Manual login check with the test account");

  await expect(page.locator(".save-status")).toContainText("All changes saved");
  await page.reload();

  await expect(
    page.getByRole("radio", { name: "Human verification" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByLabel("Human verification for Login form"),
  ).toHaveValue("Manual login check with the test account");
});

test("test coverage counts only automated chapters and edits guidelines inline", async ({
  page,
}) => {
  await page.goto("/#/projects/website/coverage");
  await expect(
    page.getByRole("heading", { name: "Test coverage", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Test coverage", exact: true }),
  ).not.toContainText("Soon");
  await expect(page.locator(".coverage-score strong")).toHaveText("75%");
  await expect(page.locator(".coverage-score")).toContainText(
    "3 of 4 eligible chapters covered",
  );
  await expect(page.locator(".coverage-row")).toHaveCount(4);

  const humanRow = page.locator(".coverage-row").filter({
    has: page.getByRole("button", { name: "Password reset", exact: true }),
  });
  await expect(humanRow).toContainText("Human");
  await expect(humanRow).toContainText("Not covered");

  const autoRow = page.locator(".coverage-row").filter({
    has: page.getByRole("button", { name: "Login form", exact: true }),
  });
  await expect(autoRow).toContainText("npm test login:test-ok");
  await expect(autoRow).toContainText("Covered");

  await expect(
    page
      .locator(".coverage-list")
      .getByRole("button", { name: "Authentication", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".coverage-list")
      .getByRole("button", { name: "User profiles", exact: true }),
  ).toHaveCount(0);

  const guidelines = page.getByLabel(
    "Shared instructions for human and AI testers",
  );
  await guidelines.fill("Updated guidelines for human and AI testers.");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/v1/projects/website"),
  );
  await guidelines.press("Tab");
  await saved;
  await page.reload();
  await expect(
    page.getByLabel("Shared instructions for human and AI testers"),
  ).toHaveValue("Updated guidelines for human and AI testers.");
});

test("a project with only root chapters has an empty coverage state", async ({
  page,
}) => {
  await page.goto("/#/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name").fill("Coverage empty");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await page
    .getByRole("button", { name: "Test coverage", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No verification chapters yet" }),
  ).toBeVisible();

  const guidelines = page.getByLabel(
    "Shared instructions for human and AI testers",
  );
  await guidelines.fill("Run the empty coverage checks.");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/v1/projects/"),
  );
  await guidelines.press("Tab");
  await saved;
  await page.reload();
  await expect(
    page.getByLabel("Shared instructions for human and AI testers"),
  ).toHaveValue("Run the empty coverage checks.");
});

test("a newly created criterion subchapter has verification immediately", async ({
  page,
}) => {
  await page.goto("/#/projects/website/chapters/login");
  await page.getByLabel("New success criterion").fill("Enter email");
  await page.getByLabel("New success criterion").press("Enter");

  await page.getByRole("button", { name: "Enter email", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Enter email");
  await expect(
    page.getByRole("heading", { name: "Verification Rules", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("radiogroup", {
      name: "Verification mode for Enter email",
    }),
  ).toBeVisible();
});
