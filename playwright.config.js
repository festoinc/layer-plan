import { defineConfig } from "@playwright/test";

const production = process.env.E2E_TARGET === "production";
const port = production ? 3001 : 5173;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/unit/**", "**/api/**", "**/contract/**", "**/fixtures.js"],
  workers: 1,
  use: {
    baseURL,
    browserName: "chromium",
    reducedMotion: "reduce",
  },
  webServer: {
    command: production ? "npm start" : "npm run dev:e2e",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
