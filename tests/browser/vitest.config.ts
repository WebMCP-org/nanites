import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus/test/config";
import { playwright } from "vite-plus/test/browser-playwright";

const testsDir = import.meta.dirname;
const srcDir = path.join(testsDir, "../../src");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^#\/(.*)$/, replacement: `${srcDir}/$1` }],
    tsconfigPaths: true,
  },
  test: {
    name: "browser",
    include: [path.join(testsDir, "**/*.test.ts"), path.join(testsDir, "**/*.test.tsx")],
    setupFiles: [path.join(testsDir, "../helpers/browser-msw-setup.ts")],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
    passWithNoTests: true,
  },
});
