import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

test("data persists through the local API without localStorage", async ({
  page,
}) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  await page
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("API-backed title");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");
  await expect(page.getByRole("status").first()).toContainText(
    "All changes saved",
  );

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("API-backed title");

  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((key) => key.startsWith("layers"))).toEqual([]);
});

test("the last keystroke survives an immediate reload", async ({ page }) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  await page
    .getByRole("region", { name: "Description preview", exact: true })
    .dblclick();
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Flushed before unload");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Description preview", exact: true }),
  ).toHaveText("Flushed before unload");
});

test("export and import round-trip a whole project through the API", async ({
  page,
}) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  await page
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("Exportable title");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");
  await expect(page.getByRole("status").first()).toContainText(
    "All changes saved",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project" }).click();
  const download = await downloadPromise;
  const file = await download.path();
  const exported = JSON.parse(readFileSync(file, "utf8"));
  expect(exported.format).toBe("layers-project");
  expect(exported.formatVersion).toBe(3);
  expect(exported.instructions).toContain("# Layers project export");
  expect(exported.instructions).toContain("Reading chapters");
  expect(exported.project.name).toBe("Website project");
  expect(exported.testGuidelines).toContain("npm test");
  expect(exported.chapters.byId["login"].verification.mode).toBe("auto");
  expect(exported.chapters.byId["password-reset"].title).toBe(
    "Exportable title",
  );
  expect(exported.activity).toBeDefined();
  expect(exported.ui.selectedId).toBe("password-reset");

  exported.chapters.byId["password-reset"].title = "Imported title";
  await page.getByLabel("Import project file").setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Imported title");
  await expect(page.locator(".project-switcher-trigger")).toContainText(
    "Website project (imported)",
  );
  await page
    .getByRole("button", { name: "Test coverage", exact: true })
    .click();
  await expect(
    page.getByLabel("Shared instructions for human and AI testers"),
  ).toHaveValue(/Run npm test/);
  await page
    .getByRole("button", { name: "Specifications", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Imported title");

  const importedUrl = page.url();
  await page.reload();
  expect(page.url()).toBe(importedUrl);
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Imported title");
});

test("a second tab sees server-backed changes after reload", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  await expect(
    other.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");

  await page
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("Synced through the API");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");
  await expect(page.getByRole("status").first()).toContainText(
    "All changes saved",
  );

  await other.reload();
  await expect(
    other.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Synced through the API");
});

test("a stale write shows a conflict and can reload the latest document", async ({
  page,
  context,
}) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  const other = await context.newPage();
  await other.goto("/#/projects/website/chapters/password-reset");
  await expect(
    other.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");

  await page
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("First writer");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");
  await expect(page.getByRole("status").first()).toContainText(
    "All changes saved",
  );

  await other
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("Second writer");
  await other.getByRole("textbox", { name: "Chapter title" }).press("Tab");
  await expect(other.locator(".storage-banner-error")).toContainText(
    "changed in another tab",
  );
  await other.getByRole("button", { name: "Reload latest" }).click();
  await expect(
    other.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("First writer");
});

test("a stale write can explicitly overwrite the server document", async ({
  page,
  context,
}) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  const other = await context.newPage();
  await other.goto("/#/projects/website/chapters/password-reset");

  await page
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("First writer");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");
  await expect(page.getByRole("status").first()).toContainText(
    "All changes saved",
  );

  await other
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("Second writer");
  await other.getByRole("textbox", { name: "Chapter title" }).press("Tab");
  await expect(other.locator(".storage-banner-error")).toContainText(
    "changed in another tab",
  );
  await other.getByRole("button", { name: "Overwrite server" }).click();
  await expect(
    other.getByRole("alertdialog", {
      name: "Overwrite the server document?",
    }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Overwrite document" }).click();
  await expect(other.getByRole("status").first()).toContainText(
    "All changes saved",
  );

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Second writer");
});

test("a failed document write is reported and can be retried", async ({
  page,
}) => {
  await page.goto("/#/projects/website/chapters/password-reset");
  await page.route("**/api/v1/projects/website/document", async (route) => {
    if (route.request().method() === "PUT") {
      await route.abort();
    } else {
      await route.continue();
    }
  });

  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New chapter title", exact: true })
    .fill("Unsaved chapter");
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();

  await expect(page.locator(".storage-banner-error")).toContainText(
    "local API is not reachable",
  );

  await page.unroute("**/api/v1/projects/website/document");
  await page.getByRole("button", { name: "Retry saving" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "All changes saved",
  );

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Unsaved chapter");
});

test("an unavailable API shows a retryable connection error", async ({
  page,
}) => {
  await page.route("**/api/v1/projects", async (route) => {
    if (route.request().method() === "GET") {
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "The local API is not available" }),
  ).toBeVisible();

  await page.unroute("**/api/v1/projects");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(
    page.locator(".project-card").filter({ hasText: "Website project" }),
  ).toBeVisible();
});
