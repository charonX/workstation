// @ts-check
const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: "./tests",
  /* Run tests in files in parallel only where safe; Electron tests share an app instance per worker */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI for Electron stability */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use */
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  /* Shared settings for all the projects below */
  use: {
    /* Collect trace and screenshot on failure for evidence */
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  /* Configure projects for major desktop browsers */
  projects: [
    {
      name: "electron",
      use: {
        ...devices["Desktop Chrome"],
        // Electron app is launched by the test fixture, not by Playwright's browser launcher.
      },
    },
  ],

  /* Output directory for test artifacts */
  outputDir: "./playwright-report/test-artifacts",
});
