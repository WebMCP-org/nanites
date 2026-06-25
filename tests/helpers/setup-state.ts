import {
  createInitialSetupState,
  type NanitesSetupState,
} from "#/backend/agents/NanitesSetupAgent.ts";

export const repositoryInstalledSetupState = {
  setupComplete: true,
  currentStep: "launch",
  githubApp: {
    status: "complete",
    slug: "nanites-test",
  },
  repositories: {
    status: "complete",
    githubInstallationId: 42,
    repositoryFullName: "WebMCP-org/nanites",
  },
} as const;

export function buildCloudflareVerifiedSetupState(): NanitesSetupState {
  const initialState = createInitialSetupState();
  return {
    ...initialState,
    currentStep: "github-app",
    cloudflare: {
      status: "verified",
      authorizationUrl: null,
      accountId: "test-account",
      accountName: "Test Account",
      scriptName: "sigvelo-agent-tests",
      readiness: { status: "ready", checkedAt: new Date().toISOString(), items: [] },
      error: null,
    },
    githubApp: {
      ...initialState.githubApp,
      status: "ready",
    },
  };
}

export function readSetupInstallNonce(setupState: NanitesSetupState): string {
  const installUrl = setupState.githubApp.installUrl;
  const installState = installUrl ? new URL(installUrl).searchParams.get("state") : null;
  if (!installState) {
    throw new Error("Expected setup Agent to expose a repository install nonce.");
  }
  return installState;
}
