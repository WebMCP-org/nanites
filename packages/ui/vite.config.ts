import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";

import { playwright } from "vite-plus/test/browser-playwright";

const dirname =
  typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const storybookPlugins = await storybookTest({
    configDir: path.join(dirname, ".storybook"),
  });

  return {
    pack: {
      entry: ["src/index.ts"],
      sourcemap: false,
      fixedExtension: false,
      copy: [{ from: "src/styles", to: "dist", flatten: false }],
      deps: {
        neverBundle: ["react", "react-dom"],
      },
      dts: true,
    },
    lint: {
      options: {
        typeAware: true,
        typeCheck: true,
      },
    },
    fmt: {},
    test: {
      projects: [
        {
          extends: true,
          plugins: storybookPlugins,
          test: {
            name: "storybook",
            browser: {
              enabled: true,
              headless: true,
              provider: playwright({}),
              instances: [{ browser: "chromium" }],
            },
            setupFiles: [".storybook/vitest.setup.ts"],
          },
        },
      ],
    },
  };
});
