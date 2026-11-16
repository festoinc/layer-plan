import AxeBuilder from "@axe-core/playwright";
import {
  addSessionCookie,
  apiBase,
  expect,
  loginCookie,
  superAdmin,
  test,
} from "./fixtures";

test("project actions manage MCP API keys", async ({ page }) => {
  await page.goto("/#/projects");
  const card = page.locator(".project-card", { hasText: "Website project" });
  await card
    .getByRole("button", { name: "Actions for Website project" })
    .click();
  await page.getByRole("menuitem", { name: "API keys" }).click();
  await expect(
    page.getByRole("heading", { name: "API keys for Website project" }),
  ).toBeVisible();

  await page.getByLabel("Key name").fill("E2E agent");
  await page.getByLabel("Scope").selectOption("read");
  await page.getByLabel("Expires in days").fill("3650");
  await page.getByRole("button", { name: "Create API key" }).click();
  const token = page.locator(".token-created code");
  await expect(token).toContainText("lrs_");
  const secret = (await token.textContent()).trim();
  expect(secret.length).toBeGreaterThan(20);

  await page.getByRole("button", { name: "Close API keys dialog" }).click();
  await card
    .getByRole("button", { name: "Actions for Website project" })
    .click();
  await page.getByRole("menuitem", { name: "API keys" }).click();
  await expect(page.locator(".token-created")).toHaveCount(0);
  await expect(page.locator(".token-list")).toContainText("E2E agent");
  await expect(
    page.locator(".token-list").getByText(/Read only/),
  ).toBeVisible();
  await page
    .locator(".token-list li", { hasText: "E2E agent" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.locator(".token-list")).toContainText("Revoked");
});

test("super admin creates and disables a member", async ({ page }) => {
  await page.goto("/#/users");
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();

  await page.getByLabel("Email").fill("member-ui@example.test");
  await page.getByLabel("Display name (optional)").fill("Member UI");
  await page
    .getByLabel("Password", { exact: true })
    .fill("member-password-123");
  await page.getByLabel("Confirm password").fill("member-password-123");
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByText(/Created member-ui@example.test/)).toBeVisible();
  await expect(page.locator(".user-list")).toContainText("Member UI");

  const row = page.locator(".user-list li", { hasText: "Member UI" });
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(row).toContainText("Disabled");
  await row.getByRole("button", { name: "Enable" }).click();
  await expect(row.getByRole("button", { name: "Disable" })).toBeVisible();

  const selfRow = page.locator(".user-list li", { hasText: superAdmin.email });
  await expect(selfRow.getByRole("button", { name: "Disable" })).toBeDisabled();
});

test("member and super admin have separate project catalogs", async ({
  page,
  request,
  context,
  browser,
}) => {
  const superCookie = await loginCookie(
    request,
    superAdmin.email,
    superAdmin.password,
  );
  const created = await request.post(`${apiBase}/users`, {
    headers: { cookie: superCookie },
    data: {
      email: "member-private@example.test",
      password: "member-password-123",
      displayName: "Private Member",
    },
  });
  expect(created.ok()).toBeTruthy();
  const memberCookie = await loginCookie(
    request,
    "member-private@example.test",
    "member-password-123",
  );
  const projectResponse = await request.post(`${apiBase}/projects`, {
    headers: { cookie: memberCookie },
    data: { name: "Member private project" },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();

  await page.goto("/#/projects");
  await expect(page.locator(".projects-page")).not.toContainText(
    "Member private project",
  );

  const memberContext = await browser.newContext();
  await addSessionCookie(memberContext, memberCookie);
  const memberPage = await memberContext.newPage();
  const origin = new URL(page.url()).origin;
  await memberPage.goto(`${origin}/#/projects`);
  await expect(memberPage.locator(".projects-page")).toContainText(
    "Member private project",
  );
  await memberPage.goto(`${origin}/#/projects/${project.id}/chapters`);
  await expect(memberPage.locator(".sidebar")).toBeVisible();

  await page.goto(`${origin}/#/projects/${project.id}/chapters`);
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.locator(".projects-page")).not.toContainText(
    "Member private project",
  );

  await memberContext.close();
  await context.clearCookies();
});

test("account and users pages are accessible", async ({ page }) => {
  for (const hash of ["#/account", "#/users"]) {
    await page.goto(`/${hash}`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
});
