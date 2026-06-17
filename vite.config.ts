import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryCliBinaryExists, sentryVitePlugin } from "@sentry/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import type { PluginOption } from "vite-plus";
import agents from "agents/vite";
import path from "node:path";
import { noTestMocksOverride } from "./tooling/lint/no-test-mocks.ts";

const srcDir = path.join(import.meta.dirname, "src");
const isVitest = process.env.VITEST !== undefined;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT?.split(",")
  .map((project) => project.trim())
  .filter(Boolean);
const hasSentryBuildConfig =
  Boolean(process.env.SENTRY_AUTH_TOKEN) &&
  Boolean(sentryOrg) &&
  Boolean(sentryProject && sentryProject.length > 0);
const canUploadSentrySourceMaps = hasSentryBuildConfig && sentryCliBinaryExists();
const sentryProjects =
  !sentryProject || sentryProject.length === 0
    ? undefined
    : sentryProject.length === 1
      ? sentryProject[0]
      : sentryProject;
const routerPlugin = tanstackRouter({
  target: "react",
  routesDirectory: "./src/frontend/routes",
  generatedRouteTree: "./src/frontend/routeTree.gen.ts",
  quoteStyle: "double",
  semicolons: true,
  autoCodeSplitting: true,
}) as PluginOption;

if (hasSentryBuildConfig && !canUploadSentrySourceMaps) {
  console.warn(
    "Sentry source map upload is configured but the @sentry/cli binary is unavailable. Approve @sentry/cli build scripts or upload artifacts with `vp dlx -- @sentry/cli ...`.",
  );
}

export default defineConfig({
  staged: {
    "*.{ts,tsx,js,jsx}": "vp check --fix",
  },
  build: {
    sourcemap: hasSentryBuildConfig,
  },
  plugins: [
    routerPlugin,
    agents() as PluginOption,
    react() as PluginOption,
    ...(!isVitest ? ([cloudflare() as PluginOption] satisfies PluginOption[]) : []),
    ...(!isVitest && hasSentryBuildConfig
      ? ([
          sentryVitePlugin({
            org: sentryOrg,
            project: sentryProjects,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            telemetry: false,
            sourcemaps: {
              disable: canUploadSentrySourceMaps ? false : "disable-upload",
              filesToDeleteAfterUpload: canUploadSentrySourceMaps
                ? ["./dist/client/**/*.js.map", "./dist/nanites_app/**/*.js.map"]
                : undefined,
            },
            release: {
              name: process.env.SENTRY_RELEASE,
              create: canUploadSentrySourceMaps,
              finalize: canUploadSentrySourceMaps,
              setCommits: canUploadSentrySourceMaps ? { auto: true } : false,
            },
          }) as PluginOption,
        ] satisfies PluginOption[])
      : []),
  ],
  resolve: {
    alias: [{ find: /^#\/(.*)$/, replacement: `${srcDir}/$1` }],
    tsconfigPaths: true,
  },
  optimizeDeps: {
    exclude: ["shiki"],
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
