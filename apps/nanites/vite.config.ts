import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryCliBinaryExists, sentryVitePlugin } from "@sentry/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import type { PluginOption } from "vite-plus";
import agents from "agents/vite";
import { fileURLToPath } from "node:url";
import { noTestMocksOverride } from "../../tooling/lint/no-test-mocks.ts";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
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
}) as PluginOption;

if (hasSentryBuildConfig && !canUploadSentrySourceMaps) {
  console.warn(
    "Sentry source map upload is configured but the @sentry/cli binary is unavailable. Approve @sentry/cli build scripts or upload artifacts with `vp dlx -- @sentry/cli ...`.",
  );
}

function cloudflareNodeRequireInterop(): PluginOption {
  const runtimeMarker = "Calling `require`";
  const requireStart = "var __require = /* @__PURE__ */";
  const requireEnd = ");\n//#endregion";

  return {
    name: "sigvelo:cloudflare-node-require-interop",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (
          chunk.type !== "chunk" ||
          !chunk.code.includes(runtimeMarker) ||
          !chunk.code.includes(requireStart)
        ) {
          continue;
        }

        const imports = [
          'import * as __sigvelo_node_buffer from "node:buffer";',
          'import * as __sigvelo_node_crypto from "node:crypto";',
          'import * as __sigvelo_node_os from "node:os";',
          'import * as __sigvelo_node_path from "node:path";',
          'import * as __sigvelo_node_util from "node:util";',
        ].join("\n");

        let code = `${imports}\n${chunk.code}`;
        const start = code.indexOf(requireStart);
        const end = code.indexOf(requireEnd, start);
        if (start === -1 || end === -1) {
          this.error("Unable to patch Rolldown runtime require shim for Cloudflare Workers.");
        }

        const replacement = [
          "var __require = (id) => {",
          '\tif (id === "buffer") return __sigvelo_node_buffer;',
          '\tif (id === "crypto") return __sigvelo_node_crypto;',
          '\tif (id === "os") return __sigvelo_node_os;',
          '\tif (id === "path") return __sigvelo_node_path;',
          '\tif (id === "util") return __sigvelo_node_util;',
          '\tif (typeof require !== "undefined") return require(id);',
          '\tthrow Error("Calling require for \\"" + id + "\\" in an environment that does not expose require.");',
          "};",
        ].join("\n");

        code = code.slice(0, start) + replacement + code.slice(end + 2);
        chunk.code = code;
      }
    },
  };
}

export default defineConfig({
  build: {
    sourcemap: hasSentryBuildConfig,
  },
  plugins: [
    cloudflareNodeRequireInterop(),
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
    trailingComma: "none",
    printWidth: 80,
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
});
