import { expect, test } from "@playwright/test";

test("projects switch independently and remember their selected chapter", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".project-switcher-trigger")).toContainText(
    "Website project",
  );
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");

  await page.locator(".project-switcher-trigger").click();
  await page.getByRole("menuitem", { name: /Mobile app/ }).click();

  await expect(page).toHaveURL(
    /#\/projects\/mobile\/chapters\/mobile-onboarding$/,
  );
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Onboarding");
  await expect(page.locator(".project-switcher-trigger")).toContainText(
    "Mobile app",
  );

  await page.reload();
  await expect(page).toHaveURL(
    /#\/projects\/mobile\/chapters\/mobile-onboarding$/,
  );
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Onboarding");

  await page.locator(".project-switcher-trigger").click();
  await page.getByRole("menuitem", { name: /Website project/ }).click();
  await expect(page).toHaveURL(
    /#\/projects\/website\/chapters\/password-reset$/,
  );
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");
});

test("projects keep chapters, activity and selection isolated", async ({
  page,
}) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  await page
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("Website only");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".activity-list")).toContainText(
    "Updated chapter title",
  );
  await page
    .getByRole("button", { name: "Specifications", exact: true })
    .click();

  await page.locator(".project-switcher-trigger").click();
  await page.getByRole("menuitem", { name: /Mobile app/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Onboarding");
  await expect(
    page.getByRole("button", { name: "Website only", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No activity yet" }),
  ).toBeVisible();

  await page.locator(".project-switcher-trigger").click();
  await page.getByRole("menuitem", { name: /Website project/ }).click();
  await page
    .getByRole("button", { name: "Specifications", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Website only");
});

test("a project can be created, renamed, duplicated and deleted", async ({
  page,
}) => {
  await page.goto("/#/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await page.getByRole("button", { name: "New project", exact: true }).click();
  const createDialog = page.getByRole("dialog");
  await createDialog.getByLabel("Project name").fill("Research");
  await createDialog.getByLabel("Description").fill("Discovery notes");
  await createDialog.getByRole("button", { name: "rose" }).click();
  await createDialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();

  await expect(page).toHaveURL(
    /#\/projects\/[0-9a-f-]+\/chapters\/[0-9a-f-]+$/,
  );
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Overview");
  await expect(page.locator(".project-switcher-trigger")).toContainText(
    "Research",
  );

  await page.getByRole("button", { name: "Projects", exact: true }).click();
  let card = page.locator(".project-card").filter({ hasText: "Research" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Discovery notes");

  await page
    .getByRole("button", { name: "Actions for Research", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Rename and settings" }).click();
  const editDialog = page.getByRole("dialog");
  await editDialog.getByLabel("Project name").fill("Research plan");
  await editDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Research plan", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Actions for Research plan", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page).toHaveURL(
    /#\/projects\/[0-9a-f-]+\/chapters\/[0-9a-f-]+$/,
  );
  await expect(page.locator(".project-switcher-trigger")).toContainText(
    "Research plan copy",
  );

  await page.getByRole("button", { name: "Projects", exact: true }).click();
  card = page
    .locator(".project-card")
    .filter({ hasText: "Research plan copy" });
  await expect(card).toBeVisible();
  await page
    .getByRole("button", {
      name: "Actions for Research plan copy",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(
    page.getByRole("heading", { name: "Delete “Research plan copy”?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete project" }).click();
  await expect(
    page.locator(".project-card").filter({ hasText: "Research plan copy" }),
  ).toHaveCount(0);
});

test("project deep links resolve and unknown projects return to the list", async ({
  page,
}) => {
  await page.goto("/#/projects/mobile/chapters/mobile-cache");
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Cache policy");
  await expect(page.locator(".breadcrumbs")).toContainText("Offline mode");

  await page.evaluate(() => {
    window.location.hash = "#/projects/missing/chapters/anything";
  });
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(/#\/projects\/mobile\/activity$/);
  await expect(
    page.getByRole("heading", { name: "Activity", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Test coverage", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/projects\/mobile\/coverage$/);
  await expect(
    page.getByRole("heading", { name: "Test coverage", exact: true }),
  ).toBeVisible();
});

test("an empty catalog shows the standalone projects page and can create", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "layers:projects:v5",
      JSON.stringify({
        schemaVersion: 4,
        activeProjectId: null,
        projectIds: [],
        projects: {},
      }),
    );
  });
  await page.goto("/");

  await expect(page).toHaveURL(/#\/projects$/);
  await expect(
    page.getByRole("heading", { name: "No projects yet" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create project" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name").fill("First project");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(
    /#\/projects\/[0-9a-f-]+\/chapters\/[0-9a-f-]+$/,
  );
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Overview");
});

test("the project list updates across tabs", async ({ page, context }) => {
  await page.goto("/#/projects");
  const other = await context.newPage();
  await other.goto("/#/projects");

  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name").fill("Shared project");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(
    other.locator(".project-card").filter({ hasText: "Shared project" }),
  ).toBeVisible();
});
