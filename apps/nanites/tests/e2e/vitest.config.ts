import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import agents from "agents/vite";
import { defineConfig } from "vite-plus/test/config";

const testsDir = import.meta.dirname;
const srcDir = fileURLToPath(new URL("../../src", import.meta.url));

export default defineConfig({
  plugins: [
    agents(),
    cloudflareTest({
      wrangler: {
        configPath: path.join(testsDir, "../backend/wrangler.jsonc"),
      },
    }),
  ],
  resolve: {
    alias: [{ find: /^#\/(.*)$/, replacement: `${srcDir}/$1` }],
    tsconfigPaths: true,
  },
  test: {
    name: "nanites-e2e",
    globals: true,
    include: [path.join(testsDir, "**/*.e2e.test.ts")],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    passWithNoTests: false,
  },
});
