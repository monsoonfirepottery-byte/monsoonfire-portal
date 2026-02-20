import { defineConfig } from "@playwright/test";

const hasRemoteBaseUrl = Boolean(process.env.BASE_URL);
const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests",
  outputDir: "../test-results/website-e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../output/playwright/website-e2e-report" }],
  ],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1366, height: 900 },
  },
  webServer: hasRemoteBaseUrl
    ? undefined
    : {
        command: "node ./ncsitebuilder/scripts/serve.mjs --host 127.0.0.1 --port 4173 --root ./ncsitebuilder",
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
