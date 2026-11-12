import { expect, test as base } from "@playwright/test";

const resetApi = async (request) => {
  const response = await request.post(
    "http://127.0.0.1:3001/api/v1/test/reset",
  );
  if (!response.ok()) {
    throw new Error(
      `Could not reset the E2E database: ${response.status()} ${await response.text()}`,
    );
  }
};

export const test = base.extend({
  resetApi: [
    async ({ request }, use) => {
      await resetApi(request);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
