import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import type { PluginOption } from "vite-plus";
import agents from "agents/vite";
import path from "node:path";
import { noTestMocksOverride } from "./tooling/lint/no-test-mocks.ts";

const srcDir = path.join(import.meta.dirname, "src");
const isVitest = process.env.VITEST !== undefined;
const routerPlugin = tanstackRouter({
  target: "react",
  routesDirectory: "./src/frontend/routes",
  generatedRouteTree: "./src/frontend/routeTree.gen.ts",
  quoteStyle: "double",
  semicolons: true,
  autoCodeSplitting: true,
}) as PluginOption;

export default defineConfig({
  staged: {
    "*.{ts,tsx,js,jsx}": "vp check --fix",
  },
  plugins: [
    routerPlugin,
    agents() as PluginOption,
    react() as PluginOption,
    ...(!isVitest ? ([cloudflare() as PluginOption] satisfies PluginOption[]) : []),
  ],
  resolve: {
    alias: [{ find: /^#\/(.*)$/, replacement: `${srcDir}/$1` }],
    tsconfigPaths: true,
  },
  optimizeDeps: {
    exclude: ["shiki"],
    // Restrict dep-scan to the real entry; default `**/*.html` crawls vendored opensrc/ repos and fails.
    entries: ["index.html"],
  },
  fmt: {
    ignorePatterns: ["src/frontend/routeTree.gen.ts"],
  },
  lint: {
    plugins: ["react", "jsx-a11y", "typescript"],
    categories: {
      correctness: "error",
    },
    // @ts-expect-error Vite+ forwards Oxlint overrides even though the current config typing lags the docs.
    overrides: [noTestMocksOverride],
    rules: {
      "no-explicit-any": "error",
      "no-unused-expressions": "off",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
    ignorePatterns: ["**/env.d.ts", "src/frontend/routeTree.gen.ts"],
  },
  test: {
    projects: ["./tests/backend/vitest.config.ts", "./tests/browser/vitest.config.ts"],
  },
  run: {
    cache: true,
  },
});
