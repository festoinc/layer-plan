import { test, expect } from "@playwright/test";

test("nested chapters, descriptions, and checklists save independently", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByLabel("Chapter title", { exact: true })).toHaveValue(
    "Password reset",
  );
  await page
    .getByRole("button", { name: "SMTP requirements", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Description preview", exact: true }),
  ).toContainText("SMTP");
  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New chapter title", exact: true })
    .fill("Notifications");
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Description preview", exact: true }),
  ).toContainText("What should this part of the project do?");
  let parent = "Notifications";
  for (let index = 1; index <= 7; index++) {
    await page
      .getByRole("button", { name: `Add subchapter to ${parent}`, exact: true })
      .click();
    parent = `Nested chapter ${index}`;
    await page
      .getByRole("textbox", { name: "New chapter title", exact: true })
      .fill(parent);
    await page
      .getByRole("textbox", { name: "New chapter title", exact: true })
      .press("Enter");
    await expect(page.getByLabel("Chapter title", { exact: true })).toHaveValue(
      parent,
    );
  }
  await page
    .getByRole("region", { name: "Description preview", exact: true })
    .dblclick();
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Deliver notifications reliably.");
  await page
    .getByLabel("New success criterion")
    .fill("A notification is delivered");
  await page.getByLabel("New success criterion").press("Enter");
  await page
    .getByRole("checkbox", { name: "Complete: A notification is delivered" })
    .check();
  await page
    .getByRole("region", { name: "Criterion preview", exact: true })
    .dblclick();
  await page
    .getByLabel("Criterion text", { exact: true })
    .fill("Delivery is confirmed");
  await page.reload();
  await expect(page.getByLabel("Chapter title", { exact: true })).toHaveValue(
    "Nested chapter 7",
  );
  await expect(
    page.getByRole("region", { name: "Description preview", exact: true }),
  ).toHaveText("Deliver notifications reliably.");
  await expect(
    page.getByRole("checkbox", { name: "Complete: Delivery is confirmed" }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Password reset", exact: true })
    .click();
  await expect(page.locator(".criterion")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Nested chapter 7", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove criterion: Delivery is confirmed" })
    .click();
  await expect(page.locator(".criterion")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("chapter tree can collapse, chapter creation can cancel, and mobile layout works", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.screenshot({
    path: "test-results/layers-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Collapse Authentication", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "SMTP requirements", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expand Authentication", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "SMTP requirements", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New chapter title", exact: true })
    .press("Escape");
  await expect(
    page.getByRole("textbox", { name: "New chapter title", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Chapter title", { exact: true })
    .fill("Recover account");
  await expect(
    page.getByRole("button", { name: "Recover account", exact: true }),
  ).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open chapters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "SMTP requirements", exact: true })
    .click();
  await expect(page.getByLabel("Chapter title", { exact: true })).toHaveValue(
    "SMTP requirements",
  );
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/layers-mobile.png",
    fullPage: true,
  });
});

test("workspace tabs show the coverage placeholder and persistent activity", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Test coverage", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Test coverage", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".development-badge")).toHaveText("In development");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No activity yet" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Specifications", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");
  await page
    .getByRole("region", { name: "Description preview", exact: true })
    .dblclick();
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("An updated reset flow.");
  await page
    .getByLabel("New success criterion")
    .fill("Reset tokens are single use");
  await page.getByLabel("New success criterion").press("Enter");
  await page
    .getByRole("checkbox", { name: "Complete: Reset tokens are single use" })
    .check();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".activity-list li")).toHaveCount(4);
  await expect(page.locator(".activity-list")).toContainText(
    "Updated description",
  );
  await expect(page.locator(".activity-list")).toContainText(
    "Added criterion: Reset tokens are single use",
  );
  await expect(page.locator(".activity-list")).toContainText(
    "Completed criterion: Reset tokens are single use",
  );
  await page.reload();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".activity-list li")).toHaveCount(4);
  await page
    .locator(".activity-list")
    .getByRole("button", { name: "Password reset", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("textbox", { name: "Chapter title", exact: true }),
  ).toHaveValue("Password reset");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open chapters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Test coverage", exact: true })
    .click();
  await expect(page.locator(".development-badge")).toBeVisible();
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
});

