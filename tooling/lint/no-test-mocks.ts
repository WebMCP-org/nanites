export const TEST_MOCK_METHOD_MESSAGE =
  "Do not use test mocks/stubs/spies here. If you think you need one, the test lane is probably wrong. Prefer a slice integration test. Mock external HTTP boundaries with MSW only.";

// Native Oxlint in this toolchain can ban the vi/jest entry points in test files,
// which blocks the mock/stub/spy API surface listed below without a custom plugin.
export const RESTRICTED_TEST_MOCK_METHODS = [
  "fn",
  "spyOn",
  "mock",
  "doMock",
  "mocked",
  "importMock",
  "unmock",
  "doUnmock",
  "stubEnv",
  "stubGlobal",
  "clearAllMocks",
  "resetAllMocks",
  "restoreAllMocks",
] as const;

export const TEST_FILE_GLOBS = ["**/*.test.{ts,tsx,js,jsx}", "**/*.spec.{ts,tsx,js,jsx}"] as const;

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
