import { defineConfig } from "vite-plus";
import { noTestMocksOverride } from "./tooling/lint/no-test-mocks.ts";

export default defineConfig({
  staged: {
    "*.{ts,tsx,js,jsx}": "vp check --fix",
  },
  fmt: {},
  lint: {
    options: { typeAware: true, typeCheck: true },
    // @ts-expect-error Vite+ forwards Oxlint overrides even though the current config typing lags the docs.
    overrides: [noTestMocksOverride],
  },
  test: {
    include: [
      "apps/**/{src,tests}/**/*.test.{ts,tsx,js,jsx}",
      "packages/**/{src,tests}/**/*.test.{ts,tsx,js,jsx}",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/opensrc/**", "apps/nanites/**"],
  },
  run: {
    cache: true,
  },
});
