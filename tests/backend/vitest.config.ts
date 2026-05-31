import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus/test/config";
import agents from "agents/vite";

const testsDir = import.meta.dirname;
const srcDir = path.join(testsDir, "../../src");

export default defineConfig({
  plugins: [
    agents(),
    cloudflareTest({
      wrangler: {
        configPath: path.join(testsDir, "wrangler.jsonc"),
      },
    }),
  ],
  resolve: {
    alias: [{ find: /^#\/(.*)$/, replacement: `${srcDir}/$1` }],
    tsconfigPaths: true,
  },
  test: {
    name: "backend",
    globals: true,
    include: [path.join(testsDir, "**/*.test.ts")],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    passWithNoTests: true,
  },
});