test("Markdown is previewed by default and edits on double click or keyboard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /^(Write|Preview) / }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveCount(0);
  const description = page.getByRole("region", {
    name: "Description preview",
    exact: true,
  });
  await description.click();
  await expect(description).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveCount(0);
  await description.dblclick();
  const editor = page.getByRole("textbox", {
    name: "Description",
    exact: true,
  });
  await expect(editor).toBeFocused();
  const markdown =
    "## Reset flow\n\nUse **email** and *secure links*. ~~Old flow~~\n\n| Rule | Value |\n| --- | --- |\n| Expiry | 30 minutes |\n\n- [x] Email configured\n- [ ] Delivery verified\n\n```js\nconst expires = 30;\n```\n\n[Documentation](https://example.com/docs)\n\n<script>window.markdownExecuted = true</script>\n\n[Unsafe](javascript:alert(1))";
  await editor.fill(markdown);
  await page.getByRole("heading", { name: "Description", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(
    description.getByRole("heading", { name: "Reset flow" }),
  ).toBeVisible();
  await expect(description.locator("strong")).toHaveText("email");
  await expect(description.locator("del")).toHaveText("Old flow");
  await expect(description.getByRole("table")).toContainText("30 minutes");
  await expect(description.getByRole("checkbox")).toHaveCount(2);
  await expect(description.getByRole("checkbox").first()).toBeChecked();
  await expect(description.locator("pre code")).toHaveText(
    "const expires = 30;\n",
  );
  await expect(
    description.getByRole("link", { name: "Documentation" }),
  ).toHaveAttribute("href", "https://example.com/docs");
  expect(await page.evaluate(() => window.markdownExecuted)).toBeUndefined();
  await expect(description.locator('[href^="javascript:"]')).toHaveCount(0);
  await description.focus();
  await description.press("Enter");
  await expect(editor).toHaveValue(markdown);
  await editor.press("Escape");
  await expect(description).toBeVisible();
  const criterion =
    "**Deliver the email** with a `reset_token`.\n\n- Include a [reset link](https://example.com/reset)\n- Expire after ~~60~~ 30 minutes";
  await page.getByLabel("New success criterion").fill(criterion);
  await page.getByLabel("New success criterion").press("Enter");
  const preview = page
    .getByRole("region", { name: "Criterion preview", exact: true })
    .last();
  await expect(preview.locator("strong")).toHaveText("Deliver the email");
  await expect(preview.locator("code")).toHaveText("reset_token");
  await expect(preview.getByRole("listitem")).toHaveCount(2);
  await preview.dblclick();
  const criterionEditor = page.getByRole("textbox", {
    name: "Criterion text",
    exact: true,
  });
  await expect(criterionEditor).toBeFocused();
  await expect(criterionEditor).toHaveValue(criterion);
  // Editing one item leaves all the other items formatted.
  await expect(
    page.getByRole("region", { name: "Criterion preview", exact: true }),
  ).toHaveCount(4);
  await criterionEditor.fill(criterion + "\n\n**Confirmed**");
  await criterionEditor.press("Control+Enter");
  await expect(criterionEditor).toHaveCount(0);
  await expect(preview.locator("strong").last()).toHaveText("Confirmed");
  await page
    .locator(".criteria-list > .criterion")
    .last()
    .getByRole("checkbox")
    .check();
  await expect(page.locator(".criteria-list > .criterion").last()).toHaveClass(
    /complete/,
  );
  await page.reload();
  await expect(description.getByRole("table")).toContainText("30 minutes");
  await expect(preview.locator("strong").last()).toHaveText("Confirmed");
  await page.getByLabel("New success criterion").fill("First line");
  await page.getByLabel("New success criterion").press("Shift+Enter");
  await page
    .getByLabel("New success criterion")
    .pressSequentially("Second line");
  await expect(page.getByLabel("New success criterion")).toHaveValue(
    "First line\nSecond line",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("new criteria create subchapters while manual subchapters stay outside the checklist", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Collapse Password reset", exact: true })
    .click();
  const text = "**Verify reset tokens**\n\nTokens expire after `30 minutes`.";
  await page.getByLabel("New success criterion").fill(text);
  await page.getByLabel("New success criterion").press("Enter");
  await expect(page.getByLabel("Chapter title", { exact: true })).toHaveValue(
    "Password reset",
  );
  await expect(page.locator(".criterion")).toHaveCount(5);
  const automatic = page.getByRole("button", {
    name: "Verify reset tokens",
    exact: true,
  });
  await expect(automatic).toBeVisible();
  await automatic.click();
  await expect(
    page.getByRole("region", { name: "Description preview", exact: true }),
  ).toContainText("Tokens expire after 30 minutes.");
  await expect(
    page
      .getByRole("region", { name: "Description preview", exact: true })
      .locator("strong"),
  ).toHaveText("Verify reset tokens");
  await expect(page.locator(".criterion")).toHaveCount(0);
  // The same behavior works inside an automatically created subchapter.
  await page
    .getByLabel("New success criterion")
    .fill("Reject an expired token");
  await page.getByLabel("New success criterion").press("Enter");
  await expect(
    page.getByRole("button", { name: "Reject an expired token", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Chapter title", { exact: true })).toHaveValue(
    "Verify reset tokens",
  );
  // Manual creation adds a child document without adding a parent criterion.
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
  await expect(page.locator(".criterion")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Verify reset tokens", exact: true })
    .first()
    .click();
  await expect(page.locator(".criterion")).toHaveCount(1);
  await expect(page.locator(".criteria-list")).not.toContainText(
    "Implementation notes",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Implementation notes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reject an expired token", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".criterion")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Password reset", exact: true })
    .first()
    .click();
  await expect(page.locator(".criterion")).toHaveCount(5);
  await page.getByLabel("New success criterion").fill("   ");
  await page.getByLabel("New success criterion").press("Enter");
  await expect(page.locator(".criterion")).toHaveCount(5);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("layers:project:website:doc:v4")),
  );
  const parent = stored.chapters.byId["password-reset"];
  const createdCriterion = parent.criteria.at(-1);
  expect(parent.childIds).toContain(createdCriterion.chapterId);
  expect(stored.chapters.byId[createdCriterion.chapterId].description).toBe(
    text,
  );
});

test("final level stops automatic subdocuments and persists per document", async ({
  page,
}) => {
  await page.goto("/");
  const finalLevel = page.getByRole("checkbox", {
    name: "Final level",
    exact: true,
  });
  await expect(finalLevel).not.toBeChecked();
  await finalLevel.check();
  await page.getByLabel("New success criterion").fill("Verify a final outcome");
  await page.getByLabel("New success criterion").press("Enter");
  await expect(page.locator(".criterion")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "Verify a final outcome", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reset email template", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(finalLevel).toBeChecked();
  await expect(page.locator(".criteria-list")).toContainText(
    "Verify a final outcome",
  );
  // Manual subdocuments are still allowed and start with Final level off.
  await page
    .getByRole("button", {
      name: "Add subchapter to Password reset",
      exact: true,
    })
    .click();
  await page
    .getByLabel("New chapter title", { exact: true })
    .fill("Manual supporting notes");
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await expect(finalLevel).not.toBeChecked();
  await expect(page.locator(".criterion")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Password reset", exact: true })
    .first()
    .click();
  await expect(finalLevel).toBeChecked();
  await expect(page.locator(".criterion")).toHaveCount(5);
  await finalLevel.uncheck();
  await page
    .getByLabel("New success criterion")
    .fill("An outcome with more detail");
  await page.getByLabel("New success criterion").press("Enter");
  await expect(
    page.getByRole("button", {
      name: "An outcome with more detail",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verify a final outcome", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".criterion")).toHaveCount(6);
  await page
    .getByRole("button", { name: "An outcome with more detail", exact: true })
    .click();
  await expect(finalLevel).not.toBeChecked();
  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await page
    .getByLabel("New chapter title", { exact: true })
    .fill("Another chapter");
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await expect(finalLevel).not.toBeChecked();
});
