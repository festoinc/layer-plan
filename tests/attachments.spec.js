import { expect, test } from "./fixtures";

const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

function openAttachments(page) {
  return page
    .locator(".workspace-tools")
    .getByRole("button", { name: "Attachments", exact: true })
    .click();
}

test("documents accept, persist, download and remove attachments", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/projects/website/chapters/password-reset");
  await openAttachments(page);
  const dialog = page.getByRole("dialog", {
    name: "Attachments for Website project",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("No attachments yet.")).toBeVisible();

  await dialog.getByLabel("Attach files").setInputFiles({
    name: "requirements.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(dialog.getByText("requirements.pdf")).toBeVisible();
  await expect(dialog.getByText("1 of 20")).toBeVisible();
  await expect(dialog.getByText("application/pdf")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download requirements.pdf", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("requirements.pdf");

  await page.reload();
  await openAttachments(page);
  await expect(
    dialog.getByRole("button", { name: "Download requirements.pdf" }),
  ).toBeVisible();

  await dialog.getByLabel("Attach files").setInputFiles({
    name: "animation.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "unsupported file type",
  );
  await expect(dialog.locator(".attachment-list li")).toHaveCount(1);

  await dialog
    .getByRole("button", { name: "Delete requirements.pdf", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByText("No attachments yet.")).toBeVisible();
  await expect(dialog.getByText("0 of 20")).toBeVisible();
  await page.reload();
  await openAttachments(page);
  await expect(dialog.getByText("No attachments yet.")).toBeVisible();
  expect(errors).toEqual([]);
});
