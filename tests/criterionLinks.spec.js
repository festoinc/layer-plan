import { test, expect } from "./fixtures";

const linkedText =
  "**Verify reset tokens**\n\nTokens expire after `30 minutes`.";

function chapterButton(page, title) {
  return page
    .getByRole("navigation", { name: "Chapters" })
    .getByRole("button", { name: title, exact: true });
}

async function addLinkedCriterion(page, text = linkedText) {
  await page.goto("/");
  await page.getByLabel("New success criterion").fill(text);
  await page.getByLabel("New success criterion").press("Enter");
  await expect(chapterButton(page, "Verify reset tokens")).toBeVisible();
}

test("editing a criterion updates its subchapter and the link affordances", async ({
  page,
  request,
}) => {
  await addLinkedCriterion(page);
  const criteria = page.locator(".criteria-list > .criterion");
  await expect(criteria).toHaveCount(5);

  await page
    .getByRole("button", {
      name: "Open subchapter: Verify reset tokens",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Chapter title", { exact: true })).toHaveValue(
    "Verify reset tokens",
  );
  const note = page.locator(".criterion-source-note");
  await expect(note).toContainText("Created from the success criterion");
  await note
    .getByRole("button", { name: "Password reset", exact: true })
    .click();
  await expect(page.getByLabel("Chapter title", { exact: true })).toHaveValue(
    "Password reset",
  );

  await criteria
    .last()
    .getByRole("region", { name: "Criterion preview", exact: true })
    .dblclick();
  const criterionEditor = page.getByRole("textbox", {
    name: "Criterion text",
    exact: true,
  });
  await criterionEditor.fill(
    "**Reset token email**\n\nThe email arrives within one minute.",
  );
  await criterionEditor.press("Control+Enter");
  await expect(chapterButton(page, "Reset token email")).toBeVisible();

  await chapterButton(page, "Reset token email").click();
  const description = page.getByRole("region", {
    name: "Description preview",
    exact: true,
  });
  await expect(description).toContainText("within one minute");
  await expect(description.locator("strong")).toHaveText("Reset token email");

  await expect(page.getByRole("status").first()).toContainText(
    "All changes saved",
  );
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Description preview", exact: true }),
  ).toContainText("within one minute");

  const stored = await (
    await request.get("http://127.0.0.1:3001/api/v1/projects/website/document")
  ).json();
  const parent = stored.chapters.byId["password-reset"];
  const created = parent.criteria.at(-1);
  const subchapter = stored.chapters.byId[created.chapterId];
  expect(subchapter.title).toBe("Reset token email");
  expect(subchapter.description).toBe(
    "**Reset token email**\n\nThe email arrives within one minute.",
  );
});

test("editing a linked subchapter updates the criterion", async ({ page }) => {
  await addLinkedCriterion(page);
  await chapterButton(page, "Verify reset tokens").click();
  const description = page.getByRole("region", {
    name: "Description preview",
    exact: true,
  });
  await description.dblclick();
  const editor = page.getByRole("textbox", {
    name: "Description",
    exact: true,
  });
  await editor.fill("The email arrives within one minute.");
  await editor.press("Control+Enter");

  await expect(
    chapterButton(page, "The email arrives within one minute."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Password reset", exact: true })
    .first()
    .click();
  await expect(
    page.locator(".criteria-list > .criterion").last(),
  ).toContainText("The email arrives within one minute.");

  await expect(page.getByRole("status").first()).toContainText(
    "All changes saved",
  );
  await page.reload();
  await expect(
    page.locator(".criteria-list > .criterion").last(),
  ).toContainText("The email arrives within one minute.");
});

test("deleting a trivial criterion deletes its subchapter without a dialog", async ({
  page,
  request,
}) => {
  await addLinkedCriterion(page);
  await page
    .locator(".criteria-list > .criterion")
    .last()
    .locator(".remove-criterion")
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator(".criteria-list > .criterion")).toHaveCount(4);
  await expect(chapterButton(page, "Verify reset tokens")).toHaveCount(0);

  const stored = await (
    await request.get("http://127.0.0.1:3001/api/v1/projects/website/document")
  ).json();
  expect(
    stored.chapters.byId["password-reset"].criteria.some(
      (item) => item.text === linkedText,
    ),
  ).toBe(false);
  expect(
    Object.values(stored.chapters.byId).some(
      (chapter) => chapter.title === "Verify reset tokens",
    ),
  ).toBe(false);
});

test("deleting a non-trivial criterion asks for confirmation and removes the subtree", async ({
  page,
  request,
}) => {
  await addLinkedCriterion(page);
  await chapterButton(page, "Verify reset tokens").click();
  await page
    .getByRole("button", {
      name: "Add subchapter to Verify reset tokens",
      exact: true,
    })
    .click();
  await page
    .getByLabel("New chapter title", { exact: true })
    .fill("Implementation notes");
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await expect(chapterButton(page, "Implementation notes")).toBeVisible();

  await page
    .getByRole("button", { name: "Password reset", exact: true })
    .first()
    .click();
  const remove = page
    .locator(".criteria-list > .criterion")
    .last()
    .locator(".remove-criterion");
  await remove.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Verify reset tokens");
  await expect(dialog).toContainText("2 chapters in total");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chapterButton(page, "Implementation notes")).toBeVisible();

  await remove.click();
  await page
    .getByRole("button", {
      name: "Delete criterion and subchapter",
      exact: true,
    })
    .click();
  await expect(chapterButton(page, "Verify reset tokens")).toHaveCount(0);
  await expect(chapterButton(page, "Implementation notes")).toHaveCount(0);

  await expect(page.getByRole("status").first()).toContainText(
    "All changes saved",
  );
  await page.reload();
  await expect(chapterButton(page, "Verify reset tokens")).toHaveCount(0);
  const stored = await (
    await request.get("http://127.0.0.1:3001/api/v1/projects/website/document")
  ).json();
  expect(
    stored.chapters.byId["password-reset"].criteria.some(
      (item) => item.text === linkedText,
    ),
  ).toBe(false);
  expect(
    Object.values(stored.chapters.byId).some(
      (chapter) => chapter.title === "Implementation notes",
    ),
  ).toBe(false);
});
