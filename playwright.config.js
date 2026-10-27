import { defineConfig } from "@playwright/test";

const production = process.env.E2E_TARGET === "production";
const port = production ? 4174 : 5173;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/unit/**"],
  use: {
    baseURL,
    browserName: "chromium",
    reducedMotion: "reduce",
  },
  webServer: {
    command: production
      ? `npm run preview -- --port ${port} --strictPort`
      : "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
  },
});
