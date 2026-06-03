const TEST_MOCK_METHOD_MESSAGE =
  "Do not use test mocks/stubs/spies here. If you think you need one, the test lane is probably wrong. Prefer a slice integration test. Mock external HTTP boundaries with MSW only.";

const TEST_FILE_GLOBS = ["**/*.test.{ts,tsx,js,jsx}", "**/*.spec.{ts,tsx,js,jsx}"] as const;

const restrictedTestMockGlobals = [
  {
    name: "vi",
    message: TEST_MOCK_METHOD_MESSAGE,
  },
  {
    name: "jest",
    message: TEST_MOCK_METHOD_MESSAGE,
  },
] as const;

const noTestMocksImportRule = [
  "error",
  {
    paths: [
      {
        name: "vite-plus/test",
        importNames: ["vi"],
        message: TEST_MOCK_METHOD_MESSAGE,
      },
      {
        name: "vitest",
        importNames: ["vi"],
        message: TEST_MOCK_METHOD_MESSAGE,
      },
      {
        name: "@jest/globals",
        importNames: ["jest"],
        message: TEST_MOCK_METHOD_MESSAGE,
      },
    ],
  },
] as const;

const noTestMocksGlobalRule = ["error", ...restrictedTestMockGlobals] as const;

export const noTestMocksOverride = {
  files: [...TEST_FILE_GLOBS],
  rules: {
    "no-restricted-globals": noTestMocksGlobalRule,
    "no-restricted-imports": noTestMocksImportRule,
  },
} as const;
