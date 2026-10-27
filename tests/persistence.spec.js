import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("a phase 1 workspace is migrated and announced", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "layers-chapters-v2",
      JSON.stringify({
        chapters: [
          {
            id: "legacy",
            title: "Legacy plan",
            description: "Migrated description",
            criteria: [
              { id: "legacy-1", text: "Migrated criterion", checked: true },
            ],
            children: [],
          },
        ],
        selectedId: "legacy",
        events: [],
      }),
    );
  });
  await page.goto("/");

  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Legacy plan");
  await expect(page.locator(".storage-banner")).toContainText("upgraded");
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain("layers:doc:v3");
  expect(keys).toContain("layers:activity:v3");
  expect(keys).toContain("layers:ui:v3");
});

test("a corrupt document is backed up instead of disappearing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("layers:doc:v3", "{this is not json");
  });
  await page.goto("/");

  await expect(page.locator(".storage-banner-error")).toContainText(
    "could not be read",
  );
  const backup = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) =>
      name.startsWith("layers:backup:doc-v3"),
    );
    return key ? localStorage.getItem(key) : null;
  });
  expect(backup).toBe("{this is not json");
});

test("the last keystroke survives an immediate reload", async ({ page }) => {
  await page.goto("/#/chapters/password-reset");
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

test("export and import round-trip the whole workspace", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("Exportable title");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace" }).click();
  const download = await downloadPromise;
  const file = await download.path();
  const exported = JSON.parse(readFileSync(file, "utf8"));
  expect(exported.schemaVersion).toBe(3);
  expect(exported.chapters.byId["password-reset"].title).toBe(
    "Exportable title",
  );

  exported.chapters.byId["password-reset"].title = "Imported title";
  await page.getByLabel("Import workspace file").setInputFiles({
    name: "workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Imported title");

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Imported title");
});

test("a second tab adopts external changes", async ({ page, context }) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  await expect(
    other.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");

  await page
    .getByRole("textbox", { name: "Chapter title", exact: true })
    .fill("Synced from tab one");
  await page.getByRole("textbox", { name: "Chapter title" }).press("Tab");

  await expect(
    other.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Synced from tab one");
});

test("a failed write is reported and can be retried", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__restoreStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function failingSetItem() {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });

  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New chapter title", exact: true })
    .fill("Unsaved chapter");
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();

  await expect(page.locator(".storage-banner-error")).toContainText(
    "Changes are not saved",
  );

  await page.evaluate(() => window.__restoreStorage());
  await page.getByRole("button", { name: "Retry saving" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "All changes saved",
  );

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Unsaved chapter");
});
