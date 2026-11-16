import { expect, test as base } from "@playwright/test";

export const apiBase = "http://127.0.0.1:3001/api/v1";
export const superAdmin = {
  email: "super@example.test",
  password: "test-super-admin-password",
};

const resetApi = async (request) => {
  const response = await request.post(`${apiBase}/test/reset`);
  if (!response.ok()) {
    throw new Error(
      `Could not reset the E2E database: ${response.status()} ${await response.text()}`,
    );
  }
};

export async function loginCookie(request, email, password) {
  const response = await request.post(`${apiBase}/auth/login`, {
    data: { email, password },
  });
  if (!response.ok()) {
    throw new Error(
      `Could not sign in ${email}: ${response.status()} ${await response.text()}`,
    );
  }
  const setCookie = response.headers()["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error("The login did not set a session cookie.");
  return raw.split(";")[0];
}

export async function addSessionCookie(context, cookiePair) {
  const separator = cookiePair.indexOf("=");
  await context.addCookies([
    {
      name: cookiePair.slice(0, separator),
      value: cookiePair.slice(separator + 1),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function signInSuperAdmin(request, context) {
  const cookie = await loginCookie(
    request,
    superAdmin.email,
    superAdmin.password,
  );
  await addSessionCookie(context, cookie);
  return cookie;
}

export const test = base.extend({
  resetApi: [
    async ({ request, context }, use) => {
      await resetApi(request);
      await signInSuperAdmin(request, context);
      await use();
    },
    { auto: true },
  ],
});

export const anonymousTest = base.extend({
  resetApi: [
    async ({ request }, use) => {
      await resetApi(request);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
