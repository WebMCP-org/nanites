import { defineConfig, devices } from "@playwright/test";

/**
 * Page-level accessibility tests for React component Storybook.
 *
 * Scans composed Storybook pages for WCAG 2.2 AA violations that
 * individual story tests might miss (duplicate IDs, landmarks, dark mode contrast).
 *
 * Prerequisites: start Storybook first with `pnpm storybook`
 * Run: pnpm test:a11y
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:6011",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
